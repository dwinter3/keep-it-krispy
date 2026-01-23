import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { authenticateApiRequest } from '@/lib/api-auth'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const s3 = new S3Client({ region: AWS_REGION, credentials })
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

interface TranscriptItem {
  meeting_id: string
  s3_key: string
  title: string
  date: string
  timestamp: string
  speakers?: string[]
  speaker_corrections?: Record<string, { name: string; linkedin?: string }>
}

interface TranscriptContent {
  raw_payload?: {
    data?: {
      raw_content?: string
      raw_meeting?: string
    }
  }
}

export interface SpeakerContext {
  name: string
  contextKeywords: string[]
  companies: string[]
  topics: string[]
  roleHints: string[]
  transcriptCount: number
  recentMeetingTitles: string[]
}

// GET /api/speakers/[name]/context - Extract context from speaker's transcripts
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  // Authenticate via session or API key
  const authResult = await authenticateApiRequest(request)
  if (!authResult.authenticated || !authResult.userId) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }
  const userId = authResult.userId

  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()

    // Find all meetings with this speaker for this user
    const allItems: TranscriptItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ProjectionExpression: 'meeting_id, s3_key, title, #date, #timestamp, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
          '#timestamp': 'timestamp',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allItems.push(...(response.Items as TranscriptItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Filter meetings with this speaker
    const speakerMeetings: { key: string; title: string; date: string }[] = []
    let canonicalName = speakerName

    for (const item of allItems) {
      const speakers = item.speakers || []
      const corrections = item.speaker_corrections || {}

      for (const speaker of speakers) {
        const speakerLower = speaker.toLowerCase()
        const correction = corrections[speakerLower]
        const correctedName = correction?.name || speaker

        if (speakerLower === speakerNameLower ||
            correctedName.toLowerCase() === speakerNameLower) {
          speakerMeetings.push({
            key: item.s3_key,
            title: item.title || 'Untitled',
            date: item.timestamp || item.date,
          })
          if (correction?.name) {
            canonicalName = correction.name
          }
          break
        }
      }
    }

    if (speakerMeetings.length === 0) {
      return NextResponse.json({
        error: 'No meetings found for this speaker',
      }, { status: 404 })
    }

    // Sort by date and take most recent meetings for context
    speakerMeetings.sort((a, b) => b.date.localeCompare(a.date))
    const recentMeetings = speakerMeetings.slice(0, 10)

    // Fetch transcript content from S3
    const transcriptExcerpts: string[] = []
    for (const meeting of recentMeetings.slice(0, 5)) {
      try {
        const getCommand = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: meeting.key,
        })
        const response = await s3.send(getCommand)
        const body = await response.Body?.transformToString()
        if (body) {
          const content: TranscriptContent = JSON.parse(body)
          const transcript = content.raw_payload?.data?.raw_content || ''
          const summary = content.raw_payload?.data?.raw_meeting || ''

          // Extract relevant portions
          const excerpt = summary || transcript.slice(0, 3000)
          if (excerpt) {
            transcriptExcerpts.push(`Meeting: ${meeting.title}\n${excerpt}`)
          }
        }
      } catch (err) {
        console.error(`Error fetching transcript ${meeting.key}:`, err)
      }
    }

    if (transcriptExcerpts.length === 0) {
      // Return basic context without AI analysis
      return NextResponse.json({
        name: canonicalName,
        contextKeywords: [],
        companies: [],
        topics: [],
        roleHints: [],
        transcriptCount: speakerMeetings.length,
        recentMeetingTitles: recentMeetings.map(m => m.title),
      } as SpeakerContext)
    }

    // Use AI to extract context from transcripts
    const prompt = `Analyze the following meeting transcripts involving "${canonicalName}" and extract professional context that would help identify this person online.

Meeting transcripts:
${transcriptExcerpts.join('\n\n---\n\n')}

Extract and return a JSON object with:
1. "contextKeywords": 5-10 unique keywords/terms the speaker frequently uses or is associated with (technologies, products, domains)
2. "companies": Any company names mentioned or associated with this speaker (employer, partners, clients)
3. "topics": 3-5 main professional topics/areas they discuss
4. "roleHints": Any hints about their job role/title (e.g., "VP", "engineer", "product manager", "partnerships", "sales")

Be specific and extract actual terms from the conversations. Only include items you're confident about from the transcript content.

Return ONLY valid JSON:
{
  "contextKeywords": ["keyword1", "keyword2"],
  "companies": ["Company A", "Company B"],
  "topics": ["topic1", "topic2"],
  "roleHints": ["role hint 1", "role hint 2"]
}`

    let contextKeywords: string[] = []
    let companies: string[] = []
    let topics: string[] = []
    let roleHints: string[] = []

    try {
      const invokeCommand = new InvokeModelCommand({
        modelId: 'amazon.nova-2-lite-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          messages: [
            {
              role: 'user',
              content: [{ text: prompt }],
            },
          ],
          inferenceConfig: {
            maxTokens: 1000,
            temperature: 0.3,
          },
        }),
      })

      const response = await bedrock.send(invokeCommand)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))
      const assistantMessage = responseBody.output?.message?.content?.[0]?.text || ''

      // Parse the JSON response
      try {
        const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          contextKeywords = parsed.contextKeywords || []
          companies = parsed.companies || []
          topics = parsed.topics || []
          roleHints = parsed.roleHints || []
        }
      } catch {
        console.error('Failed to parse AI context response')
      }
    } catch (err) {
      console.error('Bedrock context extraction error:', err)
      // Continue with empty context
    }

    const result: SpeakerContext = {
      name: canonicalName,
      contextKeywords,
      companies,
      topics,
      roleHints,
      transcriptCount: speakerMeetings.length,
      recentMeetingTitles: recentMeetings.map(m => m.title),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Speaker context error:', error)
    return NextResponse.json(
      { error: 'Failed to extract speaker context', details: String(error) },
      { status: 500 }
    )
  }
}

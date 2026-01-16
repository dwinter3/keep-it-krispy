import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
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

// POST /api/speakers/[name]/enrich - Generate AI summary from meeting context
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()

    // Check if we have a recent enrichment (cache for 7 days)
    try {
      const getCommand = new GetCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
      })
      const existing = await dynamodb.send(getCommand)
      if (existing.Item?.enrichedAt) {
        const enrichedAt = new Date(existing.Item.enrichedAt)
        const daysSinceEnrich = (Date.now() - enrichedAt.getTime()) / (1000 * 60 * 60 * 24)
        if (daysSinceEnrich < 7 && existing.Item.aiSummary) {
          // Return cached enrichment
          return NextResponse.json({
            cached: true,
            aiSummary: existing.Item.aiSummary,
            topics: existing.Item.topics || [],
            enrichedAt: existing.Item.enrichedAt,
          })
        }
      }
    } catch {
      // Table may not exist, continue with enrichment
    }

    // Find all meetings with this speaker
    const allItems: TranscriptItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: 'meeting_id, s3_key, title, #date, #timestamp, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
          '#timestamp': 'timestamp',
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(scanCommand)
      if (response.Items) {
        allItems.push(...(response.Items as TranscriptItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Filter meetings with this speaker and get their S3 keys
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

    // Sort by date and take most recent 5 meetings for context
    speakerMeetings.sort((a, b) => b.date.localeCompare(a.date))
    const recentMeetings = speakerMeetings.slice(0, 5)

    // Fetch transcript content from S3
    const transcriptExcerpts: string[] = []
    for (const meeting of recentMeetings) {
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

          // Extract relevant portions (limit to 2000 chars per meeting)
          const excerpt = summary || transcript.slice(0, 2000)
          if (excerpt) {
            transcriptExcerpts.push(`Meeting: ${meeting.title} (${meeting.date})\n${excerpt}`)
          }
        }
      } catch (err) {
        console.error(`Error fetching transcript ${meeting.key}:`, err)
      }
    }

    if (transcriptExcerpts.length === 0) {
      return NextResponse.json({
        error: 'Could not fetch transcript content',
      }, { status: 500 })
    }

    // Generate AI summary using Bedrock Claude
    const prompt = `Based on the following meeting transcripts, provide a brief professional summary of ${canonicalName}. Focus on:
1. Their apparent role and expertise
2. Topics they typically discuss
3. Their communication style
4. Key themes from their conversations

Keep the summary concise (2-3 sentences) and professional. Also extract 3-5 key topics/themes as a list.

Meeting transcripts:
${transcriptExcerpts.join('\n\n---\n\n')}

Respond in JSON format:
{
  "summary": "Brief professional summary...",
  "topics": ["topic1", "topic2", "topic3"]
}`

    let aiSummary = ''
    let topics: string[] = []

    try {
      const invokeCommand = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 500,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
        }),
      })

      const response = await bedrock.send(invokeCommand)
      const responseBody = JSON.parse(new TextDecoder().decode(response.body))
      const assistantMessage = responseBody.content?.[0]?.text || ''

      // Parse the JSON response
      try {
        const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          aiSummary = parsed.summary || ''
          topics = parsed.topics || []
        }
      } catch {
        // If JSON parsing fails, use the raw response as summary
        aiSummary = assistantMessage
      }
    } catch (err) {
      console.error('Bedrock invocation error:', err)
      // Fallback: generate a basic summary without AI
      aiSummary = `${canonicalName} has participated in ${speakerMeetings.length} meeting${speakerMeetings.length !== 1 ? 's' : ''}.`
      topics = ['Meetings']
    }

    // Cache the enrichment in DynamoDB
    try {
      const updateCommand = new UpdateCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
        UpdateExpression: 'SET #aiSummary = :aiSummary, #topics = :topics, #enrichedAt = :enrichedAt, #displayName = :displayName',
        ExpressionAttributeNames: {
          '#aiSummary': 'aiSummary',
          '#topics': 'topics',
          '#enrichedAt': 'enrichedAt',
          '#displayName': 'displayName',
        },
        ExpressionAttributeValues: {
          ':aiSummary': aiSummary,
          ':topics': topics,
          ':enrichedAt': new Date().toISOString(),
          ':displayName': canonicalName,
        },
      })
      await dynamodb.send(updateCommand)
    } catch (err) {
      console.error('Error caching enrichment:', err)
      // Continue even if caching fails
    }

    return NextResponse.json({
      cached: false,
      aiSummary,
      topics,
      enrichedAt: new Date().toISOString(),
      meetingsAnalyzed: transcriptExcerpts.length,
    })
  } catch (error) {
    console.error('Speaker enrichment error:', error)
    return NextResponse.json(
      { error: 'Failed to enrich speaker profile', details: String(error) },
      { status: 500 }
    )
  }
}

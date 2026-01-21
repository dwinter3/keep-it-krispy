import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, PutCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { v4 as uuidv4 } from 'uuid'

const BRIEFINGS_TABLE = process.env.BRIEFINGS_TABLE || 'krisp-briefings'
const TRANSCRIPTS_TABLE = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const MODEL_ID = 'amazon.nova-2-lite-v1:0'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const s3 = new S3Client({ region: AWS_REGION, credentials })
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

interface ActionItem {
  text: string
  meeting: string
}

interface CrossReference {
  topic: string
  meetings: string[]
}

interface MeetingSummary {
  title: string
  summary: string
}

interface BriefingSummary {
  meeting_count: number
  key_themes: string[]
  action_items: ActionItem[]
  cross_references: CrossReference[]
  meeting_summaries: MeetingSummary[]
}

interface Briefing {
  briefing_id: string
  user_id: string
  date: string
  generated_at: string
  summary: BriefingSummary
}

interface TranscriptContent {
  raw_payload?: {
    data?: {
      raw_content?: string
      raw_meeting?: string
    }
  }
}

/**
 * GET /api/briefings
 * Retrieve user's briefings with optional date filter
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)

  try {
    const queryParams: QueryCommandInput = {
      TableName: BRIEFINGS_TABLE,
      IndexName: 'user-date-index',
      KeyConditionExpression: date
        ? 'user_id = :userId AND #date = :date'
        : 'user_id = :userId',
      ExpressionAttributeValues: date
        ? { ':userId': user.user_id, ':date': date }
        : { ':userId': user.user_id },
      ...(date && { ExpressionAttributeNames: { '#date': 'date' } }),
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    }

    const response = await dynamodb.send(new QueryCommand(queryParams))
    const briefings = response.Items || []

    return NextResponse.json({ briefings })
  } catch (error) {
    console.error('Error fetching briefings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch briefings', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/briefings
 * Manually trigger briefing generation for a specific date
 */
export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  let targetDate: string

  try {
    const body = await request.json()
    targetDate = body.date || getYesterdayDate()
  } catch {
    targetDate = getYesterdayDate()
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 })
  }

  try {
    // Check if briefing already exists for this date
    const existingResponse = await dynamodb.send(new QueryCommand({
      TableName: BRIEFINGS_TABLE,
      IndexName: 'user-date-index',
      KeyConditionExpression: 'user_id = :userId AND #date = :date',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':userId': user.user_id,
        ':date': targetDate,
      },
      Limit: 1,
    }))

    const existingBriefings = existingResponse.Items || []

    // Return cached briefing unless force regeneration
    const forceRegenerate = (await request.clone().json().catch(() => ({}))).forceRegenerate
    if (existingBriefings.length > 0 && !forceRegenerate) {
      return NextResponse.json({
        cached: true,
        briefing: existingBriefings[0],
      })
    }

    // Query transcripts for this user and date
    const transcriptsResponse = await dynamodb.send(new QueryCommand({
      TableName: TRANSCRIPTS_TABLE,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: '#date = :targetDate',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':userId': user.user_id,
        ':targetDate': targetDate,
      },
    }))

    const transcripts = transcriptsResponse.Items || []

    if (transcripts.length === 0) {
      return NextResponse.json({
        cached: false,
        briefing: null,
        message: `No transcripts found for ${targetDate}`,
      })
    }

    // Fetch full content for each transcript from S3
    const meetingContents = await Promise.all(
      transcripts.map(async (transcript) => {
        const s3Key = transcript.s3_key
        if (!s3Key) {
          return {
            meeting_id: transcript.meeting_id,
            title: transcript.title || 'Untitled',
            duration: transcript.duration || 0,
            speakers: transcript.speakers || [],
            topic: transcript.topic,
            content: '',
          }
        }

        try {
          const s3Response = await s3.send(new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          }))
          const body = await s3Response.Body?.transformToString()
          if (!body) {
            throw new Error('Empty S3 response')
          }
          const content: TranscriptContent = JSON.parse(body)
          const rawContent = content.raw_payload?.data?.raw_content || ''

          return {
            meeting_id: transcript.meeting_id,
            title: transcript.title || 'Untitled',
            duration: transcript.duration || 0,
            speakers: transcript.speakers || [],
            topic: transcript.topic,
            content: rawContent.slice(0, 8000), // Truncate for token limits
          }
        } catch (err) {
          console.error(`Error fetching transcript ${s3Key}:`, err)
          return {
            meeting_id: transcript.meeting_id,
            title: transcript.title || 'Untitled',
            duration: transcript.duration || 0,
            speakers: transcript.speakers || [],
            topic: transcript.topic,
            content: '',
          }
        }
      })
    )

    // Generate briefing summary using Bedrock
    const summary = await generateBriefingSummary(meetingContents)

    // Create the briefing document
    const briefingId = uuidv4()
    const now = new Date().toISOString()

    const briefing: Briefing = {
      briefing_id: briefingId,
      user_id: user.user_id,
      date: targetDate,
      generated_at: now,
      summary,
    }

    // Store in DynamoDB
    await dynamodb.send(new PutCommand({
      TableName: BRIEFINGS_TABLE,
      Item: briefing,
    }))

    return NextResponse.json({
      cached: false,
      briefing,
    })
  } catch (error) {
    console.error('Error generating briefing:', error)
    return NextResponse.json(
      { error: 'Failed to generate briefing', details: String(error) },
      { status: 500 }
    )
  }
}

function getYesterdayDate(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}

interface MeetingContent {
  meeting_id: string
  title: string
  duration: number
  speakers: string[]
  topic?: string
  content: string
}

async function generateBriefingSummary(meetings: MeetingContent[]): Promise<BriefingSummary> {
  if (meetings.length === 0) {
    return {
      meeting_count: 0,
      key_themes: [],
      action_items: [],
      cross_references: [],
      meeting_summaries: [],
    }
  }

  // Build the prompt with all meeting content
  const meetingsText = meetings.map((meeting, i) => {
    const durationMins = Math.round((meeting.duration || 0) / 60)
    const speakers = (meeting.speakers || []).slice(0, 5).join(', ')

    return `
Meeting ${i + 1}: ${meeting.title || 'Untitled'}
Duration: ${durationMins} minutes
Participants: ${speakers}
Topic: ${meeting.topic || 'Not specified'}

Transcript excerpt:
${(meeting.content || '').slice(0, 4000)}
`
  }).join('\n---\n')

  const prompt = `You are an executive assistant creating a daily morning briefing.
Analyze the following ${meetings.length} meetings from the day and provide a comprehensive summary.

${meetingsText}

Create a JSON summary with the following structure:
{
    "meeting_count": ${meetings.length},
    "key_themes": ["List 3-5 overarching themes or topics that were discussed across meetings"],
    "action_items": [
        {"text": "Specific action item or task", "meeting": "Meeting title where this was mentioned"}
    ],
    "cross_references": [
        {"topic": "Topic that appeared in multiple meetings", "meetings": ["Meeting 1", "Meeting 2"]}
    ],
    "meeting_summaries": [
        {"title": "Meeting title", "summary": "2-3 sentence summary of key points"}
    ]
}

Focus on:
1. Extracting concrete action items (tasks, follow-ups, deadlines)
2. Identifying themes that span multiple meetings
3. Creating concise but informative meeting summaries
4. Noting any cross-references or related topics across meetings

Return ONLY valid JSON, no additional text.`

  try {
    const invokeCommand = new InvokeModelCommand({
      modelId: MODEL_ID,
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
          maxTokens: 3000,
          temperature: 0.3,
        },
      }),
    })

    const response = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    let resultText = responseBody.output?.message?.content?.[0]?.text
      || responseBody.content?.[0]?.text
      || ''

    // Handle potential markdown code blocks
    if (resultText.startsWith('```')) {
      resultText = resultText.split('```')[1]
      if (resultText.startsWith('json')) {
        resultText = resultText.slice(4)
      }
      resultText = resultText.trim()
    }

    const summary = JSON.parse(resultText)

    return {
      meeting_count: summary.meeting_count || meetings.length,
      key_themes: (summary.key_themes || []).slice(0, 10),
      action_items: (summary.action_items || []).slice(0, 20),
      cross_references: (summary.cross_references || []).slice(0, 10),
      meeting_summaries: summary.meeting_summaries || [],
    }
  } catch (error) {
    console.error('Error generating briefing summary:', error)
    // Return a basic summary on error
    return {
      meeting_count: meetings.length,
      key_themes: [],
      action_items: [],
      cross_references: [],
      meeting_summaries: meetings.map(m => ({
        title: m.title || 'Untitled',
        summary: `Meeting with ${(m.speakers || []).slice(0, 3).join(', ')}`,
      })),
    }
  }
}

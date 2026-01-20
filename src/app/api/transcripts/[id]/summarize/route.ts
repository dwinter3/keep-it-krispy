import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const s3 = new S3Client({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

export interface DetailedSummary {
  overview: string
  keyDiscussionPoints: string[]
  decisions: string[]
  actionItems: string[]
  importantTopics: string[]
  generatedAt: string
}

interface TranscriptRecord {
  meeting_id: string
  s3_key: string
  user_id?: string
  detailed_summary?: DetailedSummary
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
 * POST /api/transcripts/[id]/summarize
 * Generate a detailed AI summary for a transcript
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params

  // Authenticate user
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Get the transcript record from DynamoDB
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const record = await dynamodb.send(getCommand)
    const transcript = record.Item as TranscriptRecord | undefined

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Check ownership
    if (transcript.user_id && transcript.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check for cached summary (unless force refresh)
    let forceRefresh = false
    try {
      const body = await request.json()
      forceRefresh = body.forceRefresh === true
    } catch {
      // No body or invalid JSON
    }

    if (!forceRefresh && transcript.detailed_summary) {
      return NextResponse.json({
        cached: true,
        summary: transcript.detailed_summary,
      })
    }

    // Fetch the transcript content from S3
    if (!transcript.s3_key) {
      return NextResponse.json({ error: 'No transcript content available' }, { status: 404 })
    }

    const s3Command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: transcript.s3_key,
    })
    const s3Response = await s3.send(s3Command)
    const body = await s3Response.Body?.transformToString()

    if (!body) {
      return NextResponse.json({ error: 'Empty transcript content' }, { status: 404 })
    }

    const content: TranscriptContent = JSON.parse(body)
    const rawContent = content.raw_payload?.data?.raw_content
    const rawMeeting = content.raw_payload?.data?.raw_meeting

    if (!rawContent && !rawMeeting) {
      return NextResponse.json({ error: 'No transcript text available' }, { status: 404 })
    }

    // Use the full transcript content, but truncate if too long
    const transcriptText = rawContent || rawMeeting || ''
    const maxLength = 50000 // ~12k tokens for Claude
    const truncatedText = transcriptText.length > maxLength
      ? transcriptText.slice(0, maxLength) + '\n\n[Transcript truncated due to length...]'
      : transcriptText

    // Generate detailed summary using Claude via Bedrock
    const prompt = `Analyze the following meeting transcript and provide a comprehensive summary.

TRANSCRIPT:
${truncatedText}

Please provide a detailed analysis in the following JSON format. Be thorough and specific, extracting concrete details from the conversation:

{
  "overview": "A 2-3 sentence high-level summary of what this meeting was about, who participated, and the main purpose.",
  "keyDiscussionPoints": ["List 3-7 key topics or themes discussed in the meeting, with brief context for each"],
  "decisions": ["List any decisions that were made during the meeting. If no clear decisions were made, include an empty array"],
  "actionItems": ["List any action items, next steps, or tasks mentioned. Include who is responsible if mentioned. If none, include an empty array"],
  "importantTopics": ["List 2-5 important keywords or topic areas covered"]
}

Return ONLY valid JSON. Be specific and extract actual details from the transcript rather than generic descriptions.`

    const invokeCommand = new InvokeModelCommand({
      modelId: 'amazon.nova-lite-v1:0',
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
          maxTokens: 2000,
          temperature: 0.3,
        },
      }),
    })

    const bedrockResponse = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body))
    // Nova uses output.message.content[0].text, Claude uses content[0].text
    const assistantMessage = responseBody.output?.message?.content?.[0]?.text
      || responseBody.content?.[0]?.text
      || ''

    // Parse the JSON response
    let parsedSummary: Omit<DetailedSummary, 'generatedAt'>
    try {
      const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedSummary = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
      console.error('Raw response:', assistantMessage)
      return NextResponse.json(
        { error: 'Failed to parse AI summary response' },
        { status: 500 }
      )
    }

    // Create the full summary object
    const detailedSummary: DetailedSummary = {
      overview: parsedSummary.overview || '',
      keyDiscussionPoints: parsedSummary.keyDiscussionPoints || [],
      decisions: parsedSummary.decisions || [],
      actionItems: parsedSummary.actionItems || [],
      importantTopics: parsedSummary.importantTopics || [],
      generatedAt: new Date().toISOString(),
    }

    // Generate a topic title from the overview and important topics
    let topic: string | null = null
    if (detailedSummary.overview || detailedSummary.importantTopics.length > 0) {
      const topicPrompt = `Based on this meeting summary, generate a descriptive topic title (10-20 words) that captures the main subject and purpose.

Overview: ${detailedSummary.overview}
Key Topics: ${detailedSummary.importantTopics.join(', ')}

Return ONLY the topic title, nothing else. Use a dash to separate the main topic from details.
Example: "Q4 2025 Financial Review - Revenue targets, margin analysis, and 2026 strategic planning"`

      try {
        const topicCommand = new InvokeModelCommand({
          modelId: 'amazon.nova-lite-v1:0',
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            messages: [{ role: 'user', content: [{ text: topicPrompt }] }],
            inferenceConfig: { maxTokens: 100, temperature: 0.3 },
          }),
        })
        const topicResponse = await bedrock.send(topicCommand)
        const topicBody = JSON.parse(new TextDecoder().decode(topicResponse.body))
        let generatedTopic = topicBody.output?.message?.content?.[0]?.text?.trim() || ''
        // Strip surrounding quotes if AI wrapped the response in them
        if (generatedTopic.startsWith('"') && generatedTopic.endsWith('"')) {
          generatedTopic = generatedTopic.slice(1, -1)
        }
        if (generatedTopic && generatedTopic.length <= 150) {
          topic = generatedTopic
        }
      } catch (topicError) {
        console.error('Topic generation error (non-fatal):', topicError)
      }
    }

    // Cache the summary and topic in DynamoDB
    const updateExpression = topic
      ? 'SET detailed_summary = :summary, topic = :topic'
      : 'SET detailed_summary = :summary'
    const expressionValues: Record<string, unknown> = { ':summary': detailedSummary }
    if (topic) {
      expressionValues[':topic'] = topic
    }

    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionValues,
    })
    await dynamodb.send(updateCommand)

    return NextResponse.json({
      cached: false,
      summary: detailedSummary,
    })
  } catch (error) {
    console.error('Summarize error:', error)
    return NextResponse.json(
      { error: 'Failed to generate summary', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/transcripts/[id]/summarize
 * Get cached summary if available
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params

  // Authenticate user
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Get the transcript record from DynamoDB
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      ProjectionExpression: 'meeting_id, user_id, detailed_summary',
    })
    const record = await dynamodb.send(getCommand)
    const transcript = record.Item as TranscriptRecord | undefined

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Check ownership
    if (transcript.user_id && transcript.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (!transcript.detailed_summary) {
      return NextResponse.json({
        cached: false,
        summary: null,
        message: 'No summary generated yet'
      })
    }

    return NextResponse.json({
      cached: true,
      summary: transcript.detailed_summary,
    })
  } catch (error) {
    console.error('Get summary error:', error)
    return NextResponse.json(
      { error: 'Failed to get summary', details: String(error) },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
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

export interface SpeakerInference {
  originalName: string
  inferredName: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

interface TranscriptRecord {
  meeting_id: string
  s3_key: string
  user_id?: string
  speakers?: string[]
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
 * Check if a speaker name is generic (e.g., "Speaker 1", "Participant 2", "Guest", "Unknown")
 */
function isGenericSpeaker(name: string): boolean {
  const lower = name.toLowerCase().trim()
  return (
    /^speaker\s*\d+$/i.test(lower) ||
    /^participant\s*\d+$/i.test(lower) ||
    lower === 'guest' ||
    lower === 'unknown' ||
    lower === 'me' ||
    /^person\s*\d+$/i.test(lower)
  )
}

/**
 * POST /api/transcripts/[id]/infer-speakers
 * Use AI to infer real speaker names from transcript content
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

    // Get the speakers list
    const speakers = transcript.speakers || []
    const genericSpeakers = speakers.filter(isGenericSpeaker)

    if (genericSpeakers.length === 0) {
      return NextResponse.json({
        inferences: [],
        message: 'No generic speakers found to infer',
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

    if (!rawContent) {
      return NextResponse.json({ error: 'No transcript text available' }, { status: 404 })
    }

    // Truncate if too long
    const maxLength = 30000 // ~7.5k tokens for Claude Haiku
    const truncatedText = rawContent.length > maxLength
      ? rawContent.slice(0, maxLength) + '\n\n[Transcript truncated...]'
      : rawContent

    // Build the prompt for speaker inference
    const prompt = `Analyze this meeting transcript and identify the real names of the generic speakers listed below.

GENERIC SPEAKERS TO IDENTIFY:
${genericSpeakers.map(s => `- ${s}`).join('\n')}

OTHER KNOWN SPEAKERS IN THE MEETING:
${speakers.filter(s => !isGenericSpeaker(s)).map(s => `- ${s}`).join('\n') || '(none)'}

TRANSCRIPT:
${truncatedText}

Look for clues like:
- Self-introductions: "Hi, I'm John" or "This is Sarah speaking"
- When others address someone: "Thanks, Mike" or "John, what do you think?"
- Mentions of roles/titles: "As the product manager, I..."
- Email signatures or contact info mentioned
- Context from conversation (who is asking questions vs. answering)

Return a JSON array with your findings. For each generic speaker you can identify, provide:
- originalName: The generic name (e.g., "Speaker 1")
- inferredName: The real name you identified
- confidence: "high" (direct self-introduction), "medium" (addressed by name by others), or "low" (contextual inference)
- evidence: A brief quote or explanation of how you identified them

If you cannot identify a speaker with reasonable confidence, do not include them.

Return ONLY valid JSON in this format:
{
  "inferences": [
    {
      "originalName": "Speaker 1",
      "inferredName": "John Smith",
      "confidence": "high",
      "evidence": "Said 'Hi everyone, this is John from engineering' at the start"
    }
  ]
}

If no speakers can be identified, return: { "inferences": [] }`

    const invokeCommand = new InvokeModelCommand({
      modelId: 'anthropic.claude-3-haiku-20240307-v1:0',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 1500,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    const bedrockResponse = await bedrock.send(invokeCommand)
    const responseBody = JSON.parse(new TextDecoder().decode(bedrockResponse.body))
    const assistantMessage = responseBody.content?.[0]?.text || ''

    // Parse the JSON response
    let parsedResponse: { inferences: SpeakerInference[] }
    try {
      const jsonMatch = assistantMessage.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0])
      } else {
        throw new Error('No JSON found in response')
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', parseError)
      console.error('Raw response:', assistantMessage)
      return NextResponse.json(
        { error: 'Failed to parse AI response' },
        { status: 500 }
      )
    }

    // Validate and clean up the inferences
    const validInferences: SpeakerInference[] = (parsedResponse.inferences || [])
      .filter((inf: SpeakerInference) => {
        // Must have required fields
        if (!inf.originalName || !inf.inferredName) return false
        // Original name must be in our generic speakers list
        if (!genericSpeakers.some(s => s.toLowerCase() === inf.originalName.toLowerCase())) return false
        // Inferred name should not be empty or too short
        if (inf.inferredName.trim().length < 2) return false
        return true
      })
      .map((inf: SpeakerInference) => ({
        originalName: inf.originalName,
        inferredName: inf.inferredName.trim(),
        confidence: ['high', 'medium', 'low'].includes(inf.confidence) ? inf.confidence : 'low',
        evidence: inf.evidence || 'Inferred from transcript context',
      }))

    return NextResponse.json({
      inferences: validInferences,
      genericSpeakersFound: genericSpeakers.length,
      speakersIdentified: validInferences.length,
    })
  } catch (error) {
    console.error('Infer speakers error:', error)
    return NextResponse.json(
      { error: 'Failed to infer speakers', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/transcripts/[id]/infer-speakers
 * Check if there are generic speakers that could be inferred
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
      ProjectionExpression: 'meeting_id, user_id, speakers',
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

    // Get the speakers list and check for generic ones
    const speakers = transcript.speakers || []
    const genericSpeakers = speakers.filter(isGenericSpeaker)

    return NextResponse.json({
      hasGenericSpeakers: genericSpeakers.length > 0,
      genericSpeakers,
      totalSpeakers: speakers.length,
    })
  } catch (error) {
    console.error('Check speakers error:', error)
    return NextResponse.json(
      { error: 'Failed to check speakers', details: String(error) },
      { status: 500 }
    )
  }
}

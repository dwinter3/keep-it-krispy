/**
 * Upload API Route for Transcript Import
 *
 * Handles bulk upload of Microsoft Teams/Copilot transcripts.
 * Supports VTT, TXT formats.
 *
 * POST /api/upload
 * - Accepts multipart form data with files
 * - Parses transcripts and stores in S3 + DynamoDB
 * - Returns import results for each file
 */

import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { parseTranscriptFile, validateParsedTranscript, type ParsedTranscriptData } from '@/lib/parsers/transcript-parser'
import { randomBytes } from 'crypto'

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

interface UploadResult {
  filename: string
  success: boolean
  meetingId?: string
  title?: string
  speakers?: string[]
  duration?: number
  error?: string
  warnings?: string[]
}

/**
 * Generate unique meeting ID
 */
function generateMeetingId(): string {
  return `upload_${Date.now()}_${randomBytes(4).toString('hex')}`
}

/**
 * Create S3 key with date-based organization
 * Format: meetings/YYYY/MM/DD/timestamp_title_id.json
 */
function createS3Key(title: string, meetingId: string): string {
  const now = new Date()
  const datePrefix = now.toISOString().slice(0, 10).replace(/-/g, '/')
  const timestamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15)

  // Clean title for filename
  const safeTitle = title
    .replace(/[^a-zA-Z0-9\s-_]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 50)

  return `meetings/${datePrefix}/${timestamp}_${safeTitle}_${meetingId}.json`
}

/**
 * Create Krisp-compatible payload structure
 */
function createPayload(
  parsed: ParsedTranscriptData,
  meetingId: string
): Record<string, unknown> {
  const now = new Date()

  // Build speaker array in Krisp format
  const speakers = parsed.speakers.map((name, index) => {
    // Try to split into first/last name
    const parts = name.split(' ')
    return {
      index: index + 1,
      first_name: parts[0] || name,
      last_name: parts.slice(1).join(' ') || ''
    }
  })

  return {
    received_at: now.toISOString(),
    event_type: 'transcript_created',
    raw_payload: {
      event: 'transcript_created',
      meeting_id: meetingId,
      title: parsed.title,
      data: {
        raw_content: parsed.rawContent,
        meeting: {
          id: meetingId,
          title: parsed.title,
          duration: parsed.duration,
          start_date: now.toISOString(),
          speakers
        }
      }
    },
    // Additional metadata
    import_source: 'web_upload',
    import_format: parsed.format,
    import_filename: parsed.filename
  }
}

/**
 * Store transcript in S3
 */
async function storeInS3(
  s3Key: string,
  payload: Record<string, unknown>
): Promise<void> {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: s3Key,
    Body: JSON.stringify(payload, null, 2),
    ContentType: 'application/json'
  }))
}

/**
 * Index transcript in DynamoDB
 */
async function indexInDynamoDB(
  meetingId: string,
  s3Key: string,
  parsed: ParsedTranscriptData,
  userId: string
): Promise<void> {
  const now = new Date()

  const item = {
    pk: 'TRANSCRIPT',
    meeting_id: meetingId,
    user_id: userId, // User isolation
    title: parsed.title,
    date: now.toISOString().slice(0, 10),
    timestamp: now.toISOString(),
    duration: parsed.duration,
    s3_key: s3Key,
    event_type: 'transcript_created',
    received_at: now.toISOString(),
    indexed_at: now.toISOString(),
    // Speakers
    speakers: parsed.speakers,
    speaker_name: parsed.speakers[0]?.toLowerCase() || 'unknown',
    // Import metadata
    import_source: 'web_upload',
    import_format: parsed.format,
    import_filename: parsed.filename
  }

  await dynamodb.send(new PutCommand({
    TableName: TABLE_NAME,
    Item: item
  }))
}

/**
 * Process a single file upload
 */
async function processFile(
  content: string,
  filename: string,
  userId: string
): Promise<UploadResult> {
  try {
    // Parse the transcript
    const parsed = parseTranscriptFile(content, filename)

    // Validate parsed data
    const validation = validateParsedTranscript(parsed)
    if (!validation.valid) {
      return {
        filename,
        success: false,
        error: validation.errors.join('; '),
        warnings: parsed.warnings
      }
    }

    // Generate IDs and keys
    const meetingId = generateMeetingId()
    const s3Key = createS3Key(parsed.title, meetingId)

    // Create payload
    const payload = createPayload(parsed, meetingId)

    // Store in S3
    await storeInS3(s3Key, payload)

    // Index in DynamoDB
    await indexInDynamoDB(meetingId, s3Key, parsed, userId)

    return {
      filename,
      success: true,
      meetingId,
      title: parsed.title,
      speakers: parsed.speakers,
      duration: parsed.duration,
      warnings: parsed.warnings.length > 0 ? parsed.warnings : undefined
    }
  } catch (error) {
    console.error(`Error processing ${filename}:`, error)
    return {
      filename,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    // Authenticate user
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Parse multipart form data
    const formData = await request.formData()
    const files = formData.getAll('files') as File[]

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      )
    }

    // Validate file types
    const validExtensions = ['.vtt', '.txt']
    const results: UploadResult[] = []

    for (const file of files) {
      const extension = '.' + file.name.split('.').pop()?.toLowerCase()

      if (!validExtensions.includes(extension)) {
        results.push({
          filename: file.name,
          success: false,
          error: `Unsupported file type. Supported: ${validExtensions.join(', ')}`
        })
        continue
      }

      // Read file content
      const content = await file.text()

      if (!content || content.trim().length === 0) {
        results.push({
          filename: file.name,
          success: false,
          error: 'File is empty'
        })
        continue
      }

      // Process the file
      const result = await processFile(content, file.name, user.user_id)
      results.push(result)
    }

    // Summary
    const successful = results.filter(r => r.success).length
    const failed = results.filter(r => !r.success).length

    return NextResponse.json({
      message: `Processed ${files.length} file(s): ${successful} successful, ${failed} failed`,
      results,
      summary: {
        total: files.length,
        successful,
        failed
      }
    })
  } catch (error) {
    console.error('Upload API error:', error)
    return NextResponse.json(
      { error: 'Upload failed', details: String(error) },
      { status: 500 }
    )
  }
}

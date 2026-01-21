import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const AUDIO_BUCKET = process.env.AUDIO_BUCKET || 'krisp-audio-754639201213'
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// Max file size: 500MB (for long meetings)
const MAX_FILE_SIZE = 500 * 1024 * 1024

// Allowed audio formats and their extensions
const ALLOWED_TYPES: Record<string, string> = {
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
}

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const s3 = new S3Client({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/transcripts/[id]/audio
 *
 * Get audio file info and presigned download URL for a transcript.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Check transcript ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const transcript = await dynamodb.send(getCommand)

    if (!transcript.Item) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    if (transcript.Item.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if audio exists
    if (!transcript.Item.audio_s3_key) {
      return NextResponse.json({ hasAudio: false })
    }

    // Get audio file metadata
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: transcript.Item.audio_s3_key,
      })
      const headResult = await s3.send(headCommand)

      // Generate presigned URL for download (valid for 1 hour)
      const getObjectCommand = new GetObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: transcript.Item.audio_s3_key,
      })
      const downloadUrl = await getSignedUrl(s3, getObjectCommand, { expiresIn: 3600 })

      return NextResponse.json({
        hasAudio: true,
        audioKey: transcript.Item.audio_s3_key,
        audioFormat: transcript.Item.audio_format,
        audioSize: headResult.ContentLength,
        audioDuration: transcript.Item.audio_duration,
        diarizationStatus: transcript.Item.diarization_status || 'none',
        downloadUrl,
      })
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound') {
        return NextResponse.json({ hasAudio: false })
      }
      throw err
    }
  } catch (error) {
    console.error('Error getting audio info:', error)
    return NextResponse.json(
      { error: 'Failed to get audio info', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/transcripts/[id]/audio
 *
 * Get a presigned URL for direct S3 upload.
 * This bypasses Lambda payload limits by uploading directly to S3.
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Parse request body for file metadata
    const body = await request.json()
    const { contentType, fileSize, fileName } = body

    if (!contentType || !fileSize) {
      return NextResponse.json({ error: 'contentType and fileSize are required' }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES[contentType]) {
      return NextResponse.json(
        { error: `Invalid audio format. Allowed: ${Object.keys(ALLOWED_TYPES).join(', ')}` },
        { status: 400 }
      )
    }

    // Validate file size
    if (fileSize > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Check transcript ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const transcript = await dynamodb.send(getCommand)

    if (!transcript.Item) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    if (transcript.Item.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Determine file extension from MIME type
    const ext = ALLOWED_TYPES[contentType]

    // Build S3 key: users/{user_id}/audio/{meeting_id}/recording.{ext}
    const s3Key = `users/${user.user_id}/audio/${meetingId}/recording.${ext}`

    // Generate presigned URL for direct upload (valid for 15 minutes)
    const putCommand = new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: s3Key,
      ContentType: contentType,
      Metadata: {
        'meeting-id': meetingId,
        'user-id': user.user_id,
        'original-filename': fileName || 'recording',
      },
    })
    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 900 })

    return NextResponse.json({
      uploadUrl,
      s3Key,
      format: ext,
      expiresIn: 900,
    })
  } catch (error) {
    console.error('Error generating upload URL:', error)
    return NextResponse.json(
      { error: 'Failed to generate upload URL', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/transcripts/[id]/audio
 *
 * Confirm audio upload after direct S3 upload completes.
 * Updates the transcript metadata with audio info.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Parse request body for upload confirmation
    const body = await request.json()
    const { s3Key, format, fileSize } = body

    if (!s3Key || !format) {
      return NextResponse.json({ error: 's3Key and format are required' }, { status: 400 })
    }

    // Check transcript ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const transcript = await dynamodb.send(getCommand)

    if (!transcript.Item) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    if (transcript.Item.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Verify file exists in S3
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: AUDIO_BUCKET,
        Key: s3Key,
      })
      await s3.send(headCommand)
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound') {
        return NextResponse.json({ error: 'Audio file not found in S3. Upload may have failed.' }, { status: 400 })
      }
      throw err
    }

    // Update transcript record with audio info
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'SET audio_s3_key = :key, audio_format = :format, audio_size = :size, audio_uploaded_at = :uploadedAt, diarization_status = :status',
      ExpressionAttributeValues: {
        ':key': s3Key,
        ':format': format,
        ':size': fileSize || 0,
        ':uploadedAt': new Date().toISOString(),
        ':status': 'pending',  // Ready for diarization processing
      },
      ReturnValues: 'ALL_NEW',
    })
    await dynamodb.send(updateCommand)

    console.log(`Audio uploaded for meeting ${meetingId}: s3://${AUDIO_BUCKET}/${s3Key}`)

    return NextResponse.json({
      success: true,
      audioKey: s3Key,
      audioFormat: format,
      audioSize: fileSize,
      diarizationStatus: 'pending',
      message: 'Audio uploaded successfully. Voice print processing will begin shortly.',
    })
  } catch (error) {
    console.error('Error confirming audio upload:', error)
    return NextResponse.json(
      { error: 'Failed to confirm audio upload', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/transcripts/[id]/audio
 *
 * Delete audio file for a transcript.
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    // Check transcript ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const transcript = await dynamodb.send(getCommand)

    if (!transcript.Item) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    if (transcript.Item.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    if (!transcript.Item.audio_s3_key) {
      return NextResponse.json({ error: 'No audio file to delete' }, { status: 404 })
    }

    // Delete from S3
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    const deleteCommand = new DeleteObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: transcript.Item.audio_s3_key,
    })
    await s3.send(deleteCommand)

    // Update transcript record to remove audio info
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'REMOVE audio_s3_key, audio_format, audio_size, audio_uploaded_at, audio_duration, diarization_status, diarization_result',
      ReturnValues: 'ALL_NEW',
    })
    await dynamodb.send(updateCommand)

    console.log(`Audio deleted for meeting ${meetingId}`)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting audio:', error)
    return NextResponse.json(
      { error: 'Failed to delete audio', details: String(error) },
      { status: 500 }
    )
  }
}

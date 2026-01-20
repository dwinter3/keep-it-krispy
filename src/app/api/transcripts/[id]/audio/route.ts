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

// Allowed audio formats
const ALLOWED_TYPES = [
  'audio/mpeg',      // .mp3
  'audio/wav',       // .wav
  'audio/x-wav',
  'audio/ogg',       // .ogg
  'audio/opus',      // .opus
  'audio/webm',      // .webm
  'audio/mp4',       // .m4a
  'audio/x-m4a',
  'audio/aac',       // .aac
]

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
 * POST /api/transcripts/[id]/audio
 *
 * Upload audio file for a transcript.
 * Expects multipart form data with 'audio' field.
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

    // Parse multipart form data
    const formData = await request.formData()
    const audioFile = formData.get('audio') as File | null

    if (!audioFile) {
      return NextResponse.json({ error: 'No audio file provided' }, { status: 400 })
    }

    // Validate file type
    if (!ALLOWED_TYPES.includes(audioFile.type)) {
      return NextResponse.json(
        { error: `Invalid audio format. Allowed: ${ALLOWED_TYPES.join(', ')}` },
        { status: 400 }
      )
    }

    // Validate file size
    if (audioFile.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        { error: `File too large. Max size: ${MAX_FILE_SIZE / 1024 / 1024}MB` },
        { status: 400 }
      )
    }

    // Determine file extension from MIME type
    const extMap: Record<string, string> = {
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
    const ext = extMap[audioFile.type] || 'audio'

    // Build S3 key: users/{user_id}/audio/{meeting_id}/recording.{ext}
    const s3Key = `users/${user.user_id}/audio/${meetingId}/recording.${ext}`

    // Upload to S3
    const fileBuffer = Buffer.from(await audioFile.arrayBuffer())

    const putCommand = new PutObjectCommand({
      Bucket: AUDIO_BUCKET,
      Key: s3Key,
      Body: fileBuffer,
      ContentType: audioFile.type,
      Metadata: {
        'meeting-id': meetingId,
        'user-id': user.user_id,
        'original-filename': audioFile.name,
      },
    })
    await s3.send(putCommand)

    // Update transcript record with audio info
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'SET audio_s3_key = :key, audio_format = :format, audio_size = :size, audio_uploaded_at = :uploadedAt, diarization_status = :status',
      ExpressionAttributeValues: {
        ':key': s3Key,
        ':format': ext,
        ':size': audioFile.size,
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
      audioFormat: ext,
      audioSize: audioFile.size,
      diarizationStatus: 'pending',
      message: 'Audio uploaded successfully. Voice print processing will begin shortly.',
    })
  } catch (error) {
    console.error('Error uploading audio:', error)
    return NextResponse.json(
      { error: 'Failed to upload audio', details: String(error) },
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

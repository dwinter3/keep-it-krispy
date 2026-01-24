import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { logAuditEvent, getClientInfo } from '@/lib/auditLog'

const execFileAsync = promisify(execFile)

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'transcript-chunks'
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

interface TranscriptRecord {
  meeting_id: string
  s3_key: string
  title?: string
  date?: string
  timestamp?: string
  duration?: number
  speakers?: string[]
  topic?: string
  isPrivate?: boolean
  privacy_level?: string
  privacy_reason?: string
  privacy_topics?: string[]
  privacy_confidence?: number
  privacy_work_percent?: number
  privacy_dismissed?: boolean
  user_id?: string
  owner_id?: string
}

/**
 * GET /api/transcripts/[id]
 * Get a single transcript by meeting ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params

  try {
    // Get authenticated user (via session or API key)
    const session = await auth()
    const apiKey = request.headers.get('x-api-key')

    let userId: string | null = null

    if (session?.user?.email) {
      const user = await getUserByEmail(session.user.email)
      userId = user?.user_id || null
    } else if (apiKey) {
      // Validate API key and get user
      const { getUserByApiKey } = await import('@/lib/users')
      const user = await getUserByApiKey(apiKey)
      userId = user?.user_id || null
    }

    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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

    // Check access - user must own the transcript
    const ownerId = transcript.owner_id || transcript.user_id
    if (ownerId !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check if summary only requested
    const summaryOnly = request.nextUrl.searchParams.get('summaryOnly') === 'true'

    // If not summary only, fetch the full transcript from S3
    let transcriptContent: string | undefined
    let summary: string | undefined
    let notes: string | undefined
    let actionItems: string[] | undefined

    if (transcript.s3_key && !summaryOnly) {
      try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3')
        const s3Response = await s3.send(new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: transcript.s3_key,
        }))
        const s3Content = await s3Response.Body?.transformToString()
        if (s3Content) {
          const parsed = JSON.parse(s3Content)
          // Handle nested structure: raw_payload.data.content is array of {speaker, text}
          const content = parsed.raw_payload?.data?.content
          if (Array.isArray(content)) {
            transcriptContent = content
              .map((c: { speaker: string; text: string }) => `${c.speaker}: ${c.text}`)
              .join('\n\n')
          } else if (parsed.transcript) {
            // Fallback for older format
            transcriptContent = parsed.transcript
          }
          summary = parsed.summary || parsed.raw_payload?.data?.summary
          notes = parsed.notes || parsed.raw_payload?.data?.notes
          actionItems = parsed.action_items || parsed.raw_payload?.data?.action_items
        }
      } catch (s3Error) {
        console.error('Error fetching from S3:', s3Error)
      }
    }

    return NextResponse.json({
      meetingId: transcript.meeting_id,
      key: transcript.s3_key,
      title: transcript.title,
      date: transcript.date,
      timestamp: transcript.timestamp,
      duration: transcript.duration,
      speakers: transcript.speakers || [],
      topic: transcript.topic,
      isPrivate: transcript.isPrivate,
      summary,
      notes,
      actionItems,
      transcript: transcriptContent,
    })
  } catch (error) {
    console.error('GET error:', error)
    return NextResponse.json(
      { error: 'Failed to get transcript', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/transcripts/[id]
 * Permanently delete a transcript and its vectors
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params

  try {
    // Get authenticated user
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's ID for tenant isolation
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

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

    // Delete from S3
    if (transcript.s3_key) {
      try {
        await s3.send(new DeleteObjectCommand({
          Bucket: BUCKET_NAME,
          Key: transcript.s3_key,
        }))
        console.log(`Deleted S3 object: ${transcript.s3_key}`)
      } catch (s3Error) {
        console.error('Error deleting from S3:', s3Error)
        // Continue with other deletions
      }
    }

    // Delete vectors from S3 Vectors
    await deleteVectorsByMeetingId(meetingId)

    // Delete from DynamoDB
    await dynamodb.send(new DeleteCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    }))
    console.log(`Deleted DynamoDB record: ${meetingId}`)

    // Log audit event for deletion
    const { ipAddress, userAgent } = getClientInfo(request)
    await logAuditEvent({
      actorId: user.user_id,
      actorEmail: session.user.email,
      eventType: 'delete.item',
      targetType: 'transcript',
      targetId: meetingId,
      metadata: {
        s3_key: transcript.s3_key,
      },
      ipAddress,
      userAgent,
    })

    return NextResponse.json({
      success: true,
      message: 'Transcript deleted successfully',
      meeting_id: meetingId,
    })
  } catch (error) {
    console.error('DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete transcript', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PATCH /api/transcripts/[id]
 * Update transcript properties (privacy flag, dismiss privacy warning)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: meetingId } = await params

  try {
    // Get authenticated user
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's ID for tenant isolation
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const body = await request.json()
    const { isPrivate, privacyDismissed, irrelevanceDismissed } = body

    // Get the current transcript record
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const record = await dynamodb.send(getCommand)
    const transcript = record.Item as TranscriptRecord | undefined

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Build update expression
    const updateParts: string[] = []
    const expressionValues: Record<string, unknown> = {}
    const expressionNames: Record<string, string> = {}

    // Track privacy changes for audit logging
    let privacyChanged = false
    let previousPrivacy: boolean | undefined
    let newPrivacy: boolean | undefined

    if (typeof isPrivate === 'boolean') {
      updateParts.push('#isPrivate = :isPrivate')
      expressionNames['#isPrivate'] = 'isPrivate'
      expressionValues[':isPrivate'] = isPrivate

      // Track for audit logging
      if (isPrivate !== transcript.isPrivate) {
        privacyChanged = true
        previousPrivacy = transcript.isPrivate
        newPrivacy = isPrivate
      }

      // Handle vector cascade
      if (isPrivate && !transcript.isPrivate) {
        // Marking as private - remove vectors
        await deleteVectorsByMeetingId(meetingId)
        console.log(`Removed vectors for private transcript: ${meetingId}`)
      } else if (!isPrivate && transcript.isPrivate) {
        // Making public - vectors will be regenerated on next processing
        // For now, just update the flag
        console.log(`Transcript ${meetingId} made public - vectors may need regeneration`)
      }
    }

    if (typeof privacyDismissed === 'boolean') {
      updateParts.push('#privacyDismissed = :privacyDismissed')
      expressionNames['#privacyDismissed'] = 'privacy_dismissed'
      expressionValues[':privacyDismissed'] = privacyDismissed
    }

    if (typeof irrelevanceDismissed === 'boolean') {
      updateParts.push('#irrelevanceDismissed = :irrelevanceDismissed')
      expressionNames['#irrelevanceDismissed'] = 'irrelevance_dismissed'
      expressionValues[':irrelevanceDismissed'] = irrelevanceDismissed
    }

    if (updateParts.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Update DynamoDB
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: expressionNames,
      ExpressionAttributeValues: expressionValues,
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)
    console.log(`Updated transcript: ${meetingId}`)

    // Log audit event for privacy changes
    if (privacyChanged) {
      const { ipAddress, userAgent } = getClientInfo(request)
      await logAuditEvent({
        actorId: user.user_id,
        actorEmail: session.user.email,
        eventType: 'update.privacy',
        targetType: 'transcript',
        targetId: meetingId,
        metadata: {
          previous_privacy: previousPrivacy,
          new_privacy: newPrivacy,
        },
        ipAddress,
        userAgent,
      })
    }

    return NextResponse.json({
      success: true,
      meeting_id: meetingId,
      transcript: result.Attributes,
    })
  } catch (error) {
    console.error('PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update transcript', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Delete all vectors associated with a meeting from S3 Vectors
 * Uses AWS CLI since the S3 Vectors SDK is not yet available
 */
async function deleteVectorsByMeetingId(meetingId: string): Promise<number> {
  try {
    // First, list vectors with the meeting_id filter
    const listParams = {
      vectorBucketName: VECTOR_BUCKET,
      indexName: VECTOR_INDEX,
      filter: { equals: { key: 'meeting_id', value: meetingId } },
    }

    const tmpListFile = path.join(os.tmpdir(), `list-vectors-${Date.now()}.json`)
    fs.writeFileSync(tmpListFile, JSON.stringify(listParams))

    try {
      const { stdout: listOutput } = await execFileAsync('aws', [
        's3vectors',
        'list-vectors',
        '--cli-input-json',
        `file://${tmpListFile}`,
        '--region',
        AWS_REGION,
        '--output',
        'json',
      ], { maxBuffer: 10 * 1024 * 1024 })

      const listResponse = JSON.parse(listOutput)
      const keys = (listResponse.vectors || []).map((v: { key: string }) => v.key)

      if (keys.length === 0) {
        console.log(`No vectors found for meeting: ${meetingId}`)
        return 0
      }

      // Delete the vectors
      const deleteParams = {
        vectorBucketName: VECTOR_BUCKET,
        indexName: VECTOR_INDEX,
        keys,
      }

      const tmpDeleteFile = path.join(os.tmpdir(), `delete-vectors-${Date.now()}.json`)
      fs.writeFileSync(tmpDeleteFile, JSON.stringify(deleteParams))

      try {
        await execFileAsync('aws', [
          's3vectors',
          'delete-vectors',
          '--cli-input-json',
          `file://${tmpDeleteFile}`,
          '--region',
          AWS_REGION,
        ])

        console.log(`Deleted ${keys.length} vectors for meeting: ${meetingId}`)
        return keys.length
      } finally {
        if (fs.existsSync(tmpDeleteFile)) {
          fs.unlinkSync(tmpDeleteFile)
        }
      }
    } finally {
      if (fs.existsSync(tmpListFile)) {
        fs.unlinkSync(tmpListFile)
      }
    }
  } catch (error) {
    console.error('Error deleting vectors:', error)
    // This is non-fatal - the transcript can still be deleted
    return 0
  }
}

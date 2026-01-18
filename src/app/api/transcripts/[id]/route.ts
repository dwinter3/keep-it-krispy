import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

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
  isPrivate?: boolean
  privacy_level?: string
  privacy_reason?: string
  privacy_topics?: string[]
  privacy_confidence?: number
  privacy_work_percent?: number
  privacy_dismissed?: boolean
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

    if (typeof isPrivate === 'boolean') {
      updateParts.push('#isPrivate = :isPrivate')
      expressionNames['#isPrivate'] = 'isPrivate'
      expressionValues[':isPrivate'] = isPrivate

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

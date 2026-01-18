import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

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
  user_id?: string
  isPrivate?: boolean
}

interface BulkRequest {
  action: 'delete' | 'markPrivate'
  meetingIds: string[]
}

/**
 * Delete all vectors associated with a meeting from S3 Vectors
 */
async function deleteVectorsByMeetingId(meetingId: string): Promise<number> {
  try {
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
        return 0
      }

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
    return 0
  }
}

/**
 * POST /api/transcripts/bulk
 * Perform bulk operations on transcripts
 */
export async function POST(request: NextRequest) {
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
    const userId = user.user_id

    const body: BulkRequest = await request.json()
    const { action, meetingIds } = body

    if (!action || !meetingIds || !Array.isArray(meetingIds) || meetingIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request. Required: action (delete|markPrivate), meetingIds (array)' },
        { status: 400 }
      )
    }

    if (meetingIds.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 transcripts can be processed at once' },
        { status: 400 }
      )
    }

    // Fetch all transcripts to verify ownership
    const batchGetCommand = new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: meetingIds.map(id => ({ meeting_id: id })),
        },
      },
    })
    const batchResult = await dynamodb.send(batchGetCommand)
    const transcripts = (batchResult.Responses?.[TABLE_NAME] || []) as TranscriptRecord[]

    // Verify user owns all transcripts
    const unauthorizedIds = transcripts
      .filter(t => t.user_id && t.user_id !== userId)
      .map(t => t.meeting_id)

    if (unauthorizedIds.length > 0) {
      return NextResponse.json(
        { error: 'Unauthorized access to some transcripts', unauthorizedIds },
        { status: 403 }
      )
    }

    const results = {
      success: [] as string[],
      failed: [] as { id: string; error: string }[],
    }

    if (action === 'delete') {
      for (const transcript of transcripts) {
        try {
          // Delete from S3
          if (transcript.s3_key) {
            try {
              await s3.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: transcript.s3_key,
              }))
            } catch (s3Error) {
              console.error(`Error deleting S3 object ${transcript.s3_key}:`, s3Error)
            }
          }

          // Delete vectors
          await deleteVectorsByMeetingId(transcript.meeting_id)

          // Delete from DynamoDB
          await dynamodb.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: transcript.meeting_id },
          }))

          results.success.push(transcript.meeting_id)
        } catch (error) {
          results.failed.push({
            id: transcript.meeting_id,
            error: String(error),
          })
        }
      }
    } else if (action === 'markPrivate') {
      for (const transcript of transcripts) {
        try {
          // Skip if already private
          if (transcript.isPrivate) {
            results.success.push(transcript.meeting_id)
            continue
          }

          // Delete vectors when marking private
          await deleteVectorsByMeetingId(transcript.meeting_id)

          // Update DynamoDB
          await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: transcript.meeting_id },
            UpdateExpression: 'SET #isPrivate = :isPrivate',
            ExpressionAttributeNames: { '#isPrivate': 'isPrivate' },
            ExpressionAttributeValues: { ':isPrivate': true },
          }))

          results.success.push(transcript.meeting_id)
        } catch (error) {
          results.failed.push({
            id: transcript.meeting_id,
            error: String(error),
          })
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be "delete" or "markPrivate"' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      action,
      results,
      summary: {
        requested: meetingIds.length,
        succeeded: results.success.length,
        failed: results.failed.length,
      },
    })
  } catch (error) {
    console.error('Bulk operation error:', error)
    return NextResponse.json(
      { error: 'Failed to perform bulk operation', details: String(error) },
      { status: 500 }
    )
  }
}

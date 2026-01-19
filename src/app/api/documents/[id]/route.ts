import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { S3VectorsClient, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const s3 = new S3Client({ region: AWS_REGION, credentials })

interface RouteParams {
  params: Promise<{ id: string }>
}

interface TranscriptInfo {
  meetingId: string
  title: string
  date: string
  topic?: string
}

/**
 * GET /api/documents/[id] - Get document details with linked transcripts
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: documentId } = await params

  // Get authenticated user
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  try {
    // Fetch document from DynamoDB
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const response = await dynamodb.send(getCommand)

    if (!response.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Check ownership
    if (response.Item.user_id && response.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const doc = response.Item
    const linkedTranscriptIds: string[] = doc.linked_transcripts || []

    // Fetch linked transcript details
    const linkedTranscripts: TranscriptInfo[] = []
    for (const meetingId of linkedTranscriptIds) {
      try {
        const transcriptCommand = new GetCommand({
          TableName: TABLE_NAME,
          Key: { meeting_id: meetingId },
          ProjectionExpression: 'meeting_id, title, #d, topic, #ts',
          ExpressionAttributeNames: {
            '#d': 'date',
            '#ts': 'timestamp',
          },
        })
        const transcriptResponse = await dynamodb.send(transcriptCommand)
        if (transcriptResponse.Item) {
          linkedTranscripts.push({
            meetingId: transcriptResponse.Item.meeting_id,
            title: transcriptResponse.Item.title || 'Untitled Meeting',
            date: transcriptResponse.Item.date || transcriptResponse.Item.timestamp || '',
            topic: transcriptResponse.Item.topic,
          })
        }
      } catch (err) {
        console.error(`Failed to fetch transcript ${meetingId}:`, err)
      }
    }

    // Fetch content from S3 if requested
    const { searchParams } = new URL(request.url)
    const includeContent = searchParams.get('content') === 'true'
    let content: string | undefined

    if (includeContent && doc.s3_key) {
      try {
        const s3Command = new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: doc.s3_key,
        })
        const s3Response = await s3.send(s3Command)
        content = await s3Response.Body?.transformToString()
      } catch {
        // Content might not exist
      }
    }

    return NextResponse.json({
      documentId: doc.document_id,
      title: doc.title,
      filename: doc.filename,
      fileType: doc.file_type || doc.format,
      fileSize: doc.file_size,
      fileHash: doc.file_hash,
      source: doc.source,
      sourceUrl: doc.source_url,
      format: doc.format,
      s3Key: doc.s3_key,
      importedAt: doc.timestamp || doc.importedAt,
      wordCount: doc.word_count || doc.wordCount,
      isPrivate: doc.is_private || doc.isPrivate || false,
      linkedTranscripts,
      linkedTranscriptCount: linkedTranscripts.length,
      ...(content && { content }),
    })
  } catch (error) {
    console.error('Document GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch document', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id] - Delete a document
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: documentId } = await params

  // Get authenticated user
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  try {
    // First get the document to find the S3 key and verify ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const response = await dynamodb.send(getCommand)

    if (!response.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Check ownership
    if (response.Item.user_id && response.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const s3Key = response.Item.s3_key

    // Delete from S3
    if (s3Key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          })
        )
      } catch (s3Error) {
        console.error('Failed to delete from S3:', s3Error)
      }
    }

    // Delete vectors
    try {
      const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })
      // Generate keys for potential chunks (up to 100 chunks)
      const keysToDelete = Array.from({ length: 100 }, (_, i) => `doc_${documentId}_chunk_${i}`)
      await vectorsClient.send(
        new DeleteVectorsCommand({
          vectorBucketName: VECTOR_BUCKET,
          indexName: INDEX_NAME,
          keys: keysToDelete,
        })
      )
    } catch (vectorError) {
      console.error('Failed to delete vectors:', vectorError)
    }

    // Delete from DynamoDB
    await dynamodb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: `doc_${documentId}` },
      })
    )

    return NextResponse.json({ success: true, documentId })
  } catch (error) {
    console.error('Document DELETE error:', error)
    return NextResponse.json(
      { error: 'Failed to delete document', details: String(error) },
      { status: 500 }
    )
  }
}

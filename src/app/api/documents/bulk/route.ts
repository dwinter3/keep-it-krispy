import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
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

interface BulkDeleteResult {
  documentId: string
  success: boolean
  error?: string
}

/**
 * Helper function to delete a single document
 */
async function deleteDocument(
  documentId: string,
  userId: string
): Promise<BulkDeleteResult> {
  try {
    // First get the document to find the S3 key and verify ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const response = await dynamodb.send(getCommand)

    if (!response.Item) {
      return { documentId, success: false, error: 'Document not found' }
    }

    // Check ownership
    if (response.Item.user_id && response.Item.user_id !== userId) {
      return { documentId, success: false, error: 'Access denied' }
    }

    const s3Key = response.Item.s3_key
    const rawFileKey = response.Item.raw_file_key

    // Delete text content from S3
    if (s3Key) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          })
        )
      } catch (s3Error) {
        console.error(`Failed to delete S3 object ${s3Key}:`, s3Error)
      }
    }

    // Delete raw file from S3 (e.g., original PDF)
    if (rawFileKey) {
      try {
        await s3.send(
          new DeleteObjectCommand({
            Bucket: BUCKET_NAME,
            Key: rawFileKey,
          })
        )
      } catch (s3Error) {
        console.error(`Failed to delete raw file ${rawFileKey}:`, s3Error)
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
      console.error(`Failed to delete vectors for ${documentId}:`, vectorError)
    }

    // Delete from DynamoDB
    await dynamodb.send(
      new DeleteCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: `doc_${documentId}` },
      })
    )

    return { documentId, success: true }
  } catch (error) {
    console.error(`Error deleting document ${documentId}:`, error)
    return { documentId, success: false, error: String(error) }
  }
}

/**
 * DELETE /api/documents/bulk - Bulk delete documents
 *
 * Request body:
 * {
 *   "documentIds": ["id1", "id2", "id3"]
 * }
 */
export async function DELETE(request: NextRequest) {
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
    const body = await request.json()
    const { documentIds } = body

    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) {
      return NextResponse.json(
        { error: 'documentIds array is required' },
        { status: 400 }
      )
    }

    // Limit batch size to prevent abuse
    const MAX_BATCH_SIZE = 50
    if (documentIds.length > MAX_BATCH_SIZE) {
      return NextResponse.json(
        { error: `Cannot delete more than ${MAX_BATCH_SIZE} documents at once` },
        { status: 400 }
      )
    }

    // Delete documents in parallel
    const results = await Promise.all(
      documentIds.map((id: string) => deleteDocument(id, userId))
    )

    const successful = results.filter(r => r.success)
    const failed = results.filter(r => !r.success)

    return NextResponse.json({
      success: true,
      deleted: successful.length,
      failed: failed.length,
      results,
    })
  } catch (error) {
    console.error('Bulk delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete documents', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/drive/import - Import a file from Google Drive
 *
 * Body:
 * - fileId: Google Drive file ID to import
 */

import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import {
  getDriveFile,
  downloadDriveFile,
  refreshAccessToken,
  isSupportedMimeType,
  isFolder,
  getExtensionForMimeType,
} from '@/lib/google'
import { parseDocument, detectFormat, chunkText, type DocumentFormat } from '@/lib/documentParser'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

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
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

/**
 * Calculate file hash for deduplication
 */
function calculateFileHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Check if a document with the same hash already exists for this user
 */
async function findDocumentByHash(userId: string, fileHash: string): Promise<Record<string, unknown> | null> {
  try {
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'pk = :pk AND user_id = :userId AND file_hash = :fileHash',
      ExpressionAttributeValues: {
        ':pk': 'DOCUMENT',
        ':userId': userId,
        ':fileHash': fileHash,
      },
    })
    const response = await dynamodb.send(scanCommand)
    return response.Items?.[0] || null
  } catch {
    return null
  }
}

/**
 * Generate embeddings for document chunks and store in S3 Vectors
 */
async function generateDocumentEmbeddings(
  documentId: string,
  s3Key: string,
  title: string,
  chunks: string[]
) {
  const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]

    // Generate embedding using Bedrock Titan
    const embeddingCommand = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: chunk.slice(0, 8192 * 4),
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    })

    const embeddingResponse = await bedrock.send(embeddingCommand)
    const embeddingBody = JSON.parse(new TextDecoder().decode(embeddingResponse.body))
    const embedding = embeddingBody.embedding as number[]

    // Store vector in S3 Vectors
    await vectorsClient.send(
      new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: INDEX_NAME,
        vectors: [
          {
            key: `doc_${documentId}_chunk_${i}`,
            data: { float32: embedding },
            metadata: {
              meeting_id: `doc_${documentId}`,
              s3_key: s3Key,
              chunk_index: String(i),
              speaker: title,
              text: chunk.slice(0, 2000),
              type: 'document',
            },
          },
        ],
      })
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get authenticated user session
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const userId = user.user_id

    // Get access token (prefer session, fallback to stored)
    let accessToken = session.accessToken || user.google_access_token
    const refreshToken = session.refreshToken || user.google_refresh_token

    if (!accessToken) {
      return NextResponse.json(
        {
          error: 'Not connected to Google Drive',
          code: 'NO_TOKEN',
          message: 'Please sign in again to grant Google Drive access',
        },
        { status: 401 }
      )
    }

    // Parse request body
    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json({ error: 'fileId is required' }, { status: 400 })
    }

    // Get file metadata from Drive
    let file
    let retried = false

    while (true) {
      try {
        file = await getDriveFile(accessToken, fileId)
        break
      } catch (error) {
        // If unauthorized and we have a refresh token, try to refresh
        if (!retried && refreshToken && String(error).includes('401')) {
          const refreshed = await refreshAccessToken(refreshToken)
          if (refreshed) {
            accessToken = refreshed.accessToken
            retried = true
            continue
          }
        }
        throw error
      }
    }

    // Validate file type
    if (!isSupportedMimeType(file.mimeType) || isFolder(file.mimeType)) {
      return NextResponse.json(
        { error: 'Unsupported file type. Please select a document file.' },
        { status: 400 }
      )
    }

    // Download file content
    const { content: fileBuffer, filename } = await downloadDriveFile(
      accessToken,
      fileId,
      file.mimeType
    )

    // Calculate hash for deduplication
    const fileHash = calculateFileHash(fileBuffer)

    // Check for duplicate
    const existingDoc = await findDocumentByHash(userId, fileHash)
    if (existingDoc) {
      return NextResponse.json({
        success: true,
        documentId: existingDoc.document_id,
        title: existingDoc.title,
        duplicate: true,
        message: 'Document already exists in your library',
      })
    }

    // Determine format from the exported/downloaded file
    const extension = getExtensionForMimeType(file.mimeType)
    let format: DocumentFormat

    if (extension) {
      format = detectFormat(`file.${extension}`) || 'txt'
    } else {
      format = detectFormat(filename) || 'txt'
    }

    // Parse the document content
    let parsed
    try {
      parsed = await parseDocument(fileBuffer, format)
    } catch (parseError) {
      console.error('Document parse error:', parseError)
      // Fall back to plain text if parsing fails
      parsed = {
        content: fileBuffer.toString('utf-8'),
        title: file.name,
        wordCount: fileBuffer.toString('utf-8').split(/\s+/).filter((w: string) => w.length > 0).length,
        format: 'txt' as DocumentFormat,
      }
    }

    // Generate document ID and S3 key
    const documentId = uuidv4()
    const now = new Date()
    const safeFilename = filename.replace(/[^a-zA-Z0-9-_.\s]/g, '').slice(0, 50)
    const s3Key = `users/${userId}/documents/${documentId}/${safeFilename}.txt`

    // Store content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: parsed.content,
        ContentType: 'text/plain; charset=utf-8',
      })
    )

    // Store metadata in DynamoDB
    const title = parsed.title || file.name.replace(/\.[^/.]+$/, '')
    const item = {
      pk: 'DOCUMENT',
      meeting_id: `doc_${documentId}`,
      document_id: documentId,
      user_id: userId,
      title,
      filename,
      file_type: format,
      file_size: fileBuffer.length,
      file_hash: fileHash,
      source: 'drive',
      source_url: file.webViewLink || `https://drive.google.com/file/d/${fileId}`,
      drive_file_id: fileId,
      format,
      s3_key: s3Key,
      timestamp: now.toISOString(),
      importedAt: now.toISOString(),
      word_count: parsed.wordCount,
      is_private: false,
      linked_transcripts: [],
    }

    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    )

    // Generate embeddings for the document content
    const chunks = chunkText(parsed.content, 1000, 100)
    console.log(`Generating embeddings for ${chunks.length} chunks from Drive import`)

    try {
      await generateDocumentEmbeddings(documentId, s3Key, title, chunks)
      console.log(`Successfully generated embeddings for document ${documentId}`)
    } catch (embeddingError) {
      console.error('Failed to generate embeddings:', embeddingError)
      // Don't fail the import if embeddings fail, document is still saved
    }

    return NextResponse.json({
      success: true,
      documentId,
      title,
      filename,
      fileSize: fileBuffer.length,
      wordCount: parsed.wordCount,
      chunks: chunks.length,
      source: 'drive',
    })
  } catch (error) {
    console.error('Drive import error:', error)

    // Check if it's a token error
    if (String(error).includes('401') || String(error).includes('invalid_grant')) {
      return NextResponse.json(
        {
          error: 'Google Drive access expired',
          code: 'TOKEN_EXPIRED',
          message: 'Please sign in again to refresh your Google Drive access',
        },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to import file from Drive', details: String(error) },
      { status: 500 }
    )
  }
}

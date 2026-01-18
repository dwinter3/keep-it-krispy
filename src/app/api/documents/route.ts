import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors'
import { v4 as uuidv4 } from 'uuid'
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

export interface Document {
  document_id: string
  pk: string
  title: string
  source: 'upload' | 'url' | 'drive'
  sourceUrl?: string
  format: DocumentFormat
  s3_key: string
  importedAt: string
  wordCount: number
  isPrivate: boolean
}

/**
 * GET /api/documents - List all documents or fetch a specific one
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const documentId = searchParams.get('id')

  try {
    // Fetch specific document by ID
    if (documentId) {
      const getCommand = new GetCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: `doc_${documentId}` },
      })
      const response = await dynamodb.send(getCommand)

      if (!response.Item) {
        return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      }

      // Also fetch the content from S3
      const s3Key = response.Item.s3_key
      if (s3Key) {
        try {
          const s3Command = new GetObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
          })
          const s3Response = await s3.send(s3Command)
          const content = await s3Response.Body?.transformToString()

          return NextResponse.json({
            ...response.Item,
            content,
          })
        } catch {
          // Content might not exist, return metadata only
          return NextResponse.json(response.Item)
        }
      }

      return NextResponse.json(response.Item)
    }

    // List all documents using GSI
    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'all-transcripts-index',
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'DOCUMENT' },
      ScanIndexForward: false, // Newest first
    })

    const response = await dynamodb.send(queryCommand)
    const documents = (response.Items || []).map(item => ({
      documentId: item.document_id,
      title: item.title,
      source: item.source,
      sourceUrl: item.source_url,
      format: item.format,
      importedAt: item.timestamp || item.importedAt,
      wordCount: item.word_count || item.wordCount,
      isPrivate: item.is_private || item.isPrivate || false,
    }))

    return NextResponse.json({
      count: documents.length,
      documents,
    })
  } catch (error) {
    console.error('Documents API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch documents', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/documents - Upload a new document
 */
export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || ''

    let title: string
    let content: string
    let format: DocumentFormat
    let source: 'upload' | 'url' | 'drive' = 'upload'
    let sourceUrl: string | undefined
    let wordCount: number
    let isPrivate = false

    // Handle file upload (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      const detectedFormat = detectFormat(file.name)
      if (!detectedFormat) {
        return NextResponse.json(
          { error: 'Unsupported file format. Supported: PDF, DOCX, MD, TXT' },
          { status: 400 }
        )
      }

      format = detectedFormat
      const fileBuffer = Buffer.from(await file.arrayBuffer())

      // Parse the document
      const parsed = await parseDocument(fileBuffer, format)
      title = (formData.get('title') as string) || parsed.title || file.name.replace(/\.[^/.]+$/, '')
      content = parsed.content
      wordCount = parsed.wordCount
      isPrivate = formData.get('isPrivate') === 'true'
    }
    // Handle JSON body (for manual content or URL-imported content)
    else {
      const body = await request.json()
      title = body.title
      content = body.content
      format = body.format || 'txt'
      source = body.source || 'upload'
      sourceUrl = body.sourceUrl
      wordCount = body.wordCount || content.split(/\s+/).filter((w: string) => w.length > 0).length
      isPrivate = body.isPrivate || false

      if (!title || !content) {
        return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
      }
    }

    // Generate document ID
    const documentId = uuidv4()
    const now = new Date()
    const datePrefix = now.toISOString().slice(0, 10).replace(/-/g, '/')
    const safeTitle = title.replace(/[^a-zA-Z0-9-_\s]/g, '').slice(0, 50)
    const s3Key = `documents/${datePrefix}/${documentId}_${safeTitle}.txt`

    // Store content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
      })
    )

    // Store metadata in DynamoDB
    const item = {
      pk: 'DOCUMENT',
      meeting_id: `doc_${documentId}`,
      document_id: documentId,
      title,
      source,
      source_url: sourceUrl,
      format,
      s3_key: s3Key,
      timestamp: now.toISOString(),
      importedAt: now.toISOString(),
      word_count: wordCount,
      is_private: isPrivate,
    }

    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    )

    // Generate embeddings for the document content
    const chunks = chunkText(content, 1000, 100)
    console.log(`Generating embeddings for ${chunks.length} chunks`)

    try {
      await generateDocumentEmbeddings(documentId, s3Key, title, chunks)
      console.log(`Successfully generated embeddings for document ${documentId}`)
    } catch (embeddingError) {
      console.error('Failed to generate embeddings:', embeddingError)
      // Don't fail the upload if embeddings fail, document is still saved
    }

    return NextResponse.json({
      success: true,
      documentId,
      title,
      wordCount,
      chunks: chunks.length,
    })
  } catch (error) {
    console.error('Document upload error:', error)
    return NextResponse.json(
      { error: 'Failed to upload document', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents?id=xxx - Delete a document
 */
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const documentId = searchParams.get('id')

  if (!documentId) {
    return NextResponse.json({ error: 'Document ID required' }, { status: 400 })
  }

  try {
    // First get the document to find the S3 key
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const response = await dynamodb.send(getCommand)

    if (!response.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
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
    // Note: We need to delete all chunks, but we don't know how many there are.
    // For now, we'll attempt to delete a reasonable range of chunk keys.
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
    console.error('Document delete error:', error)
    return NextResponse.json(
      { error: 'Failed to delete document', details: String(error) },
      { status: 500 }
    )
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

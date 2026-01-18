import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { getUserByApiKey } from '@/lib/users'
import { chunkText } from '@/lib/documentParser'

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

interface NotionWebhookPayload {
  pageId: string
  title: string
  content: string
  url?: string
  // Optional: Direct Notion API integration
  accessToken?: string
  // Optional metadata
  lastEditedTime?: string
  createdTime?: string
  parentType?: 'database' | 'page' | 'workspace'
  parentId?: string
}

/**
 * POST /api/webhooks/notion
 *
 * Accepts Notion content via webhook. Can be called by:
 * - Zapier/Make automations with extracted content
 * - Direct integrations with pre-extracted text
 *
 * Authentication: API key in Authorization header (Bearer token)
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate via API key
    const authHeader = request.headers.get('authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid authorization header. Use Bearer <api_key>' },
        { status: 401 }
      )
    }

    const apiKey = authHeader.slice(7)
    const user = await getUserByApiKey(apiKey)
    if (!user) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      )
    }

    const userId = user.user_id

    // Parse request body
    const body = await request.json() as NotionWebhookPayload
    const { pageId, title, content, url, lastEditedTime, createdTime, parentType, parentId } = body

    // Validate required fields
    if (!pageId) {
      return NextResponse.json(
        { error: 'pageId is required' },
        { status: 400 }
      )
    }

    if (!title) {
      return NextResponse.json(
        { error: 'title is required' },
        { status: 400 }
      )
    }

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'content is required and cannot be empty' },
        { status: 400 }
      )
    }

    // Calculate content hash for deduplication
    const contentHash = createHash('sha256').update(content).digest('hex')

    // Generate document ID (use pageId as base for idempotency)
    const documentId = uuidv4()
    const now = new Date()
    const safeTitle = title.replace(/[^a-zA-Z0-9-_.\s]/g, '').slice(0, 50)

    // Store in user-specific path with notion prefix
    const s3Key = `users/${userId}/notion/${pageId}/${safeTitle}.txt`

    // Store content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
        Metadata: {
          'notion-page-id': pageId,
          'notion-url': url || '',
          'source': 'notion',
        },
      })
    )

    // Calculate word count
    const wordCount = content.split(/\s+/).filter((w: string) => w.length > 0).length

    // Store metadata in DynamoDB
    const item = {
      pk: 'DOCUMENT',
      meeting_id: `doc_${documentId}`,
      document_id: documentId,
      user_id: userId,
      title,
      source: 'notion',
      source_url: url || `https://notion.so/${pageId.replace(/-/g, '')}`,
      format: 'notion',
      s3_key: s3Key,
      timestamp: now.toISOString(),
      importedAt: now.toISOString(),
      word_count: wordCount,
      file_hash: contentHash,
      is_private: false,
      linked_transcripts: [],
      // Notion-specific metadata
      notion_page_id: pageId,
      notion_last_edited: lastEditedTime,
      notion_created: createdTime,
      notion_parent_type: parentType,
      notion_parent_id: parentId,
    }

    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    )

    // Generate embeddings for the document content
    const chunks = chunkText(content, 1000, 100)
    console.log(`[Notion Webhook] Generating embeddings for ${chunks.length} chunks (pageId: ${pageId})`)

    try {
      await generateNotionEmbeddings(documentId, s3Key, title, chunks)
      console.log(`[Notion Webhook] Successfully generated embeddings for document ${documentId}`)
    } catch (embeddingError) {
      console.error('[Notion Webhook] Failed to generate embeddings:', embeddingError)
      // Don't fail the import if embeddings fail, document is still saved
    }

    return NextResponse.json({
      success: true,
      documentId,
      pageId,
      title,
      wordCount,
      chunks: chunks.length,
      message: 'Notion page imported successfully',
    })
  } catch (error) {
    console.error('[Notion Webhook] Error:', error)
    return NextResponse.json(
      { error: 'Failed to import Notion page', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Generate embeddings for Notion document chunks and store in S3 Vectors
 */
async function generateNotionEmbeddings(
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
              type: 'notion',
            },
          },
        ],
      })
    )
  }
}

/**
 * GET /api/webhooks/notion
 *
 * Returns information about the webhook endpoint and expected payload format
 */
export async function GET() {
  return NextResponse.json({
    name: 'Notion Import Webhook',
    version: '1.0',
    description: 'Import Notion pages into the knowledge base',
    authentication: 'Bearer token (API key)',
    endpoint: 'POST /api/webhooks/notion',
    payload: {
      pageId: { type: 'string', required: true, description: 'Notion page ID' },
      title: { type: 'string', required: true, description: 'Page title' },
      content: { type: 'string', required: true, description: 'Extracted text content' },
      url: { type: 'string', required: false, description: 'Notion page URL' },
      lastEditedTime: { type: 'string', required: false, description: 'ISO 8601 timestamp of last edit' },
      createdTime: { type: 'string', required: false, description: 'ISO 8601 timestamp of creation' },
      parentType: { type: 'string', required: false, description: 'Parent type: database, page, or workspace' },
      parentId: { type: 'string', required: false, description: 'Parent ID' },
    },
    example: {
      pageId: '12345678-1234-1234-1234-123456789abc',
      title: 'Meeting Notes - Q1 Planning',
      content: 'The full text content of the Notion page...',
      url: 'https://notion.so/workspace/Meeting-Notes-123456',
      lastEditedTime: '2024-01-15T10:30:00.000Z',
    },
  })
}

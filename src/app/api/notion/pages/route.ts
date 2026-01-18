import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { chunkText } from '@/lib/documentParser'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const USERS_TABLE = 'krisp-users'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

// AWS clients with custom credentials
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

interface NotionPage {
  id: string
  url: string
  created_time: string
  last_edited_time: string
  parent: {
    type: string
    database_id?: string
    page_id?: string
    workspace?: boolean
  }
  properties: {
    title?: {
      title?: Array<{ plain_text: string }>
    }
    Name?: {
      title?: Array<{ plain_text: string }>
    }
    [key: string]: unknown
  }
}

interface NotionBlock {
  id: string
  type: string
  [key: string]: unknown
}

/**
 * GET /api/notion/pages
 *
 * Lists pages accessible via the user's Notion connection
 */
export async function GET(request: NextRequest) {
  // Verify user is authenticated
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Get user's Notion access token
  const userRecord = await dynamodb.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { user_id: user.user_id },
      ProjectionExpression: 'notion_access_token, notion_workspace_name',
    })
  )

  const notionToken = userRecord.Item?.notion_access_token
  if (!notionToken) {
    return NextResponse.json(
      { error: 'Notion not connected. Please connect your Notion account first.' },
      { status: 400 }
    )
  }

  try {
    // Search for pages in Notion
    const searchResponse = await fetch('https://api.notion.com/v1/search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 100,
      }),
    })

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json().catch(() => ({}))
      console.error('[Notion API] Search failed:', errorData)
      return NextResponse.json(
        { error: 'Failed to fetch Notion pages', details: errorData },
        { status: searchResponse.status }
      )
    }

    const searchData = await searchResponse.json()
    const pages = (searchData.results as NotionPage[]).map((page) => ({
      id: page.id,
      url: page.url,
      title: getPageTitle(page),
      createdTime: page.created_time,
      lastEditedTime: page.last_edited_time,
      parentType: page.parent.type,
    }))

    return NextResponse.json({
      pages,
      workspace: userRecord.Item?.notion_workspace_name,
      hasMore: searchData.has_more,
      nextCursor: searchData.next_cursor,
    })
  } catch (error) {
    console.error('[Notion API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch Notion pages', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/notion/pages
 *
 * Imports a specific Notion page into the knowledge base
 */
export async function POST(request: NextRequest) {
  // Verify user is authenticated
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const userId = user.user_id

  // Get user's Notion access token
  const userRecord = await dynamodb.send(
    new GetCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      ProjectionExpression: 'notion_access_token',
    })
  )

  const notionToken = userRecord.Item?.notion_access_token
  if (!notionToken) {
    return NextResponse.json(
      { error: 'Notion not connected. Please connect your Notion account first.' },
      { status: 400 }
    )
  }

  try {
    const body = await request.json()
    const { pageId } = body

    if (!pageId) {
      return NextResponse.json({ error: 'pageId is required' }, { status: 400 })
    }

    // Fetch page metadata
    const pageResponse = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      headers: {
        'Authorization': `Bearer ${notionToken}`,
        'Notion-Version': '2022-06-28',
      },
    })

    if (!pageResponse.ok) {
      const errorData = await pageResponse.json().catch(() => ({}))
      return NextResponse.json(
        { error: 'Failed to fetch Notion page', details: errorData },
        { status: pageResponse.status }
      )
    }

    const pageData = await pageResponse.json() as NotionPage
    const title = getPageTitle(pageData)

    // Fetch page content (blocks)
    const content = await fetchPageContent(notionToken, pageId)

    if (!content || content.trim().length === 0) {
      return NextResponse.json(
        { error: 'Could not extract content from Notion page' },
        { status: 400 }
      )
    }

    // Calculate content hash for deduplication
    const contentHash = createHash('sha256').update(content).digest('hex')

    // Generate document ID
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
          'notion-url': pageData.url || '',
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
      source_url: pageData.url,
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
      notion_last_edited: pageData.last_edited_time,
      notion_created: pageData.created_time,
      notion_parent_type: pageData.parent.type,
    }

    await dynamodb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: item,
      })
    )

    // Generate embeddings
    const chunks = chunkText(content, 1000, 100)
    console.log(`[Notion Import] Generating embeddings for ${chunks.length} chunks (pageId: ${pageId})`)

    try {
      await generateNotionEmbeddings(documentId, s3Key, title, chunks)
      console.log(`[Notion Import] Successfully generated embeddings for document ${documentId}`)
    } catch (embeddingError) {
      console.error('[Notion Import] Failed to generate embeddings:', embeddingError)
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
    console.error('[Notion Import] Error:', error)
    return NextResponse.json(
      { error: 'Failed to import Notion page', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Extract page title from Notion page object
 */
function getPageTitle(page: NotionPage): string {
  // Try different title property names
  const titleProp = page.properties?.title || page.properties?.Name
  if (titleProp?.title?.[0]?.plain_text) {
    return titleProp.title[0].plain_text
  }

  // Fall back to generic property search
  for (const [, value] of Object.entries(page.properties || {})) {
    if (typeof value === 'object' && value !== null && 'title' in value) {
      const titleArray = (value as { title?: Array<{ plain_text: string }> }).title
      if (titleArray?.[0]?.plain_text) {
        return titleArray[0].plain_text
      }
    }
  }

  return 'Untitled'
}

/**
 * Fetch all content blocks from a Notion page
 */
async function fetchPageContent(token: string, pageId: string): Promise<string> {
  const blocks: string[] = []
  let cursor: string | null = null

  do {
    const url = new URL(`https://api.notion.com/v1/blocks/${pageId}/children`)
    if (cursor) url.searchParams.set('start_cursor', cursor)

    const response = await fetch(url.toString(), {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
      },
    })

    if (!response.ok) {
      console.error('[Notion] Failed to fetch blocks:', await response.text())
      break
    }

    const data = await response.json()

    for (const block of data.results as NotionBlock[]) {
      const text = extractBlockText(block)
      if (text) blocks.push(text)

      // Recursively fetch child blocks if present
      if (block.has_children) {
        const childContent = await fetchPageContent(token, block.id)
        if (childContent) blocks.push(childContent)
      }
    }

    cursor = data.has_more ? data.next_cursor : null
  } while (cursor)

  return blocks.join('\n\n')
}

/**
 * Extract plain text from a Notion block
 */
function extractBlockText(block: NotionBlock): string {
  const type = block.type
  const content = block[type] as { rich_text?: Array<{ plain_text: string }>; text?: string } | undefined

  if (!content) return ''

  // Handle rich text blocks
  if (content.rich_text && Array.isArray(content.rich_text)) {
    const text = content.rich_text.map((t) => t.plain_text).join('')

    // Add formatting based on block type
    switch (type) {
      case 'heading_1':
        return `# ${text}`
      case 'heading_2':
        return `## ${text}`
      case 'heading_3':
        return `### ${text}`
      case 'bulleted_list_item':
        return `- ${text}`
      case 'numbered_list_item':
        return `1. ${text}`
      case 'to_do':
        const checked = (block[type] as { checked?: boolean })?.checked
        return `[${checked ? 'x' : ' '}] ${text}`
      case 'quote':
        return `> ${text}`
      case 'code':
        return `\`\`\`\n${text}\n\`\`\``
      default:
        return text
    }
  }

  return ''
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

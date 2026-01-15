import { NextRequest, NextResponse } from 'next/server'
import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import { createHash } from 'crypto'

// Configuration
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

// AWS clients
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })

interface ExtractedContent {
  title: string
  content: string
  excerpt: string
  byline: string | null
  siteName: string | null
  publishedTime: string | null
  url: string
}

interface ImportResult {
  success: boolean
  documentId: string
  title: string
  url: string
  contentLength: number
  chunksCreated: number
  error?: string
}

/**
 * POST /api/import-url
 * Import web content from a URL into the knowledge base
 */
export async function POST(request: NextRequest): Promise<NextResponse<ImportResult | { error: string }>> {
  try {
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 })
    }

    // Validate URL format
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return NextResponse.json({ error: 'Only HTTP and HTTPS URLs are supported' }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 })
    }

    console.log(`[import-url] Fetching: ${url}`)

    // Fetch the web page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KrispBuddy/1.0; +https://github.com/krisp-buddy)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      redirect: 'follow',
    })

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
        { status: 400 }
      )
    }

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
      return NextResponse.json(
        { error: 'URL does not point to an HTML page' },
        { status: 400 }
      )
    }

    const html = await response.text()
    console.log(`[import-url] Fetched ${html.length} bytes`)

    // Extract content using Readability
    const extracted = extractContent(html, url)
    if (!extracted.content || extracted.content.length < 100) {
      return NextResponse.json(
        { error: 'Could not extract meaningful content from the page' },
        { status: 400 }
      )
    }

    console.log(`[import-url] Extracted: "${extracted.title}" (${extracted.content.length} chars)`)

    // Generate a unique document ID based on URL
    const documentId = generateDocumentId(url)

    // Chunk the content
    const chunks = chunkText(extracted.content, 500, 50)
    console.log(`[import-url] Created ${chunks.length} chunks`)

    // Generate embeddings and store vectors
    const vectors = await generateAndStoreVectors(documentId, chunks, extracted)
    console.log(`[import-url] Stored ${vectors} vectors`)

    // Store document metadata in DynamoDB
    await storeDocumentMetadata(documentId, extracted)
    console.log(`[import-url] Stored metadata for: ${documentId}`)

    return NextResponse.json({
      success: true,
      documentId,
      title: extracted.title,
      url: extracted.url,
      contentLength: extracted.content.length,
      chunksCreated: chunks.length,
    })

  } catch (error) {
    console.error('[import-url] Error:', error)
    return NextResponse.json(
      { error: `Import failed: ${error instanceof Error ? error.message : 'Unknown error'}` },
      { status: 500 }
    )
  }
}

/**
 * Extract main content from HTML using Mozilla Readability
 */
function extractContent(html: string, url: string): ExtractedContent {
  const dom = new JSDOM(html, { url })
  const document = dom.window.document

  // Extract metadata from meta tags before Readability modifies the DOM
  const metaTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
                    document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
                    document.title

  const metaDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
                          document.querySelector('meta[name="description"]')?.getAttribute('content') ||
                          document.querySelector('meta[name="twitter:description"]')?.getAttribute('content')

  const siteName = document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
                   new URL(url).hostname

  const publishedTime = document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
                        document.querySelector('meta[name="date"]')?.getAttribute('content') ||
                        document.querySelector('time')?.getAttribute('datetime')

  const author = document.querySelector('meta[name="author"]')?.getAttribute('content') ||
                 document.querySelector('meta[property="article:author"]')?.getAttribute('content')

  // Use Readability to extract main content
  const reader = new Readability(document)
  const article = reader.parse()

  if (!article) {
    // Fallback: try to get body text
    const bodyText = document.body?.textContent?.trim() || ''
    return {
      title: metaTitle || 'Untitled',
      content: cleanText(bodyText),
      excerpt: metaDescription || bodyText.slice(0, 300),
      byline: author || null,
      siteName: siteName || null,
      publishedTime: publishedTime || null,
      url,
    }
  }

  return {
    title: article.title || metaTitle || 'Untitled',
    content: cleanText(article.textContent || ''),
    excerpt: article.excerpt || metaDescription || '',
    byline: article.byline || author || null,
    siteName: article.siteName || siteName || null,
    publishedTime: publishedTime || null,
    url,
  }
}

/**
 * Clean extracted text (remove excessive whitespace, etc.)
 */
function cleanText(text: string): string {
  return text
    .replace(/\s+/g, ' ')           // Collapse whitespace
    .replace(/\n\s*\n/g, '\n\n')    // Normalize paragraph breaks
    .trim()
}

/**
 * Generate a deterministic document ID from URL
 */
function generateDocumentId(url: string): string {
  const hash = createHash('sha256').update(url).digest('hex').slice(0, 12)
  const timestamp = Date.now().toString(36)
  return `web_${timestamp}_${hash}`
}

/**
 * Split text into overlapping chunks for embedding
 */
function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  const words = text.split(/\s+/)

  if (words.length <= chunkSize) {
    return text.trim() ? [text] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    const chunk = words.slice(start, end).join(' ')
    chunks.push(chunk)

    // Move start forward, accounting for overlap
    start = end - overlap
    if (start >= words.length - overlap) {
      break
    }
  }

  return chunks
}

/**
 * Generate embedding for text using Bedrock Titan
 */
async function generateEmbedding(text: string): Promise<number[]> {
  // Truncate if too long
  const maxChars = 8192 * 4
  const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: truncatedText,
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    }),
  })

  const response = await bedrock.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  return responseBody.embedding
}

/**
 * Generate embeddings for all chunks and store in S3 Vectors
 */
async function generateAndStoreVectors(
  documentId: string,
  chunks: string[],
  metadata: ExtractedContent
): Promise<number> {
  if (chunks.length === 0) return 0

  // Process in batches of 10 to avoid rate limits
  const batchSize = 10
  let totalStored = 0

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize)
    const vectors = []

    for (let j = 0; j < batch.length; j++) {
      const chunkIndex = i + j
      const chunk = batch[j]

      // Add context to embedding for better semantic search
      const textForEmbedding = `Source: ${metadata.title}. ${chunk}`
      const embedding = await generateEmbedding(textForEmbedding)

      vectors.push({
        key: `${documentId}_chunk_${String(chunkIndex).padStart(4, '0')}`,
        data: { float32: embedding },
        metadata: {
          meeting_id: documentId,  // Using meeting_id for compatibility with existing search
          s3_key: `web/${documentId}`,
          chunk_index: String(chunkIndex),
          speaker: metadata.siteName || 'web',
          text: chunk.slice(0, 500),  // Truncate for metadata storage
          source_type: 'web',
          url: metadata.url,
          title: metadata.title,
        },
      })
    }

    // Store batch in S3 Vectors
    try {
      const command = new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: INDEX_NAME,
        vectors,
      })
      await vectorsClient.send(command)
      totalStored += vectors.length
    } catch (error) {
      console.error(`[import-url] Error storing vectors batch ${i}:`, error)
      throw error
    }
  }

  return totalStored
}

/**
 * Store document metadata in DynamoDB
 */
async function storeDocumentMetadata(documentId: string, content: ExtractedContent): Promise<void> {
  const now = new Date().toISOString()
  const dateStr = now.split('T')[0]

  const item = {
    meeting_id: documentId,  // Using meeting_id as partition key for compatibility
    title: content.title,
    date: dateStr,
    timestamp: content.publishedTime || now,
    duration: 0,  // Not applicable for web content
    s3_key: `web/${documentId}`,
    event_type: 'web_import',
    received_at: now,
    url: content.url,
    indexed_at: now,
    source_type: 'web',
    excerpt: content.excerpt?.slice(0, 500),
    byline: content.byline,
    site_name: content.siteName,
  }

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
  })

  await dynamodb.send(command)
}

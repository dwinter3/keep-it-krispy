import { NextRequest, NextResponse } from 'next/server'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import {
  getFileMetadata,
  exportGoogleDoc,
  downloadFile,
  refreshAccessToken,
  isGoogleWorkspaceDoc,
  isSupportedFormat,
} from '@/lib/google'

const GOOGLE_TOKEN_COOKIE = 'google-tokens'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const VECTOR_INDEX = process.env.VECTOR_INDEX || 'transcript-chunks'
const ENABLE_VECTORS = process.env.ENABLE_VECTORS !== 'false'

// AWS clients
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const s3 = new S3Client({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION, credentials })
const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })

/**
 * Helper to get valid access token
 */
async function getAccessToken(request: NextRequest): Promise<{ token: string; response?: NextResponse } | null> {
  const tokenCookie = request.cookies.get(GOOGLE_TOKEN_COOKIE)

  if (!tokenCookie) {
    return null
  }

  try {
    const tokens = JSON.parse(tokenCookie.value)
    const isExpired = tokens.expires_at < Date.now() + 5 * 60 * 1000

    if (isExpired && tokens.refresh_token) {
      const newTokens = await refreshAccessToken(tokens.refresh_token)
      const expiresAt = Date.now() + (newTokens.expires_in * 1000)

      const tokenData = {
        access_token: newTokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      }

      const response = new NextResponse()
      response.cookies.set(GOOGLE_TOKEN_COOKIE, JSON.stringify(tokenData), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      })

      return { token: newTokens.access_token, response }
    }

    return { token: tokens.access_token }
  } catch {
    return null
  }
}

/**
 * Generate embedding using Bedrock Titan
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const maxChars = 8192 * 4 // Rough estimate: 4 chars per token
  const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text

  const command = new InvokeModelCommand({
    modelId: 'amazon.titan-embed-text-v1',
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({ inputText: truncatedText }),
  })

  const response = await bedrockClient.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  return responseBody.embedding
}

/**
 * Chunk text for embedding
 */
function chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
  const words = text.split(/\s+/)

  if (words.length <= chunkSize) {
    return text.trim() ? [text.trim()] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = start + chunkSize
    const chunk = words.slice(start, end).join(' ')
    chunks.push(chunk)
    start = end - overlap
    if (start >= words.length) break
  }

  return chunks
}

/**
 * Store vectors in S3 Vectors
 */
async function storeVectors(documentId: string, s3Key: string, text: string): Promise<number> {
  const chunks = chunkText(text)

  if (chunks.length === 0) {
    return 0
  }

  const vectors: Array<{
    key: string
    data: { float32: number[] }
    metadata: Record<string, string>
  }> = []

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateEmbedding(chunks[i])

    vectors.push({
      key: `doc_${documentId}_chunk_${i.toString().padStart(4, '0')}`,
      data: { float32: embedding },
      metadata: {
        document_id: documentId,
        s3_key: s3Key,
        chunk_index: String(i),
        text: chunks[i].slice(0, 500),
        source: 'google_drive',
      },
    })

    // Store in batches of 10 to avoid rate limits
    if (vectors.length >= 10 || i === chunks.length - 1) {
      const command = new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: VECTOR_INDEX,
        vectors,
      })

      await vectorsClient.send(command)
      vectors.length = 0
    }
  }

  return chunks.length
}

/**
 * Extract text from PDF (basic implementation)
 * Note: For production, use a proper PDF parsing library
 */
function extractTextFromPdf(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes)

  // Try to extract text between stream objects (basic approach)
  const textMatches: string[] = []
  const streamRegex = /stream\s*([\s\S]*?)\s*endstream/g
  let match

  while ((match = streamRegex.exec(text)) !== null) {
    // Clean up common PDF encoding artifacts
    const content = match[1]
      .replace(/\\[0-9]{3}/g, ' ')
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (content.length > 20) {
      textMatches.push(content)
    }
  }

  // If streams approach did not work, try finding text objects
  if (textMatches.length === 0) {
    const textObjRegex = /\(([^)]+)\)/g
    while ((match = textObjRegex.exec(text)) !== null) {
      const content = match[1].replace(/\s+/g, ' ').trim()
      if (content.length > 5) {
        textMatches.push(content)
      }
    }
  }

  return textMatches.join('\n\n') || '[Unable to extract text from PDF]'
}

/**
 * POST /api/drive/import
 * Import a file from Google Drive into the knowledge base
 *
 * Body:
 * - fileId: Google Drive file ID
 */
export async function POST(request: NextRequest) {
  const tokenResult = await getAccessToken(request)

  if (!tokenResult) {
    return NextResponse.json(
      { error: 'Not authenticated with Google' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { fileId } = body

    if (!fileId) {
      return NextResponse.json(
        { error: 'Missing fileId' },
        { status: 400 }
      )
    }

    // Get file metadata
    const file = await getFileMetadata(tokenResult.token, fileId)

    if (!isSupportedFormat(file.mimeType)) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.mimeType}` },
        { status: 400 }
      )
    }

    // Extract text content based on file type
    let textContent: string

    if (isGoogleWorkspaceDoc(file.mimeType)) {
      // Export Google Docs/Sheets/Slides as text
      textContent = await exportGoogleDoc(tokenResult.token, fileId, file.mimeType)
    } else if (file.mimeType === 'application/pdf') {
      // Download and extract text from PDF
      const buffer = await downloadFile(tokenResult.token, fileId)
      textContent = extractTextFromPdf(buffer)
    } else if (file.mimeType.startsWith('text/')) {
      // Download text files directly
      const buffer = await downloadFile(tokenResult.token, fileId)
      textContent = new TextDecoder().decode(buffer)
    } else {
      // For other formats, try to download as text (might fail)
      try {
        const buffer = await downloadFile(tokenResult.token, fileId)
        textContent = new TextDecoder().decode(buffer)
      } catch {
        return NextResponse.json(
          { error: `Cannot extract text from: ${file.mimeType}` },
          { status: 400 }
        )
      }
    }

    // Generate document ID
    const documentId = `gdrive_${fileId}`
    const now = new Date()
    const datePath = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`
    const s3Key = `documents/${datePath}/${documentId}.json`

    // Prepare document data for S3
    const documentData = {
      id: documentId,
      source: 'google_drive',
      source_id: fileId,
      name: file.name,
      mime_type: file.mimeType,
      modified_time: file.modifiedTime,
      web_view_link: file.webViewLink,
      text_content: textContent,
      imported_at: now.toISOString(),
    }

    // Store in S3
    await s3.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: s3Key,
      Body: JSON.stringify(documentData),
      ContentType: 'application/json',
    }))

    // Index in DynamoDB
    const dbItem = {
      meeting_id: documentId, // Using meeting_id as PK for compatibility
      title: file.name,
      date: now.toISOString().split('T')[0],
      timestamp: now.toISOString(),
      duration: 0,
      s3_key: s3Key,
      event_type: 'document_import',
      source: 'google_drive',
      source_id: fileId,
      mime_type: file.mimeType,
      indexed_at: now.toISOString(),
    }

    await dynamodb.send(new PutCommand({
      TableName: TABLE_NAME,
      Item: dbItem,
    }))

    // Generate embeddings and store vectors
    let vectorsStored = 0
    if (ENABLE_VECTORS && textContent.trim().length > 0) {
      try {
        vectorsStored = await storeVectors(documentId, s3Key, textContent)
      } catch (vectorError) {
        console.error('Vector storage error (non-fatal):', vectorError)
      }
    }

    const result = {
      success: true,
      document: {
        id: documentId,
        name: file.name,
        s3Key,
        textLength: textContent.length,
        vectorsStored,
      },
    }

    const response = NextResponse.json(result)

    if (tokenResult.response) {
      for (const cookie of tokenResult.response.cookies.getAll()) {
        response.cookies.set(cookie)
      }
    }

    return response
  } catch (error) {
    console.error('Import error:', error)
    return NextResponse.json(
      { error: 'Failed to import file', details: String(error) },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { S3VectorsClient, PutVectorsCommand } from '@aws-sdk/client-s3vectors'
import { PDFParse } from 'pdf-parse'
import mammoth from 'mammoth'

// Configuration
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

// AWS credentials
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

// AWS clients
const s3 = new S3Client({ region: AWS_REGION, credentials })
const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

// Supported file types
const SUPPORTED_TYPES = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'application/octet-stream': 'unknown', // Will check extension
} as const

interface DocumentMetadata {
  document_id: string
  title: string
  type: 'document'
  file_type: string
  file_name: string
  file_size: number
  date: string
  timestamp: string
  s3_key: string
  text_length: number
  chunk_count: number
  indexed_at: string
}

/**
 * Extract text from PDF file
 */
async function extractPdfText(buffer: Buffer): Promise<string> {
  try {
    const parser = new PDFParse({ data: buffer })
    const result = await parser.getText()
    await parser.destroy()
    return result.text
  } catch (error) {
    console.error('PDF parsing error:', error)
    throw new Error(`Failed to parse PDF: ${error}`)
  }
}

/**
 * Extract text from DOCX file
 */
async function extractDocxText(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  } catch (error) {
    console.error('DOCX parsing error:', error)
    throw new Error(`Failed to parse DOCX: ${error}`)
  }
}

/**
 * Extract text from plain text or markdown file
 */
function extractPlainText(buffer: Buffer): string {
  return buffer.toString('utf-8')
}

/**
 * Extract text based on file type
 */
async function extractText(buffer: Buffer, fileType: string): Promise<string> {
  switch (fileType) {
    case 'pdf':
      return extractPdfText(buffer)
    case 'docx':
      return extractDocxText(buffer)
    case 'txt':
    case 'md':
      return extractPlainText(buffer)
    default:
      throw new Error(`Unsupported file type: ${fileType}`)
  }
}

/**
 * Chunk text into overlapping segments for embedding
 */
function chunkText(text: string, chunkSize: number = 500, overlap: number = 50): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)

  if (words.length <= chunkSize) {
    return text.trim() ? [text.trim()] : []
  }

  const chunks: string[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + chunkSize, words.length)
    const chunkWords = words.slice(start, end)
    const chunk = chunkWords.join(' ')
    chunks.push(chunk)

    // Move start forward, accounting for overlap
    start = end - overlap
    if (start >= words.length) break
  }

  return chunks
}

/**
 * Generate embedding using Bedrock Titan
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.slice(0, 8192 * 4), // Truncate if too long
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    }),
  })

  const response = await bedrock.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  return responseBody.embedding
}

/**
 * Store vectors in S3 Vectors
 */
async function storeVectors(vectors: Array<{ key: string; data: number[]; metadata: Record<string, string> }>) {
  if (vectors.length === 0) return

  try {
    const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })

    // Store in batches of 100
    const batchSize = 100
    for (let i = 0; i < vectors.length; i += batchSize) {
      const batch = vectors.slice(i, i + batchSize)

      const command = new PutVectorsCommand({
        vectorBucketName: VECTOR_BUCKET,
        indexName: INDEX_NAME,
        vectors: batch.map(v => ({
          key: v.key,
          data: { float32: v.data },
          metadata: v.metadata,
        })),
      })

      await vectorsClient.send(command)
      console.log(`Stored batch ${Math.floor(i / batchSize) + 1}, ${batch.length} vectors`)
    }
  } catch (error) {
    console.error('Vector storage error:', error)
    throw error
  }
}

/**
 * Store document metadata in DynamoDB
 */
async function storeMetadata(metadata: DocumentMetadata) {
  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: {
      meeting_id: metadata.document_id, // Using meeting_id as primary key for compatibility
      document_id: metadata.document_id,
      title: metadata.title,
      type: metadata.type,
      file_type: metadata.file_type,
      file_name: metadata.file_name,
      file_size: metadata.file_size,
      date: metadata.date,
      timestamp: metadata.timestamp,
      s3_key: metadata.s3_key,
      text_length: metadata.text_length,
      chunk_count: metadata.chunk_count,
      indexed_at: metadata.indexed_at,
    },
  })

  await dynamodb.send(command)
}

/**
 * Upload original file to S3
 */
async function uploadToS3(buffer: Buffer, key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  })

  await s3.send(command)
}

/**
 * Get file type from file name or MIME type
 */
function getFileType(fileName: string, mimeType: string): string {
  // First try to get from MIME type
  const typeFromMime = SUPPORTED_TYPES[mimeType as keyof typeof SUPPORTED_TYPES]
  if (typeFromMime && typeFromMime !== 'unknown') {
    return typeFromMime
  }

  // Fall back to extension
  const extension = fileName.split('.').pop()?.toLowerCase()
  if (extension && ['pdf', 'docx', 'txt', 'md'].includes(extension)) {
    return extension
  }

  throw new Error(`Unsupported file type: ${mimeType} (${fileName})`)
}

/**
 * Generate a unique document ID
 */
function generateDocumentId(): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `doc_${timestamp}_${random}`
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    const fileType = getFileType(file.name, file.type)
    console.log(`Processing ${fileType} file: ${file.name} (${file.size} bytes)`)

    // Read file content
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Extract text
    console.log('Extracting text...')
    const text = await extractText(buffer, fileType)
    console.log(`Extracted ${text.length} characters`)

    if (!text.trim()) {
      return NextResponse.json({ error: 'No text content found in document' }, { status: 400 })
    }

    // Generate document ID and metadata
    const documentId = generateDocumentId()
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0]
    const s3Key = `documents/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}/${documentId}_${file.name}`

    // Chunk text for embeddings
    console.log('Chunking text...')
    const chunks = chunkText(text, 500, 50)
    console.log(`Created ${chunks.length} chunks`)

    // Generate embeddings and prepare vectors
    console.log('Generating embeddings...')
    const vectors: Array<{ key: string; data: number[]; metadata: Record<string, string> }> = []

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = await generateEmbedding(chunk)

      vectors.push({
        key: `${documentId}_chunk_${String(i).padStart(4, '0')}`,
        data: embedding,
        metadata: {
          meeting_id: documentId, // For compatibility with existing search
          document_id: documentId,
          s3_key: s3Key,
          chunk_index: String(i),
          speaker: 'document', // Mark as document content
          text: chunk.slice(0, 500), // Truncate for metadata storage
          type: 'document',
          file_name: file.name,
        },
      })

      // Log progress for large documents
      if ((i + 1) % 10 === 0) {
        console.log(`Generated ${i + 1}/${chunks.length} embeddings`)
      }
    }

    // Store vectors
    console.log('Storing vectors...')
    await storeVectors(vectors)

    // Upload original file to S3
    console.log('Uploading to S3...')
    await uploadToS3(buffer, s3Key, file.type || 'application/octet-stream')

    // Store metadata in DynamoDB
    console.log('Storing metadata...')
    const metadata: DocumentMetadata = {
      document_id: documentId,
      title: file.name.replace(/\.[^/.]+$/, ''), // Remove extension
      type: 'document',
      file_type: fileType,
      file_name: file.name,
      file_size: file.size,
      date: dateStr,
      timestamp: now.toISOString(),
      s3_key: s3Key,
      text_length: text.length,
      chunk_count: chunks.length,
      indexed_at: now.toISOString(),
    }
    await storeMetadata(metadata)

    console.log(`Document processed successfully: ${documentId}`)

    return NextResponse.json({
      success: true,
      documentId,
      fileName: file.name,
      fileType,
      textLength: text.length,
      chunkCount: chunks.length,
      s3Key,
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json(
      { error: 'Upload failed', details: String(error) },
      { status: 500 }
    )
  }
}

export async function GET(request: NextRequest) {
  // List uploaded documents
  try {
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: '#type = :type',
      ExpressionAttributeNames: { '#type': 'type' },
      ExpressionAttributeValues: { ':type': 'document' },
      Limit: 100,
    })

    const response = await dynamodb.send(scanCommand)
    const items = response.Items || []

    // Sort by timestamp descending
    items.sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date)
      const dateB = new Date(b.timestamp || b.date)
      return dateB.getTime() - dateA.getTime()
    })

    const documents = items.map(item => ({
      documentId: item.document_id,
      title: item.title,
      fileName: item.file_name,
      fileType: item.file_type,
      fileSize: item.file_size,
      date: item.date,
      timestamp: item.timestamp,
      textLength: item.text_length,
      chunkCount: item.chunk_count,
      s3Key: item.s3_key,
    }))

    return NextResponse.json({ documents })

  } catch (error) {
    console.error('List documents error:', error)
    return NextResponse.json(
      { error: 'Failed to list documents', details: String(error) },
      { status: 500 }
    )
  }
}

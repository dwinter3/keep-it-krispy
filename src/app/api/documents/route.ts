import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
  GetCommand,
  DeleteCommand,
  UpdateCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb'
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { S3VectorsClient, PutVectorsCommand, DeleteVectorsCommand } from '@aws-sdk/client-s3vectors'
import { v4 as uuidv4 } from 'uuid'
import { createHash } from 'crypto'
import { parseDocument, detectFormat, chunkText, type DocumentFormat } from '@/lib/documentParser'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
const DOCUMENT_PROCESSOR_LAMBDA = 'krisp-document-processor'

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
const lambdaClient = new LambdaClient({ region: AWS_REGION, credentials })

export interface Document {
  document_id: string
  pk: string
  user_id: string
  title: string
  filename?: string
  file_type?: string
  file_hash?: string
  file_size?: number
  source: 'upload' | 'url' | 'drive'
  sourceUrl?: string
  format: DocumentFormat
  s3_key: string
  importedAt: string
  wordCount: number
  isPrivate: boolean
  linked_transcripts?: string[]
}

/**
 * GET /api/documents - List all documents or fetch a specific one
 */
export async function GET(request: NextRequest) {
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

      // Check ownership
      if (response.Item.user_id && response.Item.user_id !== userId) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 })
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
            processing: response.Item.processing || false,
          })
        } catch {
          // Content might not exist, return metadata only
          return NextResponse.json({
            ...response.Item,
            processing: response.Item.processing || false,
          })
        }
      }

      return NextResponse.json({
        ...response.Item,
        processing: response.Item.processing || false,
      })
    }

    // List documents for this user using GSI
    // First try user-index, then fall back to scanning with filter
    let documents: Record<string, unknown>[] = []

    try {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        FilterExpression: 'pk = :pk',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':pk': 'DOCUMENT',
        },
        ScanIndexForward: false,
      })
      const response = await dynamodb.send(queryCommand)
      documents = response.Items || []
    } catch {
      // Fall back to scan if user-index doesn't work for documents
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'pk = :pk AND (attribute_not_exists(user_id) OR user_id = :userId)',
        ExpressionAttributeValues: {
          ':pk': 'DOCUMENT',
          ':userId': userId,
        },
      })
      const response = await dynamodb.send(scanCommand)
      documents = response.Items || []
    }

    const formattedDocuments = documents.map(item => {
      const linkedTranscripts = (item.linked_transcripts as string[] | undefined) || []
      return {
        documentId: item.document_id,
        title: item.title,
        filename: item.filename,
        fileType: item.file_type || item.format,
        fileSize: item.file_size,
        source: item.source,
        sourceUrl: item.source_url,
        format: item.format,
        importedAt: item.timestamp || item.importedAt,
        wordCount: item.word_count ?? item.wordCount ?? 0,
        isPrivate: item.is_private || item.isPrivate || false,
        linkedTranscripts,
        linkedTranscriptCount: linkedTranscripts.length,
        processing: item.processing || false,
      }
    })

    return NextResponse.json({
      count: formattedDocuments.length,
      documents: formattedDocuments,
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
 * Helper: Calculate file hash for deduplication
 */
function calculateFileHash(content: string | Buffer): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Helper: Check if a document with the same hash already exists for this user
 * Uses file_hash for deduplication - same content = same document
 */
async function findDocumentByHash(userId: string, fileHash: string): Promise<Record<string, unknown> | null> {
  try {
    // Use QueryCommand with user-index GSI and filter by hash
    // This is more efficient than a full table scan
    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'pk = :pk AND file_hash = :fileHash',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':pk': 'DOCUMENT',
        ':fileHash': fileHash,
      },
      Limit: 1,
    })
    const response = await dynamodb.send(queryCommand)
    if (response.Items && response.Items.length > 0) {
      return response.Items[0]
    }
    return null
  } catch (err) {
    // Fall back to scan if GSI query fails
    console.log('Falling back to scan for deduplication check:', err)
    try {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'pk = :pk AND user_id = :userId AND file_hash = :fileHash',
        ExpressionAttributeValues: {
          ':pk': 'DOCUMENT',
          ':userId': userId,
          ':fileHash': fileHash,
        },
        Limit: 1,
      })
      const response = await dynamodb.send(scanCommand)
      return response.Items?.[0] || null
    } catch {
      return null
    }
  }
}

/**
 * POST /api/documents - Upload a new document
 */
export async function POST(request: NextRequest) {
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
    const contentType = request.headers.get('content-type') || ''

    let title: string
    let content: string
    let format: DocumentFormat
    let source: 'upload' | 'url' | 'drive' = 'upload'
    let sourceUrl: string | undefined
    let wordCount: number
    let isPrivate = false
    let filename: string | undefined
    let fileSize: number | undefined
    let fileHash: string | undefined
    let fileBuffer: Buffer | undefined

    // Handle file upload (multipart/form-data)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData()
      const file = formData.get('file') as File | null

      if (!file) {
        return NextResponse.json({ error: 'No file provided' }, { status: 400 })
      }

      // Check file size
      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB` },
          { status: 400 }
        )
      }

      const detectedFormat = detectFormat(file.name)
      if (!detectedFormat) {
        return NextResponse.json(
          { error: 'Unsupported file format. Supported: PDF, DOCX, MD, TXT' },
          { status: 400 }
        )
      }

      format = detectedFormat
      filename = file.name
      fileSize = file.size
      fileBuffer = Buffer.from(await file.arrayBuffer())

      // Calculate hash for deduplication
      fileHash = calculateFileHash(fileBuffer)

      // Check for duplicate
      const existingDoc = await findDocumentByHash(userId, fileHash)
      if (existingDoc) {
        return NextResponse.json({
          success: true,
          documentId: existingDoc.document_id,
          title: existingDoc.title,
          duplicate: true,
          message: 'Document already exists',
        })
      }

      // For large PDFs (>1MB), skip parsing to avoid timeout
      // Store the raw file and use placeholder content
      const LARGE_PDF_THRESHOLD = 1 * 1024 * 1024 // 1MB

      if (format === 'pdf' && file.size > LARGE_PDF_THRESHOLD) {
        // Skip parsing for large PDFs - will be processed asynchronously by Lambda
        title = (formData.get('title') as string) || file.name.replace(/\.[^/.]+$/, '')
        content = `[PDF document: ${file.name}]\n\nThis PDF is being processed. Content will be available shortly.`
        wordCount = 0
        isPrivate = formData.get('isPrivate') === 'true'

        // Generate document ID early for large PDFs
        const documentId = uuidv4()
        const now = new Date()
        const safeFilename = (filename || title).replace(/[^a-zA-Z0-9-_.\s]/g, '').slice(0, 50)
        const s3Key = `users/${userId}/documents/${documentId}/${safeFilename}.txt`
        const rawFileKey = `users/${userId}/documents/${documentId}/${filename || safeFilename + '.pdf'}`

        // Store placeholder content in S3
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: s3Key,
            Body: content,
            ContentType: 'text/plain; charset=utf-8',
          })
        )

        // Store raw PDF file
        await s3.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: rawFileKey,
            Body: fileBuffer,
            ContentType: 'application/pdf',
          })
        )

        // Store metadata in DynamoDB with processing flag
        const item: Record<string, unknown> = {
          pk: 'DOCUMENT',
          meeting_id: `doc_${documentId}`,
          document_id: documentId,
          user_id: userId,
          title,
          filename,
          file_type: format,
          file_size: fileSize,
          file_hash: fileHash,
          source,
          source_url: sourceUrl,
          format,
          s3_key: s3Key,
          raw_file_key: rawFileKey,
          timestamp: now.toISOString(),
          importedAt: now.toISOString(),
          word_count: wordCount,
          is_private: isPrivate,
          linked_transcripts: [],
          processing: true, // Flag to indicate async processing in progress
        }

        await dynamodb.send(
          new PutCommand({
            TableName: TABLE_NAME,
            Item: item,
          })
        )

        // Invoke Lambda asynchronously to process the PDF
        try {
          await lambdaClient.send(new InvokeCommand({
            FunctionName: DOCUMENT_PROCESSOR_LAMBDA,
            InvocationType: 'Event', // Async invocation
            Payload: JSON.stringify({
              document_id: documentId,
              user_id: userId,
              s3_key: s3Key,
              raw_file_key: rawFileKey,
              format: 'pdf',
            }),
          }))
          console.log(`Invoked document processor Lambda for large PDF: ${documentId}`)
        } catch (lambdaError) {
          console.error('Failed to invoke document processor Lambda:', lambdaError)
          // Don't fail the upload - document is saved, just won't be processed
        }

        // Return early for large PDFs - embeddings will be generated by Lambda
        return NextResponse.json({
          success: true,
          documentId,
          title,
          filename,
          fileSize,
          wordCount: 0,
          chunks: 0,
          processing: true, // Indicate async processing in progress
        })
      } else {
        // Parse smaller documents normally
        const parsed = await parseDocument(fileBuffer, format)
        title = (formData.get('title') as string) || parsed.title || file.name.replace(/\.[^/.]+$/, '')
        content = parsed.content
        wordCount = parsed.wordCount
        isPrivate = formData.get('isPrivate') === 'true'
      }
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
      filename = body.filename

      if (!title || !content) {
        return NextResponse.json({ error: 'Title and content are required' }, { status: 400 })
      }

      // Calculate hash for deduplication
      fileHash = calculateFileHash(content)

      // Check for duplicate
      const existingDoc = await findDocumentByHash(userId, fileHash)
      if (existingDoc) {
        return NextResponse.json({
          success: true,
          documentId: existingDoc.document_id,
          title: existingDoc.title,
          duplicate: true,
          message: 'Document already exists',
        })
      }
    }

    // Generate document ID
    const documentId = uuidv4()
    const now = new Date()
    const safeFilename = (filename || title).replace(/[^a-zA-Z0-9-_.\s]/g, '').slice(0, 50)
    // Store in user-specific path for isolation
    const s3Key = `users/${userId}/documents/${documentId}/${safeFilename}.txt`

    // Store content in S3
    await s3.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: s3Key,
        Body: content,
        ContentType: 'text/plain; charset=utf-8',
      })
    )

    // For PDFs, also store the raw file for download/viewing
    let rawFileKey: string | undefined
    if (format === 'pdf' && fileBuffer) {
      rawFileKey = `users/${userId}/documents/${documentId}/${filename || safeFilename + '.pdf'}`
      await s3.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: rawFileKey,
          Body: fileBuffer,
          ContentType: 'application/pdf',
        })
      )
    }

    // Store metadata in DynamoDB
    const item: Record<string, unknown> = {
      pk: 'DOCUMENT',
      meeting_id: `doc_${documentId}`,
      document_id: documentId,
      user_id: userId,
      title,
      filename,
      file_type: format,
      file_size: fileSize,
      file_hash: fileHash,
      source,
      source_url: sourceUrl,
      format,
      s3_key: s3Key,
      timestamp: now.toISOString(),
      importedAt: now.toISOString(),
      word_count: wordCount,
      is_private: isPrivate,
      linked_transcripts: [],
    }

    // Add raw file key for PDFs
    if (rawFileKey) {
      item.raw_file_key = rawFileKey
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
      filename,
      fileSize,
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

  const { searchParams } = new URL(request.url)
  const documentId = searchParams.get('id')

  if (!documentId) {
    return NextResponse.json({ error: 'Document ID required' }, { status: 400 })
  }

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
 * PATCH /api/documents - Link/unlink document to/from transcripts
 */
export async function PATCH(request: NextRequest) {
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
    const { documentId, action, meetingId } = body

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

    // Get the document and verify ownership
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const docResponse = await dynamodb.send(getCommand)

    if (!docResponse.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    // Check ownership
    if (docResponse.Item.user_id && docResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Handle link action
    if (action === 'link' && meetingId) {
      // Verify the transcript belongs to the user
      const transcriptCheck = new GetCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: meetingId },
        ProjectionExpression: 'user_id',
      })
      const transcriptResponse = await dynamodb.send(transcriptCheck)
      if (transcriptResponse.Item?.user_id && transcriptResponse.Item.user_id !== userId) {
        return NextResponse.json({ error: 'Access denied to transcript' }, { status: 403 })
      }

      // Add meetingId to linked_transcripts array
      const updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: `doc_${documentId}` },
        UpdateExpression: 'SET linked_transcripts = list_append(if_not_exists(linked_transcripts, :empty), :meetingId)',
        ConditionExpression: 'NOT contains(if_not_exists(linked_transcripts, :empty), :meetingIdValue)',
        ExpressionAttributeValues: {
          ':empty': [],
          ':meetingId': [meetingId],
          ':meetingIdValue': meetingId,
        },
        ReturnValues: 'ALL_NEW',
      })

      try {
        const result = await dynamodb.send(updateCommand)
        return NextResponse.json({
          success: true,
          documentId,
          linkedTranscripts: result.Attributes?.linked_transcripts || [],
        })
      } catch (err: unknown) {
        // If the condition failed, it means the transcript is already linked
        if (err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException') {
          return NextResponse.json({
            success: true,
            documentId,
            linkedTranscripts: docResponse.Item.linked_transcripts || [],
            message: 'Transcript already linked',
          })
        }
        throw err
      }
    }

    // Handle unlink action
    if (action === 'unlink' && meetingId) {
      const currentLinks: string[] = docResponse.Item.linked_transcripts || []
      const newLinks = currentLinks.filter(id => id !== meetingId)

      const updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: `doc_${documentId}` },
        UpdateExpression: 'SET linked_transcripts = :newLinks',
        ExpressionAttributeValues: {
          ':newLinks': newLinks,
        },
        ReturnValues: 'ALL_NEW',
      })

      const result = await dynamodb.send(updateCommand)
      return NextResponse.json({
        success: true,
        documentId,
        linkedTranscripts: result.Attributes?.linked_transcripts || [],
      })
    }

    // Handle reprocess action
    if (action === 'reprocess') {
      // Check if document has a raw file to reprocess
      const rawFileKey = docResponse.Item.raw_file_key
      const format = docResponse.Item.format

      if (!rawFileKey) {
        return NextResponse.json(
          { error: 'Document has no raw file to reprocess' },
          { status: 400 }
        )
      }

      if (format !== 'pdf') {
        return NextResponse.json(
          { error: 'Only PDF documents can be reprocessed' },
          { status: 400 }
        )
      }

      // Set processing flag
      await dynamodb.send(
        new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { meeting_id: `doc_${documentId}` },
          UpdateExpression: 'SET processing = :p, processing_error = :pe',
          ExpressionAttributeValues: {
            ':p': true,
            ':pe': null,
          },
        })
      )

      // Invoke Lambda asynchronously to reprocess the document
      try {
        await lambdaClient.send(new InvokeCommand({
          FunctionName: DOCUMENT_PROCESSOR_LAMBDA,
          InvocationType: 'Event', // Async invocation
          Payload: JSON.stringify({
            document_id: documentId,
            user_id: userId,
            s3_key: docResponse.Item.s3_key,
            raw_file_key: rawFileKey,
            format: 'pdf',
          }),
        }))
        console.log(`Invoked document processor Lambda for reprocessing: ${documentId}`)

        return NextResponse.json({
          success: true,
          documentId,
          processing: true,
          message: 'Document reprocessing started',
        })
      } catch (lambdaError) {
        console.error('Failed to invoke document processor Lambda:', lambdaError)

        // Reset processing flag on error
        await dynamodb.send(
          new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: `doc_${documentId}` },
            UpdateExpression: 'SET processing = :p, processing_error = :pe',
            ExpressionAttributeValues: {
              ':p': false,
              ':pe': 'Failed to start reprocessing',
            },
          })
        )

        return NextResponse.json(
          { error: 'Failed to start reprocessing', details: String(lambdaError) },
          { status: 500 }
        )
      }
    }

    return NextResponse.json({ error: 'Invalid action. Use "link", "unlink", or "reprocess"' }, { status: 400 })
  } catch (error) {
    console.error('Document PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update document', details: String(error) },
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

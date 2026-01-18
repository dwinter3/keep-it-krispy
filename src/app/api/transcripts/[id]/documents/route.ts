import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * GET /api/transcripts/[id]/documents - Get documents linked to a transcript
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

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
    // First verify the transcript belongs to the user
    const transcriptCheck = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      ProjectionExpression: 'user_id',
    })
    const transcriptResponse = await dynamodb.send(transcriptCheck)
    if (transcriptResponse.Item?.user_id && transcriptResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Find all documents that have this meetingId in their linked_transcripts array
    const scanCommand = new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'pk = :pk AND user_id = :userId AND contains(linked_transcripts, :meetingId)',
      ExpressionAttributeValues: {
        ':pk': 'DOCUMENT',
        ':userId': userId,
        ':meetingId': meetingId,
      },
    })

    const response = await dynamodb.send(scanCommand)
    const documents = (response.Items || []).map(item => ({
      documentId: item.document_id,
      title: item.title,
      filename: item.filename,
      fileType: item.file_type || item.format,
      fileSize: item.file_size,
      format: item.format,
      importedAt: item.timestamp || item.importedAt,
      wordCount: item.word_count || item.wordCount,
    }))

    return NextResponse.json({ documents })
  } catch (error) {
    console.error('Error fetching linked documents:', error)
    return NextResponse.json(
      { error: 'Failed to fetch linked documents', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/transcripts/[id]/documents - Link a document to this transcript
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

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
    const { documentId } = body

    if (!documentId) {
      return NextResponse.json({ error: 'documentId is required' }, { status: 400 })
    }

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

    // Verify the document belongs to the user
    const docCheck = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const docResponse = await dynamodb.send(docCheck)
    if (!docResponse.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (docResponse.Item.user_id && docResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied to document' }, { status: 403 })
    }

    // Add meetingId to the document's linked_transcripts array
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
      if (err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({
          success: true,
          message: 'Document already linked to this transcript',
        })
      }
      throw err
    }
  } catch (error) {
    console.error('Error linking document:', error)
    return NextResponse.json(
      { error: 'Failed to link document', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/transcripts/[id]/documents - Unlink a document from this transcript
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: meetingId } = await params

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
  const documentId = searchParams.get('documentId')

  if (!documentId) {
    return NextResponse.json({ error: 'documentId query parameter is required' }, { status: 400 })
  }

  try {
    // Verify the document belongs to the user
    const docCheck = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const docResponse = await dynamodb.send(docCheck)
    if (!docResponse.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }
    if (docResponse.Item.user_id && docResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Remove meetingId from the document's linked_transcripts array
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
  } catch (error) {
    console.error('Error unlinking document:', error)
    return NextResponse.json(
      { error: 'Failed to unlink document', details: String(error) },
      { status: 500 }
    )
  }
}

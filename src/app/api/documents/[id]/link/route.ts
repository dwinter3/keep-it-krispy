import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
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

interface RouteParams {
  params: Promise<{ id: string }>
}

/**
 * POST /api/documents/[id]/link - Link document to a transcript
 * Body: { transcriptId: string }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id: documentId } = await params

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
    const { transcriptId } = body

    if (!transcriptId) {
      return NextResponse.json({ error: 'transcriptId is required' }, { status: 400 })
    }

    // Verify the document exists and belongs to the user
    const docCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const docResponse = await dynamodb.send(docCommand)

    if (!docResponse.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (docResponse.Item.user_id && docResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied to document' }, { status: 403 })
    }

    // Verify the transcript exists and belongs to the user
    const transcriptCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: transcriptId },
      ProjectionExpression: 'user_id, title, topic',
    })
    const transcriptResponse = await dynamodb.send(transcriptCommand)

    if (!transcriptResponse.Item) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    if (transcriptResponse.Item.user_id && transcriptResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied to transcript' }, { status: 403 })
    }

    // Add transcriptId to the document's linked_transcripts array
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
      UpdateExpression: 'SET linked_transcripts = list_append(if_not_exists(linked_transcripts, :empty), :transcriptId)',
      ConditionExpression: 'NOT contains(if_not_exists(linked_transcripts, :empty), :transcriptIdValue)',
      ExpressionAttributeValues: {
        ':empty': [],
        ':transcriptId': [transcriptId],
        ':transcriptIdValue': transcriptId,
      },
      ReturnValues: 'ALL_NEW',
    })

    try {
      const result = await dynamodb.send(updateCommand)
      return NextResponse.json({
        success: true,
        documentId,
        transcriptId,
        linkedTranscripts: result.Attributes?.linked_transcripts || [],
        message: 'Transcript linked successfully',
      })
    } catch (err: unknown) {
      // If the condition failed, it means the transcript is already linked
      if (err && typeof err === 'object' && 'name' in err && err.name === 'ConditionalCheckFailedException') {
        return NextResponse.json({
          success: true,
          documentId,
          transcriptId,
          linkedTranscripts: docResponse.Item.linked_transcripts || [],
          message: 'Transcript already linked',
        })
      }
      throw err
    }
  } catch (error) {
    console.error('Document link error:', error)
    return NextResponse.json(
      { error: 'Failed to link transcript', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/documents/[id]/link?transcriptId=xxx - Unlink document from a transcript
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id: documentId } = await params

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
  const transcriptId = searchParams.get('transcriptId')

  if (!transcriptId) {
    return NextResponse.json({ error: 'transcriptId query parameter is required' }, { status: 400 })
  }

  try {
    // Get the document and verify ownership
    const docCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: `doc_${documentId}` },
    })
    const docResponse = await dynamodb.send(docCommand)

    if (!docResponse.Item) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 })
    }

    if (docResponse.Item.user_id && docResponse.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Remove transcriptId from the document's linked_transcripts array
    const currentLinks: string[] = docResponse.Item.linked_transcripts || []
    const newLinks = currentLinks.filter(id => id !== transcriptId)

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
      transcriptId,
      linkedTranscripts: result.Attributes?.linked_transcripts || [],
      message: 'Transcript unlinked successfully',
    })
  } catch (error) {
    console.error('Document unlink error:', error)
    return NextResponse.json(
      { error: 'Failed to unlink transcript', details: String(error) },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''  // Required: set via environment variable
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const s3 = new S3Client({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')
  const action = searchParams.get('action')

  // Get authenticated user
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user's ID for tenant isolation
  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  try {
    // If key provided, fetch specific transcript from S3 (with ownership check)
    if (key) {
      // First check ownership in DynamoDB
      const meetingId = key.split('/').pop()?.replace('.json', '')
      if (meetingId) {
        const getCommand = new GetCommand({
          TableName: TABLE_NAME,
          Key: { meeting_id: meetingId },
          ProjectionExpression: 'user_id',
        })
        const ownerCheck = await dynamodb.send(getCommand)
        if (ownerCheck.Item?.user_id && ownerCheck.Item.user_id !== userId) {
          return NextResponse.json({ error: 'Access denied' }, { status: 403 })
        }
      }

      const command = new GetObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
      })
      const response = await s3.send(command)
      const body = await response.Body?.transformToString()

      if (!body) {
        return NextResponse.json({ error: 'Empty response' }, { status: 404 })
      }

      return NextResponse.json(JSON.parse(body))
    }

    // Get stats for dashboard (scoped to user)
    if (action === 'stats') {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        Select: 'COUNT',
      })
      const countResult = await dynamodb.send(queryCommand)

      // Get unique speakers for this user
      const speakersCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'speakers',
      })
      const speakersResult = await dynamodb.send(speakersCommand)
      const allSpeakers = new Set<string>()
      for (const item of speakersResult.Items || []) {
        for (const speaker of item.speakers || []) {
          allSpeakers.add(speaker)
        }
      }

      return NextResponse.json({
        totalTranscripts: countResult.Count || 0,
        totalSpeakers: allSpeakers.size,
        thisWeek: countResult.Count || 0, // TODO: filter by date
      })
    }

    // List transcripts with pagination using user-index GSI
    const cursor = searchParams.get('cursor')
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100)
    const includePrivate = searchParams.get('includePrivate') === 'true'
    const onlyPrivate = searchParams.get('onlyPrivate') === 'true'

    // Build filter expression for privacy
    let filterExpression: string | undefined
    const expressionAttrValues: Record<string, unknown> = { ':userId': userId }

    if (onlyPrivate) {
      filterExpression = 'isPrivate = :isPrivate'
      expressionAttrValues[':isPrivate'] = true
    } else if (!includePrivate) {
      // By default, exclude private transcripts
      filterExpression = 'attribute_not_exists(isPrivate) OR isPrivate = :isPrivate'
      expressionAttrValues[':isPrivate'] = false
    }

    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: expressionAttrValues,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ScanIndexForward: false, // Newest first (descending by timestamp)
      Limit: limit,
      ...(cursor && { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }),
    })

    const response = await dynamodb.send(queryCommand)
    const items = response.Items || []

    // Format for frontend
    const transcripts = items.map(item => ({
      key: item.s3_key,
      meetingId: item.meeting_id,
      title: item.title || 'Untitled Meeting',
      date: item.date,
      timestamp: item.timestamp,
      duration: item.duration || 0,
      speakers: item.speakers || [],
      eventType: item.event_type,
      speakerCorrections: item.speaker_corrections || null,
      topic: item.topic || null,
      isPrivate: item.isPrivate || false,
      privacyLevel: item.privacy_level || null,
      privacyReason: item.privacy_reason || null,
      privacyTopics: item.privacy_topics || [],
      privacyConfidence: item.privacy_confidence || null,
      privacyWorkPercent: item.privacy_work_percent || null,
      privacyDismissed: item.privacy_dismissed || false,
    }))

    // Build next cursor if there are more results
    const nextCursor = response.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64')
      : null

    return NextResponse.json({ transcripts, nextCursor })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transcripts', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * PATCH - Update speaker corrections for a transcript
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
    const { meetingId, speakerCorrection } = body

    if (!meetingId || !speakerCorrection) {
      return NextResponse.json(
        { error: 'Missing required fields: meetingId and speakerCorrection' },
        { status: 400 }
      )
    }

    // Verify ownership before update
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      ProjectionExpression: 'user_id',
    })
    const ownerCheck = await dynamodb.send(getCommand)
    if (ownerCheck.Item?.user_id && ownerCheck.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const { originalName, correctedName } = speakerCorrection

    if (!originalName || !correctedName) {
      return NextResponse.json(
        { error: 'speakerCorrection must have originalName and correctedName' },
        { status: 400 }
      )
    }

    // Update the speaker_corrections map in DynamoDB
    // The key is the lowercase original name for consistent lookups
    const correctionKey = originalName.toLowerCase()

    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'SET speaker_corrections.#speakerKey = :correction',
      ExpressionAttributeNames: {
        '#speakerKey': correctionKey,
      },
      ExpressionAttributeValues: {
        ':correction': { name: correctedName },
      },
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      speakerCorrections: result.Attributes?.speaker_corrections || {},
    })
  } catch (error) {
    console.error('PATCH error:', error)

    // Handle case where speaker_corrections doesn't exist yet
    // Need to create the map first
    try {
      const body = await request.json().catch(() => ({}))
      const { meetingId, speakerCorrection } = body

      if (meetingId && speakerCorrection) {
        const correctionKey = speakerCorrection.originalName.toLowerCase()

        const createMapCommand = new UpdateCommand({
          TableName: TABLE_NAME,
          Key: { meeting_id: meetingId },
          UpdateExpression: 'SET speaker_corrections = :corrections',
          ExpressionAttributeValues: {
            ':corrections': {
              [correctionKey]: { name: speakerCorrection.correctedName },
            },
          },
          ReturnValues: 'ALL_NEW',
        })

        const result = await dynamodb.send(createMapCommand)

        return NextResponse.json({
          success: true,
          speakerCorrections: result.Attributes?.speaker_corrections || {},
        })
      }
    } catch (retryError) {
      console.error('Retry error:', retryError)
    }

    return NextResponse.json(
      { error: 'Failed to update speaker correction', details: String(error) },
      { status: 500 }
    )
  }
}

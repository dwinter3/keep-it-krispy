import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

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

  try {
    // If key provided, fetch specific transcript from S3
    if (key) {
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

    // Get stats for dashboard
    if (action === 'stats') {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        Select: 'COUNT',
      })
      const countResult = await dynamodb.send(scanCommand)

      // Get unique speakers
      const speakersCommand = new ScanCommand({
        TableName: TABLE_NAME,
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

    // List transcripts with pagination using all-transcripts-index GSI
    const cursor = searchParams.get('cursor')
    const limit = Math.min(parseInt(searchParams.get('limit') || '25'), 100)

    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'all-transcripts-index',
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'TRANSCRIPT' },
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

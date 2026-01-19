import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const ENTITIES_TABLE = 'krisp-entities'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

// Generic speaker labels to exclude
const EXCLUDED_SPEAKERS = new Set([
  'speaker 1',
  'speaker 2',
  'speaker 3',
  'speaker 4',
  'speaker 5',
  'unknown',
  'guest',
  'host',
])

export async function GET() {
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
    // Get all transcripts for this user to calculate stats
    const allItems: Array<{
      timestamp?: string
      date?: string
      speakers?: string[]
      speaker_corrections?: Record<string, { name: string }>
    }> = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: '#timestamp, #date, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#timestamp': 'timestamp',
          '#date': 'date',
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allItems.push(...response.Items as typeof allItems)
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Calculate total meetings
    const totalMeetings = allItems.length

    // Calculate meetings this week
    const now = new Date()
    const startOfWeek = new Date(now)
    startOfWeek.setDate(now.getDate() - now.getDay()) // Sunday
    startOfWeek.setHours(0, 0, 0, 0)

    const meetingsThisWeek = allItems.filter(item => {
      const meetingDate = new Date(item.timestamp || item.date || '')
      return meetingDate >= startOfWeek
    }).length

    // Calculate unique speakers
    const speakerSet = new Set<string>()
    for (const item of allItems) {
      const corrections = item.speaker_corrections || {}
      for (const speaker of item.speakers || []) {
        const speakerLower = speaker.toLowerCase()
        if (EXCLUDED_SPEAKERS.has(speakerLower)) continue
        const correction = corrections[speakerLower]
        const canonicalName = correction?.name || speaker
        speakerSet.add(canonicalName.toLowerCase())
      }
    }
    const totalSpeakers = speakerSet.size

    // Get company count from entities table
    let totalCompanies = 0
    try {
      // Try using user-type-index GSI first
      const queryCommand = new QueryCommand({
        TableName: ENTITIES_TABLE,
        IndexName: 'user-type-index',
        KeyConditionExpression: 'user_id = :userId AND entity_type = :type',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':type': 'company',
          ':active': 'active',
        },
        Select: 'COUNT',
      })
      const response = await dynamodb.send(queryCommand)
      totalCompanies = response.Count || 0
    } catch {
      // GSI might not exist, fallback to scan
      try {
        const scanCommand = new ScanCommand({
          TableName: ENTITIES_TABLE,
          FilterExpression: 'user_id = :userId AND entity_type = :type AND #status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':userId': userId,
            ':type': 'company',
            ':active': 'active',
          },
          Select: 'COUNT',
        })
        const response = await dynamodb.send(scanCommand)
        totalCompanies = response.Count || 0
      } catch {
        // Table might not exist yet
        totalCompanies = 0
      }
    }

    return NextResponse.json({
      totalMeetings,
      meetingsThisWeek,
      totalSpeakers,
      totalCompanies,
    })
  } catch (error) {
    console.error('Dashboard stats API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard stats', details: String(error) },
      { status: 500 }
    )
  }
}

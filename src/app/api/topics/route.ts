import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
const TRANSCRIPTS_TABLE = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface SpeakerItem {
  name: string
  displayName?: string
  topics?: string[]
  aiSummary?: string
  enrichedAt?: string
}

interface TranscriptItem {
  meeting_id: string
  topic?: string
  privacy_topics?: string[]
  timestamp?: number
}

interface TopicStats {
  topic: string
  speakerCount: number
  transcriptCount: number
  lastMentioned?: string
  speakers: Array<{
    name: string
    displayName: string
  }>
}

// GET /api/topics - Get all topics aggregated across speakers
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
    // Query speakers with topics for this user
    const allSpeakers: SpeakerItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: SPEAKERS_TABLE,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: '#name, displayName, topics, enrichedAt',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        FilterExpression: 'attribute_exists(topics)',
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allSpeakers.push(...(response.Items as SpeakerItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Query transcripts for topics from meetings
    const allTranscripts: TranscriptItem[] = []
    let lastTranscriptKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TRANSCRIPTS_TABLE,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'meeting_id, topic, privacy_topics, #timestamp',
        ExpressionAttributeNames: {
          '#timestamp': 'timestamp',
        },
        ...(lastTranscriptKey && { ExclusiveStartKey: lastTranscriptKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allTranscripts.push(...(response.Items as TranscriptItem[]))
      }
      lastTranscriptKey = response.LastEvaluatedKey
    } while (lastTranscriptKey)

    // Aggregate topics across all speakers
    const topicMap = new Map<string, TopicStats>()

    for (const speaker of allSpeakers) {
      const topics = speaker.topics || []
      const displayName = speaker.displayName || speaker.name

      for (const topic of topics) {
        const topicLower = topic.toLowerCase()
        const existing = topicMap.get(topicLower)

        if (existing) {
          existing.speakerCount += 1
          existing.speakers.push({
            name: speaker.name,
            displayName,
          })
        } else {
          topicMap.set(topicLower, {
            topic,
            speakerCount: 1,
            transcriptCount: 0,
            speakers: [{
              name: speaker.name,
              displayName,
            }],
          })
        }
      }
    }

    // Add transcript-based topics and counts
    for (const transcript of allTranscripts) {
      const topicsInTranscript = [
        transcript.topic,
        ...(transcript.privacy_topics || [])
      ].filter(Boolean) as string[]

      for (const topic of topicsInTranscript) {
        const topicLower = topic.toLowerCase()
        const existing = topicMap.get(topicLower)

        if (existing) {
          existing.transcriptCount += 1
          // Update lastMentioned if this transcript is more recent
          if (transcript.timestamp) {
            const date = new Date(transcript.timestamp).toISOString()
            if (!existing.lastMentioned || date > existing.lastMentioned) {
              existing.lastMentioned = date
            }
          }
        } else {
          // Topic only from transcript (not from enriched speakers)
          topicMap.set(topicLower, {
            topic,
            speakerCount: 0,
            transcriptCount: 1,
            lastMentioned: transcript.timestamp
              ? new Date(transcript.timestamp).toISOString()
              : undefined,
            speakers: [],
          })
        }
      }
    }

    // Convert to array and sort by total mentions (speakers + transcripts)
    const topics = Array.from(topicMap.values())
      .sort((a, b) => {
        const totalA = a.speakerCount + a.transcriptCount
        const totalB = b.speakerCount + b.transcriptCount
        if (totalB !== totalA) {
          return totalB - totalA
        }
        return a.topic.localeCompare(b.topic)
      })

    return NextResponse.json({
      count: topics.length,
      enrichedSpeakers: allSpeakers.length,
      totalTranscripts: allTranscripts.length,
      topics,
    })
  } catch (error) {
    console.error('Topics API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch topics', details: String(error) },
      { status: 500 }
    )
  }
}

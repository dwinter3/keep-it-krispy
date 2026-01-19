import { NextRequest, NextResponse } from 'next/server'
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
  s3_key: string
  title?: string
  date?: string
  timestamp?: number
  duration?: number
  speakers?: string[]
  topic?: string
  privacy_topics?: string[]
  speaker_corrections?: Record<string, { name: string }>
}

interface TopicDetailResponse {
  topic: string
  speakerCount: number
  transcriptCount: number
  speakers: Array<{
    name: string
    displayName: string
  }>
  transcripts: Array<{
    meetingId: string
    title: string
    date: string
    duration: number
    speakers: string[]
  }>
  relatedTopics: Array<{
    topic: string
    coOccurrenceCount: number
  }>
}

// GET /api/topics/[topic] - Get detailed information about a specific topic
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ topic: string }> }
) {
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

  const { topic: encodedTopic } = await params
  const topic = decodeURIComponent(encodedTopic).toLowerCase()

  try {
    // 1. Get all speakers with their topics for this user
    const allSpeakers: SpeakerItem[] = []
    let lastSpeakerKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: SPEAKERS_TABLE,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: '#name, displayName, topics',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        FilterExpression: 'attribute_exists(topics)',
        ...(lastSpeakerKey && { ExclusiveStartKey: lastSpeakerKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allSpeakers.push(...(response.Items as SpeakerItem[]))
      }
      lastSpeakerKey = response.LastEvaluatedKey
    } while (lastSpeakerKey)

    // Find speakers who discuss this topic (case-insensitive)
    const matchingSpeakers = allSpeakers.filter(speaker =>
      speaker.topics?.some(t => t.toLowerCase() === topic)
    )

    // 2. Get all transcripts for this user
    const allTranscripts: TranscriptItem[] = []
    let lastTranscriptKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TRANSCRIPTS_TABLE,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'meeting_id, s3_key, title, #date, #timestamp, duration, speakers, topic, privacy_topics, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
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

    // Find transcripts that contain this topic (in topic or privacy_topics)
    const matchingTranscripts = allTranscripts.filter(transcript => {
      const transcriptTopic = transcript.topic?.toLowerCase()
      const privacyTopics = transcript.privacy_topics?.map(t => t.toLowerCase()) || []
      return transcriptTopic === topic || privacyTopics.includes(topic)
    })

    // 3. Calculate co-occurring topics
    const coOccurrenceMap = new Map<string, number>()

    // From speakers
    for (const speaker of matchingSpeakers) {
      for (const t of speaker.topics || []) {
        const topicLower = t.toLowerCase()
        if (topicLower !== topic) {
          coOccurrenceMap.set(topicLower, (coOccurrenceMap.get(topicLower) || 0) + 1)
        }
      }
    }

    // From transcripts
    for (const transcript of matchingTranscripts) {
      const allTopics = [
        transcript.topic,
        ...(transcript.privacy_topics || [])
      ].filter(Boolean).map(t => t!.toLowerCase())

      for (const t of allTopics) {
        if (t !== topic) {
          coOccurrenceMap.set(t, (coOccurrenceMap.get(t) || 0) + 1)
        }
      }
    }

    // Sort related topics by co-occurrence count
    const relatedTopics = Array.from(coOccurrenceMap.entries())
      .map(([t, count]) => ({ topic: t, coOccurrenceCount: count }))
      .sort((a, b) => b.coOccurrenceCount - a.coOccurrenceCount)
      .slice(0, 20) // Limit to top 20

    // Format response
    const response: TopicDetailResponse = {
      topic,
      speakerCount: matchingSpeakers.length,
      transcriptCount: matchingTranscripts.length,
      speakers: matchingSpeakers.map(s => ({
        name: s.name,
        displayName: s.displayName || s.name,
      })),
      transcripts: matchingTranscripts
        .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0))
        .slice(0, 50) // Limit to most recent 50
        .map(t => {
          // Apply speaker corrections
          const correctedSpeakers = (t.speakers || []).map(speaker => {
            const correction = t.speaker_corrections?.[speaker.toLowerCase()]
            return correction?.name || speaker
          })

          return {
            meetingId: t.meeting_id,
            title: t.title || 'Untitled Meeting',
            date: t.date || '',
            duration: t.duration || 0,
            speakers: correctedSpeakers,
          }
        }),
      relatedTopics,
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Topic detail API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch topic details', details: String(error) },
      { status: 500 }
    )
  }
}

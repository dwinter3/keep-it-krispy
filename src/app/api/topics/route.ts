import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb'

const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
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

interface TopicStats {
  topic: string
  speakerCount: number
  speakers: Array<{
    name: string
    displayName: string
  }>
}

// GET /api/topics - Get all topics aggregated across speakers
export async function GET() {
  try {
    // Scan all speakers with topics
    const allSpeakers: SpeakerItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const scanCommand = new ScanCommand({
        TableName: SPEAKERS_TABLE,
        ProjectionExpression: '#name, displayName, topics, enrichedAt',
        ExpressionAttributeNames: {
          '#name': 'name',
        },
        FilterExpression: 'attribute_exists(topics)',
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(scanCommand)
      if (response.Items) {
        allSpeakers.push(...(response.Items as SpeakerItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

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
            speakers: [{
              name: speaker.name,
              displayName,
            }],
          })
        }
      }
    }

    // Convert to array and sort by speaker count (descending)
    const topics = Array.from(topicMap.values())
      .sort((a, b) => {
        if (b.speakerCount !== a.speakerCount) {
          return b.speakerCount - a.speakerCount
        }
        return a.topic.localeCompare(b.topic)
      })

    return NextResponse.json({
      count: topics.length,
      enrichedSpeakers: allSpeakers.length,
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

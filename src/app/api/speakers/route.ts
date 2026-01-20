import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
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

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface TranscriptItem {
  meeting_id: string
  date: string
  timestamp: string
  duration?: number
  speakers?: string[]
  speaker_corrections?: Record<string, SpeakerCorrection>
}

interface SpeakerStats {
  name: string
  canonicalName: string
  meetingCount: number
  totalDuration: number
  lastSeen: string
  linkedin?: string
}

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
    // Query user's transcripts to aggregate speaker data
    const allItems: TranscriptItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ExpressionAttributeValues: { ':userId': userId },
        ProjectionExpression: 'meeting_id, #date, #timestamp, #duration, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
          '#timestamp': 'timestamp',
          '#duration': 'duration',
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allItems.push(...(response.Items as TranscriptItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Build speaker statistics
    // Map from canonical name (lowercase) -> SpeakerStats
    const speakerMap = new Map<string, SpeakerStats>()

    for (const item of allItems) {
      const speakerCorrections = item.speaker_corrections || {}
      const speakers = item.speakers || []
      const meetingDate = item.timestamp || item.date || ''
      const duration = item.duration || 0

      // Process each speaker in the meeting
      for (const speaker of speakers) {
        const speakerLower = speaker.toLowerCase()

        // Check for correction first - corrected speakers should be included
        const correction = speakerCorrections[speakerLower]

        // Skip excluded generic speakers ONLY if they haven't been corrected
        if (EXCLUDED_SPEAKERS.has(speakerLower) && !correction) {
          continue
        }

        // Get canonical name from corrections, or use original
        const canonicalName = correction?.name || speaker
        const canonicalKey = canonicalName.toLowerCase()

        const existing = speakerMap.get(canonicalKey)

        if (existing) {
          existing.meetingCount += 1
          existing.totalDuration += duration
          // Update lastSeen if this meeting is more recent
          if (meetingDate > existing.lastSeen) {
            existing.lastSeen = meetingDate
          }
          // Update linkedin if we have a correction with it
          if (correction?.linkedin && !existing.linkedin) {
            existing.linkedin = correction.linkedin
          }
        } else {
          speakerMap.set(canonicalKey, {
            name: speaker,
            canonicalName,
            meetingCount: 1,
            totalDuration: duration,
            lastSeen: meetingDate,
            linkedin: correction?.linkedin,
          })
        }
      }
    }

    // Convert to array and sort by meeting count (descending), then by name
    const speakers = Array.from(speakerMap.values())
      .sort((a, b) => {
        if (b.meetingCount !== a.meetingCount) {
          return b.meetingCount - a.meetingCount
        }
        return a.canonicalName.localeCompare(b.canonicalName)
      })

    // Format duration and lastSeen for display
    const formattedSpeakers = speakers.map(s => ({
      name: s.canonicalName,
      meetingCount: s.meetingCount,
      totalDuration: s.totalDuration,
      totalDurationFormatted: formatDuration(s.totalDuration),
      lastSeen: s.lastSeen,
      lastSeenFormatted: formatLastSeen(s.lastSeen),
      linkedin: s.linkedin,
    }))

    return NextResponse.json({
      count: formattedSpeakers.length,
      speakers: formattedSpeakers,
    })
  } catch (error) {
    console.error('Speakers API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch speakers', details: String(error) },
      { status: 500 }
    )
  }
}

function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

function formatLastSeen(dateStr: string): string {
  if (!dateStr) return 'Unknown'

  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return 'Today'
  } else if (diffDays === 1) {
    return 'Yesterday'
  } else if (diffDays < 7) {
    return `${diffDays} days ago`
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return `${weeks} week${weeks > 1 ? 's' : ''} ago`
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30)
    return `${months} month${months > 1 ? 's' : ''} ago`
  } else {
    return date.toLocaleDateString()
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface TranscriptItem {
  meeting_id: string
  s3_key: string
  title: string
  date: string
  timestamp: string
  duration?: number
  speakers?: string[]
  speaker_corrections?: Record<string, SpeakerCorrection>
}

interface SpeakerProfile {
  name: string
  bio?: string
  linkedin?: string
  company?: string
  role?: string
  aiSummary?: string
  topics?: string[]
  enrichedAt?: string
}

// GET /api/speakers/[name] - Get speaker profile and meeting history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()

    // Scan all transcripts to find meetings with this speaker
    const allItems: TranscriptItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        ProjectionExpression: 'meeting_id, s3_key, title, #date, #timestamp, #duration, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
          '#timestamp': 'timestamp',
          '#duration': 'duration',
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(scanCommand)
      if (response.Items) {
        allItems.push(...(response.Items as TranscriptItem[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Filter meetings where this speaker appears (check both original and corrected names)
    const meetings: Array<{
      meetingId: string
      key: string
      title: string
      date: string
      timestamp: string
      duration: number
      originalName: string
    }> = []

    let linkedin: string | undefined
    let canonicalName = speakerName

    for (const item of allItems) {
      const speakers = item.speakers || []
      const corrections = item.speaker_corrections || {}

      for (const speaker of speakers) {
        const speakerLower = speaker.toLowerCase()
        const correction = corrections[speakerLower]
        const correctedName = correction?.name || speaker

        // Check if this speaker matches (either original or corrected name)
        if (speakerLower === speakerNameLower ||
            correctedName.toLowerCase() === speakerNameLower) {
          meetings.push({
            meetingId: item.meeting_id,
            key: item.s3_key,
            title: item.title || 'Untitled Meeting',
            date: item.date,
            timestamp: item.timestamp,
            duration: item.duration || 0,
            originalName: speaker,
          })

          // Capture linkedin and canonical name from corrections
          if (correction?.linkedin && !linkedin) {
            linkedin = correction.linkedin
          }
          if (correction?.name) {
            canonicalName = correction.name
          }
          break // Only count each meeting once
        }
      }
    }

    // Sort meetings by date (newest first)
    meetings.sort((a, b) => {
      const dateA = a.timestamp || a.date
      const dateB = b.timestamp || b.date
      return dateB.localeCompare(dateA)
    })

    // Try to get speaker profile from speakers table (if exists)
    let profile: SpeakerProfile | null = null
    try {
      const getCommand = new GetCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
      })
      const profileResult = await dynamodb.send(getCommand)
      if (profileResult.Item) {
        profile = profileResult.Item as SpeakerProfile
      }
    } catch {
      // Speakers table may not exist yet, that's okay
    }

    // Calculate stats
    const totalDuration = meetings.reduce((sum, m) => sum + m.duration, 0)

    return NextResponse.json({
      name: canonicalName,
      bio: profile?.bio,
      linkedin: linkedin || profile?.linkedin,
      company: profile?.company,
      role: profile?.role,
      aiSummary: profile?.aiSummary,
      topics: profile?.topics || [],
      enrichedAt: profile?.enrichedAt,
      stats: {
        meetingCount: meetings.length,
        totalDuration,
        totalDurationFormatted: formatDuration(totalDuration),
        firstMeeting: meetings.length > 0 ? meetings[meetings.length - 1].timestamp : null,
        lastMeeting: meetings.length > 0 ? meetings[0].timestamp : null,
      },
      meetings: meetings.map(m => ({
        meetingId: m.meetingId,
        key: m.key,
        title: m.title,
        date: m.date,
        timestamp: m.timestamp,
        duration: m.duration,
        durationFormatted: formatDuration(m.duration),
      })),
    })
  } catch (error) {
    console.error('Speaker profile API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch speaker profile', details: String(error) },
      { status: 500 }
    )
  }
}

// PUT /api/speakers/[name] - Update speaker profile (bio, linkedin, etc.)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()
    const body = await request.json()

    const { bio, linkedin, company, role } = body

    // Update or create speaker profile in speakers table
    const updateCommand = new UpdateCommand({
      TableName: SPEAKERS_TABLE,
      Key: { name: speakerNameLower },
      UpdateExpression: 'SET #bio = :bio, #linkedin = :linkedin, #company = :company, #role = :role, #displayName = :displayName, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#bio': 'bio',
        '#linkedin': 'linkedin',
        '#company': 'company',
        '#role': 'role',
        '#displayName': 'displayName',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':bio': bio || null,
        ':linkedin': linkedin || null,
        ':company': company || null,
        ':role': role || null,
        ':displayName': speakerName,
        ':updatedAt': new Date().toISOString(),
      },
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      profile: result.Attributes,
    })
  } catch (error) {
    console.error('Speaker profile update error:', error)
    return NextResponse.json(
      { error: 'Failed to update speaker profile', details: String(error) },
      { status: 500 }
    )
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0m'
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

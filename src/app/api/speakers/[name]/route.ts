import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, GetCommand, UpdateCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
const ENTITIES_TABLE = 'krisp-entities'
const RELATIONSHIPS_TABLE = 'krisp-relationships'
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
  topic?: string
  date: string
  timestamp: string
  duration?: number
  speakers?: string[]
  speaker_corrections?: Record<string, SpeakerCorrection>
}

interface EnrichedData {
  title?: string
  company?: string
  summary?: string
  linkedinUrl?: string
  photoUrl?: string
  fullName?: string
}

// Helper functions for entity management
function generateEntityId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'ent_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function generateRelationshipId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'rel_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
}

async function findSpeakerEntity(
  userId: string,
  speakerName: string
): Promise<{ entity_id: string } | null> {
  const canonical = canonicalizeName(speakerName)
  const queryCommand = new QueryCommand({
    TableName: ENTITIES_TABLE,
    IndexName: 'type-name-index',
    KeyConditionExpression: 'entity_type = :type AND canonical_name = :name',
    FilterExpression: 'user_id = :userId',
    ExpressionAttributeValues: {
      ':type': 'speaker',
      ':name': canonical,
      ':userId': userId,
    },
    Limit: 1,
  })

  const response = await dynamodb.send(queryCommand)
  if (response.Items && response.Items.length > 0) {
    return response.Items[0] as { entity_id: string }
  }
  return null
}

async function findCompanyEntity(
  userId: string,
  companyName: string
): Promise<{ entity_id: string } | null> {
  const canonical = canonicalizeName(companyName)
  const queryCommand = new QueryCommand({
    TableName: ENTITIES_TABLE,
    IndexName: 'type-name-index',
    KeyConditionExpression: 'entity_type = :type AND canonical_name = :name',
    FilterExpression: 'user_id = :userId',
    ExpressionAttributeValues: {
      ':type': 'company',
      ':name': canonical,
      ':userId': userId,
    },
    Limit: 1,
  })

  const response = await dynamodb.send(queryCommand)
  if (response.Items && response.Items.length > 0) {
    return response.Items[0] as { entity_id: string }
  }
  return null
}

async function createOrUpdateSpeakerEntity(
  userId: string,
  speakerName: string,
  metadata: {
    linkedin?: string
    role?: string
    company_name?: string
    bio?: string
    verified?: boolean
  }
): Promise<string> {
  const now = new Date().toISOString()
  const canonical = canonicalizeName(speakerName)

  // Check if entity exists
  const existing = await findSpeakerEntity(userId, speakerName)
  if (existing) {
    // Update existing entity
    const updateCommand = new UpdateCommand({
      TableName: ENTITIES_TABLE,
      Key: { entity_id: existing.entity_id },
      UpdateExpression:
        'SET #name = :name, canonical_name = :canonical, metadata = :metadata, updated_at = :now, updated_by = :userId',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':name': speakerName,
        ':canonical': canonical,
        ':metadata': metadata,
        ':now': now,
        ':userId': userId,
      },
    })
    await dynamodb.send(updateCommand)
    return existing.entity_id
  }

  // Create new entity
  const entityId = generateEntityId()
  const putCommand = new PutCommand({
    TableName: ENTITIES_TABLE,
    Item: {
      entity_id: entityId,
      entity_type: 'speaker',
      user_id: userId,
      name: speakerName,
      canonical_name: canonical,
      status: 'active',
      metadata,
      confidence: metadata.verified ? 100 : 70,
      enrichment_source: metadata.verified ? 'manual' : 'ai',
      created_at: now,
      created_by: userId,
      updated_at: now,
      updated_by: userId,
    },
  })
  await dynamodb.send(putCommand)
  return entityId
}

async function createCompanyEntityIfNeeded(
  userId: string,
  companyName: string
): Promise<string> {
  const existing = await findCompanyEntity(userId, companyName)
  if (existing) {
    return existing.entity_id
  }

  const now = new Date().toISOString()
  const entityId = generateEntityId()
  const putCommand = new PutCommand({
    TableName: ENTITIES_TABLE,
    Item: {
      entity_id: entityId,
      entity_type: 'company',
      user_id: userId,
      name: companyName,
      canonical_name: canonicalizeName(companyName),
      status: 'active',
      metadata: { type: 'other' },
      confidence: 70,
      created_at: now,
      created_by: userId,
      updated_at: now,
      updated_by: userId,
    },
  })
  await dynamodb.send(putCommand)
  return entityId
}

async function createWorksAtRelationshipIfNeeded(
  userId: string,
  speakerId: string,
  companyId: string,
  role?: string
): Promise<void> {
  // Check if relationship already exists
  const queryCommand = new QueryCommand({
    TableName: RELATIONSHIPS_TABLE,
    IndexName: 'from-index',
    KeyConditionExpression: 'from_entity_id = :from AND rel_type = :type',
    FilterExpression: 'to_entity_id = :to',
    ExpressionAttributeValues: {
      ':from': speakerId,
      ':type': 'works_at',
      ':to': companyId,
    },
    Limit: 1,
  })

  const existing = await dynamodb.send(queryCommand)
  if (existing.Items && existing.Items.length > 0) {
    // Update role if changed
    if (role) {
      const updateCommand = new UpdateCommand({
        TableName: RELATIONSHIPS_TABLE,
        Key: { relationship_id: (existing.Items[0] as { relationship_id: string }).relationship_id },
        UpdateExpression: 'SET #role = :role',
        ExpressionAttributeNames: { '#role': 'role' },
        ExpressionAttributeValues: { ':role': role },
      })
      await dynamodb.send(updateCommand)
    }
    return
  }

  // Create new relationship
  const now = new Date().toISOString()
  const relationshipId = generateRelationshipId()
  const putCommand = new PutCommand({
    TableName: RELATIONSHIPS_TABLE,
    Item: {
      relationship_id: relationshipId,
      from_entity_id: speakerId,
      from_entity_type: 'speaker',
      to_entity_id: companyId,
      to_entity_type: 'company',
      rel_type: 'works_at',
      role: role || undefined,
      confidence: 80,
      source: 'user_created',
      user_id: userId,
      created_at: now,
      created_by: userId,
    },
  })
  await dynamodb.send(putCommand)
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
  // Web enrichment fields
  enrichedData?: EnrichedData
  enrichedConfidence?: number
  enrichedReasoning?: string
  enrichedSources?: string[]
  webEnrichedAt?: string
  // Human feedback fields
  humanVerified?: boolean
  humanVerifiedAt?: string
  humanHints?: string
  rejectedProfiles?: string[]
  verifiedFullName?: string
}

// GET /api/speakers/[name] - Get speaker profile and meeting history
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  // Auth is required for user isolation
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
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()

    // Query user's transcripts to find meetings with this speaker (user-isolated)
    const allItems: TranscriptItem[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        ProjectionExpression: 'meeting_id, s3_key, title, topic, #date, #timestamp, #duration, speakers, speaker_corrections',
        ExpressionAttributeNames: {
          '#date': 'date',
          '#timestamp': 'timestamp',
          '#duration': 'duration',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(queryCommand)
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
      topic: string | null
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
            topic: item.topic || null,
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

    // Use verified full name if available
    const verifiedFullName = profile?.verifiedFullName
    const displayName = verifiedFullName || canonicalName

    // Look up entity_id from krisp-entities (if user is authenticated)
    let entityId: string | null = null
    if (userId) {
      const speakerEntity = await findSpeakerEntity(userId, displayName)
      entityId = speakerEntity?.entity_id || null
    }

    return NextResponse.json({
      name: displayName,
      originalName: canonicalName,  // Keep original for reference
      entityId,  // Entity ID from krisp-entities (if exists)
      verifiedFullName: verifiedFullName || null,
      bio: profile?.bio,
      linkedin: linkedin || profile?.linkedin,
      company: profile?.company,
      role: profile?.role,
      aiSummary: profile?.aiSummary,
      topics: profile?.topics || [],
      enrichedAt: profile?.enrichedAt,
      // Web enrichment fields
      enrichedData: profile?.enrichedData,
      enrichedConfidence: profile?.enrichedConfidence,
      enrichedReasoning: profile?.enrichedReasoning,
      enrichedSources: profile?.enrichedSources,
      webEnrichedAt: profile?.webEnrichedAt,
      // Human feedback fields
      humanVerified: profile?.humanVerified || false,
      humanVerifiedAt: profile?.humanVerifiedAt || null,
      humanHints: profile?.humanHints || null,
      rejectedProfiles: profile?.rejectedProfiles || null,
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
        topic: m.topic,
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

    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()
    const body = await request.json()

    const { bio, linkedin, company, role } = body

    // Update or create speaker profile in speakers table (legacy)
    const updateCommand = new UpdateCommand({
      TableName: SPEAKERS_TABLE,
      Key: { name: speakerNameLower },
      UpdateExpression: 'SET #bio = :bio, #linkedin = :linkedin, #company = :company, #role = :role, #displayName = :displayName, #updatedAt = :updatedAt, #userId = :userId',
      ExpressionAttributeNames: {
        '#bio': 'bio',
        '#linkedin': 'linkedin',
        '#company': 'company',
        '#role': 'role',
        '#displayName': 'displayName',
        '#updatedAt': 'updatedAt',
        '#userId': 'user_id',
      },
      ExpressionAttributeValues: {
        ':bio': bio || null,
        ':linkedin': linkedin || null,
        ':company': company || null,
        ':role': role || null,
        ':displayName': speakerName,
        ':updatedAt': new Date().toISOString(),
        ':userId': userId,
      },
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    // Create/update Speaker entity in krisp-entities (new model)
    const speakerId = await createOrUpdateSpeakerEntity(userId, speakerName, {
      linkedin: linkedin || undefined,
      role: role || undefined,
      company_name: company || undefined,
      bio: bio || undefined,
    })

    // If company provided, create Company entity and works_at relationship
    if (company && company.trim()) {
      const companyId = await createCompanyEntityIfNeeded(userId, company)
      await createWorksAtRelationshipIfNeeded(userId, speakerId, companyId, role)
    }

    return NextResponse.json({
      success: true,
      profile: result.Attributes,
      entity_id: speakerId,
    })
  } catch (error) {
    console.error('Speaker profile update error:', error)
    return NextResponse.json(
      { error: 'Failed to update speaker profile', details: String(error) },
      { status: 500 }
    )
  }
}

// PATCH /api/speakers/[name] - Partial updates (verification, hints, rejected profiles)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { name } = await params
    const speakerName = decodeURIComponent(name)
    const speakerNameLower = speakerName.toLowerCase()
    const body = await request.json()

    const updateExpressions: string[] = []
    const expressionAttributeNames: Record<string, string> = {}
    const expressionAttributeValues: Record<string, unknown> = {}

    // Handle humanVerified update
    if (body.humanVerified !== undefined) {
      updateExpressions.push('#humanVerified = :humanVerified')
      expressionAttributeNames['#humanVerified'] = 'humanVerified'
      expressionAttributeValues[':humanVerified'] = body.humanVerified

      if (body.humanVerified) {
        updateExpressions.push('#humanVerifiedAt = :humanVerifiedAt')
        expressionAttributeNames['#humanVerifiedAt'] = 'humanVerifiedAt'
        expressionAttributeValues[':humanVerifiedAt'] = new Date().toISOString()

        // If verifying, check if there's a fullName to use as the displayName
        const getCommand = new GetCommand({
          TableName: SPEAKERS_TABLE,
          Key: { name: speakerNameLower },
        })
        const existing = await dynamodb.send(getCommand)
        const fullName = existing.Item?.enrichedData?.fullName
        if (fullName && fullName !== speakerName) {
          updateExpressions.push('#verifiedFullName = :verifiedFullName')
          expressionAttributeNames['#verifiedFullName'] = 'verifiedFullName'
          expressionAttributeValues[':verifiedFullName'] = fullName
        }
      }
    }

    // Handle hints update
    if (body.humanHints !== undefined) {
      updateExpressions.push('#humanHints = :humanHints')
      expressionAttributeNames['#humanHints'] = 'humanHints'
      expressionAttributeValues[':humanHints'] = body.humanHints || null
    }

    // Handle rejected profile (adds to list)
    if (body.rejectProfile) {
      // First get existing rejected profiles
      const getCommand = new GetCommand({
        TableName: SPEAKERS_TABLE,
        Key: { name: speakerNameLower },
      })
      const existing = await dynamodb.send(getCommand)
      const existingRejected = existing.Item?.rejectedProfiles || []
      const newRejected = [...new Set([...existingRejected, body.rejectProfile])]

      updateExpressions.push('#rejectedProfiles = :rejectedProfiles')
      expressionAttributeNames['#rejectedProfiles'] = 'rejectedProfiles'
      expressionAttributeValues[':rejectedProfiles'] = newRejected

      // Also reset humanVerified since we're looking for a new match
      updateExpressions.push('#humanVerified = :humanVerified')
      expressionAttributeNames['#humanVerified'] = 'humanVerified'
      expressionAttributeValues[':humanVerified'] = false
    }

    // Handle clearing rejected profiles (fresh start)
    if (body.clearRejectedProfiles) {
      updateExpressions.push('#rejectedProfiles = :rejectedProfiles')
      expressionAttributeNames['#rejectedProfiles'] = 'rejectedProfiles'
      expressionAttributeValues[':rejectedProfiles'] = null
    }

    if (updateExpressions.length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Always update timestamp
    updateExpressions.push('#updatedAt = :updatedAt')
    expressionAttributeNames['#updatedAt'] = 'updatedAt'
    expressionAttributeValues[':updatedAt'] = new Date().toISOString()

    const updateCommand = new UpdateCommand({
      TableName: SPEAKERS_TABLE,
      Key: { name: speakerNameLower },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      profile: result.Attributes,
    })
  } catch (error) {
    console.error('Speaker profile patch error:', error)
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

import { NextRequest, NextResponse } from 'next/server'
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand, UpdateCommand, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail, getUser } from '@/lib/users'

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''  // Required: set via environment variable
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const ENTITIES_TABLE = 'krisp-entities'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// Ownership filter types for transcript listing
type OwnershipFilter = 'owned' | 'shared' | 'all'

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
    // If key provided, fetch specific transcript from S3 (with ownership/sharing check)
    if (key) {
      // First check ownership or sharing in DynamoDB
      const meetingId = key.split('/').pop()?.replace('.json', '')
      if (meetingId) {
        const getCommand = new GetCommand({
          TableName: TABLE_NAME,
          Key: { meeting_id: meetingId },
          ProjectionExpression: 'user_id, shared_with_user_ids, owner_type, owner_id',
        })
        const accessCheck = await dynamodb.send(getCommand)
        const isOwner = accessCheck.Item?.user_id === userId
        const isSharedWith = accessCheck.Item?.shared_with_user_ids?.includes(userId)
        // For team-owned transcripts, check if user is in shared_with_user_ids or is the team owner
        const isTeamOwned = accessCheck.Item?.owner_type === 'team'
        const isTeamOwner = isTeamOwned && accessCheck.Item?.owner_id === userId

        if (accessCheck.Item?.user_id && !isOwner && !isSharedWith && !isTeamOwner) {
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

    // Get stats for dashboard (scoped to user, excluding documents)
    if (action === 'stats') {
      const queryCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        FilterExpression: 'attribute_not_exists(pk) OR pk <> :docPk',
        ExpressionAttributeValues: { ':userId': userId, ':docPk': 'DOCUMENT' },
        Select: 'COUNT',
      })
      const countResult = await dynamodb.send(queryCommand)

      // Get unique speakers for this user (excluding documents)
      const speakersCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'user-index',
        KeyConditionExpression: 'user_id = :userId',
        FilterExpression: 'attribute_not_exists(pk) OR pk <> :docPk',
        ExpressionAttributeValues: { ':userId': userId, ':docPk': 'DOCUMENT' },
        ProjectionExpression: 'speakers, pk',
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
    const ownership = (searchParams.get('ownership') || 'all') as OwnershipFilter

    // Format transcript item for API response
    const formatTranscript = (item: Record<string, unknown>, isShared: boolean = false) => ({
      key: item.s3_key,
      meetingId: item.meeting_id,
      title: item.title || 'Untitled Meeting',
      date: item.date,
      timestamp: item.timestamp,
      duration: item.duration || 0,
      speakers: item.speakers || [],
      speakerWordCounts: item.speaker_word_counts || null,
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
      // Sharing info
      isShared,
      sharedWithUserIds: item.shared_with_user_ids || [],
      visibility: item.visibility || 'private',
      ownerId: item.user_id,
      // Team ownership info
      ownerType: item.owner_type || 'user',
      relinquishedBy: item.relinquished_by || null,
      relinquishedAt: item.relinquished_at || null,
    })

    // For shared-only, we need to scan for transcripts shared with this user
    // This is less efficient but necessary until we add a GSI for shared_with_user_ids
    if (ownership === 'shared') {
      // Scan for transcripts where user is in shared_with_user_ids (excluding documents)
      const scanCommand = new ScanCommand({
        TableName: TABLE_NAME,
        FilterExpression: 'contains(shared_with_user_ids, :userId) AND (attribute_not_exists(pk) OR pk <> :docPk)',
        ExpressionAttributeValues: { ':userId': userId, ':docPk': 'DOCUMENT' },
        Limit: limit,
        ...(cursor && { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }),
      })

      const scanResponse = await dynamodb.send(scanCommand)
      const sharedItems = scanResponse.Items || []

      // Get owner names for shared transcripts
      const ownerIds = [...new Set(sharedItems.map(item => item.user_id as string))]
      const ownerNames: Record<string, string> = {}
      for (const ownerId of ownerIds) {
        const owner = await getUser(ownerId)
        if (owner) {
          ownerNames[ownerId] = owner.name
        }
      }

      const transcripts = sharedItems.map(item => ({
        ...formatTranscript(item, true),
        ownerName: ownerNames[item.user_id as string] || 'Unknown',
      }))

      // Sort by timestamp descending
      transcripts.sort((a, b) => {
        const dateA = new Date((a.timestamp || a.date) as string | number).getTime()
        const dateB = new Date((b.timestamp || b.date) as string | number).getTime()
        return dateB - dateA
      })

      const nextCursor = scanResponse.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(scanResponse.LastEvaluatedKey)).toString('base64')
        : null

      return NextResponse.json({ transcripts, nextCursor })
    }

    // Build filter expression for privacy (for owned transcripts)
    // Also exclude documents (pk = 'DOCUMENT') which are stored in the same table
    let filterExpression: string | undefined
    const expressionAttrValues: Record<string, unknown> = { ':userId': userId }
    const expressionAttrNames: Record<string, string> = {}

    // Base filter: exclude documents
    const documentFilter = '(attribute_not_exists(pk) OR pk <> :docPk)'
    expressionAttrValues[':docPk'] = 'DOCUMENT'

    if (onlyPrivate) {
      filterExpression = `${documentFilter} AND isPrivate = :isPrivate`
      expressionAttrValues[':isPrivate'] = true
    } else if (!includePrivate) {
      // By default, exclude private transcripts
      filterExpression = `${documentFilter} AND (attribute_not_exists(isPrivate) OR isPrivate = :isPrivate)`
      expressionAttrValues[':isPrivate'] = false
    } else {
      filterExpression = documentFilter
    }

    // Query owned transcripts
    const queryCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: expressionAttrValues,
      ...(filterExpression && { FilterExpression: filterExpression }),
      ScanIndexForward: false, // Newest first (descending by timestamp)
      Limit: ownership === 'owned' ? limit : Math.ceil(limit * 0.75), // Leave room for shared if 'all'
      ...(cursor && !cursor.startsWith('shared:') && { ExclusiveStartKey: JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8')) }),
    })

    const response = await dynamodb.send(queryCommand)
    const ownedItems = response.Items || []
    const ownedTranscripts = ownedItems.map(item => formatTranscript(item, false))

    // If ownership is 'all', also fetch shared transcripts
    let sharedTranscripts: Array<ReturnType<typeof formatTranscript> & { ownerName?: string }> = []
    let sharedNextKey: Record<string, unknown> | undefined

    if (ownership === 'all') {
      const sharedLimit = limit - ownedTranscripts.length
      if (sharedLimit > 0) {
        const scanCommand = new ScanCommand({
          TableName: TABLE_NAME,
          FilterExpression: 'contains(shared_with_user_ids, :userId) AND (attribute_not_exists(pk) OR pk <> :docPk)',
          ExpressionAttributeValues: { ':userId': userId, ':docPk': 'DOCUMENT' },
          Limit: sharedLimit,
        })

        const scanResponse = await dynamodb.send(scanCommand)
        const sharedItems = scanResponse.Items || []
        sharedNextKey = scanResponse.LastEvaluatedKey

        // Get owner names
        const ownerIds = [...new Set(sharedItems.map(item => item.user_id as string))]
        const ownerNames: Record<string, string> = {}
        for (const ownerId of ownerIds) {
          const owner = await getUser(ownerId)
          if (owner) {
            ownerNames[ownerId] = owner.name
          }
        }

        sharedTranscripts = sharedItems.map(item => ({
          ...formatTranscript(item, true),
          ownerName: ownerNames[item.user_id as string] || 'Unknown',
        }))
      }
    }

    // Combine and sort all transcripts
    const allTranscripts = [...ownedTranscripts, ...sharedTranscripts]
    allTranscripts.sort((a, b) => {
      const dateA = new Date((a.timestamp || a.date) as string | number).getTime()
      const dateB = new Date((b.timestamp || b.date) as string | number).getTime()
      return dateB - dateA
    })

    // Build next cursor
    const nextCursor = response.LastEvaluatedKey
      ? Buffer.from(JSON.stringify(response.LastEvaluatedKey)).toString('base64')
      : null

    return NextResponse.json({ transcripts: allTranscripts, nextCursor })
  } catch (error) {
    console.error('API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transcripts', details: String(error) },
      { status: 500 }
    )
  }
}

// Helper to generate entity ID
function generateEntityId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'ent_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

// Canonicalize name for consistent lookups
function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
}

// Find existing speaker entity by name
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

// Create a new speaker entity
async function createSpeakerEntity(
  userId: string,
  speakerName: string
): Promise<string> {
  const now = new Date().toISOString()
  const entityId = generateEntityId()
  const canonical = canonicalizeName(speakerName)

  const putCommand = new PutCommand({
    TableName: ENTITIES_TABLE,
    Item: {
      entity_id: entityId,
      entity_type: 'speaker',
      user_id: userId,
      name: speakerName,
      canonical_name: canonical,
      status: 'active',
      metadata: {},
      confidence: 70,
      enrichment_source: 'user_correction',
      created_at: now,
      created_by: userId,
      updated_at: now,
      updated_by: userId,
    },
  })
  await dynamodb.send(putCommand)
  return entityId
}

// Fire-and-forget enrichment trigger for newly created speaker entities
// This is intentionally non-blocking to avoid slowing down the speaker correction flow
async function triggerSpeakerEnrichment(
  speakerName: string,
  request: NextRequest
): Promise<void> {
  try {
    // Construct the enrichment URL from the current request
    const baseUrl = new URL(request.url).origin
    const enrichUrl = `${baseUrl}/api/speakers/${encodeURIComponent(speakerName)}/enrich`

    // Fire-and-forget with short timeout
    // We don't await the response - just fire the request
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout

    fetch(enrichUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Forward cookies for auth
        'Cookie': request.headers.get('Cookie') || '',
      },
      body: JSON.stringify({ forceRefresh: false }),
      signal: controller.signal,
    })
      .then(response => {
        clearTimeout(timeoutId)
        if (response.ok) {
          console.log(`Auto-enrichment triggered for speaker: ${speakerName}`)
        } else {
          console.log(`Auto-enrichment returned ${response.status} for speaker: ${speakerName}`)
        }
      })
      .catch(err => {
        clearTimeout(timeoutId)
        // AbortError is expected on timeout - don't log it as an error
        if (err.name !== 'AbortError') {
          console.error(`Auto-enrichment failed for speaker ${speakerName}:`, err.message)
        }
      })
  } catch (err) {
    // Don't fail the main flow for enrichment errors
    console.error('Error triggering speaker enrichment:', err)
  }
}

/**
 * PATCH - Update speaker corrections for a transcript
 * Also creates speaker entities for new names
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

  // Parse body once and store for retry logic
  let body: {
    meetingId?: string
    speakerCorrection?: {
      originalName?: string
      correctedName?: string
      entityId?: string  // Optional: link to existing entity
    }
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { meetingId, speakerCorrection } = body

  if (!meetingId || !speakerCorrection) {
    return NextResponse.json(
      { error: 'Missing required fields: meetingId and speakerCorrection' },
      { status: 400 }
    )
  }

  const { originalName, correctedName, entityId: providedEntityId } = speakerCorrection

  if (!originalName || !correctedName) {
    return NextResponse.json(
      { error: 'speakerCorrection must have originalName and correctedName' },
      { status: 400 }
    )
  }

  try {
    // Verify ownership before update
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      ProjectionExpression: 'user_id, speaker_corrections',
    })
    const existingItem = await dynamodb.send(getCommand)

    if (existingItem.Item?.user_id && existingItem.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Determine entity ID: use provided, find existing, or create new
    let entityId = providedEntityId
    let isNewlyCreatedEntity = false

    if (!entityId) {
      // Check if an entity already exists for this name
      const existingEntity = await findSpeakerEntity(userId, correctedName)
      if (existingEntity) {
        entityId = existingEntity.entity_id
      } else {
        // Create new speaker entity for this name
        entityId = await createSpeakerEntity(userId, correctedName)
        isNewlyCreatedEntity = true
        console.log(`Created new speaker entity ${entityId} for "${correctedName}"`)

        // Fire-and-forget enrichment for newly created entity
        // This runs in the background without blocking the response
        triggerSpeakerEnrichment(correctedName, request)
      }
    }

    // The key is the lowercase original name for consistent lookups
    const correctionKey = originalName.toLowerCase()

    // Build the correction object with entity link
    const correctionValue = {
      name: correctedName,
      entity_id: entityId,
    }

    // Check if speaker_corrections map already exists
    const existingCorrections = existingItem.Item?.speaker_corrections

    let updateCommand: UpdateCommand

    if (existingCorrections) {
      // Update existing map - can use nested path
      updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: meetingId },
        UpdateExpression: 'SET speaker_corrections.#speakerKey = :correction',
        ExpressionAttributeNames: {
          '#speakerKey': correctionKey,
        },
        ExpressionAttributeValues: {
          ':correction': correctionValue,
        },
        ReturnValues: 'ALL_NEW',
      })
    } else {
      // Create new map - speaker_corrections doesn't exist yet
      updateCommand = new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { meeting_id: meetingId },
        UpdateExpression: 'SET speaker_corrections = :corrections',
        ExpressionAttributeValues: {
          ':corrections': {
            [correctionKey]: correctionValue,
          },
        },
        ReturnValues: 'ALL_NEW',
      })
    }

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      speakerCorrections: result.Attributes?.speaker_corrections || {},
      entityId,  // Return the entity ID so frontend knows it was created/linked
      entityCreated: isNewlyCreatedEntity,  // Indicates if enrichment was triggered
    })
  } catch (error) {
    console.error('PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update speaker correction', details: String(error) },
      { status: 500 }
    )
  }
}

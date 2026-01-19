#!/usr/bin/env npx ts-node
/**
 * Migration Script: Create Transcript ↔ Speaker Relationships
 *
 * This script creates participant relationships between speakers and transcripts:
 * - Reads all transcripts from krisp-transcripts-index
 * - For each speaker in the transcript, looks up their entity_id
 * - Creates a participant relationship
 *
 * Usage:
 *   AWS_PROFILE=krisp-buddy npx ts-node --transpile-only scripts/create-transcript-relationships.ts [--dry-run]
 */

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb'

const client = new DynamoDBClient({ region: 'us-east-1' })

const TRANSCRIPTS_TABLE = 'krisp-transcripts-index'
const ENTITIES_TABLE = 'krisp-entities'
const RELATIONSHIPS_TABLE = 'krisp-relationships'

const DRY_RUN = process.argv.includes('--dry-run')

interface MigrationStats {
  transcriptsProcessed: number
  relationshipsCreated: number
  speakersNotFound: string[]
  errors: string[]
}

const stats: MigrationStats = {
  transcriptsProcessed: 0,
  relationshipsCreated: 0,
  speakersNotFound: [],
  errors: [],
}

// Cache speaker lookups
const speakerCache = new Map<string, string | null>() // canonical_name -> entity_id

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

async function getAllTranscripts(): Promise<Record<string, any>[]> {
  const transcripts: Record<string, any>[] = []
  let lastEvaluatedKey: Record<string, any> | undefined

  do {
    const command = new ScanCommand({
      TableName: TRANSCRIPTS_TABLE,
      ExclusiveStartKey: lastEvaluatedKey as any,
    })

    const response = await client.send(command)

    if (response.Items) {
      transcripts.push(...response.Items.map((item) => unmarshall(item)))
    }

    lastEvaluatedKey = response.LastEvaluatedKey as any
  } while (lastEvaluatedKey)

  return transcripts
}

async function findSpeakerEntity(speakerName: string): Promise<string | null> {
  const canonical = canonicalizeName(speakerName)

  // Check cache
  if (speakerCache.has(canonical)) {
    return speakerCache.get(canonical)!
  }

  // Query by canonical name
  const command = new QueryCommand({
    TableName: ENTITIES_TABLE,
    IndexName: 'type-name-index',
    KeyConditionExpression: 'entity_type = :type AND canonical_name = :name',
    ExpressionAttributeValues: marshall({
      ':type': 'speaker',
      ':name': canonical,
    }),
    Limit: 1,
  })

  const response = await client.send(command)
  let entityId: string | null = null

  if (response.Items && response.Items.length > 0) {
    const item = unmarshall(response.Items[0])
    entityId = item.entity_id as string
  }

  speakerCache.set(canonical, entityId)
  return entityId
}

async function checkRelationshipExists(
  fromId: string,
  toId: string,
  relType: string
): Promise<boolean> {
  const command = new QueryCommand({
    TableName: RELATIONSHIPS_TABLE,
    IndexName: 'from-index',
    KeyConditionExpression: 'from_entity_id = :from AND rel_type = :type',
    FilterExpression: 'to_entity_id = :to',
    ExpressionAttributeValues: marshall({
      ':from': fromId,
      ':type': relType,
      ':to': toId,
    }),
    Limit: 1,
  })

  const response = await client.send(command)
  return response.Items !== undefined && response.Items.length > 0
}

async function createParticipantRelationship(
  speakerId: string,
  transcriptId: string,
  userId: string
): Promise<void> {
  // Check if relationship already exists
  const exists = await checkRelationshipExists(speakerId, transcriptId, 'participant')
  if (exists) {
    console.log(`    ⏭️  Relationship already exists`)
    return
  }

  const relationshipId = generateRelationshipId()
  const now = new Date().toISOString()

  const relationship = {
    relationship_id: relationshipId,
    from_entity_id: speakerId,
    from_entity_type: 'speaker',
    to_entity_id: transcriptId, // Using meeting_id as entity reference
    to_entity_type: 'transcript',
    rel_type: 'participant',
    role: 'attendee',
    confidence: 100,
    source: 'imported',
    user_id: userId,
    created_at: now,
    created_by: 'migration_script',
  }

  if (!DRY_RUN) {
    const command = new PutItemCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: marshall(relationship, { removeUndefinedValues: true }),
    })
    await client.send(command)
  }

  console.log(`    🔗 Created participant relationship (${relationshipId})`)
  stats.relationshipsCreated++
}

async function processTranscript(transcript: Record<string, any>): Promise<void> {
  const meetingId = transcript.meeting_id
  const title = transcript.title || 'Untitled'
  const speakers = transcript.speakers || []
  const userId = transcript.user_id || 'usr_admin_001'

  console.log(`\nProcessing: ${title.substring(0, 50)}...`)
  console.log(`  Meeting ID: ${meetingId}`)
  console.log(`  Speakers: ${speakers.length}`)

  for (const speakerName of speakers) {
    // Skip generic speaker names
    if (speakerName.toLowerCase().startsWith('speaker ')) {
      console.log(`    ⏭️  Skipping generic: ${speakerName}`)
      continue
    }

    // Skip self (david winter)
    if (canonicalizeName(speakerName) === 'david winter') {
      console.log(`    ⏭️  Skipping self: ${speakerName}`)
      continue
    }

    const speakerId = await findSpeakerEntity(speakerName)

    if (speakerId) {
      console.log(`    Found speaker: ${speakerName} → ${speakerId}`)
      await createParticipantRelationship(speakerId, meetingId, userId)
    } else {
      console.log(`    ❓ Speaker not found: ${speakerName}`)
      if (!stats.speakersNotFound.includes(speakerName)) {
        stats.speakersNotFound.push(speakerName)
      }
    }
  }

  stats.transcriptsProcessed++
}

async function main() {
  console.log('='.repeat(60))
  console.log('Transcript ↔ Speaker Relationship Migration')
  console.log('='.repeat(60))

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be written\n')
  }

  // Get all transcripts
  console.log('\nFetching transcripts...')
  const transcripts = await getAllTranscripts()
  console.log(`Found ${transcripts.length} transcripts`)

  // Process each transcript
  for (const transcript of transcripts) {
    try {
      await processTranscript(transcript)
    } catch (error) {
      const errorMsg = `Error processing ${transcript.meeting_id}: ${error}`
      console.error(`  ❌ ${errorMsg}`)
      stats.errors.push(errorMsg)
    }
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('Migration Summary')
  console.log('='.repeat(60))
  console.log(`Transcripts processed:     ${stats.transcriptsProcessed}`)
  console.log(`Relationships created:     ${stats.relationshipsCreated}`)

  if (stats.speakersNotFound.length > 0) {
    console.log(`\nSpeakers not found (${stats.speakersNotFound.length}):`)
    stats.speakersNotFound.forEach((s) => console.log(`  - ${s}`))
  }

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`)
    stats.errors.forEach((e) => console.log(`  - ${e}`))
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply changes')
  }
}

main().catch(console.error)

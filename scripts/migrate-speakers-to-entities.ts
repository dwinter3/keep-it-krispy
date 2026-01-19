#!/usr/bin/env npx ts-node
/**
 * Migration Script: Speakers → Entity Model
 *
 * This script migrates existing krisp-speakers records to the new entity model:
 * 1. Creates speaker entities in krisp-entities
 * 2. Creates company entities for unique companies
 * 3. Creates works_at relationships between speakers and companies
 *
 * Usage:
 *   npx ts-node --transpile-only scripts/migrate-speakers-to-entities.ts [--dry-run]
 *
 * @see docs/entity-relationship-model.md
 */

import {
  DynamoDBClient,
  ScanCommand,
  PutItemCommand,
  QueryCommand,
} from '@aws-sdk/client-dynamodb'
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb'

// Use AWS_PROFILE environment variable
const client = new DynamoDBClient({ region: 'us-east-1' })

const SPEAKERS_TABLE = 'krisp-speakers'
const ENTITIES_TABLE = 'krisp-entities'
const RELATIONSHIPS_TABLE = 'krisp-relationships'

const DRY_RUN = process.argv.includes('--dry-run')

// Inline type definitions (to avoid module resolution issues)
type EntityType = 'speaker' | 'company' | 'topic' | 'transcript' | 'document'

interface MigrationStats {
  speakersProcessed: number
  speakerEntitiesCreated: number
  companyEntitiesCreated: number
  relationshipsCreated: number
  skipped: number
  errors: string[]
}

const stats: MigrationStats = {
  speakersProcessed: 0,
  speakerEntitiesCreated: 0,
  companyEntitiesCreated: 0,
  relationshipsCreated: 0,
  skipped: 0,
  errors: [],
}

// Track companies we've already created to avoid duplicates
const companyCache = new Map<string, string>() // canonical_name -> entity_id

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

async function getAllSpeakers(): Promise<Record<string, any>[]> {
  const speakers: Record<string, any>[] = []
  let lastEvaluatedKey: Record<string, any> | undefined

  do {
    const command = new ScanCommand({
      TableName: SPEAKERS_TABLE,
      ExclusiveStartKey: lastEvaluatedKey as any,
    })

    const response = await client.send(command)

    if (response.Items) {
      speakers.push(...response.Items.map((item) => unmarshall(item)))
    }

    lastEvaluatedKey = response.LastEvaluatedKey as any
  } while (lastEvaluatedKey)

  return speakers
}

async function checkEntityExists(
  entityType: EntityType,
  canonicalName: string
): Promise<string | null> {
  const command = new QueryCommand({
    TableName: ENTITIES_TABLE,
    IndexName: 'type-name-index',
    KeyConditionExpression: 'entity_type = :type AND canonical_name = :name',
    ExpressionAttributeValues: marshall({
      ':type': entityType,
      ':name': canonicalName,
    }),
    Limit: 1,
  })

  const response = await client.send(command)
  if (response.Items && response.Items.length > 0) {
    const item = unmarshall(response.Items[0])
    return item.entity_id as string
  }
  return null
}

async function createSpeakerEntity(
  speaker: Record<string, any>
): Promise<string> {
  const now = new Date().toISOString()
  const name = speaker.displayName || speaker.name
  const canonical = canonicalizeName(name)

  // Check if already exists
  const existingId = await checkEntityExists('speaker', canonical)
  if (existingId) {
    console.log(`  ⏭️  Speaker "${name}" already exists as ${existingId}`)
    stats.skipped++
    return existingId
  }

  const entityId = generateEntityId()
  const userId = speaker.user_id || 'usr_admin_001' // Default for legacy data

  const metadata: Record<string, any> = {
    linkedin: speaker.linkedin,
    role: speaker.role,
    company_name: speaker.company,
    bio: speaker.aiSummary,
    verified: speaker.humanVerified,
  }

  // Include enriched data if available
  const enrichedData = speaker.enrichedData as Record<string, any> | undefined
  if (enrichedData) {
    metadata.linkedin = metadata.linkedin || enrichedData.linkedinUrl
    metadata.role = metadata.role || enrichedData.title
    metadata.company_name = metadata.company_name || enrichedData.company
  }

  // Clean undefined values
  Object.keys(metadata).forEach((key) => {
    if (metadata[key] === undefined) delete metadata[key]
  })

  const aliases = [speaker.name]
    .filter((a: string) => a && a.toLowerCase() !== name.toLowerCase())

  const entity: Record<string, any> = {
    entity_id: entityId,
    entity_type: 'speaker',
    user_id: userId,
    name: name,
    canonical_name: canonical,
    status: 'active',
    metadata: metadata,
    confidence: speaker.enrichedConfidence || 50,
    created_at: now,
    created_by: 'migration_script',
    updated_at: now,
    updated_by: 'migration_script',
  }

  if (aliases.length > 0) {
    entity.aliases = aliases
  }
  if (speaker.enrichedAt) {
    entity.enriched_at = speaker.enrichedAt
    entity.enrichment_source = speaker.humanVerified ? 'manual' : 'ai'
  }

  if (!DRY_RUN) {
    const command = new PutItemCommand({
      TableName: ENTITIES_TABLE,
      Item: marshall(entity, { removeUndefinedValues: true }),
    })
    await client.send(command)
  }

  console.log(`  ✅ Created speaker entity: ${name} (${entityId})`)
  stats.speakerEntitiesCreated++
  return entityId
}

async function createCompanyEntity(
  companyName: string,
  userId: string
): Promise<string> {
  const canonical = canonicalizeName(companyName)

  // Check cache first
  if (companyCache.has(canonical)) {
    return companyCache.get(canonical)!
  }

  // Check if already exists in DB
  const existingId = await checkEntityExists('company', canonical)
  if (existingId) {
    companyCache.set(canonical, existingId)
    console.log(`  ⏭️  Company "${companyName}" already exists as ${existingId}`)
    return existingId
  }

  const entityId = generateEntityId()
  const now = new Date().toISOString()

  const entity = {
    entity_id: entityId,
    entity_type: 'company',
    user_id: userId,
    name: companyName,
    canonical_name: canonical,
    status: 'active',
    metadata: { type: 'other' },
    confidence: 70,
    created_at: now,
    created_by: 'migration_script',
    updated_at: now,
    updated_by: 'migration_script',
  }

  if (!DRY_RUN) {
    const command = new PutItemCommand({
      TableName: ENTITIES_TABLE,
      Item: marshall(entity, { removeUndefinedValues: true }),
    })
    await client.send(command)
  }

  companyCache.set(canonical, entityId)
  console.log(`  ✅ Created company entity: ${companyName} (${entityId})`)
  stats.companyEntitiesCreated++
  return entityId
}

async function createWorksAtRelationship(
  speakerId: string,
  companyId: string,
  userId: string,
  role?: string
): Promise<void> {
  const relationshipId = generateRelationshipId()
  const now = new Date().toISOString()

  const relationship: Record<string, any> = {
    relationship_id: relationshipId,
    from_entity_id: speakerId,
    from_entity_type: 'speaker',
    to_entity_id: companyId,
    to_entity_type: 'company',
    rel_type: 'works_at',
    confidence: 80,
    source: 'imported',
    user_id: userId,
    created_at: now,
    created_by: 'migration_script',
  }

  if (role) {
    relationship.role = role
  }

  if (!DRY_RUN) {
    const command = new PutItemCommand({
      TableName: RELATIONSHIPS_TABLE,
      Item: marshall(relationship, { removeUndefinedValues: true }),
    })
    await client.send(command)
  }

  console.log(`  🔗 Created works_at relationship (${relationshipId})`)
  stats.relationshipsCreated++
}

async function migrateSpeaker(speaker: Record<string, any>): Promise<void> {
  const name = speaker.displayName || speaker.name
  console.log(`\nProcessing speaker: ${name}`)

  try {
    // 1. Create speaker entity
    const speakerId = await createSpeakerEntity(speaker)

    // 2. Create company entity if company exists
    const companyName = speaker.company as string | undefined
    const userId = speaker.user_id || 'usr_admin_001'

    if (companyName && companyName.trim()) {
      const companyId = await createCompanyEntity(companyName, userId)

      // 3. Create works_at relationship
      await createWorksAtRelationship(
        speakerId,
        companyId,
        userId,
        speaker.role
      )
    }

    stats.speakersProcessed++
  } catch (error) {
    const errorMsg = `Error processing ${name}: ${error}`
    console.error(`  ❌ ${errorMsg}`)
    stats.errors.push(errorMsg)
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Speaker → Entity Migration')
  console.log('='.repeat(60))

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN MODE - No changes will be written\n')
  }

  // Get all speakers
  console.log('\nFetching speakers from krisp-speakers...')
  const speakers = await getAllSpeakers()
  console.log(`Found ${speakers.length} speakers to migrate`)

  // Migrate each speaker
  for (const speaker of speakers) {
    await migrateSpeaker(speaker)
  }

  // Print summary
  console.log('\n' + '='.repeat(60))
  console.log('Migration Summary')
  console.log('='.repeat(60))
  console.log(`Speakers processed:        ${stats.speakersProcessed}`)
  console.log(`Speaker entities created:  ${stats.speakerEntitiesCreated}`)
  console.log(`Company entities created:  ${stats.companyEntitiesCreated}`)
  console.log(`Relationships created:     ${stats.relationshipsCreated}`)
  console.log(`Skipped (already exist):   ${stats.skipped}`)

  if (stats.errors.length > 0) {
    console.log(`\nErrors (${stats.errors.length}):`)
    stats.errors.forEach((e) => console.log(`  - ${e}`))
  }

  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN - Run without --dry-run to apply changes')
  }
}

main().catch(console.error)

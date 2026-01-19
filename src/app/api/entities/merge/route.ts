import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  QueryCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import type { Entity } from '@/lib/entities'
import type { Relationship } from '@/lib/relationships'

const ENTITIES_TABLE = 'krisp-entities'
const RELATIONSHIPS_TABLE = 'krisp-relationships'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface MergeRequest {
  sourceIds: string[] // Entity IDs to merge FROM
  targetId: string // Entity ID to merge INTO
  preserveTargetMetadata?: boolean // If true, prefer target's metadata
}

interface MergeResult {
  success: boolean
  targetId: string
  mergedCount: number
  relationshipsUpdated: number
  aliases: string[]
}

/**
 * POST /api/entities/merge
 *
 * Merge multiple entities into one target entity.
 * - Source entities are marked as merged (status='merged')
 * - All relationships are updated to point to target
 * - Aliases are preserved for search
 */
export async function POST(request: NextRequest) {
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
    const body: MergeRequest = await request.json()
    const { sourceIds, targetId, preserveTargetMetadata = true } = body

    if (!sourceIds || sourceIds.length === 0) {
      return NextResponse.json({ error: 'sourceIds required' }, { status: 400 })
    }
    if (!targetId) {
      return NextResponse.json({ error: 'targetId required' }, { status: 400 })
    }
    if (sourceIds.includes(targetId)) {
      return NextResponse.json({ error: 'targetId cannot be in sourceIds' }, { status: 400 })
    }

    // 1. Fetch target entity
    const targetResult = await dynamodb.send(
      new GetCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: targetId },
      })
    )
    const targetEntity = targetResult.Item as Entity | undefined

    if (!targetEntity || targetEntity.user_id !== userId) {
      return NextResponse.json({ error: 'Target entity not found' }, { status: 404 })
    }
    if (targetEntity.status === 'merged') {
      return NextResponse.json({ error: 'Target entity is already merged' }, { status: 400 })
    }

    // 2. Fetch source entities
    const sourceEntities: Entity[] = []
    for (const sourceId of sourceIds) {
      const sourceResult = await dynamodb.send(
        new GetCommand({
          TableName: ENTITIES_TABLE,
          Key: { entity_id: sourceId },
        })
      )
      const sourceEntity = sourceResult.Item as Entity | undefined

      if (!sourceEntity || sourceEntity.user_id !== userId) {
        return NextResponse.json({ error: `Source entity ${sourceId} not found` }, { status: 404 })
      }
      if (sourceEntity.entity_type !== targetEntity.entity_type) {
        return NextResponse.json(
          { error: `Cannot merge different entity types: ${sourceEntity.entity_type} vs ${targetEntity.entity_type}` },
          { status: 400 }
        )
      }
      if (sourceEntity.status === 'merged') {
        return NextResponse.json({ error: `Source entity ${sourceId} is already merged` }, { status: 400 })
      }
      sourceEntities.push(sourceEntity)
    }

    const now = new Date().toISOString()

    // 3. Collect all aliases (including source names and their aliases)
    const allAliases = new Set<string>(targetEntity.aliases || [])
    allAliases.add(targetEntity.name) // Include target name as searchable

    for (const source of sourceEntities) {
      allAliases.add(source.name)
      allAliases.add(source.canonical_name)
      for (const alias of source.aliases || []) {
        allAliases.add(alias)
      }
    }
    // Remove the target's canonical name from aliases (it's the primary)
    allAliases.delete(targetEntity.canonical_name)
    allAliases.delete(targetEntity.name)

    // 4. Merge metadata (prefer target if preserveTargetMetadata, else merge)
    let mergedMetadata = { ...targetEntity.metadata }
    if (!preserveTargetMetadata) {
      // Merge metadata from sources, preferring non-empty values
      for (const source of sourceEntities) {
        const sourceMeta = source.metadata || {}
        for (const [key, value] of Object.entries(sourceMeta)) {
          if (value !== undefined && value !== null && value !== '') {
            if (!mergedMetadata[key] || mergedMetadata[key] === '') {
              mergedMetadata[key] = value
            }
          }
        }
      }
    }

    // 5. Update target entity
    const mergedFromIds = [
      ...(targetEntity.merged_from || []),
      ...sourceIds,
    ]

    await dynamodb.send(
      new UpdateCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: targetId },
        UpdateExpression: `
          SET #aliases = :aliases,
              #merged_from = :merged_from,
              #metadata = :metadata,
              #updated_at = :updated_at,
              #updated_by = :updated_by
        `,
        ExpressionAttributeNames: {
          '#aliases': 'aliases',
          '#merged_from': 'merged_from',
          '#metadata': 'metadata',
          '#updated_at': 'updated_at',
          '#updated_by': 'updated_by',
        },
        ExpressionAttributeValues: {
          ':aliases': Array.from(allAliases),
          ':merged_from': mergedFromIds,
          ':metadata': mergedMetadata,
          ':updated_at': now,
          ':updated_by': userId,
        },
      })
    )

    // 6. Mark source entities as merged
    for (const sourceId of sourceIds) {
      await dynamodb.send(
        new UpdateCommand({
          TableName: ENTITIES_TABLE,
          Key: { entity_id: sourceId },
          UpdateExpression: `
            SET #status = :status,
                #merged_into = :merged_into,
                #updated_at = :updated_at,
                #updated_by = :updated_by
          `,
          ExpressionAttributeNames: {
            '#status': 'status',
            '#merged_into': 'merged_into',
            '#updated_at': 'updated_at',
            '#updated_by': 'updated_by',
          },
          ExpressionAttributeValues: {
            ':status': 'merged',
            ':merged_into': targetId,
            ':updated_at': now,
            ':updated_by': userId,
          },
        })
      )
    }

    // 7. Update relationships - change source references to target
    let relationshipsUpdated = 0

    for (const sourceId of sourceIds) {
      // Update relationships where source is the "from" entity
      const fromRels = await dynamodb.send(
        new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'from-index',
          KeyConditionExpression: 'from_entity_id = :sourceId',
          FilterExpression: 'user_id = :userId',
          ExpressionAttributeValues: {
            ':sourceId': sourceId,
            ':userId': userId,
          },
        })
      )

      for (const rel of (fromRels.Items || []) as Relationship[]) {
        await dynamodb.send(
          new UpdateCommand({
            TableName: RELATIONSHIPS_TABLE,
            Key: { relationship_id: rel.relationship_id },
            UpdateExpression: 'SET from_entity_id = :targetId',
            ExpressionAttributeValues: {
              ':targetId': targetId,
            },
          })
        )
        relationshipsUpdated++
      }

      // Update relationships where source is the "to" entity
      const toRels = await dynamodb.send(
        new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'to-index',
          KeyConditionExpression: 'to_entity_id = :sourceId',
          FilterExpression: 'user_id = :userId',
          ExpressionAttributeValues: {
            ':sourceId': sourceId,
            ':userId': userId,
          },
        })
      )

      for (const rel of (toRels.Items || []) as Relationship[]) {
        await dynamodb.send(
          new UpdateCommand({
            TableName: RELATIONSHIPS_TABLE,
            Key: { relationship_id: rel.relationship_id },
            UpdateExpression: 'SET to_entity_id = :targetId',
            ExpressionAttributeValues: {
              ':targetId': targetId,
            },
          })
        )
        relationshipsUpdated++
      }
    }

    const result: MergeResult = {
      success: true,
      targetId,
      mergedCount: sourceIds.length,
      relationshipsUpdated,
      aliases: Array.from(allAliases),
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Entity merge error:', error)
    return NextResponse.json(
      { error: 'Failed to merge entities', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/entities/merge?targetId=xxx
 *
 * Preview a merge operation - shows what would happen
 */
export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  const searchParams = request.nextUrl.searchParams
  const sourceIdsParam = searchParams.get('sourceIds')
  const targetId = searchParams.get('targetId')

  if (!sourceIdsParam || !targetId) {
    return NextResponse.json({ error: 'sourceIds and targetId required' }, { status: 400 })
  }

  const sourceIds = sourceIdsParam.split(',')

  try {
    // Fetch target entity
    const targetResult = await dynamodb.send(
      new GetCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: targetId },
      })
    )
    const targetEntity = targetResult.Item as Entity | undefined

    if (!targetEntity || targetEntity.user_id !== userId) {
      return NextResponse.json({ error: 'Target entity not found' }, { status: 404 })
    }

    // Fetch source entities
    const sourceEntities: Entity[] = []
    for (const sourceId of sourceIds) {
      const sourceResult = await dynamodb.send(
        new GetCommand({
          TableName: ENTITIES_TABLE,
          Key: { entity_id: sourceId },
        })
      )
      if (sourceResult.Item && sourceResult.Item.user_id === userId) {
        sourceEntities.push(sourceResult.Item as Entity)
      }
    }

    // Count relationships that would be updated
    let totalRelationships = 0
    for (const sourceId of sourceIds) {
      const fromRels = await dynamodb.send(
        new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'from-index',
          KeyConditionExpression: 'from_entity_id = :sourceId',
          FilterExpression: 'user_id = :userId',
          ExpressionAttributeValues: {
            ':sourceId': sourceId,
            ':userId': userId,
          },
          Select: 'COUNT',
        })
      )
      totalRelationships += fromRels.Count || 0

      const toRels = await dynamodb.send(
        new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'to-index',
          KeyConditionExpression: 'to_entity_id = :sourceId',
          FilterExpression: 'user_id = :userId',
          ExpressionAttributeValues: {
            ':sourceId': sourceId,
            ':userId': userId,
          },
          Select: 'COUNT',
        })
      )
      totalRelationships += toRels.Count || 0
    }

    // Collect all aliases
    const allAliases = new Set<string>()
    for (const source of sourceEntities) {
      allAliases.add(source.name)
      for (const alias of source.aliases || []) {
        allAliases.add(alias)
      }
    }

    return NextResponse.json({
      target: {
        id: targetEntity.entity_id,
        name: targetEntity.name,
        type: targetEntity.entity_type,
        metadata: targetEntity.metadata,
      },
      sources: sourceEntities.map((e) => ({
        id: e.entity_id,
        name: e.name,
        type: e.entity_type,
        aliases: e.aliases || [],
      })),
      preview: {
        aliasesToAdd: Array.from(allAliases),
        relationshipsToUpdate: totalRelationships,
        entitiesToMerge: sourceEntities.length,
      },
    })
  } catch (error) {
    console.error('Merge preview error:', error)
    return NextResponse.json(
      { error: 'Failed to preview merge', details: String(error) },
      { status: 500 }
    )
  }
}

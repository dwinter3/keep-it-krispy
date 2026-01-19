import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { generateEntityId, canonicalizeName } from '@/lib/entities'
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

interface SplitRequest {
  sourceId: string // Entity ID to split FROM
  newEntityName: string // Name for the new entity
  relationshipIds: string[] // Relationship IDs to move to new entity
  copyMetadata?: boolean // If true, copy metadata from source
}

interface SplitResult {
  success: boolean
  sourceId: string
  newEntityId: string
  newEntityName: string
  relationshipsMoved: number
}

/**
 * POST /api/entities/split
 *
 * Split an entity into two by moving selected relationships to a new entity.
 * Use case: Two different people were incorrectly treated as one.
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
    const body: SplitRequest = await request.json()
    const { sourceId, newEntityName, relationshipIds, copyMetadata = true } = body

    if (!sourceId) {
      return NextResponse.json({ error: 'sourceId required' }, { status: 400 })
    }
    if (!newEntityName || !newEntityName.trim()) {
      return NextResponse.json({ error: 'newEntityName required' }, { status: 400 })
    }
    if (!relationshipIds || relationshipIds.length === 0) {
      return NextResponse.json({ error: 'relationshipIds required' }, { status: 400 })
    }

    // 1. Fetch source entity
    const sourceResult = await dynamodb.send(
      new GetCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: sourceId },
      })
    )
    const sourceEntity = sourceResult.Item as Entity | undefined

    if (!sourceEntity || sourceEntity.user_id !== userId) {
      return NextResponse.json({ error: 'Source entity not found' }, { status: 404 })
    }
    if (sourceEntity.status === 'merged') {
      return NextResponse.json({ error: 'Cannot split a merged entity' }, { status: 400 })
    }

    // 2. Verify all relationships exist and belong to the source entity
    const validRelationships: Relationship[] = []
    for (const relId of relationshipIds) {
      const relResult = await dynamodb.send(
        new GetCommand({
          TableName: RELATIONSHIPS_TABLE,
          Key: { relationship_id: relId },
        })
      )
      const rel = relResult.Item as Relationship | undefined

      if (!rel || rel.user_id !== userId) {
        return NextResponse.json({ error: `Relationship ${relId} not found` }, { status: 404 })
      }
      if (rel.from_entity_id !== sourceId && rel.to_entity_id !== sourceId) {
        return NextResponse.json(
          { error: `Relationship ${relId} does not belong to source entity` },
          { status: 400 }
        )
      }
      validRelationships.push(rel)
    }

    const now = new Date().toISOString()
    const newEntityId = generateEntityId()

    // 3. Create new entity
    const newEntity: Entity = {
      entity_id: newEntityId,
      entity_type: sourceEntity.entity_type,
      user_id: userId,
      name: newEntityName.trim(),
      canonical_name: canonicalizeName(newEntityName),
      status: 'active',
      metadata: copyMetadata ? { ...sourceEntity.metadata } : {},
      created_at: now,
      created_by: userId,
      updated_at: now,
      updated_by: userId,
    }

    await dynamodb.send(
      new PutCommand({
        TableName: ENTITIES_TABLE,
        Item: newEntity,
      })
    )

    // 4. Move relationships to new entity
    let relationshipsMoved = 0
    for (const rel of validRelationships) {
      const updateExpr: string[] = []
      const exprValues: Record<string, unknown> = {}

      if (rel.from_entity_id === sourceId) {
        updateExpr.push('from_entity_id = :newId')
        exprValues[':newId'] = newEntityId
      }
      if (rel.to_entity_id === sourceId) {
        updateExpr.push('to_entity_id = :newId')
        exprValues[':newId'] = newEntityId
      }

      if (updateExpr.length > 0) {
        await dynamodb.send(
          new UpdateCommand({
            TableName: RELATIONSHIPS_TABLE,
            Key: { relationship_id: rel.relationship_id },
            UpdateExpression: `SET ${updateExpr.join(', ')}`,
            ExpressionAttributeValues: exprValues,
          })
        )
        relationshipsMoved++
      }
    }

    // 5. Update source entity to note the split
    const splitHistory = sourceEntity.merged_from || []
    // We don't track split in merged_from, but we could add a split_to field if needed

    await dynamodb.send(
      new UpdateCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: sourceId },
        UpdateExpression: 'SET #updated_at = :updated_at, #updated_by = :updated_by',
        ExpressionAttributeNames: {
          '#updated_at': 'updated_at',
          '#updated_by': 'updated_by',
        },
        ExpressionAttributeValues: {
          ':updated_at': now,
          ':updated_by': userId,
        },
      })
    )

    const result: SplitResult = {
      success: true,
      sourceId,
      newEntityId,
      newEntityName: newEntityName.trim(),
      relationshipsMoved,
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Entity split error:', error)
    return NextResponse.json(
      { error: 'Failed to split entity', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/entities/split?sourceId=xxx
 *
 * Get relationships for an entity that could be split
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
  const sourceId = searchParams.get('sourceId')

  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId required' }, { status: 400 })
  }

  try {
    // Fetch source entity
    const sourceResult = await dynamodb.send(
      new GetCommand({
        TableName: ENTITIES_TABLE,
        Key: { entity_id: sourceId },
      })
    )
    const sourceEntity = sourceResult.Item as Entity | undefined

    if (!sourceEntity || sourceEntity.user_id !== userId) {
      return NextResponse.json({ error: 'Entity not found' }, { status: 404 })
    }

    // Get all relationships for this entity
    const relationships: Array<{
      id: string
      type: string
      direction: 'from' | 'to'
      otherEntityId: string
      otherEntityType: string
      role?: string
    }> = []

    // Relationships where entity is "from"
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
      relationships.push({
        id: rel.relationship_id,
        type: rel.rel_type,
        direction: 'from',
        otherEntityId: rel.to_entity_id,
        otherEntityType: rel.to_entity_type,
        role: rel.role,
      })
    }

    // Relationships where entity is "to"
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
      relationships.push({
        id: rel.relationship_id,
        type: rel.rel_type,
        direction: 'to',
        otherEntityId: rel.from_entity_id,
        otherEntityType: rel.from_entity_type,
        role: rel.role,
      })
    }

    return NextResponse.json({
      entity: {
        id: sourceEntity.entity_id,
        name: sourceEntity.name,
        type: sourceEntity.entity_type,
      },
      relationships,
      totalRelationships: relationships.length,
    })
  } catch (error) {
    console.error('Split preview error:', error)
    return NextResponse.json(
      { error: 'Failed to get split preview', details: String(error) },
      { status: 500 }
    )
  }
}

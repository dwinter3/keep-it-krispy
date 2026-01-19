import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import type { Entity } from '@/lib/entities'

const ENTITIES_TABLE = 'krisp-entities'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface MergeSuggestion {
  entities: Array<{
    id: string
    name: string
    confidence: number
    aliases: string[]
  }>
  similarity: number
  reason: string
}

/**
 * GET /api/entities/suggestions?type=speaker
 *
 * Find potential duplicate entities that could be merged.
 * Uses name similarity and alias matching.
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
  const entityType = searchParams.get('type') || 'speaker'

  try {
    // Get all active entities of this type for the user
    const entities: Entity[] = []
    let lastKey: Record<string, unknown> | undefined

    do {
      const scanCommand = new ScanCommand({
        TableName: ENTITIES_TABLE,
        FilterExpression: 'user_id = :userId AND entity_type = :type AND #status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':type': entityType,
          ':active': 'active',
        },
        ...(lastKey && { ExclusiveStartKey: lastKey }),
      })

      const response = await dynamodb.send(scanCommand)
      if (response.Items) {
        entities.push(...(response.Items as Entity[]))
      }
      lastKey = response.LastEvaluatedKey
    } while (lastKey)

    // Find potential duplicates
    const suggestions: MergeSuggestion[] = []
    const processed = new Set<string>()

    for (let i = 0; i < entities.length; i++) {
      const entity1 = entities[i]
      if (processed.has(entity1.entity_id)) continue

      const similarEntities: Array<{ entity: Entity; similarity: number; reason: string }> = []

      for (let j = i + 1; j < entities.length; j++) {
        const entity2 = entities[j]
        if (processed.has(entity2.entity_id)) continue

        const { similarity, reason } = calculateSimilarity(entity1, entity2)

        if (similarity >= 0.7) {
          similarEntities.push({ entity: entity2, similarity, reason })
        }
      }

      if (similarEntities.length > 0) {
        // Sort by similarity (highest first)
        similarEntities.sort((a, b) => b.similarity - a.similarity)

        const suggestion: MergeSuggestion = {
          entities: [
            {
              id: entity1.entity_id,
              name: entity1.name,
              confidence: entity1.confidence || 0,
              aliases: entity1.aliases || [],
            },
            ...similarEntities.map((s) => ({
              id: s.entity.entity_id,
              name: s.entity.name,
              confidence: s.entity.confidence || 0,
              aliases: s.entity.aliases || [],
            })),
          ],
          similarity: similarEntities[0].similarity,
          reason: similarEntities[0].reason,
        }

        suggestions.push(suggestion)

        // Mark all as processed
        processed.add(entity1.entity_id)
        for (const s of similarEntities) {
          processed.add(s.entity.entity_id)
        }
      }
    }

    // Sort suggestions by similarity (highest first)
    suggestions.sort((a, b) => b.similarity - a.similarity)

    return NextResponse.json({
      entityType,
      totalEntities: entities.length,
      suggestions: suggestions.slice(0, 20), // Limit to top 20
    })
  } catch (error) {
    console.error('Suggestions error:', error)
    return NextResponse.json(
      { error: 'Failed to get suggestions', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Calculate similarity between two entities
 */
function calculateSimilarity(
  entity1: Entity,
  entity2: Entity
): { similarity: number; reason: string } {
  let maxSimilarity = 0
  let reason = ''

  // 1. Exact canonical name match (highest priority)
  if (entity1.canonical_name === entity2.canonical_name) {
    return { similarity: 1.0, reason: 'Exact name match' }
  }

  // 2. Check if one name contains the other (e.g., "John Smith" vs "John")
  const name1 = entity1.canonical_name.toLowerCase()
  const name2 = entity2.canonical_name.toLowerCase()

  if (name1.includes(name2) || name2.includes(name1)) {
    const longer = name1.length > name2.length ? name1 : name2
    const shorter = name1.length > name2.length ? name2 : name1
    const containsSimilarity = shorter.length / longer.length
    if (containsSimilarity > maxSimilarity) {
      maxSimilarity = containsSimilarity
      reason = 'Name contains match'
    }
  }

  // 3. Check alias matches
  const aliases1 = new Set([
    entity1.name.toLowerCase(),
    entity1.canonical_name,
    ...(entity1.aliases || []).map((a) => a.toLowerCase()),
  ])
  const aliases2 = new Set([
    entity2.name.toLowerCase(),
    entity2.canonical_name,
    ...(entity2.aliases || []).map((a) => a.toLowerCase()),
  ])

  for (const alias1 of aliases1) {
    for (const alias2 of aliases2) {
      if (alias1 === alias2) {
        if (0.95 > maxSimilarity) {
          maxSimilarity = 0.95
          reason = 'Alias match'
        }
      }
    }
  }

  // 4. Levenshtein distance for fuzzy matching
  const levenshteinSimilarity = 1 - levenshteinDistance(name1, name2) / Math.max(name1.length, name2.length)
  if (levenshteinSimilarity > maxSimilarity && levenshteinSimilarity >= 0.8) {
    maxSimilarity = levenshteinSimilarity
    reason = 'Similar spelling'
  }

  // 5. Check initials match (e.g., "John Smith" vs "J. Smith" vs "JS")
  const initials1 = getInitials(entity1.name)
  const initials2 = getInitials(entity2.name)
  const lastWord1 = entity1.name.split(' ').pop()?.toLowerCase() || ''
  const lastWord2 = entity2.name.split(' ').pop()?.toLowerCase() || ''

  if (initials1 === initials2 && lastWord1 === lastWord2 && lastWord1.length > 2) {
    if (0.85 > maxSimilarity) {
      maxSimilarity = 0.85
      reason = 'Same initials and last name'
    }
  }

  // 6. First and last name swap check
  const words1 = name1.split(' ')
  const words2 = name2.split(' ')
  if (words1.length === 2 && words2.length === 2) {
    if (words1[0] === words2[1] && words1[1] === words2[0]) {
      if (0.9 > maxSimilarity) {
        maxSimilarity = 0.9
        reason = 'Name order swapped'
      }
    }
  }

  return { similarity: maxSimilarity, reason }
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(str1: string, str2: string): number {
  const m = str1.length
  const n = str2.length
  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0))

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
      }
    }
  }

  return dp[m][n]
}

/**
 * Get initials from a name
 */
function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0]?.toUpperCase() || '')
    .join('')
}

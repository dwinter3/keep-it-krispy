import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

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

interface SpeakerEntity {
  entity_id: string
  name: string
  canonical_name: string
  metadata?: {
    linkedin?: string
    role?: string
    company_name?: string
    bio?: string
    verified?: boolean
  }
  confidence?: number
}

interface SearchResult {
  entity_id: string
  name: string
  company?: string
  role?: string
  linkedin?: string
  verified?: boolean
  confidence?: number
}

/**
 * GET /api/speakers/search?q=john
 *
 * Search for speaker entities by name prefix/fuzzy match.
 * Used for live suggestions when editing speaker names.
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
  const query = searchParams.get('q')?.toLowerCase().trim()

  if (!query || query.length < 2) {
    return NextResponse.json({ suggestions: [] })
  }

  try {
    // Query speaker entities for this user
    // Using scan with filter since DynamoDB doesn't support LIKE queries natively
    // For production scale, consider OpenSearch or DynamoDB Streams to Elasticsearch
    const scanCommand = new ScanCommand({
      TableName: ENTITIES_TABLE,
      FilterExpression:
        'entity_type = :type AND user_id = :userId AND (contains(canonical_name, :query) OR contains(#name, :query))',
      ExpressionAttributeNames: {
        '#name': 'name',
      },
      ExpressionAttributeValues: {
        ':type': 'speaker',
        ':userId': userId,
        ':query': query,
      },
      Limit: 50, // Scan limit (not result limit)
    })

    const response = await dynamodb.send(scanCommand)
    const entities = (response.Items || []) as SpeakerEntity[]

    // Sort by relevance: exact prefix match first, then contains
    const suggestions: SearchResult[] = entities
      .map((entity) => ({
        entity_id: entity.entity_id,
        name: entity.name,
        company: entity.metadata?.company_name,
        role: entity.metadata?.role,
        linkedin: entity.metadata?.linkedin,
        verified: entity.metadata?.verified,
        confidence: entity.confidence,
        // Score for sorting: prefix match = 100, contains = 50
        _score:
          entity.canonical_name.startsWith(query) ||
          entity.name.toLowerCase().startsWith(query)
            ? 100
            : 50,
      }))
      .sort((a, b) => b._score - a._score)
      .slice(0, 10) // Return top 10
      .map(({ _score, ...rest }) => rest) // Remove score from output

    return NextResponse.json({ suggestions })
  } catch (error) {
    console.error('Speaker search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}

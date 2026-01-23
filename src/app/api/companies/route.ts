import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb'
import { authenticateApiRequest } from '@/lib/api-auth'
import type { CompanyEntity, CompanyMetadata } from '@/lib/entities'

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

interface CompanyResponse {
  id: string
  name: string
  type: string
  confidence: number
  mentionCount: number
  firstMentioned?: string
  lastMentioned?: string
  lastMentionedFormatted: string
  employeeCount: number
  website?: string
  description?: string
}

// GET /api/companies - List all companies for the user
export async function GET(request: NextRequest) {
  // Authenticate via session or API key
  const authResult = await authenticateApiRequest(request)
  if (!authResult.authenticated || !authResult.userId) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }
  const userId = authResult.userId

  try {
    // Query company entities for this user using GSI
    const allCompanies: CompanyEntity[] = []
    let lastKey: Record<string, unknown> | undefined

    // Try using user-type-index GSI first
    try {
      const queryCommand = new QueryCommand({
        TableName: ENTITIES_TABLE,
        IndexName: 'user-type-index',
        KeyConditionExpression: 'user_id = :userId AND entity_type = :type',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':type': 'company',
          ':active': 'active',
        },
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allCompanies.push(...(response.Items as CompanyEntity[]))
      }
    } catch {
      // GSI might not exist, fallback to scan
      do {
        const scanCommand = new ScanCommand({
          TableName: ENTITIES_TABLE,
          FilterExpression: 'user_id = :userId AND entity_type = :type AND #status = :active',
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExpressionAttributeValues: {
            ':userId': userId,
            ':type': 'company',
            ':active': 'active',
          },
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        })

        const response = await dynamodb.send(scanCommand)
        if (response.Items) {
          allCompanies.push(...(response.Items as CompanyEntity[]))
        }
        lastKey = response.LastEvaluatedKey
      } while (lastKey)
    }

    // Get employee counts for each company via relationships
    const employeeCounts = new Map<string, number>()
    for (const company of allCompanies) {
      try {
        const relCommand = new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'to-index',
          KeyConditionExpression: 'to_entity_id = :companyId',
          FilterExpression: 'rel_type = :relType AND user_id = :userId',
          ExpressionAttributeValues: {
            ':companyId': company.entity_id,
            ':relType': 'works_at',
            ':userId': userId,
          },
        })
        const relResponse = await dynamodb.send(relCommand)
        employeeCounts.set(company.entity_id, relResponse.Items?.length || 0)
      } catch {
        employeeCounts.set(company.entity_id, 0)
      }
    }

    // Sort by name alphabetically
    allCompanies.sort((a, b) => a.name.localeCompare(b.name))

    // Format companies for response
    const companies: CompanyResponse[] = allCompanies.map((entity) => {
      const metadata = entity.metadata as CompanyMetadata
      return {
        id: entity.entity_id,
        name: entity.name,
        type: metadata?.type || 'other',
        confidence: entity.confidence || 0,
        mentionCount: 0, // TODO: Calculate from relationships
        firstMentioned: entity.created_at,
        lastMentioned: entity.updated_at,
        lastMentionedFormatted: formatLastSeen(entity.updated_at),
        employeeCount: employeeCounts.get(entity.entity_id) || 0,
        website: metadata?.website,
        description: metadata?.description,
      }
    })

    // Group by type for stats
    const typeStats = companies.reduce(
      (acc, company) => {
        const type = company.type || 'other'
        acc[type] = (acc[type] || 0) + 1
        return acc
      },
      {} as Record<string, number>
    )

    return NextResponse.json({
      count: companies.length,
      typeStats,
      companies,
    })
  } catch (error) {
    console.error('Companies API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch companies', details: String(error) },
      { status: 500 }
    )
  }
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

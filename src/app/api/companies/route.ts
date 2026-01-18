import { NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, ScanCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'

const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'krisp-companies'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface CompanyItem {
  id: string
  name: string
  type: 'customer' | 'prospect' | 'partner' | 'vendor' | 'competitor' | 'internal' | 'unknown'
  confidence: number
  mentionCount: number
  firstMentioned: string
  lastMentioned: string
  transcriptMentions?: string[]
  employees?: string[]
}

// GET /api/companies - List all companies
export async function GET() {
  try {
    // Query using the all-companies-index GSI for sorted results by mention count
    const allCompanies: CompanyItem[] = []
    let lastKey: Record<string, unknown> | undefined

    // Try using the GSI first
    try {
      const queryCommand = new QueryCommand({
        TableName: COMPANIES_TABLE,
        IndexName: 'all-companies-index',
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': 'COMPANY' },
        ScanIndexForward: false, // Descending by mentionCount
      })

      const response = await dynamodb.send(queryCommand)
      if (response.Items) {
        allCompanies.push(...(response.Items as CompanyItem[]))
      }
    } catch {
      // GSI might not exist yet, fallback to scan
      do {
        const scanCommand = new ScanCommand({
          TableName: COMPANIES_TABLE,
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        })

        const response = await dynamodb.send(scanCommand)
        if (response.Items) {
          allCompanies.push(...(response.Items as CompanyItem[]))
        }
        lastKey = response.LastEvaluatedKey
      } while (lastKey)

      // Sort by mention count (descending)
      allCompanies.sort((a, b) => (b.mentionCount || 0) - (a.mentionCount || 0))
    }

    // Format companies for response
    const companies = allCompanies.map(company => ({
      id: company.id,
      name: company.name,
      type: company.type || 'unknown',
      confidence: company.confidence || 0,
      mentionCount: company.mentionCount || 0,
      firstMentioned: company.firstMentioned,
      lastMentioned: company.lastMentioned,
      lastMentionedFormatted: formatLastSeen(company.lastMentioned),
      employeeCount: company.employees?.length || 0,
    }))

    // Group by type for stats
    const typeStats = companies.reduce((acc, company) => {
      const type = company.type || 'unknown'
      acc[type] = (acc[type] || 0) + 1
      return acc
    }, {} as Record<string, number>)

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

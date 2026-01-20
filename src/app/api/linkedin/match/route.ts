import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const TABLE_NAME = 'krisp-linkedin-connections'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * Normalize a name for fuzzy matching
 */
function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculate similarity between two strings (simple Levenshtein-based)
 */
function similarity(s1: string, s2: string): number {
  if (s1 === s2) return 100

  const longer = s1.length > s2.length ? s1 : s2
  const shorter = s1.length > s2.length ? s2 : s1

  if (longer.length === 0) return 100

  // Check if shorter is contained in longer
  if (longer.includes(shorter)) {
    return Math.round((shorter.length / longer.length) * 100)
  }

  // Simple word overlap scoring
  const words1 = s1.split(' ')
  const words2 = s2.split(' ')
  const matchingWords = words1.filter(w => words2.includes(w)).length
  const totalWords = Math.max(words1.length, words2.length)

  return Math.round((matchingWords / totalWords) * 100)
}

interface LinkedInMatch {
  email: string
  firstName: string
  lastName: string
  fullName: string
  company: string
  position: string
  connectedOn: string
  confidence: number
  matchReason: string
}

/**
 * GET /api/linkedin/match
 *
 * Find LinkedIn connections matching a speaker name.
 *
 * Query params:
 * - name: Speaker name to match (required)
 * - context: Optional context from transcript to improve matching
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

  const { searchParams } = new URL(request.url)
  const name = searchParams.get('name')
  const context = searchParams.get('context')?.toLowerCase()

  if (!name) {
    return NextResponse.json({ error: 'Name parameter required' }, { status: 400 })
  }

  const normalizedSearch = normalizeName(name)
  const searchWords = normalizedSearch.split(' ').filter(w => w.length > 1)

  try {
    const matches: LinkedInMatch[] = []

    // Strategy 1: Exact prefix match on normalized name
    const exactCommand = new QueryCommand({
      TableName: TABLE_NAME,
      IndexName: 'name-index',
      KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
      ExpressionAttributeValues: {
        ':userId': user.user_id,
        ':search': normalizedSearch,
      },
      Limit: 10,
    })
    const exactResult = await dynamodb.send(exactCommand)

    for (const item of exactResult.Items || []) {
      if (item.email === '_metadata') continue

      const fullNameNorm = normalizeName(item.full_name as string)
      const confidence = similarity(normalizedSearch, fullNameNorm)

      matches.push({
        email: item.email as string,
        firstName: item.first_name as string,
        lastName: item.last_name as string,
        fullName: item.full_name as string,
        company: item.company as string,
        position: item.position as string,
        connectedOn: item.connected_on as string,
        confidence,
        matchReason: `Name match: "${name}" → "${item.full_name}"`,
      })
    }

    // Strategy 2: Search by first name only if we have a single word
    if (searchWords.length === 1 && matches.length < 5) {
      const firstNameCommand = new QueryCommand({
        TableName: TABLE_NAME,
        IndexName: 'name-index',
        KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
        ExpressionAttributeValues: {
          ':userId': user.user_id,
          ':search': searchWords[0],
        },
        Limit: 20,
      })
      const firstNameResult = await dynamodb.send(firstNameCommand)

      for (const item of firstNameResult.Items || []) {
        if (item.email === '_metadata') continue

        // Skip if already in matches
        if (matches.some(m => m.email === item.email)) continue

        const firstName = normalizeName(item.first_name as string)
        if (firstName === searchWords[0] || firstName.startsWith(searchWords[0])) {
          let confidence = 70 // Base confidence for first name match

          // Boost confidence if context matches company
          if (context && item.company) {
            const companyNorm = normalizeName(item.company as string)
            if (context.includes(companyNorm) || companyNorm.split(' ').some(w => context.includes(w))) {
              confidence += 20
            }
          }

          matches.push({
            email: item.email as string,
            firstName: item.first_name as string,
            lastName: item.last_name as string,
            fullName: item.full_name as string,
            company: item.company as string,
            position: item.position as string,
            connectedOn: item.connected_on as string,
            confidence,
            matchReason: `First name match: "${name}" → "${item.first_name}"${confidence > 70 ? ' (company context boost)' : ''}`,
          })
        }
      }
    }

    // Sort by confidence descending
    matches.sort((a, b) => b.confidence - a.confidence)

    // Deduplicate and limit
    const uniqueMatches = matches.slice(0, 5)

    return NextResponse.json({
      query: name,
      matches: uniqueMatches,
      bestMatch: uniqueMatches.length > 0 && uniqueMatches[0].confidence >= 80
        ? uniqueMatches[0]
        : null,
    })
  } catch (error) {
    console.error('LinkedIn match error:', error)
    return NextResponse.json(
      { error: 'Failed to match LinkedIn connections', details: String(error) },
      { status: 500 }
    )
  }
}

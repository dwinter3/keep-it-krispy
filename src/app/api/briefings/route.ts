import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { authenticateApiRequest } from '@/lib/api-auth'

const BRIEFINGS_TABLE = process.env.BRIEFINGS_TABLE || 'krisp-briefings'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const LAMBDA_FUNCTION_NAME = process.env.BRIEFING_LAMBDA_NAME || 'krisp-buddy-morning-briefing'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)
const lambdaClient = new LambdaClient({ region: AWS_REGION, credentials })

interface ActionItem {
  text: string
  meeting: string
  assignee?: string
}

interface CrossReference {
  topic: string
  meetings: string[]
}

interface MeetingSummary {
  title: string
  summary: string
}

interface HistoricalCorrelation {
  topic: string
  meetings: string[]
  insight: string
}

interface BriefingSummary {
  narrative?: string
  meeting_count: number
  total_duration_minutes?: number
  key_themes: string[]
  action_items: ActionItem[]
  cross_references: CrossReference[]
  meeting_summaries: MeetingSummary[]
  historical_correlations?: HistoricalCorrelation[]
}

interface Briefing {
  briefing_id: string
  user_id: string
  date: string
  generated_at: string
  summary: BriefingSummary
}

/**
 * GET /api/briefings
 * Retrieve user's briefings with optional date filter
 */
export async function GET(request: NextRequest) {
  const authResult = await authenticateApiRequest(request)
  if (!authResult.authenticated || !authResult.userId) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }
  const userId = authResult.userId

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const limit = Math.min(parseInt(searchParams.get('limit') || '30'), 100)

  try {
    const queryParams: QueryCommandInput = {
      TableName: BRIEFINGS_TABLE,
      IndexName: 'user-date-index',
      KeyConditionExpression: date
        ? 'user_id = :userId AND #date = :date'
        : 'user_id = :userId',
      ExpressionAttributeValues: date
        ? { ':userId': userId, ':date': date }
        : { ':userId': userId },
      ...(date && { ExpressionAttributeNames: { '#date': 'date' } }),
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    }

    const response = await dynamodb.send(new QueryCommand(queryParams))
    const briefings = response.Items || []

    return NextResponse.json({ briefings })
  } catch (error) {
    console.error('Error fetching briefings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch briefings', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/briefings
 * Manually trigger briefing generation for a specific date
 *
 * Invokes the morning-briefing Lambda function which handles:
 * - Fetching transcripts from S3
 * - Fetching 2 weeks of historical context
 * - Generating narrative briefing via Claude Sonnet 4.5
 * - Storing the briefing in DynamoDB
 */
export async function POST(request: NextRequest) {
  const authResult = await authenticateApiRequest(request)
  if (!authResult.authenticated || !authResult.userId) {
    return NextResponse.json({ error: authResult.error || 'Unauthorized' }, { status: 401 })
  }
  const userId = authResult.userId

  let targetDate: string
  let forceRegenerate = false

  try {
    const body = await request.json()
    targetDate = body.date || getYesterdayDate()
    forceRegenerate = body.forceRegenerate || false
  } catch {
    targetDate = getYesterdayDate()
  }

  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 })
  }

  try {
    // Check if briefing already exists for this date
    const existingResponse = await dynamodb.send(new QueryCommand({
      TableName: BRIEFINGS_TABLE,
      IndexName: 'user-date-index',
      KeyConditionExpression: 'user_id = :userId AND #date = :date',
      ExpressionAttributeNames: { '#date': 'date' },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':date': targetDate,
      },
      Limit: 1,
    }))

    const existingBriefings = existingResponse.Items || []

    // Return cached briefing unless force regeneration or the briefing failed
    if (existingBriefings.length > 0 && !forceRegenerate) {
      const existingBriefing = existingBriefings[0] as Briefing
      // Check if the briefing has a proper narrative (not a fallback message)
      const hasValidNarrative = existingBriefing.summary?.narrative &&
        !existingBriefing.summary.narrative.startsWith('Unable to generate')

      if (hasValidNarrative) {
        return NextResponse.json({
          cached: true,
          briefing: existingBriefing,
        })
      }
      // If narrative failed, regenerate
      console.log('Existing briefing has no valid narrative, regenerating...')
    }

    // Invoke the morning briefing Lambda to generate the briefing
    console.log(`Invoking Lambda ${LAMBDA_FUNCTION_NAME} for user ${userId} date ${targetDate}`)

    const invokeCommand = new InvokeCommand({
      FunctionName: LAMBDA_FUNCTION_NAME,
      InvocationType: 'RequestResponse',
      Payload: new TextEncoder().encode(JSON.stringify({
        body: JSON.stringify({
          user_id: userId,
          date: targetDate,
        })
      }))
    })

    const lambdaResponse = await lambdaClient.send(invokeCommand)

    if (lambdaResponse.FunctionError) {
      console.error('Lambda function error:', lambdaResponse.FunctionError)
      const errorPayload = lambdaResponse.Payload
        ? JSON.parse(new TextDecoder().decode(lambdaResponse.Payload))
        : {}
      throw new Error(`Lambda error: ${errorPayload.errorMessage || lambdaResponse.FunctionError}`)
    }

    if (!lambdaResponse.Payload) {
      throw new Error('No response from Lambda function')
    }

    const lambdaResult = JSON.parse(new TextDecoder().decode(lambdaResponse.Payload))

    // Lambda returns { statusCode, headers, body } format
    if (lambdaResult.statusCode !== 200) {
      const errorBody = typeof lambdaResult.body === 'string'
        ? JSON.parse(lambdaResult.body)
        : lambdaResult.body
      throw new Error(errorBody.error || errorBody.message || 'Lambda returned error status')
    }

    const briefingResult = typeof lambdaResult.body === 'string'
      ? JSON.parse(lambdaResult.body)
      : lambdaResult.body

    // Check if we got a briefing or just a message (no transcripts)
    if (briefingResult.message && !briefingResult.briefing_id) {
      return NextResponse.json({
        cached: false,
        briefing: null,
        message: briefingResult.message,
      })
    }

    return NextResponse.json({
      cached: false,
      briefing: briefingResult as Briefing,
    })
  } catch (error) {
    console.error('Error generating briefing:', error)
    console.error('Error stack:', error instanceof Error ? error.stack : 'no stack')
    return NextResponse.json(
      { error: 'Failed to generate briefing', details: String(error) },
      { status: 500 }
    )
  }
}

function getYesterdayDate(): string {
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  return yesterday.toISOString().split('T')[0]
}

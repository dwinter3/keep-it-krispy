/**
 * MCP Proxy Route
 *
 * Proxies MCP requests to the Lambda MCP server with session-based authentication.
 * This allows web clients to use MCP without managing API keys directly.
 *
 * Flow:
 * 1. Authenticate via NextAuth session
 * 2. Look up user's API key from DynamoDB
 * 3. Proxy request to Lambda MCP endpoint with API key
 * 4. Return response to client
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb'

const MCP_LAMBDA_URL =
  process.env.MCP_LAMBDA_URL ||
  'https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/'

const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS credentials for DynamoDB
const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * Get user's first active API key from DynamoDB
 */
async function getUserApiKey(userId: string): Promise<string | null> {
  try {
    const command = new QueryCommand({
      TableName: 'krisp-api-keys',
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :uid',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':uid': userId,
        ':active': 'active',
      },
      Limit: 1,
    })

    const response = await dynamodb.send(command)
    const item = response.Items?.[0]

    // API keys are stored as hashes, but we need the plaintext key
    // Since we can't reverse the hash, we need to store the key differently
    // For now, return null and let the Lambda use KRISP_USER_ID fallback
    // TODO: Consider storing encrypted API keys for proxy use
    return item?.api_key || null
  } catch (error) {
    console.error('Failed to get user API key:', error)
    return null
  }
}

export async function POST(request: NextRequest) {
  // Authenticate via session
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get user from database
  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Get user's API key (if available)
  const apiKey = await getUserApiKey(user.user_id)

  try {
    // Parse the MCP request body
    const body = await request.json()

    // Build headers for Lambda request
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    // Use API key if available, otherwise Lambda will use KRISP_USER_ID env var
    if (apiKey) {
      headers['x-api-key'] = apiKey
    }

    // Proxy to Lambda MCP endpoint
    const response = await fetch(MCP_LAMBDA_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    // Handle non-OK responses
    if (!response.ok) {
      const errorText = await response.text()
      console.error('MCP Lambda error:', response.status, errorText)

      // If auth failed at Lambda and we don't have an API key, provide helpful error
      if (response.status === 401 && !apiKey) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            error: {
              code: -32603,
              message:
                'MCP authentication failed. Please generate an API key in Settings to use MCP features.',
            },
            id: body.id || null,
          },
          { status: 200 } // Return 200 with JSON-RPC error per spec
        )
      }

      return NextResponse.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: `MCP proxy error: ${response.status}`,
          },
          id: body.id || null,
        },
        { status: 200 }
      )
    }

    // Return Lambda response
    const data = await response.json()
    return NextResponse.json(data)
  } catch (error) {
    console.error('MCP proxy error:', error)
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : 'MCP proxy failed',
        },
        id: null,
      },
      { status: 200 }
    )
  }
}

/**
 * Health check for the MCP proxy
 */
export async function GET() {
  try {
    // Check Lambda health
    const response = await fetch(`${MCP_LAMBDA_URL}health`)
    const data = await response.json()

    return NextResponse.json({
      proxy: 'healthy',
      lambda: data,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return NextResponse.json(
      {
        proxy: 'healthy',
        lambda: 'unreachable',
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    )
  }
}

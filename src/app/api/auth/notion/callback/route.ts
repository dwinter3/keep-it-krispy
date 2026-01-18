import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID
const NOTION_CLIENT_SECRET = process.env.NOTION_CLIENT_SECRET
const NOTION_REDIRECT_URI = process.env.NOTION_REDIRECT_URI || ''
const USERS_TABLE = 'krisp-users'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials
const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface NotionTokenResponse {
  access_token: string
  token_type: string
  bot_id: string
  workspace_id: string
  workspace_name?: string
  workspace_icon?: string
  owner: {
    type: string
    user?: {
      id: string
      name?: string
      avatar_url?: string
      type: string
      person?: { email?: string }
    }
  }
  duplicated_template_id?: string
}

/**
 * GET /api/auth/notion/callback
 *
 * Handles the OAuth callback from Notion after user authorization
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.redirect(new URL('/login?error=unauthorized', request.url))
    }

    const { searchParams } = new URL(request.url)
    const code = searchParams.get('code')
    const error = searchParams.get('error')
    const state = searchParams.get('state')

    // Handle errors from Notion
    if (error) {
      console.error('[Notion OAuth] Error from Notion:', error)
      return NextResponse.redirect(
        new URL(`/settings?error=notion_auth_failed&details=${encodeURIComponent(error)}`, request.url)
      )
    }

    if (!code) {
      return NextResponse.redirect(
        new URL('/settings?error=notion_auth_failed&details=missing_code', request.url)
      )
    }

    // Verify state parameter (CSRF protection)
    if (state) {
      try {
        const stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
        if (stateData.email !== session.user.email) {
          console.error('[Notion OAuth] State email mismatch')
          return NextResponse.redirect(
            new URL('/settings?error=notion_auth_failed&details=invalid_state', request.url)
          )
        }
        // Check state is not too old (15 minutes max)
        if (Date.now() - stateData.timestamp > 15 * 60 * 1000) {
          return NextResponse.redirect(
            new URL('/settings?error=notion_auth_failed&details=state_expired', request.url)
          )
        }
      } catch {
        console.error('[Notion OAuth] Invalid state parameter')
        return NextResponse.redirect(
          new URL('/settings?error=notion_auth_failed&details=invalid_state', request.url)
        )
      }
    }

    if (!NOTION_CLIENT_ID || !NOTION_CLIENT_SECRET) {
      return NextResponse.redirect(
        new URL('/settings?error=notion_auth_failed&details=not_configured', request.url)
      )
    }

    // Exchange code for access token
    const tokenResponse = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${NOTION_CLIENT_ID}:${NOTION_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: NOTION_REDIRECT_URI,
      }),
    })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      console.error('[Notion OAuth] Token exchange failed:', errorData)
      return NextResponse.redirect(
        new URL(`/settings?error=notion_auth_failed&details=token_exchange_failed`, request.url)
      )
    }

    const tokenData = await tokenResponse.json() as NotionTokenResponse

    // Get user from database
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.redirect(
        new URL('/settings?error=notion_auth_failed&details=user_not_found', request.url)
      )
    }

    // Store Notion access token in user record
    const now = new Date().toISOString()
    await dynamodb.send(
      new UpdateCommand({
        TableName: USERS_TABLE,
        Key: { user_id: user.user_id },
        UpdateExpression: `
          SET notion_access_token = :token,
              notion_workspace_id = :workspaceId,
              notion_workspace_name = :workspaceName,
              notion_bot_id = :botId,
              notion_connected_at = :connectedAt,
              updated_at = :now
        `,
        ExpressionAttributeValues: {
          ':token': tokenData.access_token,
          ':workspaceId': tokenData.workspace_id,
          ':workspaceName': tokenData.workspace_name || null,
          ':botId': tokenData.bot_id,
          ':connectedAt': now,
          ':now': now,
        },
      })
    )

    console.log(`[Notion OAuth] Successfully connected Notion for user ${user.user_id}`)

    // Redirect back to settings with success message
    return NextResponse.redirect(
      new URL('/settings?notion=connected', request.url)
    )
  } catch (error) {
    console.error('[Notion OAuth] Callback error:', error)
    return NextResponse.redirect(
      new URL('/settings?error=notion_auth_failed&details=internal_error', request.url)
    )
  }
}

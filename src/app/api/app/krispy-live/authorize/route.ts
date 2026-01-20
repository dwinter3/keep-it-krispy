import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { randomBytes } from 'crypto'

const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const AUTH_CODES_TABLE = process.env.AUTH_CODES_TABLE || 'krisp-app-auth-codes'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * GET /api/app/krispy-live/authorize
 *
 * OAuth authorization endpoint for Krispy Live native app.
 * Requires user to be logged in via NextAuth.
 *
 * Query params:
 * - code_challenge: PKCE code challenge (SHA256 hash of code_verifier, base64url encoded)
 * - state: Random state for CSRF protection
 * - redirect_uri: Optional, defaults to krispylive://oauth
 *
 * Returns:
 * - Redirects to krispylive://oauth?code=...&state=...
 */
export async function GET(request: NextRequest) {
  // Check NextAuth session
  const session = await auth()
  if (!session?.user?.email) {
    // Redirect to login with return URL
    const returnUrl = request.url
    return NextResponse.redirect(
      new URL(`/login?callbackUrl=${encodeURIComponent(returnUrl)}`, request.url)
    )
  }

  // Get user
  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const codeChallenge = searchParams.get('code_challenge')
  const state = searchParams.get('state')
  const redirectUri = searchParams.get('redirect_uri') || 'krispylive://oauth'

  // Validate required params
  if (!codeChallenge) {
    return NextResponse.json(
      { error: 'Missing code_challenge parameter' },
      { status: 400 }
    )
  }

  if (!state) {
    return NextResponse.json(
      { error: 'Missing state parameter' },
      { status: 400 }
    )
  }

  // Validate redirect URI (only allow krispylive:// scheme)
  if (!redirectUri.startsWith('krispylive://')) {
    return NextResponse.json(
      { error: 'Invalid redirect_uri - must use krispylive:// scheme' },
      { status: 400 }
    )
  }

  // Generate authorization code
  const code = randomBytes(32).toString('base64url')

  // Store code in DynamoDB with 5 minute TTL
  const expiresAt = Math.floor(Date.now() / 1000) + 300 // 5 minutes

  try {
    await dynamodb.send(new PutCommand({
      TableName: AUTH_CODES_TABLE,
      Item: {
        code,
        code_challenge: codeChallenge,
        user_id: user.user_id,
        created_at: new Date().toISOString(),
        expires_at: expiresAt, // DynamoDB TTL
        used: false,
      },
    }))
  } catch (error) {
    console.error('Failed to store auth code:', error)
    return NextResponse.json(
      { error: 'Failed to generate authorization code' },
      { status: 500 }
    )
  }

  // Build redirect URL
  const redirectUrl = new URL(redirectUri)
  redirectUrl.searchParams.set('code', code)
  redirectUrl.searchParams.set('state', state)

  // Redirect to native app
  return NextResponse.redirect(redirectUrl.toString())
}

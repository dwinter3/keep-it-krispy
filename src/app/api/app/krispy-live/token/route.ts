import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { SignJWT } from 'jose'
import { createHash } from 'crypto'

const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const AUTH_CODES_TABLE = process.env.AUTH_CODES_TABLE || 'krisp-app-auth-codes'
const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'krispy-live-jwt-secret'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * POST /api/app/krispy-live/token
 *
 * Exchange authorization code for access token (PKCE flow).
 *
 * Body:
 * - code: Authorization code from /authorize
 * - code_verifier: PKCE code verifier (original random string)
 *
 * Returns:
 * - access_token: JWT for authenticating webhook-config requests
 * - token_type: "Bearer"
 * - expires_in: Token lifetime in seconds (3600 = 1 hour)
 */
export async function POST(request: NextRequest) {
  let body: { code?: string; code_verifier?: string }

  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Invalid JSON body' },
      { status: 400 }
    )
  }

  const { code, code_verifier } = body

  // Validate required params
  if (!code) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing code parameter' },
      { status: 400 }
    )
  }

  if (!code_verifier) {
    return NextResponse.json(
      { error: 'invalid_request', error_description: 'Missing code_verifier parameter' },
      { status: 400 }
    )
  }

  // Look up the authorization code
  let authCode: {
    code: string
    code_challenge: string
    user_id: string
    expires_at: number
    used: boolean
  } | undefined

  try {
    const result = await dynamodb.send(new GetCommand({
      TableName: AUTH_CODES_TABLE,
      Key: { code },
    }))
    authCode = result.Item as typeof authCode
  } catch (error) {
    console.error('Failed to lookup auth code:', error)
    return NextResponse.json(
      { error: 'server_error', error_description: 'Failed to validate authorization code' },
      { status: 500 }
    )
  }

  // Validate code exists
  if (!authCode) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Invalid authorization code' },
      { status: 400 }
    )
  }

  // Check if code is expired
  if (authCode.expires_at < Math.floor(Date.now() / 1000)) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Authorization code has expired' },
      { status: 400 }
    )
  }

  // Check if code was already used
  if (authCode.used) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Authorization code has already been used' },
      { status: 400 }
    )
  }

  // Verify PKCE: SHA256(code_verifier) should equal code_challenge
  const computedChallenge = createHash('sha256')
    .update(code_verifier)
    .digest('base64url')

  if (computedChallenge !== authCode.code_challenge) {
    return NextResponse.json(
      { error: 'invalid_grant', error_description: 'Invalid code_verifier' },
      { status: 400 }
    )
  }

  // Mark code as used
  try {
    await dynamodb.send(new UpdateCommand({
      TableName: AUTH_CODES_TABLE,
      Key: { code },
      UpdateExpression: 'SET used = :used',
      ExpressionAttributeValues: { ':used': true },
    }))
  } catch (error) {
    console.error('Failed to mark code as used:', error)
    // Continue anyway - token will still be valid
  }

  // Generate JWT access token
  const expiresIn = 3600 // 1 hour
  const secret = new TextEncoder().encode(JWT_SECRET)

  const accessToken = await new SignJWT({
    sub: authCode.user_id,
    iss: 'keep-it-krispy',
    aud: 'krispy-live',
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${expiresIn}s`)
    .sign(secret)

  return NextResponse.json({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: expiresIn,
  })
}

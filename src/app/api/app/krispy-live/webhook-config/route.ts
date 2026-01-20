import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'
import { createApiKey, listUserApiKeys, getUser } from '@/lib/users'

const JWT_SECRET = process.env.NEXTAUTH_SECRET || 'krispy-live-jwt-secret'
const WEBHOOK_URL = process.env.KRISP_WEBHOOK_URL || 'https://uuv3kmdcsulw2voxcvppbhyul40jfdio.lambda-url.us-east-1.on.aws/'

const KRISPY_LIVE_KEY_NAME = 'Krispy Live'

/**
 * POST /api/app/krispy-live/webhook-config
 *
 * Get webhook configuration for Krispy Live app.
 * Requires JWT access token from /token endpoint.
 *
 * Headers:
 * - Authorization: Bearer <access_token>
 *
 * Returns:
 * - webhook_url: URL to configure in Krisp
 * - header_name: Header name for API key ("X-API-Key")
 * - api_key: API key value (creates new one named "Krispy Live" if needed)
 * - user_id: User's ID
 */
export async function POST(request: NextRequest) {
  // Extract and validate JWT
  const authHeader = request.headers.get('authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing or invalid Authorization header' },
      { status: 401 }
    )
  }

  const token = authHeader.slice(7) // Remove "Bearer " prefix

  let payload: { sub?: string }

  try {
    const secret = new TextEncoder().encode(JWT_SECRET)
    const { payload: verifiedPayload } = await jwtVerify(token, secret, {
      issuer: 'keep-it-krispy',
      audience: 'krispy-live',
    })
    payload = verifiedPayload as { sub?: string }
  } catch (error) {
    console.error('JWT verification failed:', error)
    return NextResponse.json(
      { error: 'Invalid or expired access token' },
      { status: 401 }
    )
  }

  const userId = payload.sub
  if (!userId) {
    return NextResponse.json(
      { error: 'Invalid token: missing user ID' },
      { status: 401 }
    )
  }

  // Verify user exists
  const user = await getUser(userId)
  if (!user) {
    return NextResponse.json(
      { error: 'User not found' },
      { status: 404 }
    )
  }

  // Check for existing "Krispy Live" API key
  let apiKey: string | null = null

  try {
    const existingKeys = await listUserApiKeys(userId)
    const krispyLiveKey = existingKeys.find(k => k.name === KRISPY_LIVE_KEY_NAME)

    if (krispyLiveKey) {
      // Key exists but we can't retrieve the actual key value (it's hashed)
      // We need to create a new one and revoke the old one, or just create a new one
      // For simplicity, create a new key each time (the old one still works)
      // Better UX: tell the user to use the existing key from their dashboard

      // Actually, let's create a new key since we can't retrieve the original
      // The user may have multiple "Krispy Live" keys but that's okay
    }

    // Create new API key for Krispy Live
    const { key } = await createApiKey(userId, KRISPY_LIVE_KEY_NAME)
    apiKey = key
  } catch (error) {
    console.error('Failed to manage API key:', error)
    return NextResponse.json(
      { error: 'Failed to create API key' },
      { status: 500 }
    )
  }

  return NextResponse.json({
    webhook_url: WEBHOOK_URL,
    header_name: 'X-API-Key',
    api_key: apiKey,
    user_id: userId,
  })
}

/**
 * GET /api/app/krispy-live/webhook-config
 *
 * Same as POST but via GET for convenience.
 */
export async function GET(request: NextRequest) {
  return POST(request)
}

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createApiKey, listUserApiKeys, revokeApiKey, getUserByEmail } from '@/lib/users'

/**
 * GET /api/settings/api-keys
 * List user's API keys (without actual key values)
 */
export async function GET() {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    const keys = await listUserApiKeys(user.user_id)
    return NextResponse.json({ keys })
  } catch (error) {
    console.error('Error listing API keys:', error)
    return NextResponse.json({ error: 'Failed to list API keys' }, { status: 500 })
  }
}

/**
 * POST /api/settings/api-keys
 * Create a new API key
 */
export async function POST(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    const body = await request.json()
    const name = body.name || 'Unnamed Key'

    const { key, keyId } = await createApiKey(user.user_id, name)

    return NextResponse.json({
      key, // Show once - user must copy this!
      keyId,
      name,
      message: 'API key created. Copy it now - you won\'t see it again!',
    })
  } catch (error) {
    console.error('Error creating API key:', error)
    return NextResponse.json({ error: 'Failed to create API key' }, { status: 500 })
  }
}

/**
 * DELETE /api/settings/api-keys
 * Revoke an API key
 */
export async function DELETE(request: NextRequest) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const keyId = searchParams.get('keyId')

    if (!keyId) {
      return NextResponse.json({ error: 'keyId required' }, { status: 400 })
    }

    const revoked = await revokeApiKey(keyId, user.user_id)

    if (!revoked) {
      return NextResponse.json({ error: 'Key not found or not owned by user' }, { status: 404 })
    }

    return NextResponse.json({ success: true, message: 'API key revoked' })
  } catch (error) {
    console.error('Error revoking API key:', error)
    return NextResponse.json({ error: 'Failed to revoke API key' }, { status: 500 })
  }
}

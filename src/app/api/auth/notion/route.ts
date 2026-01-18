import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'

const NOTION_CLIENT_ID = process.env.NOTION_CLIENT_ID
const NOTION_REDIRECT_URI = process.env.NOTION_REDIRECT_URI || ''

/**
 * GET /api/auth/notion
 *
 * Initiates Notion OAuth flow by redirecting to Notion's authorization page
 */
export async function GET(request: NextRequest) {
  // Verify user is authenticated
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!NOTION_CLIENT_ID) {
    return NextResponse.json(
      { error: 'Notion OAuth not configured. Set NOTION_CLIENT_ID environment variable.' },
      { status: 500 }
    )
  }

  // Generate state parameter for CSRF protection
  const state = Buffer.from(JSON.stringify({
    email: session.user.email,
    timestamp: Date.now(),
    nonce: Math.random().toString(36).substring(2),
  })).toString('base64url')

  // Build Notion OAuth URL
  // See: https://developers.notion.com/docs/authorization
  const params = new URLSearchParams({
    client_id: NOTION_CLIENT_ID,
    response_type: 'code',
    owner: 'user',
    redirect_uri: NOTION_REDIRECT_URI,
    state,
  })

  const notionAuthUrl = `https://api.notion.com/v1/oauth/authorize?${params.toString()}`

  // Redirect to Notion
  return NextResponse.redirect(notionAuthUrl)
}

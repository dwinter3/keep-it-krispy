import { NextRequest, NextResponse } from 'next/server'
import { refreshAccessToken } from '@/lib/google'

const GOOGLE_TOKEN_COOKIE = 'google-tokens'

/**
 * GET /api/auth/google/status
 * Check if user is connected to Google Drive
 */
export async function GET(request: NextRequest) {
  const tokenCookie = request.cookies.get(GOOGLE_TOKEN_COOKIE)

  if (!tokenCookie) {
    return NextResponse.json({ connected: false })
  }

  try {
    const tokens = JSON.parse(tokenCookie.value)

    // Check if token is expired or will expire soon (within 5 minutes)
    const isExpired = tokens.expires_at < Date.now() + 5 * 60 * 1000

    if (isExpired && tokens.refresh_token) {
      // Try to refresh the token
      try {
        const newTokens = await refreshAccessToken(tokens.refresh_token)
        const expiresAt = Date.now() + (newTokens.expires_in * 1000)

        const tokenData = {
          access_token: newTokens.access_token,
          refresh_token: tokens.refresh_token, // Keep the original refresh token
          expires_at: expiresAt,
        }

        const response = NextResponse.json({ connected: true })
        response.cookies.set(GOOGLE_TOKEN_COOKIE, JSON.stringify(tokenData), {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          maxAge: 60 * 60 * 24 * 30,
          path: '/',
        })

        return response
      } catch {
        // Refresh failed, user needs to re-authenticate
        return NextResponse.json({ connected: false, error: 'token_expired' })
      }
    }

    return NextResponse.json({ connected: true })
  } catch {
    return NextResponse.json({ connected: false })
  }
}

/**
 * DELETE /api/auth/google/status
 * Disconnect from Google Drive
 */
export async function DELETE() {
  const response = NextResponse.json({ success: true })
  response.cookies.delete(GOOGLE_TOKEN_COOKIE)
  return response
}

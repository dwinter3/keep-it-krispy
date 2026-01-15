import { NextRequest, NextResponse } from 'next/server'
import { exchangeCodeForTokens } from '@/lib/google'

const GOOGLE_TOKEN_COOKIE = 'google-tokens'

/**
 * GET /api/auth/google/callback
 * Handles the OAuth callback from Google
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const state = searchParams.get('state')
  const error = searchParams.get('error')

  // Parse state to get redirect URL
  let redirect = '/documents'
  if (state) {
    try {
      const stateData = JSON.parse(Buffer.from(state, 'base64url').toString())
      redirect = stateData.redirect || '/documents'
    } catch {
      // Use default redirect
    }
  }

  // Handle OAuth errors
  if (error) {
    console.error('Google OAuth error:', error)
    const errorUrl = new URL(redirect, request.url)
    errorUrl.searchParams.set('error', error)
    return NextResponse.redirect(errorUrl)
  }

  // Missing authorization code
  if (!code) {
    console.error('Missing authorization code')
    const errorUrl = new URL(redirect, request.url)
    errorUrl.searchParams.set('error', 'missing_code')
    return NextResponse.redirect(errorUrl)
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code)

    // Calculate expiration time
    const expiresAt = Date.now() + (tokens.expires_in * 1000)

    // Store tokens in secure cookie
    const tokenData = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
    }

    const response = NextResponse.redirect(new URL(redirect, request.url))

    response.cookies.set(GOOGLE_TOKEN_COOKIE, JSON.stringify(tokenData), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30 days (refresh token allows re-auth)
      path: '/',
    })

    return response
  } catch (err) {
    console.error('Token exchange failed:', err)
    const errorUrl = new URL(redirect, request.url)
    errorUrl.searchParams.set('error', 'token_exchange_failed')
    return NextResponse.redirect(errorUrl)
  }
}

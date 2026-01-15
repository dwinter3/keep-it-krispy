import { NextRequest, NextResponse } from 'next/server'
import { getAuthUrl } from '@/lib/google'

/**
 * GET /api/auth/google
 * Initiates Google OAuth flow by redirecting to Google's authorization page
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const redirect = searchParams.get('redirect') || '/documents'

  // Generate state to prevent CSRF and preserve redirect
  const state = Buffer.from(JSON.stringify({ redirect })).toString('base64url')

  const authUrl = getAuthUrl(state)

  return NextResponse.redirect(authUrl)
}

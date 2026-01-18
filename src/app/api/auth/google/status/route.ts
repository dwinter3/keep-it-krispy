/**
 * GET /api/auth/google/status - Check Google Drive connection status
 *
 * Returns whether the user has a valid Google OAuth connection with Drive access.
 */

import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

export async function GET() {
  try {
    // Get authenticated user session
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({
        connected: false,
        reason: 'user_not_found',
      })
    }

    // Check if we have an access token (either in session or stored)
    const hasAccessToken = !!(session.accessToken || user.google_access_token)
    const hasRefreshToken = !!(session.refreshToken || user.google_refresh_token)

    // We need at least an access token to be considered connected
    if (!hasAccessToken) {
      return NextResponse.json({
        connected: false,
        reason: 'no_token',
        message: 'Please sign in again to grant Google Drive access',
      })
    }

    // Validate the token by making a simple API call
    const accessToken = session.accessToken || user.google_access_token
    const testResponse = await fetch(
      'https://www.googleapis.com/drive/v3/about?fields=user',
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    )

    if (!testResponse.ok) {
      // Token might be expired
      if (testResponse.status === 401) {
        return NextResponse.json({
          connected: false,
          reason: 'token_expired',
          hasRefreshToken,
          message: hasRefreshToken
            ? 'Token expired, will refresh automatically'
            : 'Please sign in again to refresh your Google Drive access',
        })
      }

      return NextResponse.json({
        connected: false,
        reason: 'api_error',
        message: 'Unable to verify Google Drive access',
      })
    }

    const aboutData = await testResponse.json()

    return NextResponse.json({
      connected: true,
      user: {
        email: aboutData.user?.emailAddress,
        displayName: aboutData.user?.displayName,
      },
    })
  } catch (error) {
    console.error('Google status check error:', error)
    return NextResponse.json(
      { error: 'Failed to check Google connection', details: String(error) },
      { status: 500 }
    )
  }
}

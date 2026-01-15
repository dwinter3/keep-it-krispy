import { NextRequest, NextResponse } from 'next/server'
import {
  listDriveFiles,
  getFileMetadata,
  refreshAccessToken,
  isSupportedFormat,
  getFileTypeName,
} from '@/lib/google'

const GOOGLE_TOKEN_COOKIE = 'google-tokens'

/**
 * Helper to get valid access token (refreshing if needed)
 */
async function getAccessToken(request: NextRequest): Promise<{ token: string; response?: NextResponse } | null> {
  const tokenCookie = request.cookies.get(GOOGLE_TOKEN_COOKIE)

  if (!tokenCookie) {
    return null
  }

  try {
    const tokens = JSON.parse(tokenCookie.value)

    // Check if token is expired or will expire soon (within 5 minutes)
    const isExpired = tokens.expires_at < Date.now() + 5 * 60 * 1000

    if (isExpired && tokens.refresh_token) {
      const newTokens = await refreshAccessToken(tokens.refresh_token)
      const expiresAt = Date.now() + (newTokens.expires_in * 1000)

      const tokenData = {
        access_token: newTokens.access_token,
        refresh_token: tokens.refresh_token,
        expires_at: expiresAt,
      }

      // Create a response to update the cookie
      const response = new NextResponse()
      response.cookies.set(GOOGLE_TOKEN_COOKIE, JSON.stringify(tokenData), {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 60 * 60 * 24 * 30,
        path: '/',
      })

      return { token: newTokens.access_token, response }
    }

    return { token: tokens.access_token }
  } catch {
    return null
  }
}

/**
 * GET /api/drive
 * List files from Google Drive
 *
 * Query params:
 * - folderId: Optional folder ID to list contents of
 * - pageToken: Pagination token
 * - query: Search query
 */
export async function GET(request: NextRequest) {
  const tokenResult = await getAccessToken(request)

  if (!tokenResult) {
    return NextResponse.json(
      { error: 'Not authenticated with Google' },
      { status: 401 }
    )
  }

  const { searchParams } = new URL(request.url)
  const folderId = searchParams.get('folderId') || undefined
  const pageToken = searchParams.get('pageToken') || undefined
  const query = searchParams.get('query') || undefined
  const fileId = searchParams.get('fileId') || undefined

  try {
    // If fileId is provided, get single file metadata
    if (fileId) {
      const file = await getFileMetadata(tokenResult.token, fileId)
      const result = {
        ...file,
        typeName: getFileTypeName(file.mimeType),
        isSupported: isSupportedFormat(file.mimeType),
        isFolder: file.mimeType === 'application/vnd.google-apps.folder',
      }

      const response = NextResponse.json(result)
      if (tokenResult.response) {
        // Copy cookie updates
        for (const cookie of tokenResult.response.cookies.getAll()) {
          response.cookies.set(cookie)
        }
      }
      return response
    }

    // List files
    const driveResponse = await listDriveFiles(tokenResult.token, {
      folderId,
      pageToken,
      query,
      pageSize: 50,
    })

    // Enhance file data with additional info
    const files = driveResponse.files.map(file => ({
      ...file,
      typeName: getFileTypeName(file.mimeType),
      isSupported: isSupportedFormat(file.mimeType),
      isFolder: file.mimeType === 'application/vnd.google-apps.folder',
    }))

    const response = NextResponse.json({
      files,
      nextPageToken: driveResponse.nextPageToken,
    })

    if (tokenResult.response) {
      for (const cookie of tokenResult.response.cookies.getAll()) {
        response.cookies.set(cookie)
      }
    }

    return response
  } catch (error) {
    console.error('Drive API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch from Google Drive', details: String(error) },
      { status: 500 }
    )
  }
}

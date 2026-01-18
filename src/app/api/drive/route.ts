/**
 * GET /api/drive - List files from Google Drive
 *
 * Query parameters:
 * - folderId: Optional folder ID to list contents of (default: root)
 * - pageToken: Optional pagination token for next page
 * - search: Optional search query
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import {
  listDriveFiles,
  searchDriveFiles,
  getFolderPath,
  refreshAccessToken,
  isFolder,
  isGoogleNativeFormat,
  getExtensionForMimeType,
  SUPPORTED_MIME_TYPES,
  FOLDER_MIME_TYPE,
} from '@/lib/google'

export async function GET(request: NextRequest) {
  try {
    // Get authenticated user session
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user from database
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get access token (prefer session, fallback to stored)
    let accessToken = session.accessToken || user.google_access_token
    const refreshToken = session.refreshToken || user.google_refresh_token

    if (!accessToken) {
      return NextResponse.json(
        {
          error: 'Not connected to Google Drive',
          code: 'NO_TOKEN',
          message: 'Please sign in again to grant Google Drive access',
        },
        { status: 401 }
      )
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const folderId = searchParams.get('folderId') || undefined
    const pageToken = searchParams.get('pageToken') || undefined
    const search = searchParams.get('search') || undefined

    // Try to list files, refresh token if needed
    let result
    let retried = false

    while (true) {
      try {
        if (search) {
          result = await searchDriveFiles(accessToken, search, pageToken)
        } else {
          result = await listDriveFiles(accessToken, folderId, pageToken)
        }
        break
      } catch (error) {
        // If unauthorized and we have a refresh token, try to refresh
        if (!retried && refreshToken && String(error).includes('401')) {
          const refreshed = await refreshAccessToken(refreshToken)
          if (refreshed) {
            accessToken = refreshed.accessToken
            retried = true
            continue
          }
        }
        throw error
      }
    }

    // Get folder path for breadcrumbs
    let path: { id: string; name: string }[] = []
    if (folderId && !search) {
      try {
        path = await getFolderPath(accessToken, folderId)
      } catch (error) {
        console.error('Failed to get folder path:', error)
      }
    }

    // Format files for response
    const files = result.files.map((file) => ({
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      isFolder: isFolder(file.mimeType),
      isGoogleFormat: isGoogleNativeFormat(file.mimeType),
      extension: getExtensionForMimeType(file.mimeType),
      size: file.size ? parseInt(file.size, 10) : undefined,
      modifiedTime: file.modifiedTime,
      webViewLink: file.webViewLink,
      iconLink: file.iconLink,
    }))

    return NextResponse.json({
      files,
      path,
      nextPageToken: result.nextPageToken,
      supportedTypes: Object.keys(SUPPORTED_MIME_TYPES),
      folderType: FOLDER_MIME_TYPE,
    })
  } catch (error) {
    console.error('Drive list error:', error)

    // Check if it's a token error
    if (String(error).includes('401') || String(error).includes('invalid_grant')) {
      return NextResponse.json(
        {
          error: 'Google Drive access expired',
          code: 'TOKEN_EXPIRED',
          message: 'Please sign in again to refresh your Google Drive access',
        },
        { status: 401 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to list Drive files', details: String(error) },
      { status: 500 }
    )
  }
}

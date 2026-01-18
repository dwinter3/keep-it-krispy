/**
 * Google Drive API utilities
 *
 * Uses OAuth tokens from the NextAuth session to interact with Google Drive.
 * Supports listing files, navigating folders, and importing documents.
 */

export interface GoogleDriveFile {
  id: string
  name: string
  mimeType: string
  size?: string
  modifiedTime?: string
  parents?: string[]
  webViewLink?: string
  iconLink?: string
}

export interface GoogleDriveListResponse {
  files: GoogleDriveFile[]
  nextPageToken?: string
}

// Google Drive MIME types we support importing
export const SUPPORTED_MIME_TYPES = {
  // Native Google formats (require export)
  'application/vnd.google-apps.document': { exportAs: 'text/plain', extension: 'txt' },
  'application/vnd.google-apps.spreadsheet': { exportAs: 'text/csv', extension: 'csv' },
  // Standard file formats (direct download)
  'application/pdf': { extension: 'pdf' },
  'text/plain': { extension: 'txt' },
  'text/markdown': { extension: 'md' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extension: 'docx' },
  'text/html': { extension: 'html' },
} as const

export type SupportedMimeType = keyof typeof SUPPORTED_MIME_TYPES

// Folder MIME type
export const FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

// Max file size for import (10MB)
export const MAX_IMPORT_SIZE = 10 * 1024 * 1024

/**
 * Check if a MIME type is supported for import
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return mimeType in SUPPORTED_MIME_TYPES || mimeType === FOLDER_MIME_TYPE
}

/**
 * Check if a file is a folder
 */
export function isFolder(mimeType: string): boolean {
  return mimeType === FOLDER_MIME_TYPE
}

/**
 * Check if a MIME type is a Google native format (requires export)
 */
export function isGoogleNativeFormat(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.')
}

/**
 * Get the export MIME type for Google native formats
 */
export function getExportMimeType(mimeType: string): string | null {
  const config = SUPPORTED_MIME_TYPES[mimeType as SupportedMimeType]
  if (config && 'exportAs' in config) {
    return config.exportAs
  }
  return null
}

/**
 * Get the file extension for a MIME type
 */
export function getExtensionForMimeType(mimeType: string): string | null {
  const config = SUPPORTED_MIME_TYPES[mimeType as SupportedMimeType]
  return config?.extension || null
}

/**
 * List files in a Google Drive folder
 */
export async function listDriveFiles(
  accessToken: string,
  folderId?: string,
  pageToken?: string
): Promise<GoogleDriveListResponse> {
  const fields = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,iconLink)'

  // Build query - only show files the user can read, exclude trashed files
  let query = 'trashed=false'

  // Filter by parent folder if specified
  if (folderId) {
    query += ` and '${folderId}' in parents`
  } else {
    // If no folder specified, show root items
    query += ` and 'root' in parents`
  }

  // Only show supported file types and folders
  const mimeTypeFilters = [
    ...Object.keys(SUPPORTED_MIME_TYPES).map(mt => `mimeType='${mt}'`),
    `mimeType='${FOLDER_MIME_TYPE}'`,
  ]
  query += ` and (${mimeTypeFilters.join(' or ')})`

  const params = new URLSearchParams({
    fields,
    q: query,
    orderBy: 'folder,name',
    pageSize: '50',
  })

  if (pageToken) {
    params.append('pageToken', pageToken)
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
    throw new Error(`Google Drive API error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Get file metadata from Google Drive
 */
export async function getDriveFile(
  accessToken: string,
  fileId: string
): Promise<GoogleDriveFile> {
  const fields = 'id,name,mimeType,size,modifiedTime,parents,webViewLink,iconLink'

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=${fields}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
    throw new Error(`Google Drive API error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

/**
 * Download a file from Google Drive
 * Returns the file content as a Buffer
 */
export async function downloadDriveFile(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<{ content: Buffer; filename: string }> {
  // For Google native formats, we need to export
  const exportMimeType = getExportMimeType(mimeType)

  let url: string
  if (exportMimeType) {
    // Export Google Docs/Sheets as text/plain or CSV
    url = `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`
  } else {
    // Direct download for standard files
    url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
    throw new Error(`Google Drive download error: ${error.error?.message || response.statusText}`)
  }

  // Get the file metadata for the filename
  const metadata = await getDriveFile(accessToken, fileId)

  const arrayBuffer = await response.arrayBuffer()
  const content = Buffer.from(arrayBuffer)

  // Check file size
  if (content.length > MAX_IMPORT_SIZE) {
    throw new Error(`File too large. Maximum size is ${MAX_IMPORT_SIZE / 1024 / 1024}MB`)
  }

  // Generate filename with correct extension
  const extension = getExtensionForMimeType(mimeType)
  const baseName = metadata.name.replace(/\.[^/.]+$/, '') // Remove existing extension
  const filename = extension ? `${baseName}.${extension}` : metadata.name

  return { content, filename }
}

/**
 * Refresh an expired access token using the refresh token
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<{ accessToken: string; expiresAt: number } | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET

  if (!clientId || !clientSecret) {
    console.error('Missing Google OAuth credentials')
    return null
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    console.error('Failed to refresh access token:', await response.text())
    return null
  }

  const data = await response.json()

  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in * 1000),
  }
}

/**
 * Get the path (breadcrumb) for a folder
 */
export async function getFolderPath(
  accessToken: string,
  folderId: string
): Promise<{ id: string; name: string }[]> {
  const path: { id: string; name: string }[] = []
  let currentId: string | null = folderId

  // Maximum depth to prevent infinite loops
  const maxDepth = 10
  let depth = 0

  while (currentId && currentId !== 'root' && depth < maxDepth) {
    const file = await getDriveFile(accessToken, currentId)
    path.unshift({ id: file.id, name: file.name })
    currentId = file.parents?.[0] || null
    depth++
  }

  return path
}

/**
 * Search for files in Google Drive
 */
export async function searchDriveFiles(
  accessToken: string,
  searchQuery: string,
  pageToken?: string
): Promise<GoogleDriveListResponse> {
  const fields = 'nextPageToken,files(id,name,mimeType,size,modifiedTime,parents,webViewLink,iconLink)'

  // Escape special characters in search query
  const escapedQuery = searchQuery.replace(/['"\\]/g, '\\$&')

  // Build query - search by name, exclude trashed files
  let query = `name contains '${escapedQuery}' and trashed=false`

  // Only show supported file types and folders
  const mimeTypeFilters = [
    ...Object.keys(SUPPORTED_MIME_TYPES).map(mt => `mimeType='${mt}'`),
    `mimeType='${FOLDER_MIME_TYPE}'`,
  ]
  query += ` and (${mimeTypeFilters.join(' or ')})`

  const params = new URLSearchParams({
    fields,
    q: query,
    orderBy: 'folder,name',
    pageSize: '50',
  })

  if (pageToken) {
    params.append('pageToken', pageToken)
  }

  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: { message: 'Unknown error' } }))
    throw new Error(`Google Drive API error: ${error.error?.message || response.statusText}`)
  }

  return response.json()
}

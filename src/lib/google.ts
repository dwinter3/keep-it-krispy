/**
 * Google OAuth and Drive API client utilities
 */

// OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || ''
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'

// Google API endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_DRIVE_API = 'https://www.googleapis.com/drive/v3'
const GOOGLE_DOCS_EXPORT_API = 'https://www.googleapis.com/drive/v3/files'

// Scopes required for Drive access
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
]

export interface GoogleTokens {
  access_token: string
  refresh_token?: string
  expires_in: number
  token_type: string
  scope: string
}

export interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  parents?: string[]
  webViewLink?: string
  iconLink?: string
}

export interface DriveListResponse {
  files: DriveFile[]
  nextPageToken?: string
}

/**
 * Generate the Google OAuth authorization URL
 */
export function getAuthUrl(state?: string): string {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
  })

  if (state) {
    params.set('state', state)
  }

  return `${GOOGLE_AUTH_URL}?${params.toString()}`
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code',
      redirect_uri: GOOGLE_REDIRECT_URI,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to exchange code: ${error}`)
  }

  return response.json()
}

/**
 * Refresh an access token using a refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<GoogleTokens> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to refresh token: ${error}`)
  }

  return response.json()
}

/**
 * List files from Google Drive
 */
export async function listDriveFiles(
  accessToken: string,
  options: {
    folderId?: string
    pageToken?: string
    pageSize?: number
    query?: string
  } = {}
): Promise<DriveListResponse> {
  const { folderId, pageToken, pageSize = 50, query } = options

  // Build query to exclude trashed files and optionally filter by folder
  const queryParts: string[] = ['trashed = false']

  if (folderId) {
    queryParts.push(`'${folderId}' in parents`)
  }

  if (query) {
    queryParts.push(query)
  }

  const params = new URLSearchParams({
    fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,parents,webViewLink,iconLink)',
    pageSize: String(pageSize),
    q: queryParts.join(' and '),
    orderBy: 'modifiedTime desc',
  })

  if (pageToken) {
    params.set('pageToken', pageToken)
  }

  const response = await fetch(`${GOOGLE_DRIVE_API}/files?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to list files: ${error}`)
  }

  return response.json()
}

/**
 * Get file metadata from Google Drive
 */
export async function getFileMetadata(
  accessToken: string,
  fileId: string
): Promise<DriveFile> {
  const params = new URLSearchParams({
    fields: 'id,name,mimeType,modifiedTime,size,parents,webViewLink,iconLink',
  })

  const response = await fetch(`${GOOGLE_DRIVE_API}/files/${fileId}?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to get file: ${error}`)
  }

  return response.json()
}

/**
 * Export Google Docs/Sheets/Slides to text format
 */
export async function exportGoogleDoc(
  accessToken: string,
  fileId: string,
  mimeType: string
): Promise<string> {
  // Map Google Workspace MIME types to export formats
  const exportMimeTypes: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
    'application/vnd.google-apps.presentation': 'text/plain',
  }

  const exportMimeType = exportMimeTypes[mimeType]

  if (!exportMimeType) {
    throw new Error(`Cannot export file type: ${mimeType}`)
  }

  const response = await fetch(
    `${GOOGLE_DOCS_EXPORT_API}/${fileId}/export?mimeType=${encodeURIComponent(exportMimeType)}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to export document: ${error}`)
  }

  return response.text()
}

/**
 * Download binary file content from Google Drive
 */
export async function downloadFile(
  accessToken: string,
  fileId: string
): Promise<ArrayBuffer> {
  const response = await fetch(
    `${GOOGLE_DRIVE_API}/files/${fileId}?alt=media`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  )

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Failed to download file: ${error}`)
  }

  return response.arrayBuffer()
}

/**
 * Check if a MIME type is a Google Workspace document
 */
export function isGoogleWorkspaceDoc(mimeType: string): boolean {
  return mimeType.startsWith('application/vnd.google-apps.')
}

/**
 * Check if a MIME type is a supported document format
 */
export function isSupportedFormat(mimeType: string): boolean {
  const supportedTypes = [
    // Google Workspace
    'application/vnd.google-apps.document',
    'application/vnd.google-apps.spreadsheet',
    'application/vnd.google-apps.presentation',
    // Native files
    'text/plain',
    'text/markdown',
    'text/csv',
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
  ]

  return supportedTypes.includes(mimeType)
}

/**
 * Get human-readable file type name
 */
export function getFileTypeName(mimeType: string): string {
  const typeNames: Record<string, string> = {
    'application/vnd.google-apps.document': 'Google Doc',
    'application/vnd.google-apps.spreadsheet': 'Google Sheet',
    'application/vnd.google-apps.presentation': 'Google Slides',
    'application/vnd.google-apps.folder': 'Folder',
    'text/plain': 'Text',
    'text/markdown': 'Markdown',
    'text/csv': 'CSV',
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel',
    'application/msword': 'Word (Legacy)',
  }

  return typeNames[mimeType] || 'Unknown'
}

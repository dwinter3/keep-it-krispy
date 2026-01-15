'use client'

import { useState, useEffect, useCallback } from 'react'
import Shell from '@/components/Shell'

interface DriveFile {
  id: string
  name: string
  mimeType: string
  modifiedTime: string
  size?: string
  webViewLink?: string
  iconLink?: string
  typeName: string
  isSupported: boolean
  isFolder: boolean
}

interface ImportedDocument {
  id: string
  name: string
  s3Key: string
  textLength: number
  vectorsStored: number
}

export default function DocumentsPage() {
  const [isConnected, setIsConnected] = useState<boolean | null>(null)
  const [files, setFiles] = useState<DriveFile[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([])
  const [showDriveBrowser, setShowDriveBrowser] = useState(false)
  const [importedDocs, setImportedDocs] = useState<ImportedDocument[]>([])

  // Check connection status on mount
  useEffect(() => {
    checkConnectionStatus()

    // Check for error in URL params (from OAuth callback)
    const params = new URLSearchParams(window.location.search)
    const urlError = params.get('error')
    if (urlError) {
      setError(`Google authentication failed: ${urlError}`)
      // Clean up URL
      window.history.replaceState({}, '', '/documents')
    }
  }, [])

  const checkConnectionStatus = async () => {
    try {
      const response = await fetch('/api/auth/google/status')
      const data = await response.json()
      setIsConnected(data.connected)
    } catch {
      setIsConnected(false)
    }
  }

  const handleConnect = () => {
    window.location.href = '/api/auth/google?redirect=/documents'
  }

  const handleDisconnect = async () => {
    try {
      await fetch('/api/auth/google/status', { method: 'DELETE' })
      setIsConnected(false)
      setFiles([])
      setFolderStack([])
      setShowDriveBrowser(false)
    } catch {
      setError('Failed to disconnect')
    }
  }

  const loadFiles = useCallback(async (folderId?: string) => {
    setLoading(true)
    setError(null)

    try {
      const url = folderId ? `/api/drive?folderId=${folderId}` : '/api/drive'
      const response = await fetch(url)

      if (!response.ok) {
        if (response.status === 401) {
          setIsConnected(false)
          setShowDriveBrowser(false)
          return
        }
        throw new Error('Failed to load files')
      }

      const data = await response.json()
      setFiles(data.files || [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  const openDriveBrowser = () => {
    setShowDriveBrowser(true)
    setFolderStack([])
    loadFiles()
  }

  const navigateToFolder = (folder: DriveFile) => {
    setFolderStack([...folderStack, { id: folder.id, name: folder.name }])
    loadFiles(folder.id)
  }

  const navigateBack = () => {
    const newStack = [...folderStack]
    newStack.pop()
    setFolderStack(newStack)
    const parentId = newStack.length > 0 ? newStack[newStack.length - 1].id : undefined
    loadFiles(parentId)
  }

  const navigateToBreadcrumb = (index: number) => {
    if (index === -1) {
      // Root
      setFolderStack([])
      loadFiles()
    } else {
      const newStack = folderStack.slice(0, index + 1)
      setFolderStack(newStack)
      loadFiles(newStack[newStack.length - 1].id)
    }
  }

  const importFile = async (file: DriveFile) => {
    if (!file.isSupported || file.isFolder) return

    setImporting(file.id)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/drive/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: file.id }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Import failed')
      }

      const data = await response.json()
      setImportedDocs(prev => [...prev, data.document])
      setSuccess(`Imported "${file.name}" successfully (${data.document.vectorsStored} vectors created)`)
    } catch (err) {
      setError(`Failed to import: ${err}`)
    } finally {
      setImporting(null)
    }
  }

  const formatFileSize = (bytes?: string) => {
    if (!bytes) return ''
    const size = parseInt(bytes, 10)
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${(size / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  // File type icon component
  const FileIcon = ({ mimeType, isFolder }: { mimeType: string; isFolder: boolean }) => {
    if (isFolder) {
      return (
        <svg className="w-5 h-5 text-yellow-500" fill="currentColor" viewBox="0 0 20 20">
          <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
        </svg>
      )
    }

    if (mimeType.includes('document') || mimeType.includes('word')) {
      return (
        <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
        </svg>
      )
    }

    if (mimeType.includes('spreadsheet') || mimeType.includes('excel')) {
      return (
        <svg className="w-5 h-5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M5 4a2 2 0 00-2 2v8a2 2 0 002 2h10a2 2 0 002-2V6a2 2 0 00-2-2H5zm0 2h10v8H5V6z" clipRule="evenodd" />
        </svg>
      )
    }

    if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) {
      return (
        <svg className="w-5 h-5 text-orange-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z" clipRule="evenodd" />
        </svg>
      )
    }

    if (mimeType.includes('pdf')) {
      return (
        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
        </svg>
      )
    }

    return (
      <svg className="w-5 h-5 text-zinc-400" fill="currentColor" viewBox="0 0 20 20">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
      </svg>
    )
  }

  return (
    <Shell>
      <div className="max-w-5xl">
        <div className="flex items-center justify-between mb-2">
          <h1 className="text-3xl font-bold">Documents</h1>
          {isConnected && (
            <button
              onClick={handleDisconnect}
              className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Disconnect Google Drive
            </button>
          )}
        </div>
        <p className="text-zinc-400 mb-8">Import documents from Google Drive to your knowledge base</p>

        {/* Error/Success Messages */}
        {error && (
          <div className="mb-4 p-4 bg-red-900/30 border border-red-800 rounded-lg text-red-200">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-4 text-red-400 hover:text-red-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {success && (
          <div className="mb-4 p-4 bg-green-900/30 border border-green-800 rounded-lg text-green-200">
            {success}
            <button
              onClick={() => setSuccess(null)}
              className="ml-4 text-green-400 hover:text-green-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Connection Status Loading */}
        {isConnected === null && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-12 text-center">
            <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto" />
            <p className="mt-4 text-zinc-400">Checking connection status...</p>
          </div>
        )}

        {/* Not Connected State */}
        {isConnected === false && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12 text-center">
            <div className="text-zinc-500 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">Connect Google Drive</h3>
            <p className="text-sm text-zinc-400 mb-6 max-w-md mx-auto">
              Import documents from Google Drive to add to your knowledge base.
              Supports Google Docs, Sheets, Slides, PDFs, and text files.
            </p>
            <button
              onClick={handleConnect}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors inline-flex items-center gap-2"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.545 10.239v3.821h5.445c-.712 2.315-2.647 3.972-5.445 3.972a6.033 6.033 0 110-12.064c1.498 0 2.866.549 3.921 1.453l2.814-2.814A9.969 9.969 0 0012.545 2C7.021 2 2.543 6.477 2.543 12s4.478 10 10.002 10c8.396 0 10.249-7.85 9.426-11.748l-9.426-.013z" />
              </svg>
              Connect with Google
            </button>
          </div>
        )}

        {/* Connected State */}
        {isConnected === true && !showDriveBrowser && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-green-900/30 rounded-full flex items-center justify-center">
                <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium">Google Drive Connected</h3>
                <p className="text-sm text-zinc-400">You can now browse and import files</p>
              </div>
            </div>

            <button
              onClick={openDriveBrowser}
              className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
              </svg>
              Browse Google Drive
            </button>

            {/* Recently Imported */}
            {importedDocs.length > 0 && (
              <div className="mt-8">
                <h4 className="text-sm font-medium text-zinc-400 mb-3">Recently Imported</h4>
                <div className="space-y-2">
                  {importedDocs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg">
                      <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-sm">{doc.name}</span>
                      </div>
                      <span className="text-xs text-zinc-500">{doc.vectorsStored} vectors</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Drive Browser */}
        {isConnected === true && showDriveBrowser && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            {/* Header */}
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDriveBrowser(false)}
                  className="p-1 hover:bg-zinc-800 rounded transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <h3 className="font-medium">Google Drive</h3>
              </div>

              {folderStack.length > 0 && (
                <button
                  onClick={navigateBack}
                  className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>
              )}
            </div>

            {/* Breadcrumb */}
            <div className="px-4 py-2 border-b border-zinc-800/50 text-sm">
              <button
                onClick={() => navigateToBreadcrumb(-1)}
                className="text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                My Drive
              </button>
              {folderStack.map((folder, index) => (
                <span key={folder.id}>
                  <span className="mx-2 text-zinc-600">/</span>
                  <button
                    onClick={() => navigateToBreadcrumb(index)}
                    className="text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </div>

            {/* Loading State */}
            {loading && (
              <div className="p-12 text-center">
                <div className="animate-spin w-8 h-8 border-2 border-zinc-600 border-t-blue-500 rounded-full mx-auto" />
                <p className="mt-4 text-zinc-400">Loading files...</p>
              </div>
            )}

            {/* File List */}
            {!loading && files.length === 0 && (
              <div className="p-12 text-center text-zinc-500">
                <svg className="w-12 h-12 mx-auto mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p>This folder is empty</p>
              </div>
            )}

            {!loading && files.length > 0 && (
              <div className="divide-y divide-zinc-800/50">
                {files.map(file => (
                  <div
                    key={file.id}
                    className={`flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors ${
                      file.isFolder ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => file.isFolder && navigateToFolder(file)}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <FileIcon mimeType={file.mimeType} isFolder={file.isFolder} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate">{file.name}</p>
                        <p className="text-xs text-zinc-500">
                          {file.typeName}
                          {file.size && ` - ${formatFileSize(file.size)}`}
                          {' - '}
                          {formatDate(file.modifiedTime)}
                        </p>
                      </div>
                    </div>

                    {!file.isFolder && (
                      <div className="flex items-center gap-2 ml-4">
                        {file.webViewLink && (
                          <a
                            href={file.webViewLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            className="p-2 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded transition-colors"
                            title="Open in Google Drive"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                          </a>
                        )}

                        {file.isSupported ? (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              importFile(file)
                            }}
                            disabled={importing === file.id}
                            className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                              importing === file.id
                                ? 'bg-zinc-700 text-zinc-400 cursor-not-allowed'
                                : 'bg-blue-600 hover:bg-blue-700 text-white'
                            }`}
                          >
                            {importing === file.id ? (
                              <span className="flex items-center gap-2">
                                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                Importing...
                              </span>
                            ) : (
                              'Import'
                            )}
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 rounded text-sm text-zinc-500 bg-zinc-800">
                            Not supported
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface Document {
  documentId: string
  title: string
  source: 'upload' | 'url' | 'drive'
  sourceUrl?: string
  format: string
  importedAt: string
  wordCount: number
  isPrivate: boolean
}

interface DocumentWithContent extends Document {
  content?: string
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<DocumentWithContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  useEffect(() => {
    fetchDocuments()
  }, [])

  async function fetchDocuments() {
    try {
      const res = await fetch('/api/documents')
      if (!res.ok) throw new Error('Failed to fetch documents')
      const data = await res.json()
      setDocuments(data.documents || [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  async function viewDocument(doc: Document) {
    setSelectedDocument(doc)
    setLoadingContent(true)

    try {
      const res = await fetch(`/api/documents?id=${doc.documentId}`)
      if (!res.ok) throw new Error('Failed to fetch document content')
      const data = await res.json()
      setSelectedDocument({ ...doc, content: data.content })
    } catch (err) {
      console.error('Error loading document:', err)
    } finally {
      setLoadingContent(false)
    }
  }

  async function deleteDocument(documentId: string) {
    try {
      const res = await fetch(`/api/documents?id=${documentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete document')

      // Refresh list
      setDocuments(prev => prev.filter(d => d.documentId !== documentId))
      if (selectedDocument?.documentId === documentId) {
        setSelectedDocument(null)
      }
      setDeleteConfirm(null)
    } catch (err) {
      setError(String(err))
    }
  }

  function formatDate(dateStr: string) {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  function formatRelativeTime(dateStr: string) {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

      if (diffDays === 0) return 'Today'
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      return `${Math.floor(diffDays / 30)} months ago`
    } catch {
      return ''
    }
  }

  function getSourceIcon(source: string) {
    switch (source) {
      case 'url':
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z" />
          </svg>
        )
      case 'drive':
        return (
          <svg className="w-4 h-4" viewBox="0 0 87.3 78" fill="currentColor">
            <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0c0 1.55.4 3.1 1.2 4.5l5.4 9.35z" />
          </svg>
        )
      default:
        return (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
          </svg>
        )
    }
  }

  function getFormatBadgeColor(format: string) {
    switch (format) {
      case 'pdf':
        return 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
      case 'docx':
        return 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'
      case 'html':
        return 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400'
      case 'md':
        return 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
      default:
        return 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-400'
    }
  }

  return (
    <Shell>
      <div className="max-w-6xl">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Documents</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
              Imported documents and files in your knowledge base
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">
              {documents.length} document{documents.length !== 1 ? 's' : ''}
            </span>
            <Link
              href="/upload"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add Document
            </Link>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="ml-3 text-gray-500 dark:text-gray-400">Loading documents...</span>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!loading && documents.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-12 text-center">
            <div className="text-gray-400 dark:text-gray-500 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2 text-gray-900 dark:text-white">No documents yet</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
              Import documents from URLs, upload files, or export from Google Drive to build your knowledge base.
            </p>
            <div className="flex justify-center gap-3">
              <Link
                href="/upload"
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors"
              >
                Upload Files
              </Link>
              <Link
                href="/upload?tab=link"
                className="px-4 py-2 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors"
              >
                Import from URL
              </Link>
            </div>
          </div>
        )}

        {/* Documents list */}
        {!loading && documents.length > 0 && (
          <div className="flex gap-6">
            {/* Document list */}
            <div className={`${selectedDocument ? 'w-1/2' : 'w-full'} transition-all`}>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {documents.map((doc) => (
                    <div
                      key={doc.documentId}
                      onClick={() => viewDocument(doc)}
                      className={`p-4 cursor-pointer transition-colors ${
                        selectedDocument?.documentId === doc.documentId
                          ? 'bg-blue-50 dark:bg-blue-900/20'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-medium text-gray-900 dark:text-white truncate">
                            {doc.title}
                          </h3>
                          <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
                            <span className="flex items-center gap-1">
                              {getSourceIcon(doc.source)}
                              {doc.source === 'url' ? 'Web' : doc.source === 'drive' ? 'Drive' : 'Upload'}
                            </span>
                            <span>{doc.wordCount.toLocaleString()} words</span>
                            <span>{formatRelativeTime(doc.importedAt)}</span>
                          </div>
                          {doc.sourceUrl && (
                            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500 truncate">
                              {doc.sourceUrl}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-xs font-medium uppercase ${getFormatBadgeColor(doc.format)}`}>
                            {doc.format}
                          </span>
                          {doc.isPrivate && (
                            <span className="px-2 py-0.5 rounded text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400">
                              Private
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Document detail panel */}
            {selectedDocument && (
              <div className="w-1/2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sticky top-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex-1 min-w-0">
                      <h2 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
                        {selectedDocument.title}
                      </h2>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(selectedDocument.importedAt)}
                      </p>
                    </div>
                    <button
                      onClick={() => setSelectedDocument(null)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-white p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  {/* Metadata badges */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className={`px-2.5 py-1 rounded-full text-sm ${getFormatBadgeColor(selectedDocument.format)}`}>
                      {selectedDocument.format.toUpperCase()}
                    </span>
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300">
                      {selectedDocument.wordCount.toLocaleString()} words
                    </span>
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      {getSourceIcon(selectedDocument.source)}
                      {selectedDocument.source === 'url' ? 'Web Import' : selectedDocument.source === 'drive' ? 'Google Drive' : 'File Upload'}
                    </span>
                  </div>

                  {/* Source URL */}
                  {selectedDocument.sourceUrl && (
                    <div className="mb-4 p-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                      <a
                        href={selectedDocument.sourceUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-2 truncate"
                      >
                        <svg className="w-4 h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
                          <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
                        </svg>
                        {selectedDocument.sourceUrl}
                      </a>
                    </div>
                  )}

                  {/* Content preview */}
                  {loadingContent && (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                      <span className="ml-3 text-gray-500 dark:text-gray-400">Loading content...</span>
                    </div>
                  )}

                  {!loadingContent && selectedDocument.content && (
                    <div>
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Content</h3>
                      <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-96 overflow-y-auto border border-gray-200 dark:border-gray-600">
                        <p className="text-sm text-gray-600 dark:text-gray-400 whitespace-pre-wrap">
                          {selectedDocument.content}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Delete button */}
                  <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                    {deleteConfirm === selectedDocument.documentId ? (
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500 dark:text-gray-400">Delete this document?</span>
                        <button
                          onClick={() => deleteDocument(selectedDocument.documentId)}
                          className="px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-sm text-white transition-colors"
                        >
                          Yes, Delete
                        </button>
                        <button
                          onClick={() => setDeleteConfirm(null)}
                          className="px-3 py-1 bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 rounded text-sm text-gray-700 dark:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(selectedDocument.documentId)}
                        className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                        </svg>
                        Delete document
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

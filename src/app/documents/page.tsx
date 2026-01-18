'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface Document {
  documentId: string
  title: string
  filename?: string
  fileType?: string
  fileSize?: number
  source: 'upload' | 'url' | 'drive' | 'notion'
  sourceUrl?: string
  format: string
  importedAt: string
  wordCount: number
  isPrivate: boolean
  linkedTranscripts: string[]
  linkedTranscriptCount: number
}

interface DocumentWithContent extends Document {
  content?: string
}

interface Transcript {
  meetingId: string
  title: string
  date: string
  timestamp: string
  topic?: string
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDocument, setSelectedDocument] = useState<DocumentWithContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  // Upload states
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)

  // Link transcript modal states
  const [showLinkModal, setShowLinkModal] = useState(false)
  const [transcriptsForLinking, setTranscriptsForLinking] = useState<Transcript[]>([])
  const [loadingTranscripts, setLoadingTranscripts] = useState(false)
  const [linkingTranscript, setLinkingTranscript] = useState<string | null>(null)

  // Filter state
  const [sourceFilter, setSourceFilter] = useState<'all' | 'upload' | 'url' | 'drive' | 'notion'>('all')

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

  // File upload handler
  const handleFileUpload = useCallback(async (files: FileList | File[]) => {
    if (files.length === 0) return

    setUploading(true)
    setUploadProgress('Uploading...')
    setError(null)

    for (const file of Array.from(files)) {
      try {
        setUploadProgress(`Uploading ${file.name}...`)

        const formData = new FormData()
        formData.append('file', file)

        const res = await fetch('/api/documents', {
          method: 'POST',
          body: formData,
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Upload failed')
        }

        const data = await res.json()
        if (data.duplicate) {
          setUploadProgress(`${file.name} already exists`)
        } else {
          setUploadProgress(`${file.name} uploaded successfully`)
        }
      } catch (err) {
        setError(`Failed to upload ${file.name}: ${String(err)}`)
      }
    }

    setUploading(false)
    setUploadProgress(null)
    fetchDocuments()
  }, [])

  // Drag and drop handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      handleFileUpload(files)
    }
  }, [handleFileUpload])

  // Link transcript functionality
  async function openLinkModal() {
    setShowLinkModal(true)
    setLoadingTranscripts(true)

    try {
      const res = await fetch('/api/transcripts?limit=50')
      if (!res.ok) throw new Error('Failed to fetch transcripts')
      const data = await res.json()
      setTranscriptsForLinking(data.transcripts || [])
    } catch (err) {
      console.error('Error loading transcripts:', err)
    } finally {
      setLoadingTranscripts(false)
    }
  }

  async function linkTranscript(meetingId: string) {
    if (!selectedDocument) return

    setLinkingTranscript(meetingId)
    try {
      const res = await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: selectedDocument.documentId,
          action: 'link',
          meetingId,
        }),
      })

      if (!res.ok) throw new Error('Failed to link transcript')

      const data = await res.json()

      // Update selected document
      setSelectedDocument({
        ...selectedDocument,
        linkedTranscripts: data.linkedTranscripts,
        linkedTranscriptCount: data.linkedTranscripts.length,
      })

      // Update document in list
      setDocuments(prev =>
        prev.map(d =>
          d.documentId === selectedDocument.documentId
            ? { ...d, linkedTranscripts: data.linkedTranscripts, linkedTranscriptCount: data.linkedTranscripts.length }
            : d
        )
      )

      setShowLinkModal(false)
    } catch (err) {
      setError(String(err))
    } finally {
      setLinkingTranscript(null)
    }
  }

  async function unlinkTranscript(meetingId: string) {
    if (!selectedDocument) return

    try {
      const res = await fetch('/api/documents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: selectedDocument.documentId,
          action: 'unlink',
          meetingId,
        }),
      })

      if (!res.ok) throw new Error('Failed to unlink transcript')

      const data = await res.json()

      // Update selected document
      setSelectedDocument({
        ...selectedDocument,
        linkedTranscripts: data.linkedTranscripts,
        linkedTranscriptCount: data.linkedTranscripts.length,
      })

      // Update document in list
      setDocuments(prev =>
        prev.map(d =>
          d.documentId === selectedDocument.documentId
            ? { ...d, linkedTranscripts: data.linkedTranscripts, linkedTranscriptCount: data.linkedTranscripts.length }
            : d
        )
      )
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

  function formatFileSize(bytes?: number) {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
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
      case 'notion':
        return (
          <svg className="w-4 h-4" viewBox="0 0 100 100" fill="currentColor">
            <path d="M6.017 4.313l55.333 -4.087c6.797 -0.583 8.543 -0.19 12.817 2.917l17.663 12.443c2.913 2.14 3.883 2.723 3.883 5.053v68.243c0 4.277 -1.553 6.807 -6.99 7.193L24.467 99.967c-4.08 0.193 -6.023 -0.39 -8.16 -3.113L3.3 79.94c-2.333 -3.113 -3.3 -5.443 -3.3 -8.167V11.113c0 -3.497 1.553 -6.413 6.017 -6.8z" fillRule="evenodd" strokeWidth="2"/>
            <path d="M61.35 0.227l-55.333 4.087C1.553 4.7 0 7.617 0 11.113v60.66c0 2.723 0.967 5.053 3.3 8.167l13.007 16.913c2.137 2.723 4.08 3.307 8.16 3.113l64.257 -3.89c5.433 -0.387 6.99 -2.917 6.99 -7.193V20.64c0 -2.21 -0.873 -2.847 -3.443 -4.733L74.167 3.143c-4.273 -3.107 -6.02 -3.5 -12.817 -2.917zM25.92 19.523c-5.247 0.353 -6.437 0.433 -9.417 -1.99L8.927 11.507c-0.77 -0.78 -0.383 -1.753 1.557 -1.947l53.193 -3.887c4.467 -0.39 6.793 1.167 8.54 2.527l9.123 6.61c0.39 0.197 1.36 1.36 0.193 1.36l-54.933 3.307 -0.68 0.047zM19.803 88.3V30.367c0 -2.53 0.777 -3.697 3.103 -3.893L86 22.78c2.14 -0.193 3.107 1.167 3.107 3.693v57.547c0 2.53 -0.39 4.67 -3.883 4.863l-60.377 3.5c-3.493 0.193 -5.043 -0.97 -5.043 -4.083zm59.6 -54.827c0.387 1.75 0 3.5 -1.75 3.7l-2.91 0.577v42.773c-2.527 1.36 -4.853 2.137 -6.797 2.137 -3.107 0 -3.883 -0.973 -6.21 -3.887l-19.03 -29.94v28.967l6.02 1.363s0 3.5 -4.857 3.5l-13.39 0.777c-0.39 -0.78 0 -2.723 1.357 -3.11l3.497 -0.97v-38.3L30.48 40.667c-0.39 -1.75 0.58 -4.277 3.3 -4.473l14.367 -0.967 19.8 30.327v-26.83l-5.047 -0.58c-0.39 -2.143 1.163 -3.7 3.103 -3.89l13.4 -0.78z" fill="#fff"/>
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
      case 'notion':
        return 'bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900'
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
            <label className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors flex items-center gap-2 cursor-pointer">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Add Document
              <input
                type="file"
                className="hidden"
                multiple
                accept=".pdf,.docx,.doc,.txt,.md"
                onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                disabled={uploading}
              />
            </label>
          </div>
        </div>

        {/* Source filter */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400">Filter:</span>
          <div className="flex flex-wrap gap-2">
            {(['all', 'upload', 'url', 'notion', 'drive'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setSourceFilter(filter)}
                className={`px-3 py-1 text-sm rounded-full transition-colors flex items-center gap-1.5 ${
                  sourceFilter === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                {filter !== 'all' && getSourceIcon(filter)}
                {filter === 'all' ? 'All' : filter === 'url' ? 'Web' : filter === 'notion' ? 'Notion' : filter === 'drive' ? 'Drive' : 'Upload'}
              </button>
            ))}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 text-red-500 hover:text-red-700"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Upload progress */}
        {uploadProgress && (
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-blue-700 dark:text-blue-400 flex items-center gap-3">
            {uploading && (
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
            )}
            {uploadProgress}
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

        {/* Empty state with drag-drop upload */}
        {!loading && documents.length === 0 && (
          <div
            className={`bg-white dark:bg-gray-800 rounded-lg shadow-sm border-2 border-dashed transition-colors p-12 text-center ${
              isDragging
                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                : 'border-gray-300 dark:border-gray-600'
            }`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
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
              Drag and drop files here, or click to upload. Supported formats: PDF, DOCX, TXT, MD
            </p>
            <div className="flex justify-center gap-3">
              <label className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium text-white transition-colors cursor-pointer">
                Upload Files
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept=".pdf,.docx,.doc,.txt,.md"
                  onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
                  disabled={uploading}
                />
              </label>
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
            {/* Document list with drag-drop zone */}
            <div
              className={`${selectedDocument ? 'w-1/2' : 'w-full'} transition-all`}
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {isDragging && (
                <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border-2 border-dashed border-blue-500 rounded-lg text-center text-blue-600 dark:text-blue-400">
                  Drop files here to upload
                </div>
              )}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                <div className="divide-y divide-gray-200 dark:divide-gray-700">
                  {documents
                    .filter((doc) => sourceFilter === 'all' || doc.source === sourceFilter)
                    .map((doc) => (
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
                              {doc.source === 'url' ? 'Web' : doc.source === 'drive' ? 'Drive' : doc.source === 'notion' ? 'Notion' : 'Upload'}
                            </span>
                            <span>{doc.wordCount.toLocaleString()} words</span>
                            {doc.fileSize && <span>{formatFileSize(doc.fileSize)}</span>}
                            <span>{formatRelativeTime(doc.importedAt)}</span>
                          </div>
                          {doc.linkedTranscriptCount > 0 && (
                            <div className="mt-1 flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400">
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                              {doc.linkedTranscriptCount} linked transcript{doc.linkedTranscriptCount !== 1 ? 's' : ''}
                            </div>
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
                    {selectedDocument.fileSize && (
                      <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300">
                        {formatFileSize(selectedDocument.fileSize)}
                      </span>
                    )}
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-sm text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      {getSourceIcon(selectedDocument.source)}
                      {selectedDocument.source === 'url' ? 'Web Import' : selectedDocument.source === 'drive' ? 'Google Drive' : selectedDocument.source === 'notion' ? 'Notion Import' : 'File Upload'}
                    </span>
                  </div>

                  {/* Linked Transcripts Section */}
                  <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                        </svg>
                        Linked Transcripts ({selectedDocument.linkedTranscriptCount})
                      </h3>
                      <button
                        onClick={openLinkModal}
                        className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                        </svg>
                        Link Transcript
                      </button>
                    </div>

                    {selectedDocument.linkedTranscripts.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        No transcripts linked yet. Click "Link Transcript" to associate this document with meeting transcripts.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {selectedDocument.linkedTranscripts.map((meetingId) => (
                          <div
                            key={meetingId}
                            className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600"
                          >
                            <Link
                              href={`/transcripts?id=${meetingId}`}
                              className="text-sm text-blue-600 dark:text-blue-400 hover:underline truncate"
                            >
                              {meetingId}
                            </Link>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                unlinkTranscript(meetingId)
                              }}
                              className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1"
                              title="Unlink transcript"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
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

        {/* Link Transcript Modal */}
        {showLinkModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Link to Transcript</h3>
                <button
                  onClick={() => setShowLinkModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1">
                {loadingTranscripts ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-500 dark:text-gray-400">Loading transcripts...</span>
                  </div>
                ) : transcriptsForLinking.length === 0 ? (
                  <p className="text-center text-gray-500 dark:text-gray-400 py-8">
                    No transcripts available to link
                  </p>
                ) : (
                  <div className="space-y-2">
                    {transcriptsForLinking
                      .filter(t => !selectedDocument?.linkedTranscripts.includes(t.meetingId))
                      .map((transcript) => (
                        <button
                          key={transcript.meetingId}
                          onClick={() => linkTranscript(transcript.meetingId)}
                          disabled={linkingTranscript === transcript.meetingId}
                          className="w-full text-left p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors disabled:opacity-50"
                        >
                          <div className="font-medium text-gray-900 dark:text-white">
                            {transcript.topic || transcript.title || 'Untitled Meeting'}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            {formatDate(transcript.timestamp || transcript.date)}
                          </div>
                          {linkingTranscript === transcript.meetingId && (
                            <div className="mt-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                              Linking...
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

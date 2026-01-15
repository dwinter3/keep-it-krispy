'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface Document {
  documentId: string
  title: string
  fileName: string
  fileType: string
  fileSize: number
  date: string
  timestamp: string
  textLength: number
  chunkCount: number
  s3Key: string
}

export default function DocumentsPage() {
  const [documents, setDocuments] = useState<Document[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchDocuments() {
      try {
        const response = await fetch('/api/upload')
        if (!response.ok) {
          throw new Error('Failed to fetch documents')
        }
        const data = await response.json()
        setDocuments(data.documents || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load documents')
      } finally {
        setLoading(false)
      }
    }

    fetchDocuments()
  }, [])

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    } catch {
      return dateStr
    }
  }

  const getFileTypeColor = (fileType: string): string => {
    switch (fileType) {
      case 'pdf':
        return 'bg-red-500/20 text-red-400'
      case 'docx':
        return 'bg-blue-500/20 text-blue-400'
      case 'txt':
        return 'bg-zinc-500/20 text-zinc-400'
      case 'md':
        return 'bg-purple-500/20 text-purple-400'
      default:
        return 'bg-zinc-500/20 text-zinc-400'
    }
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold mb-2">Documents</h1>
            <p className="text-zinc-400">Imported documents and files</p>
          </div>
          <Link
            href="/upload"
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
          >
            Upload Files
          </Link>
        </div>

        {loading && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-12 text-center">
            <div className="flex justify-center mb-4">
              <svg className="w-8 h-8 text-blue-500 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </div>
            <p className="text-zinc-400">Loading documents...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 text-center">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {!loading && !error && documents.length === 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12 text-center">
            <div className="text-zinc-500 mb-4">
              <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <h3 className="text-lg font-medium mb-2">No documents yet</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Upload PDF, DOCX, TXT, or Markdown files to build your knowledge base.
            </p>
            <Link
              href="/upload"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors"
            >
              Upload Files
            </Link>
          </div>
        )}

        {!loading && !error && documents.length > 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-medium">{documents.length} document{documents.length !== 1 ? 's' : ''}</h3>
            </div>
            <div className="divide-y divide-zinc-800">
              {documents.map(doc => (
                <div key={doc.documentId} className="px-4 py-4 hover:bg-zinc-800/50 transition-colors">
                  <div className="flex items-start gap-4">
                    <div className={`px-2 py-1 rounded text-xs font-medium uppercase ${getFileTypeColor(doc.fileType)}`}>
                      {doc.fileType}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h4 className="font-medium truncate">{doc.title}</h4>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-sm text-zinc-400">
                        <span>{formatDate(doc.date)}</span>
                        <span>{formatFileSize(doc.fileSize)}</span>
                        <span>{(doc.textLength / 1000).toFixed(1)}k characters</span>
                        <span>{doc.chunkCount} chunks</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/search?source=doc_${doc.documentId}`}
                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-xs font-medium transition-colors"
                      >
                        Search
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

'use client'

import { useState } from 'react'
import Shell from '@/components/Shell'

interface ImportResult {
  success: boolean
  documentId: string
  title: string
  url: string
  contentLength: number
  chunksCreated: number
  error?: string
}

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<'files' | 'teams' | 'link'>('files')
  const [url, setUrl] = useState('')
  const [isImporting, setIsImporting] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const handleImportUrl = async () => {
    if (!url.trim()) {
      setImportError('Please enter a URL')
      return
    }

    setIsImporting(true)
    setImportError(null)
    setImportResult(null)

    try {
      const response = await fetch('/api/import-url', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url: url.trim() }),
      })

      const data = await response.json()

      if (!response.ok) {
        setImportError(data.error || 'Import failed')
        return
      }

      setImportResult(data)
      setUrl('') // Clear input on success
    } catch (error) {
      setImportError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setIsImporting(false)
    }
  }

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !isImporting) {
      handleImportUrl()
    }
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Upload</h1>
        <p className="text-zinc-400 mb-8">Import content into your knowledge base</p>

        {/* Tabs */}
        <div className="flex gap-2 mb-6">
          <TabButton active={activeTab === 'files'} onClick={() => setActiveTab('files')}>
            Files
          </TabButton>
          <TabButton active={activeTab === 'teams'} onClick={() => setActiveTab('teams')}>
            Teams/Copilot
          </TabButton>
          <TabButton active={activeTab === 'link'} onClick={() => setActiveTab('link')}>
            Paste Link
          </TabButton>
        </div>

        {/* File Upload */}
        {activeTab === 'files' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12">
            <div className="text-center">
              <div className="text-zinc-500 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium mb-2">Upload Documents</h3>
              <p className="text-sm text-zinc-400 mb-4">
                Drag & drop files or click to browse
              </p>
              <p className="text-xs text-zinc-500 mb-4">
                Supports PDF, DOCX, TXT, MD, and more
              </p>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                Choose Files
              </button>
            </div>
          </div>
        )}

        {/* Teams/Copilot Upload */}
        {activeTab === 'teams' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 border-dashed p-12">
            <div className="text-center">
              <div className="text-zinc-500 mb-4">
                <svg className="w-12 h-12 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              </div>
              <h3 className="text-lg font-medium mb-2">Teams/Copilot Transcripts</h3>
              <p className="text-sm text-zinc-400 mb-4">
                Upload Microsoft Teams meeting transcripts
              </p>
              <p className="text-xs text-zinc-500 mb-4">
                Supports VTT, DOCX, TXT exports from Teams/Copilot
              </p>
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                Upload Transcripts
              </button>
            </div>
          </div>
        )}

        {/* Link Input */}
        {activeTab === 'link' && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <h3 className="text-lg font-medium mb-4">Import from URL</h3>
            <p className="text-sm text-zinc-400 mb-4">
              Paste a link to import web content into your knowledge base. The page will be fetched,
              its main content extracted, and made searchable via semantic search.
            </p>

            <div className="flex gap-3 mb-4">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="https://example.com/article"
                disabled={isImporting}
                className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <button
                onClick={handleImportUrl}
                disabled={isImporting || !url.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-600/50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <LoadingSpinner />
                    Importing...
                  </>
                ) : (
                  'Import'
                )}
              </button>
            </div>

            {/* Error message */}
            {importError && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span>{importError}</span>
                </div>
              </div>
            )}

            {/* Success message */}
            {importResult && importResult.success && (
              <div className="p-4 bg-green-500/10 border border-green-500/30 rounded-lg text-green-400">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <div className="flex-1">
                    <div className="font-medium mb-1">Successfully imported!</div>
                    <div className="text-sm text-green-400/80 space-y-1">
                      <p><span className="text-zinc-400">Title:</span> {importResult.title}</p>
                      <p><span className="text-zinc-400">Content:</span> {importResult.contentLength.toLocaleString()} characters</p>
                      <p><span className="text-zinc-400">Chunks:</span> {importResult.chunksCreated} searchable segments</p>
                      <p><span className="text-zinc-400">ID:</span> <code className="text-xs bg-zinc-800 px-1.5 py-0.5 rounded">{importResult.documentId}</code></p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Help text */}
            <div className="mt-4 text-xs text-zinc-500 space-y-2">
              <p>
                <strong className="text-zinc-400">Supported:</strong> Blog posts, articles, documentation pages, and other text-heavy web content.
              </p>
              <p>
                <strong className="text-zinc-400">Note:</strong> JavaScript-rendered content may not be fully captured. For best results, use pages that load content in the initial HTML.
              </p>
            </div>
          </div>
        )}
      </div>
    </Shell>
  )
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
  )
}

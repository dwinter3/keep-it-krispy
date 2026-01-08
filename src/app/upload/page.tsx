'use client'

import { useState } from 'react'
import Shell from '@/components/Shell'

export default function UploadPage() {
  const [activeTab, setActiveTab] = useState<'files' | 'teams' | 'link'>('files')

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
              Paste a link to crawl and import content using Crawl4AI
            </p>
            <div className="flex gap-3">
              <input
                type="url"
                placeholder="https://example.com/article"
                className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg text-sm font-medium transition-colors">
                Import
              </button>
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

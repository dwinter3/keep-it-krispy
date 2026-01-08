'use client'

import { useState } from 'react'
import Shell from '@/components/Shell'

export default function SearchPage() {
  const [query, setQuery] = useState('')

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Search</h1>
        <p className="text-zinc-400 mb-8">Search across all your transcripts and documents</p>

        <div className="relative mb-8">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search transcripts, speakers, documents..."
            className="w-full px-4 py-3 pl-12 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        {!query && (
          <div className="text-center py-12">
            <p className="text-zinc-500">Enter a query to search across all your content</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <SuggestionChip text="What did Michelle say about sprints?" />
              <SuggestionChip text="Temenos banking" />
              <SuggestionChip text="Action items from today" />
            </div>
          </div>
        )}

        {query && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
            <p className="text-zinc-400 text-sm mb-4">
              Searching for &quot;{query}&quot;...
            </p>
            <p className="text-zinc-500 text-sm">
              Vector search coming soon. This will search across all transcripts, documents, and speaker conversations.
            </p>
          </div>
        )}
      </div>
    </Shell>
  )
}

function SuggestionChip({ text }: { text: string }) {
  return (
    <button className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-full text-sm text-zinc-300 transition-colors">
      {text}
    </button>
  )
}

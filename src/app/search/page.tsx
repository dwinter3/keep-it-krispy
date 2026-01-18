'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Shell from '@/components/Shell'

interface SearchResult {
  meetingId: string
  s3Key: string
  title: string
  date: string
  speakers: string[]
  duration: number
  relevanceScore: number
  matchingChunks: number
  snippets: string[]
  topic?: string
}

interface SearchFilters {
  speaker: string | null
  from: string | null
  to: string | null
}

interface SearchResponse {
  query: string
  searchType: string
  filters: SearchFilters
  count: number
  results: SearchResult[]
}

interface Speaker {
  name: string
  meetingCount: number
}

// Wrapper component to handle Suspense boundary for useSearchParams
export default function SearchPage() {
  return (
    <Suspense fallback={<SearchPageFallback />}>
      <SearchPageContent />
    </Suspense>
  )
}

function SearchPageFallback() {
  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Search</h1>
        <p className="text-zinc-400 mb-8">Semantic search across all your transcripts using AI</p>
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
          <div className="animate-pulse text-zinc-400">Loading search...</div>
        </div>
      </div>
    </Shell>
  )
}

function SearchPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [speakerFilter, setSpeakerFilter] = useState(searchParams.get('speaker') || '')
  const [fromDate, setFromDate] = useState(searchParams.get('from') || '')
  const [toDate, setToDate] = useState(searchParams.get('to') || '')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [activeFilters, setActiveFilters] = useState<SearchFilters>({ speaker: null, from: null, to: null })

  // Fetch speakers for the filter dropdown
  useEffect(() => {
    async function fetchSpeakers() {
      try {
        const res = await fetch('/api/speakers')
        if (res.ok) {
          const data = await res.json()
          setSpeakers(data.speakers || [])
        }
      } catch {
        // Silently fail - speakers dropdown just won't be populated
      }
    }
    fetchSpeakers()
  }, [])

  // Auto-search if URL has query params
  useEffect(() => {
    const q = searchParams.get('q')
    if (q) {
      setQuery(q)
      setSpeakerFilter(searchParams.get('speaker') || '')
      setFromDate(searchParams.get('from') || '')
      setToDate(searchParams.get('to') || '')
      handleSearch(q, searchParams.get('speaker') || '', searchParams.get('from') || '', searchParams.get('to') || '')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSearch(searchQuery?: string, speaker?: string, from?: string, to?: string) {
    const q = searchQuery ?? query
    if (!q.trim()) return

    const spk = speaker ?? speakerFilter
    const fromD = from ?? fromDate
    const toD = to ?? toDate

    setLoading(true)
    setError(null)
    setSearched(true)

    // Update URL with search params
    const params = new URLSearchParams()
    params.set('q', q)
    if (spk) params.set('speaker', spk)
    if (fromD) params.set('from', fromD)
    if (toD) params.set('to', toD)
    router.replace(`/search?${params.toString()}`, { scroll: false })

    try {
      let url = `/api/search?q=${encodeURIComponent(q)}&limit=20`
      if (spk) url += `&speaker=${encodeURIComponent(spk)}`
      if (fromD) url += `&from=${encodeURIComponent(fromD)}`
      if (toD) url += `&to=${encodeURIComponent(toD)}`

      const res = await fetch(url)
      if (!res.ok) throw new Error('Search failed')
      const data: SearchResponse = await res.json()
      setResults(data.results || [])
      setActiveFilters(data.filters)
    } catch (err) {
      setError(String(err))
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleKeyPress(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  function handleSuggestionClick(suggestion: string) {
    setQuery(suggestion)
    handleSearch(suggestion, speakerFilter, fromDate, toDate)
  }

  function clearFilters() {
    setSpeakerFilter('')
    setFromDate('')
    setToDate('')
    if (query) {
      handleSearch(query, '', '', '')
    }
  }

  const hasActiveFilters = speakerFilter || fromDate || toDate

  function formatDate(dateStr: string) {
    try {
      const date = new Date(dateStr)
      // Display in EST timezone
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      })
    } catch {
      return dateStr
    }
  }

  function formatDuration(seconds: number) {
    if (!seconds) return ''
    const mins = Math.floor(seconds / 60)
    if (mins >= 60) {
      const hours = Math.floor(mins / 60)
      const remainingMins = mins % 60
      return `${hours}h ${remainingMins}m`
    }
    return `${mins}m`
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Search</h1>
        <p className="text-zinc-400 mb-8">Semantic search across all your transcripts using AI</p>

        {/* Search input */}
        <div className="relative mb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Search transcripts with natural language..."
            className="w-full px-4 py-3 pl-12 pr-36 bg-zinc-900 border border-zinc-800 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
          <svg
            className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-zinc-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 rounded-lg transition-colors ${showFilters || hasActiveFilters ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
              title="Toggle filters"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
            </button>
            <button
              onClick={() => handleSearch()}
              disabled={loading || !query.trim()}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-sm font-medium transition-colors"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mb-6 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-white">Filters</h3>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  Clear all
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Speaker filter */}
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Speaker</label>
                <select
                  value={speakerFilter}
                  onChange={(e) => setSpeakerFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All speakers</option>
                  {speakers.slice(0, 50).map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name} ({s.meetingCount} meetings)
                    </option>
                  ))}
                </select>
              </div>

              {/* From date */}
              <div>
                <label className="block text-xs text-zinc-500 mb-1">From date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* To date */}
              <div>
                <label className="block text-xs text-zinc-500 mb-1">To date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        )}

        {/* Active filter chips */}
        {hasActiveFilters && !showFilters && (
          <div className="flex flex-wrap gap-2 mb-6">
            {speakerFilter && (
              <FilterChip
                label={`Speaker: ${speakerFilter}`}
                onRemove={() => {
                  setSpeakerFilter('')
                  if (query) handleSearch(query, '', fromDate, toDate)
                }}
              />
            )}
            {fromDate && (
              <FilterChip
                label={`From: ${fromDate}`}
                onRemove={() => {
                  setFromDate('')
                  if (query) handleSearch(query, speakerFilter, '', toDate)
                }}
              />
            )}
            {toDate && (
              <FilterChip
                label={`To: ${toDate}`}
                onRemove={() => {
                  setToDate('')
                  if (query) handleSearch(query, speakerFilter, fromDate, '')
                }}
              />
            )}
          </div>
        )}

        {/* Suggestions when no query */}
        {!query && !searched && (
          <div className="text-center py-8">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-green-500/20 text-green-400 rounded-full text-sm mb-4">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Powered by AI Embeddings
            </div>
            <p className="text-zinc-500 mb-4">Enter a natural language query to search across all your content</p>
            <div className="flex flex-wrap justify-center gap-2">
              <SuggestionChip text="legal tech compliance" onClick={handleSuggestionClick} />
              <SuggestionChip text="project timeline discussion" onClick={handleSuggestionClick} />
              <SuggestionChip text="Temenos banking" onClick={handleSuggestionClick} />
              <SuggestionChip text="AWS partnership" onClick={handleSuggestionClick} />
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400 mb-6">
            {error}
          </div>
        )}

        {/* Loading state */}
        {loading && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
            <div className="animate-pulse text-zinc-400">
              Searching with AI embeddings...
            </div>
          </div>
        )}

        {/* Results */}
        {!loading && searched && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-zinc-400">
                {results.length} result{results.length !== 1 ? 's' : ''} for &quot;{query}&quot;
              </p>
              <span className="text-xs text-zinc-500 px-2 py-1 bg-zinc-800 rounded">
                Semantic Search
              </span>
            </div>

            {results.length === 0 ? (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center text-zinc-400">
                No matching transcripts found. Try a different search query.
              </div>
            ) : (
              <div className="space-y-4">
                {results.map((result) => (
                  <SearchResultCard key={result.meetingId} result={result} formatDate={formatDate} formatDuration={formatDuration} query={query} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

function SuggestionChip({ text, onClick }: { text: string; onClick: (text: string) => void }) {
  return (
    <button
      onClick={() => onClick(text)}
      className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-full text-sm text-zinc-300 transition-colors"
    >
      {text}
    </button>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/20 text-blue-400 rounded-full text-sm">
      {label}
      <button
        onClick={onRemove}
        className="ml-1 hover:text-blue-300"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </span>
  )
}

function SearchResultCard({
  result,
  formatDate,
  formatDuration,
  query,
}: {
  result: SearchResult
  formatDate: (s: string) => string
  formatDuration: (n: number) => string
  query?: string
}) {
  const [expanded, setExpanded] = useState(false)

  // Simple text highlighting function
  function highlightText(text: string, searchTerms: string) {
    if (!searchTerms) return text
    const terms = searchTerms.toLowerCase().split(/\s+/).filter(t => t.length > 2)
    if (terms.length === 0) return text

    // Create a regex pattern to match any of the search terms
    const pattern = new RegExp(`(${terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
    const parts = text.split(pattern)

    return parts.map((part, i) => {
      if (terms.some(term => part.toLowerCase() === term)) {
        return <mark key={i} className="bg-yellow-500/30 text-yellow-200 px-0.5 rounded">{part}</mark>
      }
      return part
    })
  }

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1">
          <h3 className="font-medium text-white mb-1">{result.title}</h3>
          {result.topic && (
            <p className="text-sm text-zinc-400 mb-1 line-clamp-1">{result.topic}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            <span>{formatDate(result.date)}</span>
            {result.duration > 0 && (
              <>
                <span className="text-zinc-600">|</span>
                <span>{formatDuration(result.duration)}</span>
              </>
            )}
            <span className="text-zinc-600">|</span>
            <span>{result.matchingChunks} matching section{result.matchingChunks !== 1 ? 's' : ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            result.relevanceScore >= 80 ? 'bg-green-500/20 text-green-400' :
            result.relevanceScore >= 50 ? 'bg-yellow-500/20 text-yellow-400' :
            'bg-zinc-700 text-zinc-400'
          }`}>
            {result.relevanceScore}% match
          </span>
        </div>
      </div>

      {/* Speakers */}
      {result.speakers.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {result.speakers.map((speaker, i) => (
            <span key={i} className="px-2 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs">
              {speaker}
            </span>
          ))}
        </div>
      )}

      {/* Snippets */}
      {result.snippets.length > 0 && (
        <div className="mt-3">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-zinc-500 hover:text-zinc-300 mb-2 flex items-center gap-1"
          >
            <svg
              className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {expanded ? 'Hide' : 'Show'} matching excerpts
          </button>

          {expanded && (
            <div className="space-y-2">
              {result.snippets.map((snippet, i) => (
                <div key={i} className="bg-zinc-800 rounded p-3 text-xs text-zinc-400 border-l-2 border-blue-500">
                  &quot;{highlightText(snippet.slice(0, 300), query || '')}{snippet.length > 300 ? '...' : ''}&quot;
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View transcript link */}
      <div className="mt-3 pt-3 border-t border-zinc-800">
        <a
          href={`/transcripts?view=${result.meetingId}`}
          className="text-sm text-blue-400 hover:text-blue-300"
        >
          View full transcript →
        </a>
      </div>
    </div>
  )
}

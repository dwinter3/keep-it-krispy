'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface Stats {
  totalTranscripts: number
  totalSpeakers: number
  thisWeek: number
}

interface Transcript {
  key: string
  meetingId: string
  title: string
  date: string
  timestamp: string
  duration: number
  speakers: string[]
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [recentTranscripts, setRecentTranscripts] = useState<Transcript[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch stats and recent transcripts in parallel
        const [statsRes, transcriptsRes] = await Promise.all([
          fetch('/api/transcripts?action=stats'),
          fetch('/api/transcripts'),
        ])

        if (statsRes.ok) {
          const statsData = await statsRes.json()
          setStats(statsData)
        }

        if (transcriptsRes.ok) {
          const transcriptsData = await transcriptsRes.json()
          setRecentTranscripts((transcriptsData.transcripts || []).slice(0, 5))
        }
      } catch (err) {
        console.error('Error fetching dashboard data:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  function formatDate(dateStr: string) {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays < 7) return `${diffDays}d ago`

      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
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
      return `${hours}h ${mins % 60}m`
    }
    return `${mins}m`
  }

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Dashboard</h1>
        <p className="text-zinc-400 mb-8">Your meeting intelligence at a glance</p>

        {/* Stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <StatCard
            title="Transcripts"
            value={loading ? '...' : String(stats?.totalTranscripts || 0)}
            subtitle="Total indexed"
            href="/transcripts"
          />
          <StatCard
            title="Speakers"
            value={loading ? '...' : String(stats?.totalSpeakers || 0)}
            subtitle="Unique contacts"
            href="/speakers"
          />
          <StatCard
            title="Search"
            value="AI"
            subtitle="Semantic search ready"
            href="/search"
            highlight
          />
        </div>

        {/* Recent transcripts */}
        <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Recent Transcripts</h2>
            <Link href="/transcripts" className="text-sm text-blue-400 hover:text-blue-300">
              View all →
            </Link>
          </div>

          {loading ? (
            <div className="animate-pulse text-zinc-500 text-center py-8">
              Loading...
            </div>
          ) : recentTranscripts.length === 0 ? (
            <div className="text-zinc-500 text-center py-8">
              No transcripts yet. They&apos;ll appear here when Krisp sends data.
            </div>
          ) : (
            <div className="space-y-1">
              {recentTranscripts.map((transcript) => (
                <Link
                  key={transcript.key}
                  href={`/transcripts?view=${transcript.meetingId}`}
                  className="flex items-start justify-between py-3 px-3 -mx-3 rounded-lg hover:bg-zinc-800/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-white truncate">
                      {transcript.title || 'Untitled Meeting'}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      {transcript.speakers.length > 0 && (
                        <span className="text-xs text-zinc-500 truncate max-w-[200px]">
                          {transcript.speakers.slice(0, 2).join(', ')}
                          {transcript.speakers.length > 2 && ` +${transcript.speakers.length - 2}`}
                        </span>
                      )}
                      {transcript.duration > 0 && (
                        <>
                          <span className="text-zinc-700">•</span>
                          <span className="text-xs text-zinc-500">
                            {formatDuration(transcript.duration)}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-zinc-500 ml-4 flex-shrink-0">
                    {formatDate(transcript.timestamp || transcript.date)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quick actions */}
        <div className="mt-6 grid grid-cols-2 gap-4">
          <Link
            href="/search"
            className="flex items-center gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-white">Semantic Search</p>
              <p className="text-xs text-zinc-500">Search with AI embeddings</p>
            </div>
          </Link>
          <Link
            href="/transcripts"
            className="flex items-center gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-colors"
          >
            <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-white">All Transcripts</p>
              <p className="text-xs text-zinc-500">Browse your meetings</p>
            </div>
          </Link>
        </div>
      </div>
    </Shell>
  )
}

function StatCard({
  title,
  value,
  subtitle,
  href,
  highlight,
}: {
  title: string
  value: string
  subtitle: string
  href: string
  highlight?: boolean
}) {
  return (
    <Link
      href={href}
      className={`block bg-zinc-900 rounded-xl border p-6 transition-colors ${
        highlight
          ? 'border-green-500/30 hover:border-green-500/50'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <p className="text-sm text-zinc-400 mb-1">{title}</p>
      <p className={`text-3xl font-bold mb-1 ${highlight ? 'text-green-400' : 'text-white'}`}>
        {value}
      </p>
      <p className="text-xs text-zinc-500">{subtitle}</p>
    </Link>
  )
}

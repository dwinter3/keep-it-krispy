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

      // Display in EST timezone with time
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'America/New_York',
        timeZoneName: 'short',
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
      <div className="max-w-6xl">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Your meeting intelligence at a glance</p>
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          <StatCard
            title="Transcripts"
            value={loading ? '...' : String(stats?.totalTranscripts || 0)}
            subtitle="Total indexed"
            href="/transcripts"
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
              </svg>
            }
          />
          <StatCard
            title="Speakers"
            value={loading ? '...' : String(stats?.totalSpeakers || 0)}
            subtitle="Unique contacts"
            href="/speakers"
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
              </svg>
            }
          />
          <StatCard
            title="Search"
            value="AI"
            subtitle="Semantic search ready"
            href="/search"
            highlight
            icon={
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
              </svg>
            }
          />
        </div>

        {/* Recent transcripts */}
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Recent Transcripts</h2>
            <Link href="/transcripts" className="text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-500 dark:hover:text-primary-400">
              View all
            </Link>
          </div>

          <div className="p-6">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                <span className="ml-3 text-gray-500 dark:text-gray-400">Loading...</span>
              </div>
            ) : recentTranscripts.length === 0 ? (
              <div className="text-center py-8">
                <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No transcripts yet</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">They&apos;ll appear here when Krisp sends data</p>
              </div>
            ) : (
              <div className="flow-root">
                <ul className="-my-3 divide-y divide-gray-200 dark:divide-gray-700">
                  {recentTranscripts.map((transcript) => (
                    <li key={transcript.key}>
                      <Link
                        href={`/transcripts?view=${transcript.meetingId}`}
                        className="flex items-center py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 -mx-2 px-2 rounded-lg transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">
                            {transcript.title || 'Untitled Meeting'}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {transcript.speakers.length > 0 && (
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[200px]">
                                {transcript.speakers.slice(0, 2).join(', ')}
                                {transcript.speakers.length > 2 && ` +${transcript.speakers.length - 2}`}
                              </span>
                            )}
                            {transcript.duration > 0 && (
                              <>
                                <span className="text-gray-300 dark:text-gray-600">|</span>
                                <span className="text-xs text-gray-500 dark:text-gray-400">
                                  {formatDuration(transcript.duration)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                        <span className="text-xs text-gray-400 dark:text-gray-500 ml-4 flex-shrink-0">
                          {formatDate(transcript.timestamp || transcript.date)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>

        {/* Quick actions */}
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link
            href="/search"
            className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">Semantic Search</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Search with AI embeddings</p>
            </div>
          </Link>
          <Link
            href="/transcripts"
            className="flex items-center gap-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 hover:border-purple-300 dark:hover:border-purple-700 transition-colors"
          >
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-gray-900 dark:text-white">All Transcripts</p>
              <p className="text-sm text-gray-500 dark:text-gray-400">Browse your meetings</p>
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
  icon,
}: {
  title: string
  value: string
  subtitle: string
  href: string
  highlight?: boolean
  icon?: React.ReactNode
}) {
  return (
    <Link
      href={href}
      className={`block bg-white dark:bg-gray-800 rounded-lg shadow-sm border p-5 transition-colors ${
        highlight
          ? 'border-green-200 dark:border-green-800 hover:border-green-300 dark:hover:border-green-700'
          : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">{title}</p>
          <p className={`text-2xl font-bold ${highlight ? 'text-green-600 dark:text-green-400' : 'text-gray-900 dark:text-white'}`}>
            {value}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{subtitle}</p>
        </div>
        {icon && (
          <div className={`flex h-12 w-12 items-center justify-center rounded-lg ${
            highlight
              ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
          }`}>
            {icon}
          </div>
        )}
      </div>
    </Link>
  )
}

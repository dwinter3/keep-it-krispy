'use client'

import { useEffect, useState, useMemo } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'
import ExpandableSpeakers from '@/components/ExpandableSpeakers'

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface Transcript {
  key: string
  meetingId: string
  title: string
  date: string
  timestamp: string
  duration: number
  speakers: string[]
  eventType: string
  speakerCorrections: Record<string, SpeakerCorrection> | null
  topic?: string | null
  isPrivate?: boolean
  privacyLevel?: 'work' | 'work_with_private' | 'likely_private' | null
  privacyReason?: string | null
  privacyTopics?: string[]
  privacyConfidence?: number | null
  privacyWorkPercent?: number | null
  privacyDismissed?: boolean
}

type DateFilter = 'all' | 'today' | 'week' | 'month'
type SortOption = 'newest' | 'oldest' | 'longest'

interface TranscriptContent {
  raw_payload?: {
    data?: {
      raw_content?: string
      raw_meeting?: string
      meeting?: {
        title?: string
        speakers?: Array<{ first_name?: string; last_name?: string; index?: number }>
      }
    }
  }
  event_type?: string
  received_at?: string
}

export default function TranscriptsPage() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null)
  const [transcriptContent, setTranscriptContent] = useState<TranscriptContent | null>(null)
  const [loadingContent, setLoadingContent] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isUpdatingPrivacy, setIsUpdatingPrivacy] = useState(false)

  // Filter and sort state
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [speakerFilter, setSpeakerFilter] = useState<string>('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')

  useEffect(() => {
    fetchTranscripts()
  }, [])

  async function fetchTranscripts(cursor?: string) {
    try {
      if (cursor) {
        setLoadingMore(true)
      }
      const url = cursor
        ? `/api/transcripts?cursor=${encodeURIComponent(cursor)}`
        : '/api/transcripts'
      const res = await fetch(url)
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      if (cursor) {
        // Append to existing transcripts
        setTranscripts(prev => [...prev, ...(data.transcripts || [])])
      } else {
        // Replace transcripts (initial load)
        setTranscripts(data.transcripts || [])
      }
      setNextCursor(data.nextCursor || null)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }

  async function viewTranscript(transcript: Transcript) {
    setSelectedTranscript(transcript)
    setLoadingContent(true)
    setTranscriptContent(null)
    setShowDeleteConfirm(false)

    try {
      const res = await fetch(`/api/transcripts?key=${encodeURIComponent(transcript.key)}`)
      if (!res.ok) throw new Error('Failed to fetch transcript')
      const data = await res.json()
      setTranscriptContent(data)
    } catch (err) {
      console.error('Error loading transcript:', err)
    } finally {
      setLoadingContent(false)
    }
  }

  async function handleDelete() {
    if (!selectedTranscript) return
    setIsDeleting(true)
    try {
      const res = await fetch(`/api/transcripts/${selectedTranscript.meetingId}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete transcript')

      // Remove from local state
      setTranscripts(prev => prev.filter(t => t.meetingId !== selectedTranscript.meetingId))
      setSelectedTranscript(null)
      setShowDeleteConfirm(false)
    } catch (err) {
      console.error('Error deleting transcript:', err)
      alert('Failed to delete transcript. Please try again.')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handlePrivacyToggle(isPrivate: boolean) {
    if (!selectedTranscript) return
    setIsUpdatingPrivacy(true)
    try {
      const res = await fetch(`/api/transcripts/${selectedTranscript.meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isPrivate }),
      })
      if (!res.ok) throw new Error('Failed to update privacy')

      // Update local state
      setTranscripts(prev => prev.map(t =>
        t.meetingId === selectedTranscript.meetingId
          ? { ...t, isPrivate }
          : t
      ))
      setSelectedTranscript(prev => prev ? { ...prev, isPrivate } : null)

      // If marking as private, remove from main view
      if (isPrivate) {
        setTranscripts(prev => prev.filter(t => t.meetingId !== selectedTranscript.meetingId))
        setSelectedTranscript(null)
      }
    } catch (err) {
      console.error('Error updating privacy:', err)
      alert('Failed to update privacy setting. Please try again.')
    } finally {
      setIsUpdatingPrivacy(false)
    }
  }

  async function handleDismissPrivacyWarning() {
    if (!selectedTranscript) return
    try {
      const res = await fetch(`/api/transcripts/${selectedTranscript.meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privacyDismissed: true }),
      })
      if (!res.ok) throw new Error('Failed to dismiss warning')

      // Update local state
      setTranscripts(prev => prev.map(t =>
        t.meetingId === selectedTranscript.meetingId
          ? { ...t, privacyDismissed: true }
          : t
      ))
      setSelectedTranscript(prev => prev ? { ...prev, privacyDismissed: true } : null)
    } catch (err) {
      console.error('Error dismissing warning:', err)
    }
  }

  function formatDate(dateStr: string, includeTime = false) {
    try {
      const date = new Date(dateStr)
      // Display in EST timezone
      const options: Intl.DateTimeFormatOptions = {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      }
      if (includeTime) {
        options.hour = 'numeric'
        options.minute = '2-digit'
        options.timeZoneName = 'short'
      }
      return date.toLocaleDateString('en-US', options)
    } catch {
      return dateStr
    }
  }

  function formatTime(dateStr: string) {
    try {
      const date = new Date(dateStr)
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
      })
    } catch {
      return ''
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
    return `${mins} min`
  }

  function formatDurationLong(seconds: number) {
    if (!seconds) return '-'
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins >= 60) {
      const hours = Math.floor(mins / 60)
      const remainingMins = mins % 60
      return `${hours}h ${remainingMins}m`
    }
    return `${mins}m ${secs}s`
  }

  function formatRelativeTime(dateStr: string) {
    try {
      const date = new Date(dateStr)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)
      const diffHours = Math.floor(diffMins / 60)
      const diffDays = Math.floor(diffHours / 24)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffHours < 24) return `${diffHours}h ago`
      if (diffDays === 1) return 'Yesterday'
      if (diffDays < 7) return `${diffDays} days ago`
      if (diffDays < 14) return '1 week ago'
      if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`
      if (diffDays < 60) return '1 month ago'
      return `${Math.floor(diffDays / 30)} months ago`
    } catch {
      return ''
    }
  }

  function formatFullDateTime(dateStr: string) {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'America/New_York',
      })
    } catch {
      return dateStr
    }
  }

  // Filter out generic speaker names like "Speaker 1", "Speaker 2"
  function getRealSpeakers(speakers: string[]) {
    return speakers.filter(s => {
      const lower = s.toLowerCase()
      return !lower.startsWith('speaker ') && lower !== 'unknown' && lower !== 'guest'
    })
  }

  // Get all unique speakers from all transcripts for the filter dropdown
  const allUniqueSpeakers = useMemo(() => {
    const speakerSet = new Set<string>()
    transcripts.forEach(t => {
      getRealSpeakers(t.speakers).forEach(speaker => {
        // Apply corrections if available
        const { displayName } = applySpeakerCorrection(speaker, t.speakerCorrections)
        speakerSet.add(displayName)
      })
    })
    return Array.from(speakerSet).sort((a, b) => a.localeCompare(b))
  }, [transcripts])

  // Filter and sort transcripts
  const filteredTranscripts = useMemo(() => {
    let result = [...transcripts]

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date()
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      const startOfWeek = new Date(startOfToday)
      startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      result = result.filter(t => {
        const transcriptDate = new Date(t.timestamp || t.date)
        switch (dateFilter) {
          case 'today':
            return transcriptDate >= startOfToday
          case 'week':
            return transcriptDate >= startOfWeek
          case 'month':
            return transcriptDate >= startOfMonth
          default:
            return true
        }
      })
    }

    // Speaker filter
    if (speakerFilter !== 'all') {
      result = result.filter(t => {
        const correctedSpeakers = getRealSpeakers(t.speakers).map(s => {
          const { displayName } = applySpeakerCorrection(s, t.speakerCorrections)
          return displayName
        })
        return correctedSpeakers.includes(speakerFilter)
      })
    }

    // Sort
    switch (sortOption) {
      case 'oldest':
        result.sort((a, b) => new Date(a.timestamp || a.date).getTime() - new Date(b.timestamp || b.date).getTime())
        break
      case 'longest':
        result.sort((a, b) => (b.duration || 0) - (a.duration || 0))
        break
      case 'newest':
      default:
        result.sort((a, b) => new Date(b.timestamp || b.date).getTime() - new Date(a.timestamp || a.date).getTime())
    }

    return result
  }, [transcripts, dateFilter, speakerFilter, sortOption])

  // Apply speaker corrections: returns { displayName, wasCorreted, linkedin? }
  function applySpeakerCorrection(
    originalName: string,
    corrections: Record<string, SpeakerCorrection> | null
  ): { displayName: string; wasCorrected: boolean; linkedin?: string } {
    if (!corrections) {
      return { displayName: originalName, wasCorrected: false }
    }
    // Try lowercase key match (corrections are stored with lowercase keys)
    const key = originalName.toLowerCase()
    const correction = corrections[key]
    if (correction) {
      return {
        displayName: correction.name,
        wasCorrected: true,
        linkedin: correction.linkedin,
      }
    }
    return { displayName: originalName, wasCorrected: false }
  }

  // Get corrected speakers list for display in title
  function getCorrectedSpeakers(transcript: Transcript): string[] {
    return getRealSpeakers(transcript.speakers).map(s => {
      const { displayName } = applySpeakerCorrection(s, transcript.speakerCorrections)
      return displayName
    })
  }

  // Build a rich title: "10:00 AM - Title with Speaker1, Speaker2 (29 min)"
  function buildRichTitle(transcript: Transcript) {
    const time = formatTime(transcript.timestamp || transcript.date)
    const correctedSpeakers = getCorrectedSpeakers(transcript)
    const duration = formatDuration(transcript.duration)

    // Clean up the title - remove date suffix if present (e.g., "Google Chrome meeting January 16")
    let title = transcript.title || 'Meeting'
    const datePattern = /\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}$/i
    title = title.replace(datePattern, '')

    let richTitle = time ? `${time} - ${title}` : title

    if (correctedSpeakers.length > 0) {
      const speakerNames = correctedSpeakers.slice(0, 2).join(', ')
      const extra = correctedSpeakers.length > 2 ? ` +${correctedSpeakers.length - 2}` : ''
      richTitle += ` with ${speakerNames}${extra}`
    }

    if (duration) {
      richTitle += ` (${duration})`
    }

    return richTitle
  }

  return (
    <Shell>
      <div className="max-w-6xl">
        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Transcripts</h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">All your meeting transcripts</p>
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full">
            {filteredTranscripts.length}{filteredTranscripts.length !== transcripts.length && ` of ${transcripts.length}`} transcripts
          </span>
        </div>

        {/* Filter Bar */}
        {!loading && transcripts.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Filters:</span>

            {/* Date Filter */}
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as DateFilter)}
              className="text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="all">All Time</option>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
            </select>

            {/* Speaker Filter */}
            <select
              value={speakerFilter}
              onChange={(e) => setSpeakerFilter(e.target.value)}
              className="text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 max-w-[200px]"
            >
              <option value="all">All Speakers</option>
              {allUniqueSpeakers.map((speaker) => (
                <option key={speaker} value={speaker}>
                  {speaker}
                </option>
              ))}
            </select>

            <span className="text-gray-300 dark:text-gray-600">|</span>

            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">Sort:</span>

            {/* Sort Option */}
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
              className="text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-gray-700 dark:text-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="longest">Longest Duration</option>
            </select>

            {/* Clear Filters */}
            {(dateFilter !== 'all' || speakerFilter !== 'all' || sortOption !== 'newest') && (
              <button
                onClick={() => {
                  setDateFilter('all')
                  setSpeakerFilter('all')
                  setSortOption('newest')
                }}
                className="ml-auto text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex items-center gap-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Clear filters
              </button>
            )}
          </div>
        )}

        {loading && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-500 dark:text-gray-400">Loading transcripts...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400">
            Error: {error}
          </div>
        )}

        {!loading && !error && transcripts.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No transcripts found</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Transcripts will appear here when Krisp sends webhook data</p>
          </div>
        )}

        {!loading && transcripts.length > 0 && filteredTranscripts.length === 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">No transcripts match your filters</p>
            <button
              onClick={() => {
                setDateFilter('all')
                setSpeakerFilter('all')
                setSortOption('newest')
              }}
              className="mt-2 text-sm text-primary-600 dark:text-primary-400 hover:underline"
            >
              Clear all filters
            </button>
          </div>
        )}

        {!loading && filteredTranscripts.length > 0 && (
          <div className="flex gap-6">
            {/* Transcript list */}
            <div className={`${selectedTranscript ? 'w-1/2' : 'w-full'} transition-all`}>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Group transcripts by date */}
                {(() => {
                  const grouped = filteredTranscripts.reduce((acc, t) => {
                    const dateKey = formatDate(t.date || t.timestamp)
                    if (!acc[dateKey]) acc[dateKey] = []
                    acc[dateKey].push(t)
                    return acc
                  }, {} as Record<string, Transcript[]>)

                  return Object.entries(grouped).map(([date, items], groupIndex) => (
                    <div key={date}>
                      {/* Date header */}
                      <div className={`px-4 py-2 bg-gray-50 dark:bg-gray-700/50 text-sm font-medium text-gray-600 dark:text-gray-300 ${groupIndex > 0 ? 'border-t border-gray-200 dark:border-gray-700' : ''}`}>
                        {date}
                      </div>
                      {/* Transcript items for this date */}
                      <div className="divide-y divide-gray-100 dark:divide-gray-700">
                        {items.map((transcript) => (
                          <div
                            key={transcript.key}
                            onClick={() => viewTranscript(transcript)}
                            className={`px-4 py-3 cursor-pointer transition-colors ${
                              selectedTranscript?.key === transcript.key
                                ? 'bg-primary-50 dark:bg-primary-900/20'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            {/* Topic as main title if available, otherwise use meeting title */}
                            <div className="font-medium text-gray-900 dark:text-white">
                              {transcript.topic || transcript.title || 'Meeting'}
                            </div>

                            {/* Date and time row */}
                            <div className="mt-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                              <span>{formatFullDateTime(transcript.timestamp || transcript.date)}</span>
                              <span className="text-gray-400 dark:text-gray-500">
                                {formatRelativeTime(transcript.timestamp || transcript.date)}
                              </span>
                            </div>

                            {/* Speakers and duration row */}
                            <div className="mt-2 flex items-center justify-between">
                              <div className="text-xs">
                                {transcript.speakers.length > 0 && (
                                  <ExpandableSpeakers
                                    speakers={transcript.speakers}
                                    speakerCorrections={transcript.speakerCorrections}
                                    initialCount={2}
                                  />
                                )}
                              </div>
                              {transcript.duration > 0 && (
                                <span className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 ml-2">
                                  {formatDuration(transcript.duration)}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                })()}

                {/* Load More Button */}
                {nextCursor && (
                  <div className="p-4 border-t border-gray-200 dark:border-gray-700">
                    <button
                      onClick={() => fetchTranscripts(nextCursor)}
                      disabled={loadingMore}
                      className="w-full py-2 px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:bg-gray-100 dark:disabled:bg-gray-700 disabled:opacity-50 rounded-lg text-sm text-gray-700 dark:text-gray-300 transition-colors flex items-center justify-center gap-2"
                    >
                      {loadingMore ? (
                        <>
                          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 dark:border-gray-300"></div>
                          Loading...
                        </>
                      ) : (
                        'Load More Transcripts'
                      )}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Transcript detail panel */}
            {selectedTranscript && (
              <div className="w-1/2">
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sticky top-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{selectedTranscript.title}</h2>
                    <button
                      onClick={() => setSelectedTranscript(null)}
                      className="text-gray-400 hover:text-gray-600 dark:hover:text-white text-xl p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4 text-sm">
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300">
                      {formatDate(selectedTranscript.timestamp || selectedTranscript.date, true)}
                    </span>
                    <span className="px-2.5 py-1 bg-gray-100 dark:bg-gray-700 rounded-full text-gray-600 dark:text-gray-300">
                      {formatDurationLong(selectedTranscript.duration)}
                    </span>
                    <span className="px-2.5 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-full">
                      {selectedTranscript.eventType?.replace(/_/g, ' ') || 'Krisp'}
                    </span>
                    {selectedTranscript.topic && (
                      <span className="px-2.5 py-1 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 rounded-full flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                        {selectedTranscript.topic}
                      </span>
                    )}
                  </div>

                  {selectedTranscript.speakers.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Speakers</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedTranscript.speakers.map((speaker, i) => {
                          const { displayName, wasCorrected, linkedin } = applySpeakerCorrection(
                            speaker,
                            selectedTranscript.speakerCorrections
                          )
                          return (
                            <Link
                              key={i}
                              href={`/speakers/${encodeURIComponent(displayName)}`}
                              className={`px-2.5 py-1 rounded-full text-sm inline-flex items-center gap-1.5 hover:opacity-80 transition-opacity ${
                                wasCorrected
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                  : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                              }`}
                              title={wasCorrected ? `Corrected from: ${speaker}` : `View ${displayName}'s profile`}
                            >
                              {displayName}
                              {wasCorrected && (
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  viewBox="0 0 16 16"
                                  fill="currentColor"
                                  className="w-3 h-3 opacity-70"
                                  aria-label="Corrected speaker name"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.739a.75.75 0 0 1 1.04-.208Z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              )}
                              {linkedin && (
                                <svg className="w-3 h-3 opacity-70" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                </svg>
                              )}
                            </Link>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Privacy Warning Banner */}
                  {selectedTranscript.privacyLevel &&
                   selectedTranscript.privacyLevel !== 'work' &&
                   !selectedTranscript.privacyDismissed && (
                    <div className={`mb-4 p-3 rounded-lg border ${
                      selectedTranscript.privacyLevel === 'likely_private'
                        ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
                        : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
                    }`}>
                      <div className="flex items-start gap-3">
                        <svg className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                          selectedTranscript.privacyLevel === 'likely_private'
                            ? 'text-red-600 dark:text-red-400'
                            : 'text-yellow-600 dark:text-yellow-400'
                        }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${
                            selectedTranscript.privacyLevel === 'likely_private'
                              ? 'text-red-800 dark:text-red-300'
                              : 'text-yellow-800 dark:text-yellow-300'
                          }`}>
                            {selectedTranscript.privacyLevel === 'likely_private'
                              ? 'This appears to be a private meeting'
                              : 'This meeting may contain private content'}
                          </p>
                          {selectedTranscript.privacyReason && (
                            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                              {selectedTranscript.privacyReason}
                            </p>
                          )}
                          {selectedTranscript.privacyTopics && selectedTranscript.privacyTopics.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {selectedTranscript.privacyTopics.map((topic, i) => (
                                <span key={i} className="text-xs px-2 py-0.5 bg-white/50 dark:bg-black/20 rounded">
                                  {topic}
                                </span>
                              ))}
                            </div>
                          )}
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={() => handlePrivacyToggle(true)}
                              disabled={isUpdatingPrivacy}
                              className="text-xs px-3 py-1.5 bg-gray-800 dark:bg-gray-700 text-white rounded hover:bg-gray-700 dark:hover:bg-gray-600 disabled:opacity-50"
                            >
                              Mark as Private
                            </button>
                            <button
                              onClick={handleDismissPrivacyWarning}
                              className="text-xs px-3 py-1.5 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                              Dismiss
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Privacy & Delete Actions */}
                  <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-500 dark:text-gray-400">Privacy:</span>
                      <button
                        onClick={() => handlePrivacyToggle(!selectedTranscript.isPrivate)}
                        disabled={isUpdatingPrivacy}
                        className={`px-2.5 py-1 text-xs rounded-full flex items-center gap-1.5 transition-colors disabled:opacity-50 ${
                          selectedTranscript.isPrivate
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400'
                            : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500'
                        }`}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {selectedTranscript.isPrivate ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                          )}
                        </svg>
                        {selectedTranscript.isPrivate ? 'Private' : 'Public'}
                      </button>
                    </div>
                    {!showDeleteConfirm ? (
                      <button
                        onClick={() => setShowDeleteConfirm(true)}
                        className="text-xs text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 flex items-center gap-1"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Delete
                      </button>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-red-600 dark:text-red-400">Delete permanently?</span>
                        <button
                          onClick={handleDelete}
                          disabled={isDeleting}
                          className="text-xs px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                        >
                          {isDeleting ? 'Deleting...' : 'Yes'}
                        </button>
                        <button
                          onClick={() => setShowDeleteConfirm(false)}
                          className="text-xs px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                        >
                          No
                        </button>
                      </div>
                    )}
                  </div>

                  {loadingContent && (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                      <span className="ml-3 text-gray-500 dark:text-gray-400">Loading content...</span>
                    </div>
                  )}

                  {transcriptContent && (
                    <TranscriptDetail data={transcriptContent} />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Shell>
  )
}

function TranscriptDetail({ data }: { data: TranscriptContent }) {
  const rawPayload = data.raw_payload
  const transcriptData = rawPayload?.data

  const summary = transcriptData?.raw_meeting
  const transcript = transcriptData?.raw_content

  return (
    <div className="space-y-4 text-sm">
      {/* Summary */}
      {summary && (
        <div>
          <h3 className="text-gray-700 dark:text-gray-300 font-medium mb-2">Summary</h3>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-32 overflow-y-auto border border-gray-100 dark:border-gray-600">
            <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap text-xs">{summary}</p>
          </div>
        </div>
      )}

      {/* Transcript */}
      {transcript && (
        <div>
          <h3 className="text-gray-700 dark:text-gray-300 font-medium mb-2">Full Transcript</h3>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-64 overflow-y-auto border border-gray-100 dark:border-gray-600">
            <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap text-xs">{transcript}</p>
          </div>
        </div>
      )}

      {/* Raw JSON fallback */}
      {!summary && !transcript && (
        <div>
          <h3 className="text-gray-700 dark:text-gray-300 font-medium mb-2">Raw Data</h3>
          <pre className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 overflow-auto max-h-64 text-xs text-gray-600 dark:text-gray-400 border border-gray-100 dark:border-gray-600">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

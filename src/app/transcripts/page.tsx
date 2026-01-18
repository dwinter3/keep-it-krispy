'use client'

import { useEffect, useState } from 'react'
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
}

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

  // Filter out generic speaker names like "Speaker 1", "Speaker 2"
  function getRealSpeakers(speakers: string[]) {
    return speakers.filter(s => {
      const lower = s.toLowerCase()
      return !lower.startsWith('speaker ') && lower !== 'unknown' && lower !== 'guest'
    })
  }

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
            {transcripts.length} transcripts
          </span>
        </div>

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

        {!loading && transcripts.length > 0 && (
          <div className="flex gap-6">
            {/* Transcript list */}
            <div className={`${selectedTranscript ? 'w-1/2' : 'w-full'} transition-all`}>
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                {/* Group transcripts by date */}
                {(() => {
                  const grouped = transcripts.reduce((acc, t) => {
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
                            <div className="font-medium text-gray-900 dark:text-white">
                              {buildRichTitle(transcript)}
                            </div>
                            {transcript.topic && (
                              <div className="mt-1 flex items-center gap-1 text-xs text-purple-600 dark:text-purple-400">
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                                </svg>
                                {transcript.topic}
                              </div>
                            )}
                            {transcript.speakers.length > 0 && (
                              <div className="mt-1 text-xs">
                                <ExpandableSpeakers
                                  speakers={transcript.speakers}
                                  speakerCorrections={transcript.speakerCorrections}
                                  initialCount={2}
                                />
                              </div>
                            )}
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

'use client'

import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'

interface Transcript {
  key: string
  meetingId: string
  title: string
  date: string
  timestamp: string
  duration: number
  speakers: string[]
  eventType: string
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

  useEffect(() => {
    fetchTranscripts()
  }, [])

  async function fetchTranscripts() {
    try {
      const res = await fetch('/api/transcripts')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()
      setTranscripts(data.transcripts || [])
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
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

  function formatDate(dateStr: string) {
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

  function formatDuration(seconds: number) {
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

  return (
    <Shell>
      <div className="max-w-6xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold mb-2">Transcripts</h1>
            <p className="text-zinc-400">All your meeting transcripts</p>
          </div>
          <div className="text-sm text-zinc-500">
            {transcripts.length} transcripts
          </div>
        </div>

        {loading && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center">
            <div className="animate-pulse text-zinc-400">Loading transcripts...</div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            Error: {error}
          </div>
        )}

        {!loading && !error && transcripts.length === 0 && (
          <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 text-center text-zinc-400">
            No transcripts found. Transcripts will appear here when Krisp sends webhook data.
          </div>
        )}

        {!loading && transcripts.length > 0 && (
          <div className="flex gap-6">
            {/* Transcript table */}
            <div className={`${selectedTranscript ? 'w-1/2' : 'w-full'} transition-all`}>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-zinc-800 text-left text-sm text-zinc-400">
                      <th className="px-4 py-3 font-medium">Title / Topic</th>
                      <th className="px-4 py-3 font-medium">Date</th>
                      <th className="px-4 py-3 font-medium">Duration</th>
                      <th className="px-4 py-3 font-medium">Speakers</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {transcripts.map((transcript) => (
                      <tr
                        key={transcript.key}
                        onClick={() => viewTranscript(transcript)}
                        className={`cursor-pointer transition-colors ${
                          selectedTranscript?.key === transcript.key
                            ? 'bg-zinc-800'
                            : 'hover:bg-zinc-800/50'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-white">
                            {transcript.title || 'Untitled Meeting'}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">
                          {formatDate(transcript.date || transcript.timestamp)}
                        </td>
                        <td className="px-4 py-3 text-sm text-zinc-400">
                          {formatDuration(transcript.duration)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {transcript.speakers.length > 0 ? (
                              transcript.speakers.slice(0, 2).map((speaker, i) => (
                                <span
                                  key={i}
                                  className="px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-300"
                                >
                                  {speaker}
                                </span>
                              ))
                            ) : (
                              <span className="text-zinc-500 text-sm">-</span>
                            )}
                            {transcript.speakers.length > 2 && (
                              <span className="px-2 py-0.5 bg-zinc-800 rounded text-xs text-zinc-400">
                                +{transcript.speakers.length - 2}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Transcript detail panel */}
            {selectedTranscript && (
              <div className="w-1/2">
                <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 sticky top-4">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">{selectedTranscript.title}</h2>
                    <button
                      onClick={() => setSelectedTranscript(null)}
                      className="text-zinc-400 hover:text-white text-xl"
                    >
                      &times;
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2 mb-4 text-sm">
                    <span className="px-2 py-1 bg-zinc-800 rounded text-zinc-400">
                      {formatDate(selectedTranscript.date || selectedTranscript.timestamp)}
                    </span>
                    <span className="px-2 py-1 bg-zinc-800 rounded text-zinc-400">
                      {formatDuration(selectedTranscript.duration)}
                    </span>
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 rounded">
                      {selectedTranscript.eventType?.replace(/_/g, ' ') || 'Krisp'}
                    </span>
                  </div>

                  {selectedTranscript.speakers.length > 0 && (
                    <div className="mb-4">
                      <h3 className="text-sm font-medium text-zinc-300 mb-2">Speakers</h3>
                      <div className="flex flex-wrap gap-2">
                        {selectedTranscript.speakers.map((speaker, i) => (
                          <span
                            key={i}
                            className="px-2 py-1 bg-blue-500/20 text-blue-400 rounded text-sm"
                          >
                            {speaker}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {loadingContent && (
                    <div className="animate-pulse text-zinc-400 py-8 text-center">
                      Loading content...
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
          <h3 className="text-zinc-300 font-medium mb-2">Summary</h3>
          <div className="bg-zinc-800 rounded p-3 max-h-32 overflow-y-auto">
            <p className="text-zinc-400 whitespace-pre-wrap text-xs">{summary}</p>
          </div>
        </div>
      )}

      {/* Transcript */}
      {transcript && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-2">Full Transcript</h3>
          <div className="bg-zinc-800 rounded p-3 max-h-64 overflow-y-auto">
            <p className="text-zinc-400 whitespace-pre-wrap text-xs">{transcript}</p>
          </div>
        </div>
      )}

      {/* Raw JSON fallback */}
      {!summary && !transcript && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-2">Raw Data</h3>
          <pre className="bg-zinc-800 rounded p-3 overflow-auto max-h-64 text-xs text-zinc-400">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

'use client'

import { useEffect, useState } from 'react'
import Shell from '@/components/Shell'

interface Transcript {
  key: string
  title: string
  date: string
  meetingId: string
  size: number
  lastModified: string
}

export default function TranscriptsPage() {
  const [transcripts, setTranscripts] = useState<Transcript[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedTranscript, setSelectedTranscript] = useState<Transcript | null>(null)
  const [transcriptContent, setTranscriptContent] = useState<Record<string, unknown> | null>(null)
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

  function formatSize(bytes: number) {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Shell>
      <div className="max-w-5xl">
        <h1 className="text-3xl font-bold mb-2">Transcripts</h1>
        <p className="text-zinc-400 mb-8">All your meeting transcripts from S3</p>

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
            {/* Transcript list */}
            <div className={`${selectedTranscript ? 'w-1/2' : 'w-full'} transition-all`}>
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 divide-y divide-zinc-800">
                {transcripts.map((transcript) => (
                  <div
                    key={transcript.key}
                    onClick={() => viewTranscript(transcript)}
                    className={`p-4 cursor-pointer transition-colors ${
                      selectedTranscript?.key === transcript.key
                        ? 'bg-zinc-800'
                        : 'hover:bg-zinc-800/50'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-medium">{transcript.title || 'Untitled Meeting'}</h3>
                      <span className="text-xs px-2 py-1 rounded bg-purple-500/20 text-purple-400">
                        Krisp
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-zinc-400">
                      <span>{formatDate(transcript.date || transcript.lastModified)}</span>
                      <span>{formatSize(transcript.size)}</span>
                    </div>
                  </div>
                ))}
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
                      className="text-zinc-400 hover:text-white"
                    >
                      &times;
                    </button>
                  </div>

                  {loadingContent && (
                    <div className="animate-pulse text-zinc-400 py-8 text-center">
                      Loading content...
                    </div>
                  )}

                  {transcriptContent && (
                    <div className="space-y-4">
                      <TranscriptDetail data={transcriptContent} />
                    </div>
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

function TranscriptDetail({ data }: { data: Record<string, unknown> }) {
  const rawPayload = data.raw_payload as Record<string, unknown> | undefined
  const eventType = data.event_type as string | undefined
  const receivedAt = data.received_at as string | undefined

  // Extract transcript text if available
  const transcriptText = rawPayload?.transcript as string | undefined
  const summary = rawPayload?.summary as string | undefined
  const notes = rawPayload?.notes as string | undefined
  const actionItems = rawPayload?.action_items as string[] | undefined
  const speakers = rawPayload?.speakers as Array<{ name: string; duration?: number }> | undefined

  return (
    <div className="space-y-4 text-sm">
      {/* Metadata */}
      <div className="flex gap-4 text-zinc-400">
        {eventType && (
          <span className="px-2 py-1 bg-zinc-800 rounded text-xs">
            {eventType.replace(/_/g, ' ')}
          </span>
        )}
        {receivedAt && (
          <span className="text-xs">
            Received: {new Date(receivedAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Summary */}
      {summary && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Summary</h3>
          <p className="text-zinc-400">{summary}</p>
        </div>
      )}

      {/* Notes */}
      {notes && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Notes</h3>
          <p className="text-zinc-400 whitespace-pre-wrap">{notes}</p>
        </div>
      )}

      {/* Action Items */}
      {actionItems && actionItems.length > 0 && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Action Items</h3>
          <ul className="list-disc list-inside text-zinc-400">
            {actionItems.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Speakers */}
      {speakers && speakers.length > 0 && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Speakers</h3>
          <div className="flex flex-wrap gap-2">
            {speakers.map((speaker, i) => (
              <span key={i} className="px-2 py-1 bg-zinc-800 rounded text-xs">
                {speaker.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Transcript */}
      {transcriptText && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Transcript</h3>
          <div className="bg-zinc-800 rounded p-3 max-h-64 overflow-y-auto">
            <p className="text-zinc-400 whitespace-pre-wrap text-xs">{transcriptText}</p>
          </div>
        </div>
      )}

      {/* Raw JSON fallback */}
      {!summary && !notes && !transcriptText && (
        <div>
          <h3 className="text-zinc-300 font-medium mb-1">Raw Data</h3>
          <pre className="bg-zinc-800 rounded p-3 overflow-auto max-h-64 text-xs text-zinc-400">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

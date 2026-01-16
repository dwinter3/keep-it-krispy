'use client'

import { useState, useEffect } from 'react'
import Shell from '@/components/Shell'

interface Speaker {
  name: string
  meetingCount: number
  totalDuration: number
  totalDurationFormatted: string
  lastSeen: string
  lastSeenFormatted: string
  linkedin?: string
}

interface SpeakersResponse {
  count: number
  speakers: Speaker[]
}

export default function SpeakersPage() {
  const [speakers, setSpeakers] = useState<Speaker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchSpeakers() {
      try {
        const response = await fetch('/api/speakers')
        if (!response.ok) {
          throw new Error(`Failed to fetch speakers: ${response.status}`)
        }
        const data: SpeakersResponse = await response.json()
        setSpeakers(data.speakers)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchSpeakers()
  }, [])

  return (
    <Shell>
      <div className="max-w-4xl">
        <h1 className="text-3xl font-bold mb-2">Speakers</h1>
        <p className="text-zinc-400 mb-8">Your contacts from meeting transcripts</p>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="ml-3 text-zinc-400">Loading speakers...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            <p className="font-medium">Error loading speakers</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && speakers.length === 0 && (
          <div className="text-center py-12 text-zinc-500">
            <p>No speakers found yet.</p>
            <p className="text-sm mt-2">Speakers will appear here as transcripts are processed.</p>
          </div>
        )}

        {!loading && !error && speakers.length > 0 && (
          <>
            <p className="text-sm text-zinc-500 mb-4">{speakers.length} speakers found</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {speakers.map((speaker) => (
                <SpeakerCard key={speaker.name} speaker={speaker} />
              ))}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

function SpeakerCard({ speaker }: { speaker: Speaker }) {
  const initials = speaker.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4 hover:border-zinc-700 transition-colors">
      <div className="flex items-start gap-4">
        <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-lg font-medium flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium truncate">{speaker.name}</h3>
            {speaker.linkedin && (
              <a
                href={speaker.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-zinc-500 hover:text-blue-400 transition-colors"
                title="LinkedIn Profile"
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                </svg>
              </a>
            )}
          </div>
          <p className="text-sm text-zinc-400 mt-1">
            {speaker.totalDurationFormatted} total meeting time
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4 mt-4 text-xs text-zinc-500">
        <span>
          {speaker.meetingCount} meeting{speaker.meetingCount !== 1 ? 's' : ''}
        </span>
        <span>Last seen: {speaker.lastSeenFormatted}</span>
      </div>
    </div>
  )
}

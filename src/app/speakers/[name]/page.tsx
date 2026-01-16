'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface Meeting {
  meetingId: string
  key: string
  title: string
  date: string
  timestamp: string
  duration: number
  durationFormatted: string
}

interface SpeakerProfile {
  name: string
  bio?: string
  linkedin?: string
  company?: string
  role?: string
  stats: {
    meetingCount: number
    totalDuration: number
    totalDurationFormatted: string
    firstMeeting: string | null
    lastMeeting: string | null
  }
  meetings: Meeting[]
}

export default function SpeakerProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = use(params)
  const [profile, setProfile] = useState<SpeakerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    bio: '',
    linkedin: '',
    company: '',
    role: '',
  })

  useEffect(() => {
    async function fetchProfile() {
      try {
        const response = await fetch(`/api/speakers/${encodeURIComponent(name)}`)
        if (!response.ok) {
          throw new Error(`Failed to fetch speaker: ${response.status}`)
        }
        const data: SpeakerProfile = await response.json()
        setProfile(data)
        setEditForm({
          bio: data.bio || '',
          linkedin: data.linkedin || '',
          company: data.company || '',
          role: data.role || '',
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [name])

  async function handleSave() {
    if (!profile) return
    setSaving(true)
    try {
      const response = await fetch(`/api/speakers/${encodeURIComponent(name)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!response.ok) {
        throw new Error('Failed to save')
      }
      setProfile({
        ...profile,
        ...editForm,
      })
      setEditing(false)
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  function formatDate(dateStr: string) {
    try {
      const date = new Date(dateStr)
      return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        timeZone: 'America/New_York',
      })
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

  // Group meetings by date
  function groupMeetingsByDate(meetings: Meeting[]) {
    const groups: Record<string, Meeting[]> = {}
    for (const meeting of meetings) {
      const dateKey = formatDate(meeting.timestamp || meeting.date)
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(meeting)
    }
    return groups
  }

  const initials = profile?.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  return (
    <Shell>
      <div className="max-w-4xl">
        {/* Back link */}
        <Link
          href="/speakers"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Speakers
        </Link>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="ml-3 text-zinc-400">Loading speaker profile...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            <p className="font-medium">Error loading speaker</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && profile && (
          <>
            {/* Profile Header */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
              <div className="flex items-start gap-6">
                {/* Avatar */}
                <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center text-2xl font-bold flex-shrink-0">
                  {initials}
                </div>

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-bold">{profile.name}</h1>
                    {profile.linkedin && (
                      <a
                        href={profile.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-blue-400 transition-colors"
                        title="LinkedIn Profile"
                      >
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                        </svg>
                      </a>
                    )}
                  </div>

                  {(profile.role || profile.company) && (
                    <p className="text-zinc-400 mb-2">
                      {profile.role}{profile.role && profile.company && ' at '}{profile.company}
                    </p>
                  )}

                  {profile.bio && !editing && (
                    <p className="text-zinc-300 text-sm mt-3">{profile.bio}</p>
                  )}

                  {/* Stats */}
                  <div className="flex flex-wrap gap-4 mt-4 text-sm">
                    <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                      <span className="text-zinc-400">Meetings: </span>
                      <span className="text-white font-medium">{profile.stats.meetingCount}</span>
                    </div>
                    <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                      <span className="text-zinc-400">Total Time: </span>
                      <span className="text-white font-medium">{profile.stats.totalDurationFormatted}</span>
                    </div>
                    {profile.stats.firstMeeting && (
                      <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                        <span className="text-zinc-400">First Met: </span>
                        <span className="text-white font-medium">{formatDate(profile.stats.firstMeeting)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Edit button */}
                <button
                  onClick={() => setEditing(!editing)}
                  className="text-zinc-400 hover:text-white transition-colors p-2"
                  title="Edit profile"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                </button>
              </div>

              {/* Edit Form */}
              {editing && (
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm text-zinc-400 mb-1">Role</label>
                      <input
                        type="text"
                        value={editForm.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                        placeholder="e.g. Product Manager"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-zinc-400 mb-1">Company</label>
                      <input
                        type="text"
                        value={editForm.company}
                        onChange={(e) => setEditForm({ ...editForm, company: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                        placeholder="e.g. Acme Corp"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm text-zinc-400 mb-1">LinkedIn URL</label>
                      <input
                        type="url"
                        value={editForm.linkedin}
                        onChange={(e) => setEditForm({ ...editForm, linkedin: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                        placeholder="https://linkedin.com/in/..."
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm text-zinc-400 mb-1">Bio / Notes</label>
                      <textarea
                        value={editForm.bio}
                        onChange={(e) => setEditForm({ ...editForm, bio: e.target.value })}
                        rows={3}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600 resize-none"
                        placeholder="Add notes about this person..."
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3 mt-4">
                    <button
                      onClick={() => setEditing(false)}
                      className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg transition-colors"
                    >
                      {saving ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Meeting History */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="font-semibold">Meeting History</h2>
              </div>

              {profile.meetings.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  No meetings found with this speaker.
                </div>
              ) : (
                <div>
                  {Object.entries(groupMeetingsByDate(profile.meetings)).map(([date, meetings]) => (
                    <div key={date}>
                      <div className="px-4 py-2 bg-zinc-800/50 text-sm font-medium text-zinc-400">
                        {date}
                      </div>
                      <div className="divide-y divide-zinc-800">
                        {meetings.map((meeting) => (
                          <Link
                            key={meeting.meetingId}
                            href={`/transcripts?key=${encodeURIComponent(meeting.key)}`}
                            className="block px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-zinc-500 text-sm mr-2">
                                  {formatTime(meeting.timestamp)}
                                </span>
                                <span className="text-white">{meeting.title}</span>
                              </div>
                              <span className="text-zinc-500 text-sm">
                                {meeting.durationFormatted}
                              </span>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}

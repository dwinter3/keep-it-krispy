'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'
import { getDisplayTitle } from '@/lib/formatting'

interface Transcript {
  meetingId: string
  key: string
  title: string
  topic?: string | null
  date: string
  timestamp: string
  duration: number
  durationFormatted: string
  speakers: string[]
}

interface Employee {
  name: string
  displayName: string
  linkedin?: string
}

interface CompanyDetail {
  id: string
  name: string
  type: 'customer' | 'prospect' | 'partner' | 'vendor' | 'competitor' | 'internal' | 'unknown'
  confidence: number
  mentionCount: number
  firstMentioned: string
  lastMentioned: string
  firstMentionedFormatted: string
  lastMentionedFormatted: string
  aliases: string[]
  description?: string
  website?: string
  notes?: string
  employees: Employee[]
  transcripts: Transcript[]
  speakersInvolved: string[]
}

const TYPE_OPTIONS = [
  { value: 'customer', label: 'Customer' },
  { value: 'prospect', label: 'Prospect' },
  { value: 'partner', label: 'Partner' },
  { value: 'vendor', label: 'Vendor' },
  { value: 'competitor', label: 'Competitor' },
  { value: 'internal', label: 'Internal' },
  { value: 'unknown', label: 'Unknown' },
]

const TYPE_COLORS: Record<string, string> = {
  customer: 'bg-green-500/20 text-green-400 border-green-500/30',
  prospect: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  partner: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  vendor: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  competitor: 'bg-red-500/20 text-red-400 border-red-500/30',
  internal: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  unknown: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

export default function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [company, setCompany] = useState<CompanyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editForm, setEditForm] = useState({
    type: 'unknown',
    description: '',
    website: '',
    notes: '',
  })

  useEffect(() => {
    async function fetchCompany() {
      try {
        const response = await fetch(`/api/companies/${encodeURIComponent(id)}`)
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Company not found')
          }
          throw new Error(`Failed to fetch company: ${response.status}`)
        }
        const data: CompanyDetail = await response.json()
        setCompany(data)
        setEditForm({
          type: data.type || 'unknown',
          description: data.description || '',
          website: data.website || '',
          notes: data.notes || '',
        })
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchCompany()
  }, [id])

  async function handleSave() {
    if (!company) return
    setSaving(true)
    try {
      const response = await fetch(`/api/companies/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      })
      if (!response.ok) {
        throw new Error('Failed to save')
      }
      setCompany({
        ...company,
        type: editForm.type as CompanyDetail['type'],
        description: editForm.description || undefined,
        website: editForm.website || undefined,
        notes: editForm.notes || undefined,
      })
      setEditing(false)
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
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

  // Group transcripts by date
  function groupTranscriptsByDate(transcripts: Transcript[]) {
    const groups: Record<string, Transcript[]> = {}
    for (const transcript of transcripts) {
      const dateKey = formatDate(transcript.timestamp || transcript.date)
      if (!groups[dateKey]) {
        groups[dateKey] = []
      }
      groups[dateKey].push(transcript)
    }
    return groups
  }

  const initials = company?.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  const typeColor = TYPE_COLORS[company?.type || 'unknown']

  return (
    <Shell>
      <div className="max-w-4xl">
        {/* Back link */}
        <Link
          href="/companies"
          className="inline-flex items-center gap-2 text-zinc-400 hover:text-white mb-6 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Companies
        </Link>

        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            <span className="ml-3 text-zinc-400">Loading company details...</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800 rounded-xl p-4 text-red-400">
            <p className="font-medium">Error loading company</p>
            <p className="text-sm mt-1">{error}</p>
          </div>
        )}

        {!loading && !error && company && (
          <>
            {/* Company Header */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
              <div className="flex items-start gap-6">
                {/* Icon */}
                <div className="w-20 h-20 bg-zinc-800 rounded-xl flex items-center justify-center text-2xl font-bold flex-shrink-0">
                  {initials}
                </div>

                {/* Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-bold">{company.name}</h1>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${typeColor}`}>
                      {TYPE_OPTIONS.find(t => t.value === company.type)?.label || 'Unknown'}
                    </span>
                    {company.website && (
                      <a
                        href={company.website.startsWith('http') ? company.website : `https://${company.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-zinc-400 hover:text-blue-400 transition-colors"
                        title="Visit website"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                      </a>
                    )}
                  </div>

                  {company.description && !editing && (
                    <p className="text-zinc-300 text-sm mt-3">{company.description}</p>
                  )}

                  {company.notes && !editing && (
                    <p className="text-zinc-400 text-sm mt-2 italic">{company.notes}</p>
                  )}

                  {/* Stats */}
                  <div className="flex flex-wrap gap-4 mt-4 text-sm">
                    <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                      <span className="text-zinc-400">Mentions: </span>
                      <span className="text-white font-medium">{company.mentionCount}</span>
                    </div>
                    <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                      <span className="text-zinc-400">Meetings: </span>
                      <span className="text-white font-medium">{company.transcripts.length}</span>
                    </div>
                    {company.employees.length > 0 && (
                      <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                        <span className="text-zinc-400">Contacts: </span>
                        <span className="text-white font-medium">{company.employees.length}</span>
                      </div>
                    )}
                    {company.confidence > 0 && (
                      <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                        <span className="text-zinc-400">Confidence: </span>
                        <span className="text-white font-medium">{company.confidence}%</span>
                      </div>
                    )}
                    {company.firstMentioned && (
                      <div className="bg-zinc-800 px-3 py-1.5 rounded-lg">
                        <span className="text-zinc-400">First Mentioned: </span>
                        <span className="text-white font-medium">{company.firstMentionedFormatted}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Edit button */}
                <button
                  onClick={() => setEditing(!editing)}
                  className="text-zinc-400 hover:text-white transition-colors p-2"
                  title="Edit company"
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
                      <label className="block text-sm text-zinc-400 mb-1">Relationship Type</label>
                      <select
                        value={editForm.type}
                        onChange={(e) => setEditForm({ ...editForm, type: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                      >
                        {TYPE_OPTIONS.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm text-zinc-400 mb-1">Website</label>
                      <input
                        type="url"
                        value={editForm.website}
                        onChange={(e) => setEditForm({ ...editForm, website: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                        placeholder="https://example.com"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm text-zinc-400 mb-1">Description</label>
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600"
                        placeholder="Brief description of the company"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-sm text-zinc-400 mb-1">Notes</label>
                      <textarea
                        value={editForm.notes}
                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                        rows={3}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-zinc-600 resize-none"
                        placeholder="Add private notes about this company..."
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

            {/* Known Contacts */}
            {company.employees.length > 0 && (
              <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-6 mb-6">
                <h2 className="font-semibold mb-4">Known Contacts</h2>
                <div className="flex flex-wrap gap-3">
                  {company.employees.map((employee) => (
                    <Link
                      key={employee.name}
                      href={`/speakers/${encodeURIComponent(employee.displayName || employee.name)}`}
                      className="flex items-center gap-2 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      <div className="w-8 h-8 bg-zinc-700 rounded-full flex items-center justify-center text-xs font-medium">
                        {(employee.displayName || employee.name)
                          .split(' ')
                          .map(n => n[0])
                          .join('')
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                      <span className="text-sm text-white">{employee.displayName || employee.name}</span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* Meeting History */}
            <div className="bg-zinc-900 rounded-xl border border-zinc-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800">
                <h2 className="font-semibold">Meeting History</h2>
              </div>

              {company.transcripts.length === 0 ? (
                <div className="p-8 text-center text-zinc-500">
                  No meetings found mentioning this company.
                </div>
              ) : (
                <div>
                  {Object.entries(groupTranscriptsByDate(company.transcripts)).map(([date, transcripts]) => (
                    <div key={date}>
                      <div className="px-4 py-2 bg-zinc-800/50 text-sm font-medium text-zinc-400">
                        {date}
                      </div>
                      <div className="divide-y divide-zinc-800">
                        {transcripts.map((transcript) => (
                          <Link
                            key={transcript.meetingId}
                            href={`/transcripts?key=${encodeURIComponent(transcript.key)}`}
                            className="block px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                          >
                            <div className="flex items-center justify-between">
                              <div>
                                <span className="text-zinc-500 text-sm mr-2">
                                  {formatTime(transcript.timestamp)}
                                </span>
                                <span className="text-white">{getDisplayTitle(transcript.topic, transcript.title)}</span>
                              </div>
                              <span className="text-zinc-500 text-sm">
                                {transcript.durationFormatted}
                              </span>
                            </div>
                            {transcript.speakers.length > 0 && (
                              <div className="mt-1 text-xs text-zinc-500">
                                {transcript.speakers.slice(0, 5).join(', ')}
                                {transcript.speakers.length > 5 && ` +${transcript.speakers.length - 5} more`}
                              </div>
                            )}
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

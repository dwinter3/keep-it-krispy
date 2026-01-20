'use client'

import { useState, useEffect, use } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'
import EntityMergeModal from '@/components/EntityMergeModal'
import { getDisplayTitle } from '@/lib/formatting'

interface Meeting {
  meetingId: string
  key: string
  title: string
  topic?: string | null
  date: string
  timestamp: string
  duration: number
  durationFormatted: string
}

interface EnrichedData {
  title?: string
  company?: string
  summary?: string
  linkedinUrl?: string
  photoUrl?: string
  fullName?: string
}

interface SpeakerProfile {
  name: string
  originalName?: string
  entityId?: string | null
  verifiedFullName?: string
  bio?: string
  linkedin?: string
  company?: string
  role?: string
  aiSummary?: string
  topics?: string[]
  enrichedAt?: string
  // New enrichment fields
  enrichedData?: EnrichedData
  enrichedConfidence?: number
  enrichedReasoning?: string
  enrichedSources?: string[]
  webEnrichedAt?: string
  // Human feedback fields
  humanVerified?: boolean
  humanVerifiedAt?: string
  humanHints?: string
  rejectedProfiles?: string[]
  stats: {
    meetingCount: number
    totalDuration: number
    totalDurationFormatted: string
    firstMeeting: string | null
    lastMeeting: string | null
  }
  meetings: Meeting[]
}

interface EnrichmentResponse {
  cached: boolean
  name: string
  enrichedData: EnrichedData
  confidence: number
  reasoning: string
  sources: string[]
  enrichedAt: string
  aiSummary: string
  topics: string[]
  humanHints?: string
  rejectedProfiles?: string[]
  humanVerified?: boolean
  humanVerifiedAt?: string
  context?: {
    transcriptCount: number
    companies: string[]
    roleHints: string[]
  }
}

// Helper to safely decode URI component (handles already-decoded strings)
function safeDecodeURIComponent(str: string): string {
  try {
    // If the string contains %XX patterns, decode it
    // This handles double-encoded strings by decoding repeatedly until stable
    let decoded = str
    let prev = ''
    while (decoded !== prev && decoded.includes('%')) {
      prev = decoded
      decoded = decodeURIComponent(decoded)
    }
    return decoded
  } catch {
    return str
  }
}

export default function SpeakerProfilePage({ params }: { params: Promise<{ name: string }> }) {
  const { name: rawName } = use(params)
  // Ensure the name is properly decoded (handles double-encoding from URL)
  const name = safeDecodeURIComponent(rawName)
  const [profile, setProfile] = useState<SpeakerProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [enriching, setEnriching] = useState(false)
  const [enrichmentResult, setEnrichmentResult] = useState<EnrichmentResponse | null>(null)
  const [showReasoning, setShowReasoning] = useState(false)
  const [hintsInput, setHintsInput] = useState('')
  const [showHintsInput, setShowHintsInput] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [editForm, setEditForm] = useState({
    bio: '',
    linkedin: '',
    company: '',
    role: '',
  })
  const [showMergeModal, setShowMergeModal] = useState(false)
  const [showAllSources, setShowAllSources] = useState(false)

  // Helper to format source URL for display
  function formatSourceDisplay(url: string): { title: string; preview: string } {
    try {
      const parsed = new URL(url)
      const hostname = parsed.hostname.replace('www.', '')

      // Special handling for LinkedIn
      if (hostname.includes('linkedin.com')) {
        const pathParts = parsed.pathname.split('/').filter(Boolean)
        if (pathParts[0] === 'in' && pathParts[1]) {
          return {
            title: 'LinkedIn Profile',
            preview: `/${pathParts.slice(0, 2).join('/')}`,
          }
        } else if (pathParts[0] === 'company' && pathParts[1]) {
          return {
            title: 'LinkedIn Company',
            preview: `/${pathParts.slice(0, 2).join('/')}`,
          }
        }
        return { title: 'LinkedIn', preview: parsed.pathname.slice(0, 30) }
      }

      // Get meaningful path preview
      const pathPreview = parsed.pathname.length > 1
        ? parsed.pathname.slice(0, 40) + (parsed.pathname.length > 40 ? '...' : '')
        : ''

      return {
        title: hostname,
        preview: pathPreview,
      }
    } catch {
      return { title: url, preview: '' }
    }
  }

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

  async function handleEnrich(forceRefresh = false, hints?: string, excludeUrls?: string[]) {
    if (!profile) return
    setEnriching(true)
    setEnrichmentResult(null)
    try {
      const response = await fetch(`/api/speakers/${encodeURIComponent(name)}/enrich`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          forceRefresh,
          hints: hints || hintsInput || undefined,
          excludeUrls,
        }),
      })
      if (!response.ok) {
        throw new Error('Failed to enrich')
      }
      const data: EnrichmentResponse = await response.json()
      setEnrichmentResult(data)

      // Update profile with enrichment data
      // When not cached (fresh search), always update role/company/linkedin with new data
      // This is important for "Wrong Person" flow where we want to replace old values
      const isFreshSearch = !data.cached
      setProfile({
        ...profile,
        aiSummary: data.aiSummary,
        topics: data.topics,
        enrichedAt: data.enrichedAt,
        enrichedData: data.enrichedData,
        enrichedConfidence: data.confidence,
        enrichedReasoning: data.reasoning,
        enrichedSources: data.sources,
        humanHints: data.humanHints,
        rejectedProfiles: data.rejectedProfiles,
        humanVerified: data.humanVerified,
        // For fresh searches, prefer new enriched data; for cached, keep existing values
        role: isFreshSearch ? (data.enrichedData?.title || profile.role) : (profile.role || data.enrichedData?.title || undefined),
        company: isFreshSearch ? (data.enrichedData?.company || profile.company) : (profile.company || data.enrichedData?.company || undefined),
        linkedin: isFreshSearch ? (data.enrichedData?.linkedinUrl || profile.linkedin) : (profile.linkedin || data.enrichedData?.linkedinUrl || undefined),
      })

      // Clear hints input after successful search
      setHintsInput('')
      setShowHintsInput(false)
    } catch (err) {
      console.error('Enrich error:', err)
    } finally {
      setEnriching(false)
    }
  }

  async function handleVerify(verified: boolean) {
    if (!profile) return
    setVerifying(true)
    try {
      const response = await fetch(`/api/speakers/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ humanVerified: verified }),
      })
      if (!response.ok) {
        throw new Error('Failed to verify')
      }
      const patchData = await response.json()

      // Refresh profile to get updated name (verifiedFullName)
      const profileResponse = await fetch(`/api/speakers/${encodeURIComponent(name)}`)
      if (profileResponse.ok) {
        const refreshedProfile = await profileResponse.json()
        setProfile({
          ...profile,
          ...refreshedProfile,
          humanVerified: patchData.profile.humanVerified,
          humanVerifiedAt: patchData.profile.humanVerifiedAt,
        })
      } else {
        // Fallback if refresh fails
        setProfile({
          ...profile,
          humanVerified: patchData.profile.humanVerified,
          humanVerifiedAt: patchData.profile.humanVerifiedAt,
          verifiedFullName: patchData.profile.verifiedFullName,
          name: patchData.profile.verifiedFullName || profile.name,
        })
      }
    } catch (err) {
      console.error('Verify error:', err)
    } finally {
      setVerifying(false)
    }
  }

  async function handleWrongPerson() {
    if (!profile) return
    // Get the current LinkedIn URL to reject
    const currentLinkedinUrl = enrichmentResult?.enrichedData?.linkedinUrl ||
                                profile?.enrichedData?.linkedinUrl
    if (!currentLinkedinUrl) {
      // No URL to reject, just trigger re-search with hints
      handleEnrich(true, hintsInput)
      return
    }

    setVerifying(true)
    try {
      // Mark current profile as rejected and save hints
      const response = await fetch(`/api/speakers/${encodeURIComponent(name)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rejectProfile: currentLinkedinUrl,
          humanHints: hintsInput || undefined,
        }),
      })
      if (!response.ok) {
        throw new Error('Failed to reject profile')
      }

      // Now trigger re-search with hints and excluded URL
      setVerifying(false)
      const existingRejected = profile.rejectedProfiles || []
      handleEnrich(true, hintsInput, [...existingRejected, currentLinkedinUrl])
    } catch (err) {
      console.error('Wrong person error:', err)
      setVerifying(false)
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

  // Get confidence badge color
  function getConfidenceBadgeColor(confidence: number) {
    if (confidence >= 70) return 'bg-green-500/20 text-green-400 border-green-500/30'
    if (confidence >= 40) return 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    return 'bg-red-500/20 text-red-400 border-red-500/30'
  }

  function getConfidenceLabel(confidence: number) {
    if (confidence >= 70) return 'High confidence'
    if (confidence >= 40) return 'Medium confidence'
    return 'Low confidence'
  }

  const initials = profile?.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '?'

  // Determine effective role/company from enrichment or manual entry
  const effectiveRole = profile?.role || profile?.enrichedData?.title
  const effectiveCompany = profile?.company || profile?.enrichedData?.company
  const effectiveLinkedin = profile?.linkedin || profile?.enrichedData?.linkedinUrl

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
                    {effectiveLinkedin && (
                      <a
                        href={effectiveLinkedin}
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

                  {(effectiveRole || effectiveCompany) && (
                    <p className="text-zinc-400 mb-2">
                      {effectiveRole}
                      {effectiveRole && effectiveCompany && ' at '}
                      {effectiveCompany && (
                        <Link
                          href={`/companies?search=${encodeURIComponent(effectiveCompany)}`}
                          className="text-blue-400 hover:text-blue-300 hover:underline transition-colors"
                        >
                          {effectiveCompany}
                        </Link>
                      )}
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

                {/* Action buttons */}
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setEditing(!editing)}
                    className="text-zinc-400 hover:text-white transition-colors p-2"
                    title="Edit profile"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  </button>
                  {profile.entityId && (
                    <button
                      onClick={() => setShowMergeModal(true)}
                      className="text-zinc-400 hover:text-white transition-colors p-2"
                      title="Merge with another speaker"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Web Enrichment Section */}
              {!editing && (
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <h3 className="text-sm font-medium text-zinc-300">Web Enrichment</h3>
                      {profile?.humanVerified && (
                        <span className="text-xs px-2 py-0.5 rounded-full border bg-green-500/20 text-green-400 border-green-500/30 flex items-center gap-1">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                          Verified
                        </span>
                      )}
                      {!profile?.humanVerified && (enrichmentResult?.confidence ?? profile?.enrichedConfidence) !== undefined && (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${getConfidenceBadgeColor(enrichmentResult?.confidence ?? profile?.enrichedConfidence ?? 0)}`}>
                          {getConfidenceLabel(enrichmentResult?.confidence ?? profile?.enrichedConfidence ?? 0)} ({enrichmentResult?.confidence ?? profile?.enrichedConfidence}%)
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {/* Show Refresh button only if there's existing enrichment data */}
                      {(enrichmentResult || profile?.enrichedData) && (
                        <button
                          onClick={() => handleEnrich(true)}
                          disabled={enriching}
                          className="text-xs px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 disabled:bg-zinc-700/50 text-white rounded-lg transition-colors flex items-center gap-2"
                          title="Search for updated profile information"
                        >
                          {enriching ? (
                            <>
                              <span className="animate-spin">&#8635;</span>
                              Searching...
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              Refresh
                            </>
                          )}
                        </button>
                      )}
                      {/* Only show "Enrich from Web" button when no data exists yet */}
                      {!enrichmentResult && !profile?.enrichedData && (
                        <button
                          onClick={() => handleEnrich(false)}
                          disabled={enriching}
                          className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg transition-colors flex items-center gap-2"
                        >
                          {enriching ? (
                            <>
                              <span className="animate-spin">&#8635;</span>
                              Searching...
                            </>
                          ) : (
                            <>
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
                              </svg>
                              Enrich from Web
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Enrichment Results */}
                  {(enrichmentResult || profile?.enrichedData) && (
                    <div className="space-y-4">
                      {/* Enriched Summary */}
                      {(enrichmentResult?.enrichedData?.summary || profile?.enrichedData?.summary) && (
                        <div className="bg-zinc-800/50 rounded-lg p-4">
                          <p className="text-zinc-300 text-sm">
                            {enrichmentResult?.enrichedData?.summary || profile?.enrichedData?.summary}
                          </p>
                        </div>
                      )}

                      {/* AI Reasoning (collapsible) */}
                      {(enrichmentResult?.reasoning || profile?.enrichedReasoning) && (
                        <div>
                          <button
                            onClick={() => setShowReasoning(!showReasoning)}
                            className="text-xs text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                          >
                            <svg
                              className={`w-3 h-3 transition-transform ${showReasoning ? 'rotate-90' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {showReasoning ? 'Hide' : 'Show'} AI reasoning
                          </button>
                          {showReasoning && (
                            <div className="mt-2 bg-zinc-800/30 rounded-lg p-3 text-xs text-zinc-400 border border-zinc-700/50">
                              <p className="font-medium text-zinc-300 mb-1">Match Analysis:</p>
                              <p>{enrichmentResult?.reasoning || profile?.enrichedReasoning}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Sources */}
                      {((enrichmentResult?.sources?.length ?? 0) > 0 || (profile?.enrichedSources?.length ?? 0) > 0) && (
                        <div className="text-xs">
                          <span className="text-zinc-500 block mb-1">Sources:</span>
                          <div className="flex flex-wrap gap-2">
                            {(enrichmentResult?.sources || profile?.enrichedSources)
                              ?.slice(0, showAllSources ? undefined : 5)
                              .map((source, i) => {
                                const { title, preview } = formatSourceDisplay(source)
                                return (
                                  <a
                                    key={i}
                                    href={source}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 rounded transition-colors text-blue-400 hover:text-blue-300"
                                    title={source}
                                  >
                                    {title.includes('LinkedIn') && (
                                      <svg className="w-3 h-3 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
                                      </svg>
                                    )}
                                    <span>{title}</span>
                                    {preview && (
                                      <span className="text-zinc-500 truncate max-w-[150px]">{preview}</span>
                                    )}
                                    <svg className="w-3 h-3 flex-shrink-0 text-zinc-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                    </svg>
                                  </a>
                                )
                              })}
                            {((enrichmentResult?.sources || profile?.enrichedSources)?.length ?? 0) > 5 && (
                              <button
                                onClick={() => setShowAllSources(!showAllSources)}
                                className="px-2 py-1 text-zinc-400 hover:text-zinc-300 transition-colors"
                              >
                                {showAllSources
                                  ? 'Show less'
                                  : `+${((enrichmentResult?.sources || profile?.enrichedSources)?.length ?? 0) - 5} more...`}
                              </button>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Verification Actions */}
                      {!profile?.humanVerified && (
                        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-zinc-700/50">
                          <button
                            onClick={() => handleVerify(true)}
                            disabled={verifying || enriching}
                            className="text-xs px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:bg-green-600/50 text-white rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Confirm Match
                          </button>
                          <button
                            onClick={() => setShowHintsInput(!showHintsInput)}
                            disabled={verifying || enriching}
                            className="text-xs px-3 py-1.5 bg-red-600 hover:bg-red-500 disabled:bg-red-600/50 text-white rounded-lg transition-colors flex items-center gap-1.5"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                            Wrong Person
                          </button>
                          <button
                            onClick={() => setEditing(true)}
                            className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors underline"
                          >
                            Edit manually
                          </button>
                        </div>
                      )}

                      {/* Human Verified Badge */}
                      {profile?.humanVerified && (
                        <div className="flex items-center gap-3 pt-2 border-t border-zinc-700/50">
                          <span className="text-xs text-green-400 flex items-center gap-1">
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            Verified by you
                            {profile.humanVerifiedAt && ` on ${formatDate(profile.humanVerifiedAt)}`}
                          </span>
                          <button
                            onClick={() => handleVerify(false)}
                            disabled={verifying}
                            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
                          >
                            Undo
                          </button>
                        </div>
                      )}

                      {/* Hints Input (shown when "Wrong Person" clicked) */}
                      {showHintsInput && (
                        <div className="mt-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                          <label className="block text-xs text-zinc-400 mb-2">
                            Add hints to find the right person:
                          </label>
                          <input
                            type="text"
                            value={hintsInput}
                            onChange={(e) => setHintsInput(e.target.value)}
                            placeholder="e.g., works at Orion Innovation, lives in Atlanta"
                            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-zinc-500 placeholder:text-zinc-600"
                          />
                          <div className="flex items-center gap-2 mt-2">
                            <button
                              onClick={handleWrongPerson}
                              disabled={verifying || enriching}
                              className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white rounded-lg transition-colors flex items-center gap-1.5"
                            >
                              {enriching ? (
                                <>
                                  <span className="animate-spin">&#8635;</span>
                                  Searching...
                                </>
                              ) : (
                                <>
                                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                  </svg>
                                  Search Again
                                </>
                              )}
                            </button>
                            <button
                              onClick={() => {
                                setShowHintsInput(false)
                                setHintsInput('')
                              }}
                              className="text-xs text-zinc-400 hover:text-zinc-300 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                          {profile?.rejectedProfiles && profile.rejectedProfiles.length > 0 && (
                            <p className="text-xs text-zinc-500 mt-2">
                              {profile.rejectedProfiles.length} profile{profile.rejectedProfiles.length > 1 ? 's' : ''} already rejected
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* No enrichment yet */}
                  {!enrichmentResult && !profile?.enrichedData && !enriching && (
                    <p className="text-zinc-500 text-sm">
                      Click &quot;Enrich from Web&quot; to search for {profile.name}&apos;s professional profile online.
                      AI will validate results against your meeting history.
                    </p>
                  )}
                </div>
              )}

              {/* AI Summary Section */}
              {!editing && (
                <div className="mt-6 pt-6 border-t border-zinc-800">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-zinc-300">AI Insights (from Meetings)</h3>
                    <button
                      onClick={() => handleEnrich(false)}
                      disabled={enriching}
                      className="text-xs px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white rounded-lg transition-colors flex items-center gap-2"
                    >
                      {enriching ? (
                        <>
                          <span className="animate-spin">&#8635;</span>
                          Analyzing...
                        </>
                      ) : profile.aiSummary ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          Refresh
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Generate Insights
                        </>
                      )}
                    </button>
                  </div>

                  {profile.aiSummary ? (
                    <div className="space-y-3">
                      <p className="text-zinc-300 text-sm">{profile.aiSummary}</p>
                      {profile.topics && profile.topics.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {profile.topics.map((topic, i) => (
                            <Link
                              key={i}
                              href={`/topics/${encodeURIComponent(topic)}`}
                              className="px-2 py-1 bg-purple-500/20 text-purple-400 hover:bg-purple-500/30 rounded text-xs transition-colors"
                            >
                              {topic}
                            </Link>
                          ))}
                        </div>
                      )}
                      {profile.enrichedAt && (
                        <p className="text-xs text-zinc-500">
                          Last updated: {formatDate(profile.enrichedAt)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p className="text-zinc-500 text-sm">
                      Click &quot;Generate Insights&quot; to analyze meeting transcripts and discover what {profile.name} typically discusses.
                    </p>
                  )}
                </div>
              )}

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
                                <span className="text-white">{getDisplayTitle(meeting.topic, meeting.title)}</span>
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

      {/* Merge Modal */}
      {profile && profile.entityId && (
        <EntityMergeModal
          isOpen={showMergeModal}
          entityType="speaker"
          currentEntity={{
            id: profile.entityId,
            name: profile.name,
            aliases: [],
          }}
          onClose={() => setShowMergeModal(false)}
          onMergeComplete={() => {
            // Refresh the page after merge
            window.location.reload()
          }}
        />
      )}
    </Shell>
  )
}

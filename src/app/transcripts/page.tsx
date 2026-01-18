'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Link from 'next/link'
import Shell from '@/components/Shell'
import ExpandableSpeakers from '@/components/ExpandableSpeakers'
import SpeakerTalkTime from '@/components/SpeakerTalkTime'
import ChatTranscript from '@/components/ChatTranscript'
import SpeakerEditModal from '@/components/SpeakerEditModal'
import SpeakerInferenceModal from '@/components/SpeakerInferenceModal'
import { parseTranscript, createSpeakerColorMap, type ParsedTranscript } from '@/lib/transcriptParser'

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
  // Relevance analysis for short calls
  isIrrelevant?: boolean
  irrelevanceReason?: string | null
  irrelevanceConfidence?: number | null
  irrelevanceDismissed?: boolean
}

type DateFilter = 'all' | 'today' | 'week' | 'month'
type SortOption = 'newest' | 'oldest' | 'longest'
type ViewMode = 'chat' | 'raw'

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

  // Multi-select state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isBulkDeleting, setIsBulkDeleting] = useState(false)
  const [isBulkUpdatingPrivacy, setIsBulkUpdatingPrivacy] = useState(false)
  const [showBulkDeleteConfirm, setShowBulkDeleteConfirm] = useState(false)

  // Filter and sort state
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [speakerFilter, setSpeakerFilter] = useState<string>('all')
  const [sortOption, setSortOption] = useState<SortOption>('newest')

  // View mode state (chat bubbles vs raw text)
  const [viewMode, setViewMode] = useState<ViewMode>('chat')

  // Speaker edit modal state
  const [editingSpeaker, setEditingSpeaker] = useState<{ original: string; current: string } | null>(null)
  const [savingSpeaker, setSavingSpeaker] = useState(false)

  // Speaker inference modal state
  const [showInferenceModal, setShowInferenceModal] = useState(false)

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

// Handle speaker name save
  async function handleSpeakerSave(newName: string) {
    if (!editingSpeaker || !selectedTranscript) return

    setSavingSpeaker(true)
    try {
      // Update DynamoDB with the new speaker correction
      const response = await fetch(`/api/transcripts`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meetingId: selectedTranscript.meetingId,
          speakerCorrection: {
            originalName: editingSpeaker.original,
            correctedName: newName
          }
        })
      })

      if (!response.ok) {
        throw new Error('Failed to save speaker correction')
      }

      // Update local state immediately
      const updatedCorrections = {
        ...selectedTranscript.speakerCorrections,
        [editingSpeaker.original.toLowerCase()]: { name: newName }
      }

      // Update selectedTranscript
      setSelectedTranscript({
        ...selectedTranscript,
        speakerCorrections: updatedCorrections
      })

      // Update transcripts list
      setTranscripts(prev => prev.map(t =>
        t.meetingId === selectedTranscript.meetingId
          ? { ...t, speakerCorrections: updatedCorrections }
          : t
      ))

      setEditingSpeaker(null)
    } catch (err) {
      console.error('Error saving speaker:', err)
      // For now, still update locally even if API fails
      // This allows the feature to work without backend changes
      const updatedCorrections = {
        ...selectedTranscript.speakerCorrections,
        [editingSpeaker.original.toLowerCase()]: { name: newName }
      }

      setSelectedTranscript({
        ...selectedTranscript,
        speakerCorrections: updatedCorrections
      })

      setTranscripts(prev => prev.map(t =>
        t.meetingId === selectedTranscript.meetingId
          ? { ...t, speakerCorrections: updatedCorrections }
          : t
      ))

      setEditingSpeaker(null)
    } finally {
      setSavingSpeaker(false)
    }
  }

  // Handle speaker click from components
  function handleSpeakerClick(originalSpeaker: string) {
    if (!selectedTranscript) return
    const { displayName } = applySpeakerCorrection(originalSpeaker, selectedTranscript.speakerCorrections)
    setEditingSpeaker({
      original: originalSpeaker,
      current: displayName
    })
  }

  // Check if a speaker name is generic
  function isGenericSpeaker(name: string): boolean {
    const lower = name.toLowerCase().trim()
    return (
      /^speaker\s*\d+$/i.test(lower) ||
      /^participant\s*\d+$/i.test(lower) ||
      lower === 'guest' ||
      lower === 'unknown' ||
      lower === 'me' ||
      /^person\s*\d+$/i.test(lower)
    )
  }

  // Check if transcript has generic speakers that haven't been corrected yet
  function hasUncorrectedGenericSpeakers(transcript: Transcript): boolean {
    return transcript.speakers.some(speaker => {
      if (!isGenericSpeaker(speaker)) return false
      // Check if already corrected
      if (transcript.speakerCorrections) {
        const key = speaker.toLowerCase()
        if (transcript.speakerCorrections[key]) return false
      }
      return true
    })
  }

  // Handle applying multiple speaker corrections from inference
  async function handleApplyInferences(corrections: Array<{ originalName: string; correctedName: string }>) {
    if (!selectedTranscript || corrections.length === 0) return

    // Apply each correction sequentially
    for (const correction of corrections) {
      try {
        const response = await fetch(`/api/transcripts`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId: selectedTranscript.meetingId,
            speakerCorrection: {
              originalName: correction.originalName,
              correctedName: correction.correctedName
            }
          })
        })

        if (!response.ok) {
          console.error('Failed to save correction for:', correction.originalName)
        }
      } catch (err) {
        console.error('Error saving correction:', err)
      }
    }

    // Update local state with all corrections
    const updatedCorrections = { ...selectedTranscript.speakerCorrections }
    for (const correction of corrections) {
      updatedCorrections[correction.originalName.toLowerCase()] = { name: correction.correctedName }
    }

    // Update selectedTranscript
    setSelectedTranscript({
      ...selectedTranscript,
      speakerCorrections: updatedCorrections
    })

    // Update transcripts list
    setTranscripts(prev => prev.map(t =>
      t.meetingId === selectedTranscript.meetingId
        ? { ...t, speakerCorrections: updatedCorrections }
        : t
    ))
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

  async function handleDismissIrrelevanceWarning() {
    if (!selectedTranscript) return
    try {
      const res = await fetch(`/api/transcripts/${selectedTranscript.meetingId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ irrelevanceDismissed: true }),
      })
      if (!res.ok) throw new Error('Failed to dismiss warning')

      // Update local state
      setTranscripts(prev => prev.map(t =>
        t.meetingId === selectedTranscript.meetingId
          ? { ...t, irrelevanceDismissed: true }
          : t
      ))
      setSelectedTranscript(prev => prev ? { ...prev, irrelevanceDismissed: true } : null)
    } catch (err) {
      console.error('Error dismissing warning:', err)
    }
  }

  // Multi-select handlers
  function toggleSelection(meetingId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(meetingId)) {
        next.delete(meetingId)
      } else {
        next.add(meetingId)
      }
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedIds.size === filteredTranscripts.length) {
      // Deselect all
      setSelectedIds(new Set())
    } else {
      // Select all visible
      setSelectedIds(new Set(filteredTranscripts.map(t => t.meetingId)))
    }
  }

  function clearSelection() {
    setSelectedIds(new Set())
    setShowBulkDeleteConfirm(false)
  }

  async function handleBulkDelete() {
    if (selectedIds.size === 0) return
    setIsBulkDeleting(true)
    try {
      const res = await fetch('/api/transcripts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          meetingIds: Array.from(selectedIds),
        }),
      })
      if (!res.ok) throw new Error('Failed to delete transcripts')

      const data = await res.json()

      // Remove deleted transcripts from local state
      setTranscripts(prev => prev.filter(t => !data.results.success.includes(t.meetingId)))

      // Clear selection and close detail panel if selected item was deleted
      if (selectedTranscript && selectedIds.has(selectedTranscript.meetingId)) {
        setSelectedTranscript(null)
      }
      clearSelection()

      if (data.results.failed.length > 0) {
        alert(`Deleted ${data.results.success.length} transcripts. ${data.results.failed.length} failed.`)
      }
    } catch (err) {
      console.error('Error bulk deleting:', err)
      alert('Failed to delete transcripts. Please try again.')
    } finally {
      setIsBulkDeleting(false)
      setShowBulkDeleteConfirm(false)
    }
  }

  async function handleBulkMarkPrivate() {
    if (selectedIds.size === 0) return
    setIsBulkUpdatingPrivacy(true)
    try {
      const res = await fetch('/api/transcripts/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'markPrivate',
          meetingIds: Array.from(selectedIds),
        }),
      })
      if (!res.ok) throw new Error('Failed to mark transcripts as private')

      const data = await res.json()

      // Remove from view (private transcripts are hidden)
      setTranscripts(prev => prev.filter(t => !data.results.success.includes(t.meetingId)))

      // Clear selection and close detail panel if selected item was marked private
      if (selectedTranscript && selectedIds.has(selectedTranscript.meetingId)) {
        setSelectedTranscript(null)
      }
      clearSelection()

      if (data.results.failed.length > 0) {
        alert(`Marked ${data.results.success.length} transcripts as private. ${data.results.failed.length} failed.`)
      }
    } catch (err) {
      console.error('Error marking private:', err)
      alert('Failed to mark transcripts as private. Please try again.')
    } finally {
      setIsBulkUpdatingPrivacy(false)
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
                {/* Bulk Action Bar - at top */}
                {selectedIds.size > 0 && (
                  <div className="sticky top-0 z-10 p-3 border-b border-gray-200 dark:border-gray-700 bg-blue-50 dark:bg-blue-900/20">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {/* Select all checkbox */}
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={selectedIds.size === filteredTranscripts.length}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate = selectedIds.size > 0 && selectedIds.size < filteredTranscripts.length
                              }
                            }}
                            onChange={toggleSelectAll}
                            className="w-4 h-4 text-primary-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-primary-500 focus:ring-2 cursor-pointer"
                          />
                          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            {selectedIds.size} selected
                          </span>
                        </label>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* Hide from AI Button */}
                        <button
                          onClick={handleBulkMarkPrivate}
                          disabled={isBulkUpdatingPrivacy || isBulkDeleting}
                          className="px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-100 dark:bg-amber-900/30 hover:bg-amber-200 dark:hover:bg-amber-900/50 rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                        >
                          {isBulkUpdatingPrivacy ? (
                            <>
                              <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-amber-600 dark:border-amber-400"></div>
                              Processing...
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                              Hide from AI
                            </>
                          )}
                        </button>

                        {/* Delete Button */}
                        {!showBulkDeleteConfirm ? (
                          <button
                            onClick={() => setShowBulkDeleteConfirm(true)}
                            disabled={isBulkUpdatingPrivacy || isBulkDeleting}
                            className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                            Delete
                          </button>
                        ) : (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-red-100 dark:bg-red-900/30 rounded-lg">
                            <span className="text-sm text-red-600 dark:text-red-400">
                              Delete {selectedIds.size} permanently?
                            </span>
                            <button
                              onClick={handleBulkDelete}
                              disabled={isBulkDeleting}
                              className="px-2 py-0.5 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
                            >
                              {isBulkDeleting ? 'Deleting...' : 'Yes'}
                            </button>
                            <button
                              onClick={() => setShowBulkDeleteConfirm(false)}
                              className="px-2 py-0.5 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
                            >
                              No
                            </button>
                          </div>
                        )}

                        {/* Clear Selection Button */}
                        <button
                          onClick={clearSelection}
                          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors"
                          title="Clear selection"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}

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
                            className={`px-4 py-3 cursor-pointer transition-colors flex items-start gap-3 ${
                              selectedIds.has(transcript.meetingId)
                                ? 'bg-blue-50 dark:bg-blue-900/20'
                                : selectedTranscript?.key === transcript.key
                                  ? 'bg-primary-50 dark:bg-primary-900/20'
                                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                            }`}
                          >
                            {/* Checkbox */}
                            <div
                              className="flex-shrink-0 pt-0.5"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleSelection(transcript.meetingId)
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.has(transcript.meetingId)}
                                onChange={() => {}}
                                className="w-4 h-4 text-primary-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-primary-500 focus:ring-2 cursor-pointer"
                              />
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
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
                <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-4 sticky top-4 max-h-[calc(100vh-8rem)] overflow-y-auto">
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
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">Speakers</h3>
                        {hasUncorrectedGenericSpeakers(selectedTranscript) && (
                          <button
                            onClick={() => setShowInferenceModal(true)}
                            className="px-2.5 py-1 text-xs font-medium bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 dark:hover:bg-indigo-900/50 rounded-lg flex items-center gap-1.5 transition-colors"
                            title="Use AI to identify unknown speakers from transcript content"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Identify Speakers
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedTranscript.speakers.map((speaker, i) => {
                          const { displayName, wasCorrected, linkedin } = applySpeakerCorrection(
                            speaker,
                            selectedTranscript.speakerCorrections
                          )
                          return (
                            <span
                              key={i}
                              className={`px-2.5 py-1 rounded-full text-sm inline-flex items-center gap-1.5 ${
                                wasCorrected
                                  ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                                  : 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400'
                              }`}
                            >
                              <Link
                                href={`/speakers/${encodeURIComponent(displayName)}`}
                                className="hover:underline"
                                title={`View ${displayName}'s profile`}
                              >
                                {displayName}
                              </Link>
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
                              <button
                                onClick={() => handleSpeakerClick(speaker)}
                                className="hover:opacity-70 transition-opacity"
                                title={wasCorrected ? `Corrected from: ${speaker}. Click to edit.` : 'Click to edit speaker name'}
                              >
                                <svg
                                  className="w-3 h-3 opacity-50 hover:opacity-100"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                </svg>
                              </button>
                            </span>
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

                  {/* Irrelevance Warning Banner */}
                  {selectedTranscript.isIrrelevant && !selectedTranscript.irrelevanceDismissed && (
                    <div className="mb-4 p-3 rounded-lg border bg-gray-100 dark:bg-gray-700/50 border-gray-300 dark:border-gray-600">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 mt-0.5 flex-shrink-0 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                            Likely irrelevant - Test call or no discernible topic
                          </p>
                          {selectedTranscript.irrelevanceReason && (
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                              {selectedTranscript.irrelevanceReason}
                            </p>
                          )}
                          <div className="flex items-center gap-2 mt-2 text-xs text-gray-500 dark:text-gray-400">
                            <span>{Math.floor(selectedTranscript.duration / 60)}:{(selectedTranscript.duration % 60).toString().padStart(2, '0')} duration</span>
                            {selectedTranscript.irrelevanceConfidence && (
                              <>
                                <span>·</span>
                                <span>{selectedTranscript.irrelevanceConfidence}% confidence</span>
                              </>
                            )}
                          </div>
                          <div className="flex gap-2 mt-3">
                            <button
                              onClick={handleDismissIrrelevanceWarning}
                              className="text-xs px-3 py-1.5 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-300 dark:hover:bg-gray-500"
                            >
                              This is relevant - Dismiss
                            </button>
                            <button
                              onClick={() => setShowDeleteConfirm(true)}
                              className="text-xs px-3 py-1.5 text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Privacy & Delete Actions */}
                  <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-100 dark:border-gray-600">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => handlePrivacyToggle(!selectedTranscript.isPrivate)}
                        disabled={isUpdatingPrivacy}
                        className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 ${
                          selectedTranscript.isPrivate
                            ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                            : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 border border-green-200 dark:border-green-800 hover:bg-green-100 dark:hover:bg-green-900/30'
                        }`}
                        title={selectedTranscript.isPrivate
                          ? 'This transcript is hidden from AI search. Click to make searchable.'
                          : 'This transcript is searchable by AI. Click to hide it.'}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          {selectedTranscript.isPrivate ? (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          ) : (
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          )}
                        </svg>
                        <span className="font-medium">
                          {selectedTranscript.isPrivate ? 'Hidden from AI' : 'Searchable by AI'}
                        </span>
                      </button>
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {selectedTranscript.isPrivate ? 'Click to make searchable' : 'Click to hide'}
                      </span>
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
                    <TranscriptDetail
                      data={transcriptContent}
                      transcript={selectedTranscript}
                      viewMode={viewMode}
                      onViewModeChange={setViewMode}
                      onSpeakerClick={handleSpeakerClick}
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Speaker Edit Modal */}
      <SpeakerEditModal
        isOpen={!!editingSpeaker}
        originalName={editingSpeaker?.original || ''}
        currentName={editingSpeaker?.current || ''}
        onSave={handleSpeakerSave}
        onCancel={() => setEditingSpeaker(null)}
      />

      {/* Speaker Inference Modal */}
      {selectedTranscript && (
        <SpeakerInferenceModal
          isOpen={showInferenceModal}
          meetingId={selectedTranscript.meetingId}
          onClose={() => setShowInferenceModal(false)}
          onApply={handleApplyInferences}
        />
      )}
    </Shell>
  )
}

interface TranscriptDetailProps {
  data: TranscriptContent
  transcript: Transcript
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onSpeakerClick: (speaker: string) => void
}

interface DetailedSummary {
  overview: string
  keyDiscussionPoints: string[]
  decisions: string[]
  actionItems: string[]
  importantTopics: string[]
  generatedAt: string
}

interface LinkedDocument {
  documentId: string
  title: string
  filename?: string
  fileType?: string
  fileSize?: number
  format: string
  importedAt: string
  wordCount: number
}

function TranscriptDetail({
  data,
  transcript,
  viewMode,
  onViewModeChange,
  onSpeakerClick
}: TranscriptDetailProps) {
  const [detailedSummary, setDetailedSummary] = useState<DetailedSummary | null>(null)
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isSummaryExpanded, setIsSummaryExpanded] = useState(true)

  // Linked documents state
  const [linkedDocuments, setLinkedDocuments] = useState<LinkedDocument[]>([])
  const [loadingDocuments, setLoadingDocuments] = useState(false)
  const [showLinkDocumentModal, setShowLinkDocumentModal] = useState(false)
  const [availableDocuments, setAvailableDocuments] = useState<LinkedDocument[]>([])
  const [loadingAvailableDocuments, setLoadingAvailableDocuments] = useState(false)
  const [linkingDocumentId, setLinkingDocumentId] = useState<string | null>(null)

  const rawPayload = data.raw_payload
  const transcriptData = rawPayload?.data

  const summary = transcriptData?.raw_meeting
  const rawContent = transcriptData?.raw_content

  // Parse the transcript for chat view and talk time stats
  const parsedTranscript: ParsedTranscript | null = useMemo(() => {
    if (!rawContent) return null
    return parseTranscript(rawContent, transcript.duration)
  }, [rawContent, transcript.duration])

  const speakerColorMap = useMemo(() => {
    if (!parsedTranscript) return new Map<string, number>()
    return createSpeakerColorMap(parsedTranscript.segments)
  }, [parsedTranscript])

  // Check for cached summary on mount
  useEffect(() => {
    async function checkCachedSummary() {
      try {
        const res = await fetch(`/api/transcripts/${transcript.meetingId}/summarize`)
        if (res.ok) {
          const data = await res.json()
          if (data.summary) {
            setDetailedSummary(data.summary)
          }
        }
      } catch (err) {
        // Ignore errors, just means no cached summary
      }
    }
    checkCachedSummary()
  }, [transcript.meetingId])

  // Fetch linked documents
  useEffect(() => {
    async function fetchLinkedDocuments() {
      setLoadingDocuments(true)
      try {
        const res = await fetch(`/api/transcripts/${transcript.meetingId}/documents`)
        if (res.ok) {
          const data = await res.json()
          setLinkedDocuments(data.documents || [])
        }
      } catch (err) {
        console.error('Error fetching linked documents:', err)
      } finally {
        setLoadingDocuments(false)
      }
    }
    fetchLinkedDocuments()
  }, [transcript.meetingId])

  // Open link document modal and fetch available documents
  async function openLinkDocumentModal() {
    setShowLinkDocumentModal(true)
    setLoadingAvailableDocuments(true)
    try {
      const res = await fetch('/api/documents')
      if (res.ok) {
        const data = await res.json()
        setAvailableDocuments(data.documents || [])
      }
    } catch (err) {
      console.error('Error fetching available documents:', err)
    } finally {
      setLoadingAvailableDocuments(false)
    }
  }

  // Link a document to this transcript
  async function linkDocument(documentId: string) {
    setLinkingDocumentId(documentId)
    try {
      const res = await fetch(`/api/transcripts/${transcript.meetingId}/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId }),
      })
      if (res.ok) {
        // Refresh linked documents
        const docsRes = await fetch(`/api/transcripts/${transcript.meetingId}/documents`)
        if (docsRes.ok) {
          const data = await docsRes.json()
          setLinkedDocuments(data.documents || [])
        }
        setShowLinkDocumentModal(false)
      }
    } catch (err) {
      console.error('Error linking document:', err)
    } finally {
      setLinkingDocumentId(null)
    }
  }

  // Unlink a document from this transcript
  async function unlinkDocument(documentId: string) {
    try {
      const res = await fetch(`/api/transcripts/${transcript.meetingId}/documents?documentId=${documentId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setLinkedDocuments(prev => prev.filter(d => d.documentId !== documentId))
      }
    } catch (err) {
      console.error('Error unlinking document:', err)
    }
  }

  function formatFileSize(bytes?: number) {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDocDate(dateStr: string) {
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

  async function generateDetailedSummary(forceRefresh = false) {
    setIsGeneratingSummary(true)
    setSummaryError(null)

    try {
      const res = await fetch(`/api/transcripts/${transcript.meetingId}/summarize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceRefresh }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to generate summary')
      }

      const data = await res.json()
      setDetailedSummary(data.summary)
      setIsSummaryExpanded(true)
    } catch (err) {
      setSummaryError(String(err))
    } finally {
      setIsGeneratingSummary(false)
    }
  }

  return (
    <div className="space-y-4 text-sm">
      {/* Quick Summary from Krisp */}
      {summary && (
        <div>
          <h3 className="text-gray-700 dark:text-gray-300 font-medium mb-2">Quick Summary</h3>
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-32 overflow-y-auto border border-gray-100 dark:border-gray-600">
            <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap text-xs">{summary}</p>
          </div>
        </div>
      )}

      {/* Detailed AI Summary */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
            Detailed Analysis
          </h3>
          {!detailedSummary && !isGeneratingSummary && (
            <button
              onClick={() => generateDetailedSummary()}
              className="px-3 py-1.5 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Generate Summary
            </button>
          )}
          {detailedSummary && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSummaryExpanded(!isSummaryExpanded)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                {isSummaryExpanded ? 'Collapse' : 'Expand'}
              </button>
              <button
                onClick={() => generateDetailedSummary(true)}
                disabled={isGeneratingSummary}
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 disabled:opacity-50"
              >
                Regenerate
              </button>
            </div>
          )}
        </div>

        {isGeneratingSummary && (
          <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-4 border border-indigo-100 dark:border-indigo-800">
            <div className="flex items-center gap-3">
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-indigo-600"></div>
              <div>
                <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">Analyzing transcript...</p>
                <p className="text-xs text-indigo-600 dark:text-indigo-400">This may take a few seconds</p>
              </div>
            </div>
          </div>
        )}

        {summaryError && (
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-600 dark:text-red-400">{summaryError}</p>
            <button
              onClick={() => generateDetailedSummary()}
              className="mt-2 text-xs text-red-700 dark:text-red-300 hover:underline"
            >
              Try again
            </button>
          </div>
        )}

        {detailedSummary && isSummaryExpanded && (
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-100 dark:border-indigo-800 overflow-hidden">
            {/* Overview */}
            <div className="p-4 border-b border-indigo-100 dark:border-indigo-800/50">
              <p className="text-gray-700 dark:text-gray-300 text-sm leading-relaxed">{detailedSummary.overview}</p>
            </div>

            <div className="p-4 space-y-4">
              {/* Key Discussion Points */}
              {Array.isArray(detailedSummary.keyDiscussionPoints) && detailedSummary.keyDiscussionPoints.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    Key Discussion Points
                  </h4>
                  <ul className="space-y-1.5">
                    {detailedSummary.keyDiscussionPoints.map((point, i) => (
                      <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                        <span className="text-blue-500 mt-0.5">-</span>
                        <span>{point}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Decisions */}
              {Array.isArray(detailedSummary.decisions) && detailedSummary.decisions.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Decisions Made
                  </h4>
                  <ul className="space-y-1.5">
                    {detailedSummary.decisions.map((decision, i) => (
                      <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                        <span className="text-green-500 mt-0.5">-</span>
                        <span>{decision}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Action Items */}
              {Array.isArray(detailedSummary.actionItems) && detailedSummary.actionItems.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                    </svg>
                    Action Items
                  </h4>
                  <ul className="space-y-1.5">
                    {detailedSummary.actionItems.map((item, i) => (
                      <li key={i} className="text-xs text-gray-600 dark:text-gray-400 flex items-start gap-2">
                        <span className="text-amber-500 mt-0.5">-</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Topics */}
              {Array.isArray(detailedSummary.importantTopics) && detailedSummary.importantTopics.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                    <svg className="w-3.5 h-3.5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                    </svg>
                    Topics Covered
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {detailedSummary.importantTopics.map((topic, i) => (
                      <span
                        key={i}
                        className="px-2 py-0.5 text-xs bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded-full"
                      >
                        {topic}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer with timestamp */}
            <div className="px-4 py-2 bg-white/50 dark:bg-black/10 border-t border-indigo-100 dark:border-indigo-800/50">
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Generated {new Date(detailedSummary.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        )}

        {detailedSummary && !isSummaryExpanded && (
          <div
            onClick={() => setIsSummaryExpanded(true)}
            className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-100 dark:border-gray-600 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2">{detailedSummary.overview}</p>
            <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">Click to expand full analysis</p>
          </div>
        )}

        {!detailedSummary && !isGeneratingSummary && !summaryError && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 border border-gray-100 dark:border-gray-600 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Click "Generate Summary" to get a detailed AI analysis including key points, decisions, and action items.
            </p>
          </div>
        )}
      </div>

      {/* Speaker Talk Time Stats */}
      {parsedTranscript && parsedTranscript.speakerStats.length > 0 && (
        <SpeakerTalkTime
          speakerStats={parsedTranscript.speakerStats}
          speakerCorrections={transcript.speakerCorrections}
          onSpeakerClick={onSpeakerClick}
        />
      )}

      {/* Linked Documents Section */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-gray-700 dark:text-gray-300 font-medium flex items-center gap-2">
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Linked Documents ({linkedDocuments.length})
          </h3>
          <button
            onClick={openLinkDocumentModal}
            className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex items-center gap-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Link Document
          </button>
        </div>

        {loadingDocuments ? (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-100 dark:border-gray-600 flex items-center justify-center">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">Loading documents...</span>
          </div>
        ) : linkedDocuments.length === 0 ? (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-100 dark:border-gray-600 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              No documents linked to this transcript. Click "Link Document" to associate relevant documents.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {linkedDocuments.map((doc) => (
              <div
                key={doc.documentId}
                className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 border border-gray-100 dark:border-gray-600 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/documents?id=${doc.documentId}`}
                    className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline truncate block"
                  >
                    {doc.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                    <span className="uppercase font-medium px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 rounded text-gray-600 dark:text-gray-300">
                      {doc.format}
                    </span>
                    <span>{doc.wordCount.toLocaleString()} words</span>
                    {doc.fileSize && <span>{formatFileSize(doc.fileSize)}</span>}
                    <span>{formatDocDate(doc.importedAt)}</span>
                  </div>
                </div>
                <button
                  onClick={() => unlinkDocument(doc.documentId)}
                  className="ml-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 p-1"
                  title="Unlink document"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Link Document Modal */}
        {showLinkDocumentModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
              <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Link Document</h3>
                <button
                  onClick={() => setShowLinkDocumentModal(false)}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-white"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-4 overflow-y-auto flex-1">
                {loadingAvailableDocuments ? (
                  <div className="flex items-center justify-center py-8">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                    <span className="ml-3 text-gray-500 dark:text-gray-400">Loading documents...</span>
                  </div>
                ) : availableDocuments.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-gray-500 dark:text-gray-400 mb-4">No documents available to link</p>
                    <Link
                      href="/documents"
                      className="text-blue-600 dark:text-blue-400 hover:underline text-sm"
                    >
                      Upload a document first
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {availableDocuments
                      .filter(d => !linkedDocuments.some(ld => ld.documentId === d.documentId))
                      .map((doc) => (
                        <button
                          key={doc.documentId}
                          onClick={() => linkDocument(doc.documentId)}
                          disabled={linkingDocumentId === doc.documentId}
                          className="w-full text-left p-3 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg border border-gray-200 dark:border-gray-600 transition-colors disabled:opacity-50"
                        >
                          <div className="font-medium text-gray-900 dark:text-white">
                            {doc.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500 dark:text-gray-400">
                            <span className="uppercase font-medium">{doc.format}</span>
                            <span>{doc.wordCount.toLocaleString()} words</span>
                            <span>{formatDocDate(doc.importedAt)}</span>
                          </div>
                          {linkingDocumentId === doc.documentId && (
                            <div className="mt-2 flex items-center gap-2 text-blue-600 dark:text-blue-400">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
                              Linking...
                            </div>
                          )}
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Transcript with view toggle */}
      {rawContent && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-gray-700 dark:text-gray-300 font-medium">Full Transcript</h3>

            {/* View toggle */}
            <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-0.5">
              <button
                onClick={() => onViewModeChange('chat')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'chat'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  Chat
                </span>
              </button>
              <button
                onClick={() => onViewModeChange('raw')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                <span className="flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
                  </svg>
                  Raw
                </span>
              </button>
            </div>
          </div>

          {viewMode === 'chat' && parsedTranscript ? (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 max-h-96 overflow-y-auto border border-gray-100 dark:border-gray-600">
              <ChatTranscript
                segments={parsedTranscript.segments}
                speakerColorMap={speakerColorMap}
                speakerCorrections={transcript.speakerCorrections}
                onSpeakerClick={onSpeakerClick}
              />
            </div>
          ) : (
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-64 overflow-y-auto border border-gray-100 dark:border-gray-600">
              <p className="text-gray-600 dark:text-gray-400 whitespace-pre-wrap text-xs">{rawContent}</p>
            </div>
          )}
        </div>
      )}

      {/* Raw JSON fallback */}
      {!summary && !rawContent && (
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

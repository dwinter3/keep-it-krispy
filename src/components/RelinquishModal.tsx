'use client'

import { useState, useEffect } from 'react'

interface RelinquishModalProps {
  isOpen: boolean
  meetingId: string
  transcriptTitle: string
  onClose: () => void
  onRelinquished?: () => void
}

interface RelinquishInfo {
  isOwner: boolean
  isAlreadyTeamOwned: boolean
  canRelinquish: boolean
  teamId: string | null
  teamMemberCount: number
  relinquishedBy: string | null
  relinquishedAt: string | null
}

/**
 * Modal for transferring transcript ownership to a team
 *
 * This operation:
 * - Changes owner_type from 'user' to 'team'
 * - Changes owner_id to the team_id
 * - Sets visibility to 'team_owned'
 * - Grants read access to all team members
 * - Original owner retains read access while in the team
 * - Cannot be undone
 */
export default function RelinquishModal({
  isOpen,
  meetingId,
  transcriptTitle,
  onClose,
  onRelinquished,
}: RelinquishModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [relinquishInfo, setRelinquishInfo] = useState<RelinquishInfo | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  // Load relinquish info when modal opens
  useEffect(() => {
    if (isOpen && meetingId) {
      loadRelinquishInfo()
      setConfirmed(false)
    }
  }, [isOpen, meetingId])

  async function loadRelinquishInfo() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/transcripts/${meetingId}/relinquish`)
      if (!response.ok) {
        throw new Error('Failed to load transfer info')
      }

      const data = await response.json()
      setRelinquishInfo(data)
    } catch (err) {
      console.error('Error loading relinquish info:', err)
      setError('Failed to load transfer information')
    } finally {
      setLoading(false)
    }
  }

  async function handleRelinquish() {
    if (!confirmed || !relinquishInfo?.canRelinquish) return

    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/transcripts/${meetingId}/relinquish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: relinquishInfo.teamId }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        throw new Error(errorData.error || 'Failed to transfer ownership')
      }

      onRelinquished?.()
      onClose()
    } catch (err) {
      console.error('Error relinquishing transcript:', err)
      setError(err instanceof Error ? err.message : 'Failed to transfer ownership')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-purple-50 dark:bg-purple-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 dark:bg-purple-900/40 rounded-lg">
                <svg className="w-5 h-5 text-purple-600 dark:text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Transfer to Team
                </h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-[280px]">
                  {transcriptTitle}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-500 dark:text-gray-400">Loading...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          ) : !relinquishInfo?.isOwner ? (
            <div className="text-center py-6">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Only the owner can transfer ownership of this transcript.
              </p>
            </div>
          ) : relinquishInfo?.isAlreadyTeamOwned ? (
            <div className="text-center py-6">
              <svg className="mx-auto h-12 w-12 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                This transcript is already team-owned.
              </p>
            </div>
          ) : !relinquishInfo?.teamId ? (
            <div className="text-center py-6">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                You must be part of a team to transfer transcripts.
              </p>
              <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                Invite colleagues from the Settings page to build your team.
              </p>
            </div>
          ) : (
            <>
              {/* Warning section */}
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-4">
                <div className="flex gap-3">
                  <svg className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <h4 className="text-sm font-medium text-amber-800 dark:text-amber-300">
                      This action cannot be undone
                    </h4>
                    <p className="mt-1 text-sm text-amber-700 dark:text-amber-400">
                      Transferring ownership to the team is permanent. You will retain read-only access while you are a member of the team.
                    </p>
                  </div>
                </div>
              </div>

              {/* What will happen */}
              <div className="space-y-3 mb-4">
                <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  What happens when you transfer:
                </h4>
                <ul className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
                  <li className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>
                      <strong>{relinquishInfo.teamMemberCount}</strong> team member{relinquishInfo.teamMemberCount !== 1 ? 's' : ''} will gain read access
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>The transcript will be owned by the team, not you</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span>You will keep read-only access while you remain in the team</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span>If you leave the team, you will lose access to this transcript</span>
                  </li>
                </ul>
              </div>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="w-4 h-4 mt-0.5 text-purple-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-purple-500 focus:ring-2"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">
                  I understand that this transfer is permanent and cannot be undone
                </span>
              </label>
            </>
          )}
        </div>

        {/* Footer */}
        {relinquishInfo?.canRelinquish && !loading && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleRelinquish}
              disabled={saving || !confirmed}
              className="px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 disabled:bg-purple-600/50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {saving ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Transferring...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  Transfer to Team
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

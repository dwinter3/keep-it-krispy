'use client'

import { useState, useEffect } from 'react'

interface TeamMember {
  user_id: string
  email: string
  name: string
  relationship: 'inviter' | 'invitee' | 'peer'
}

interface SharedUser {
  user_id: string
  name: string
  email: string
}

interface ShareModalProps {
  isOpen: boolean
  meetingId: string
  transcriptTitle: string
  onClose: () => void
  onShareChange?: () => void
}

/**
 * Modal for sharing transcripts with team members
 */
export default function ShareModal({
  isOpen,
  meetingId,
  transcriptTitle,
  onClose,
  onShareChange,
}: ShareModalProps) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [sharedWith, setSharedWith] = useState<SharedUser[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isOwner, setIsOwner] = useState(true)

  // Load sharing info when modal opens
  useEffect(() => {
    if (isOpen && meetingId) {
      loadShareInfo()
    }
  }, [isOpen, meetingId])

  async function loadShareInfo() {
    setLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/transcripts/${meetingId}/share`)
      if (!response.ok) {
        throw new Error('Failed to load sharing info')
      }

      const data = await response.json()
      setTeamMembers(data.teamMembers || [])
      setSharedWith(data.sharedWith || [])
      setIsOwner(data.isOwner ?? true)

      // Pre-select currently shared users
      const sharedIds = new Set<string>((data.sharedWith || []).map((u: SharedUser) => u.user_id))
      setSelectedIds(sharedIds)
    } catch (err) {
      console.error('Error loading share info:', err)
      setError('Failed to load sharing information')
    } finally {
      setLoading(false)
    }
  }

  function toggleUser(userId: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(userId)) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })
  }

  async function handleSave() {
    setSaving(true)
    setError(null)

    try {
      // Determine what changed
      const currentlySharedIds = new Set(sharedWith.map(u => u.user_id))
      const toAdd = [...selectedIds].filter(id => !currentlySharedIds.has(id))
      const toRemove = [...currentlySharedIds].filter(id => !selectedIds.has(id))

      // Add new shares
      if (toAdd.length > 0) {
        const addResponse = await fetch(`/api/transcripts/${meetingId}/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: toAdd }),
        })

        if (!addResponse.ok) {
          const errorData = await addResponse.json()
          throw new Error(errorData.error || 'Failed to share transcript')
        }
      }

      // Remove shares
      if (toRemove.length > 0) {
        const removeResponse = await fetch(`/api/transcripts/${meetingId}/share`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userIds: toRemove }),
        })

        if (!removeResponse.ok) {
          const errorData = await removeResponse.json()
          throw new Error(errorData.error || 'Failed to update sharing')
        }
      }

      // Notify parent and close
      onShareChange?.()
      onClose()
    } catch (err) {
      console.error('Error saving shares:', err)
      setError(err instanceof Error ? err.message : 'Failed to save sharing settings')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveShare(userId: string) {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch(`/api/transcripts/${meetingId}/share`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: [userId] }),
      })

      if (!response.ok) {
        throw new Error('Failed to remove share')
      }

      // Update local state
      setSharedWith(prev => prev.filter(u => u.user_id !== userId))
      setSelectedIds(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })

      onShareChange?.()
    } catch (err) {
      console.error('Error removing share:', err)
      setError('Failed to remove share')
    } finally {
      setSaving(false)
    }
  }

  if (!isOpen) return null

  const hasChanges = (() => {
    const currentlySharedIds = new Set(sharedWith.map(u => u.user_id))
    const toAdd = [...selectedIds].filter(id => !currentlySharedIds.has(id))
    const toRemove = [...currentlySharedIds].filter(id => !selectedIds.has(id))
    return toAdd.length > 0 || toRemove.length > 0
  })()

  const getRelationshipLabel = (rel: TeamMember['relationship']) => {
    switch (rel) {
      case 'inviter': return 'Invited you'
      case 'invitee': return 'You invited'
      case 'peer': return 'Teammate'
      default: return ''
    }
  }

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
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Share Transcript
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5 truncate max-w-[280px]">
                {transcriptTitle}
              </p>
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
        <div className="px-6 py-4 max-h-[400px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
              <span className="ml-3 text-gray-500 dark:text-gray-400">Loading...</span>
            </div>
          ) : error ? (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-600 dark:text-red-400 text-sm">
              {error}
            </div>
          ) : !isOwner ? (
            <div className="text-center py-6">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Only the owner can manage sharing for this transcript.
              </p>
            </div>
          ) : (
            <>
              {/* Currently shared section */}
              {sharedWith.length > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Currently shared with
                  </h4>
                  <div className="space-y-2">
                    {sharedWith.map(user => (
                      <div
                        key={user.user_id}
                        className="flex items-center justify-between p-2 bg-green-50 dark:bg-green-900/20 rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full bg-green-200 dark:bg-green-800 flex items-center justify-center">
                            <span className="text-sm font-medium text-green-700 dark:text-green-300">
                              {user.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {user.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              {user.email}
                            </div>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveShare(user.user_id)}
                          disabled={saving}
                          className="p-1 text-red-500 hover:text-red-700 dark:hover:text-red-400 transition-colors disabled:opacity-50"
                          title="Remove access"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Team members to share with */}
              {teamMembers.length > 0 ? (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {sharedWith.length > 0 ? 'Share with more people' : 'Share with team members'}
                  </h4>
                  <div className="space-y-2">
                    {teamMembers
                      .filter(member => !sharedWith.some(s => s.user_id === member.user_id))
                      .map(member => (
                        <label
                          key={member.user_id}
                          className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50 cursor-pointer transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(member.user_id)}
                            onChange={() => toggleUser(member.user_id)}
                            className="w-4 h-4 text-primary-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-primary-500 focus:ring-2"
                          />
                          <div className="w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                            <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                              {member.name.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-gray-900 dark:text-white">
                              {member.name}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                              {member.email}
                              <span className="text-gray-400 dark:text-gray-500">-</span>
                              <span className="text-gray-400 dark:text-gray-500">
                                {getRelationshipLabel(member.relationship)}
                              </span>
                            </div>
                          </div>
                        </label>
                      ))}
                  </div>
                </div>
              ) : sharedWith.length === 0 ? (
                <div className="text-center py-6">
                  <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                  <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                    No team members to share with yet.
                  </p>
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    Invite colleagues from the Settings page to build your team.
                  </p>
                </div>
              ) : null}
            </>
          )}
        </div>

        {/* Footer */}
        {isOwner && !loading && (
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            {hasChanges && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 disabled:bg-primary-600/50 text-white rounded-lg transition-colors flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

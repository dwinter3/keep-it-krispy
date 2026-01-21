'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import Shell from '@/components/Shell'

interface ApiKey {
  key_id: string
  name: string
  created_at: string
  last_used_at?: string
}

interface Invite {
  token: string
  email: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
  createdAt: string
  acceptedAt?: string
}

interface UserProfile {
  user_id: string
  email: string
  name: string
  role: string
  created_at: string
  avatar: string | null
  settings: {
    timezone?: string
    default_privacy?: 'normal' | 'strict'
  }
}

interface LinkedInStats {
  totalConnections: number
  lastImportAt: string | null
  importSource: string | null
}

interface TeamMember {
  user_id: string
  email: string
  name: string
  avatar?: string
}

export default function SettingsPage() {
  const { data: session, status } = useSession()

  // Profile state
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  // API Keys state
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Invites state
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [sendingInvite, setSendingInvite] = useState(false)
  const [inviteSuccess, setInviteSuccess] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [loadingInvites, setLoadingInvites] = useState(true)

  // Auto-Share state
  const [autoShareUserIds, setAutoShareUserIds] = useState<string[]>([])
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([])
  const [loadingAutoShare, setLoadingAutoShare] = useState(true)
  const [savingAutoShare, setSavingAutoShare] = useState(false)
  const [autoShareSaved, setAutoShareSaved] = useState(false)
  const [autoShareError, setAutoShareError] = useState<string | null>(null)

  // LinkedIn state
  const [linkedInStats, setLinkedInStats] = useState<LinkedInStats | null>(null)
  const [loadingLinkedIn, setLoadingLinkedIn] = useState(true)
  const [uploadingLinkedIn, setUploadingLinkedIn] = useState(false)
  const [linkedInError, setLinkedInError] = useState<string | null>(null)
  const [linkedInSuccess, setLinkedInSuccess] = useState<string | null>(null)
  const [deletingLinkedIn, setDeletingLinkedIn] = useState(false)

  useEffect(() => {
    if (status === 'authenticated') {
      loadProfile()
      loadApiKeys()
      loadInvites()
      loadAutoShare()
      loadLinkedIn()
    }
  }, [status])

  if (status === 'loading') {
    return (
      <Shell>
        <div className="max-w-4xl mx-auto">
          <div className="animate-pulse">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4 mb-4"></div>
            <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded mb-6"></div>
            <div className="h-64 bg-gray-200 dark:bg-gray-700 rounded"></div>
          </div>
        </div>
      </Shell>
    )
  }

  if (status === 'unauthenticated') {
    redirect('/api/auth/signin')
  }

  async function loadProfile() {
    try {
      const res = await fetch('/api/user/profile')
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        setDisplayName(data.name || '')
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    }
  }

  async function saveProfile() {
    if (!displayName.trim()) {
      setError('Display name cannot be empty')
      return
    }

    setSavingProfile(true)
    setError(null)
    setProfileSaved(false)

    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: displayName.trim() }),
      })
      const data = await res.json()

      if (data.success) {
        setProfile(prev => prev ? { ...prev, name: displayName.trim() } : null)
        setProfileSaved(true)
        setTimeout(() => setProfileSaved(false), 3000)
      } else {
        setError(data.error || 'Failed to save profile')
      }
    } catch (err) {
      setError('Failed to save profile')
    } finally {
      setSavingProfile(false)
    }
  }

  async function loadApiKeys() {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/api-keys')
      const data = await res.json()
      if (data.keys) {
        setApiKeys(data.keys)
      }
    } catch (err) {
      setError('Failed to load API keys')
    } finally {
      setLoading(false)
    }
  }

  async function createKey() {
    if (!newKeyName.trim()) {
      setError('Please enter a name for the API key')
      return
    }

    setCreating(true)
    setError(null)

    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      })
      const data = await res.json()

      if (data.key) {
        setNewKey(data.key)
        setNewKeyName('')
        loadApiKeys()
      } else {
        setError(data.error || 'Failed to create key')
      }
    } catch (err) {
      setError('Failed to create API key')
    } finally {
      setCreating(false)
    }
  }

  async function revokeKey(keyId: string) {
    if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) {
      return
    }

    try {
      const res = await fetch(`/api/settings/api-keys?keyId=${keyId}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.success) {
        loadApiKeys()
      } else {
        setError(data.error || 'Failed to revoke key')
      }
    } catch (err) {
      setError('Failed to revoke API key')
    }
  }

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
  }

  async function loadInvites() {
    setLoadingInvites(true)
    try {
      const res = await fetch('/api/invites')
      const data = await res.json()
      if (data.invites) {
        setInvites(data.invites)
      }
    } catch (err) {
      console.error('Failed to load invites:', err)
    } finally {
      setLoadingInvites(false)
    }
  }

  async function sendInvite() {
    if (!inviteEmail.trim()) {
      setInviteError('Please enter an email address')
      return
    }

    setSendingInvite(true)
    setInviteError(null)
    setInviteSuccess(null)

    try {
      const res = await fetch('/api/invites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      })
      const data = await res.json()

      if (data.success) {
        setInviteEmail('')
        setInviteSuccess(`Invitation sent to ${data.invite.email}`)
        loadInvites()
        setTimeout(() => setInviteSuccess(null), 5000)
      } else {
        setInviteError(data.error || 'Failed to send invitation')
      }
    } catch (err) {
      setInviteError('Failed to send invitation')
    } finally {
      setSendingInvite(false)
    }
  }

  async function revokeInvite(token: string) {
    if (!confirm('Are you sure you want to revoke this invitation?')) {
      return
    }

    try {
      const res = await fetch(`/api/invites/${token}`, {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.success) {
        loadInvites()
      } else {
        setInviteError(data.error || 'Failed to revoke invitation')
      }
    } catch (err) {
      setInviteError('Failed to revoke invitation')
    }
  }

  async function resendInvite(token: string) {
    try {
      const res = await fetch(`/api/invites/${token}`, {
        method: 'POST',
      })
      const data = await res.json()

      if (data.success) {
        setInviteSuccess(`Invitation resent to ${data.invite.email}`)
        loadInvites()
        setTimeout(() => setInviteSuccess(null), 5000)
      } else {
        setInviteError(data.error || 'Failed to resend invitation')
      }
    } catch (err) {
      setInviteError('Failed to resend invitation')
    }
  }

  async function loadAutoShare() {
    setLoadingAutoShare(true)
    try {
      const res = await fetch('/api/settings/auto-share')
      const data = await res.json()
      if (data.userIds) {
        setAutoShareUserIds(data.userIds)
      }
      if (data.teamMembers) {
        setTeamMembers(data.teamMembers)
      }
    } catch (err) {
      console.error('Failed to load auto-share settings:', err)
    } finally {
      setLoadingAutoShare(false)
    }
  }

  async function saveAutoShare() {
    setSavingAutoShare(true)
    setAutoShareError(null)
    setAutoShareSaved(false)

    try {
      const res = await fetch('/api/settings/auto-share', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: autoShareUserIds }),
      })
      const data = await res.json()

      if (data.success) {
        setAutoShareSaved(true)
        setTimeout(() => setAutoShareSaved(false), 3000)
      } else {
        setAutoShareError(data.error || 'Failed to save auto-share settings')
      }
    } catch (err) {
      setAutoShareError('Failed to save auto-share settings')
    } finally {
      setSavingAutoShare(false)
    }
  }

  function toggleAutoShareUser(userId: string) {
    setAutoShareUserIds(prev => {
      if (prev.includes(userId)) {
        return prev.filter(id => id !== userId)
      } else {
        return [...prev, userId]
      }
    })
  }

  async function loadLinkedIn() {
    setLoadingLinkedIn(true)
    try {
      const res = await fetch('/api/linkedin')
      const data = await res.json()
      setLinkedInStats({
        totalConnections: data.totalConnections || 0,
        lastImportAt: data.lastImportAt || null,
        importSource: data.importSource || null,
      })
    } catch (err) {
      console.error('Failed to load LinkedIn data:', err)
    } finally {
      setLoadingLinkedIn(false)
    }
  }

  async function uploadLinkedIn(file: File) {
    setUploadingLinkedIn(true)
    setLinkedInError(null)
    setLinkedInSuccess(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/linkedin', {
        method: 'POST',
        body: formData,
      })
      const data = await res.json()

      if (data.success) {
        setLinkedInSuccess(`Successfully imported ${data.imported} connections.`)
        loadLinkedIn()
        setTimeout(() => setLinkedInSuccess(null), 5000)
      } else {
        const errorMsg = data.details
          ? `${data.error}: ${data.details}`
          : (data.error || 'Failed to import LinkedIn data')
        setLinkedInError(errorMsg)
        console.error('LinkedIn import error:', data)
      }
    } catch (err) {
      console.error('LinkedIn upload error:', err)
      setLinkedInError('Failed to upload LinkedIn data')
    } finally {
      setUploadingLinkedIn(false)
    }
  }

  async function deleteLinkedIn() {
    if (!confirm('Are you sure you want to delete all LinkedIn connections? This cannot be undone.')) {
      return
    }

    setDeletingLinkedIn(true)
    setLinkedInError(null)

    try {
      const res = await fetch('/api/linkedin', {
        method: 'DELETE',
      })
      const data = await res.json()

      if (data.success) {
        setLinkedInSuccess(`Deleted ${data.deleted} connections.`)
        loadLinkedIn()
        setTimeout(() => setLinkedInSuccess(null), 5000)
      } else {
        setLinkedInError(data.error || 'Failed to delete LinkedIn data')
      }
    } catch (err) {
      setLinkedInError('Failed to delete LinkedIn data')
    } finally {
      setDeletingLinkedIn(false)
    }
  }

  function isLinkedInStale(): boolean {
    if (!linkedInStats?.lastImportAt) return false
    const lastImport = new Date(linkedInStats.lastImportAt)
    const thirtyDaysAgo = new Date()
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)
    return lastImport < thirtyDaysAgo
  }

  function getDaysSinceImport(): number | null {
    if (!linkedInStats?.lastImportAt) return null
    const lastImport = new Date(linkedInStats.lastImportAt)
    const now = new Date()
    const diffTime = Math.abs(now.getTime() - lastImport.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'pending':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">Pending</span>
      case 'accepted':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">Accepted</span>
      case 'revoked':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">Revoked</span>
      case 'expired':
        return <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300">Expired</span>
      default:
        return null
    }
  }

  return (
    <Shell>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <Link
            href="/dashboard"
            className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 mb-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Manage your profile and API keys
          </p>
        </div>

        {/* Profile Section */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Profile</h2>

          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {(profile?.avatar || session?.user?.image) ? (
                <img
                  src={profile?.avatar || session?.user?.image || ''}
                  alt={profile?.name || session?.user?.name || 'User'}
                  className="w-20 h-20 rounded-full border-2 border-gray-200 dark:border-gray-700"
                />
              ) : (
                <div className="w-20 h-20 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <svg className="w-10 h-10 text-primary-600 dark:text-primary-400" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">From Google</p>
            </div>

            {/* Profile Fields */}
            <div className="flex-1 space-y-4">
              <div>
                <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Display Name
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    id="displayName"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
                    placeholder="Enter your name"
                  />
                  <button
                    onClick={saveProfile}
                    disabled={savingProfile || displayName === profile?.name}
                    className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {savingProfile ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Saving...
                      </>
                    ) : profileSaved ? (
                      <>
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Saved
                      </>
                    ) : (
                      'Save'
                    )}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Email Address
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="email"
                    value={profile?.email || session?.user?.email || ''}
                    disabled
                    className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  />
                  <span className="px-2 py-1 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                    Read-only
                  </span>
                </div>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  Email is managed through your Google account
                </p>
              </div>

              <div className="pt-2 flex items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                <span>
                  <strong className="text-gray-700 dark:text-gray-300">Role:</strong>{' '}
                  <span className="capitalize">{profile?.role || 'customer'}</span>
                </span>
                {profile?.created_at && (
                  <span>
                    <strong className="text-gray-700 dark:text-gray-300">Member since:</strong>{' '}
                    {new Date(profile.created_at).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Team Section */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Team</h2>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
            Invite team members to collaborate on Keep It Krispy. Invitations expire after 7 days.
          </p>

          {/* Invite Form */}
          <div className="flex gap-2 mb-6">
            <input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
              onKeyDown={(e) => e.key === 'Enter' && sendInvite()}
            />
            <button
              onClick={sendInvite}
              disabled={sendingInvite}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 flex items-center gap-2"
            >
              {sendingInvite ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Sending...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Invite
                </>
              )}
            </button>
          </div>

          {/* Success/Error Messages */}
          {inviteSuccess && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-2 rounded mb-4">
              {inviteSuccess}
            </div>
          )}
          {inviteError && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-2 rounded mb-4">
              {inviteError}
            </div>
          )}

          {/* Invites List */}
          {loadingInvites ? (
            <p className="text-gray-500 dark:text-gray-400">Loading invitations...</p>
          ) : invites.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No invitations sent yet.</p>
          ) : (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Sent Invitations</h3>
              {invites.map((invite) => (
                <div
                  key={invite.token}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900 dark:text-white">{invite.email}</p>
                      {getStatusBadge(invite.status)}
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Sent: {new Date(invite.createdAt).toLocaleDateString()}
                      {invite.acceptedAt && (
                        <> | Accepted: {new Date(invite.acceptedAt).toLocaleDateString()}</>
                      )}
                    </p>
                  </div>
                  {invite.status === 'pending' && (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => resendInvite(invite.token)}
                        className="px-3 py-1 text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded text-sm"
                      >
                        Resend
                      </button>
                      <button
                        onClick={() => revokeInvite(invite.token)}
                        className="px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded text-sm"
                      >
                        Revoke
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Auto-Share Section */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Auto-Share New Transcripts</h2>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
            When enabled, new transcripts will automatically be shared with selected team members.
            This only affects future transcripts - existing transcripts are not changed.
          </p>

          {autoShareError && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-2 rounded mb-4">
              {autoShareError}
            </div>
          )}

          {loadingAutoShare ? (
            <p className="text-gray-500 dark:text-gray-400">Loading team members...</p>
          ) : teamMembers.length === 0 ? (
            <div className="text-center py-6">
              <svg className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <p className="text-gray-500 dark:text-gray-400 mb-2">No team members yet</p>
              <p className="text-sm text-gray-400 dark:text-gray-500">
                Invite team members above to enable auto-sharing.
              </p>
            </div>
          ) : (
            <>
              <div className="space-y-3 mb-6">
                {teamMembers.map((member) => (
                  <label
                    key={member.user_id}
                    className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={autoShareUserIds.includes(member.user_id)}
                      onChange={() => toggleAutoShareUser(member.user_id)}
                      className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-primary-600 focus:ring-primary-500 dark:bg-gray-800"
                    />
                    <div className="flex items-center gap-3 flex-1">
                      {member.avatar ? (
                        <img
                          src={member.avatar}
                          alt={member.name}
                          className="w-8 h-8 rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                          <span className="text-sm font-medium text-primary-600 dark:text-primary-400">
                            {member.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{member.name}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{member.email}</p>
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {autoShareUserIds.length === 0
                    ? 'No team members selected'
                    : `${autoShareUserIds.length} team member${autoShareUserIds.length === 1 ? '' : 's'} selected`}
                </p>
                <button
                  onClick={saveAutoShare}
                  disabled={savingAutoShare}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {savingAutoShare ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Saving...
                    </>
                  ) : autoShareSaved ? (
                    <>
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Saved
                    </>
                  ) : (
                    'Save Changes'
                  )}
                </button>
              </div>
            </>
          )}
        </section>

        {/* LinkedIn Connections Section */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">LinkedIn Connections</h2>
            {linkedInStats?.totalConnections && linkedInStats.totalConnections > 0 && (
              <span className="px-2.5 py-0.5 text-sm bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 rounded-full">
                {linkedInStats.totalConnections.toLocaleString()} connections
              </span>
            )}
          </div>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
            Upload your LinkedIn connections to match meeting attendees with your professional network.
            This helps identify 1st-degree connections for better meeting context.
          </p>

          {/* Staleness Warning */}
          {isLinkedInStale() && (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-4 py-3 rounded-lg mb-6 flex items-start gap-3">
              <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Your LinkedIn data is {getDaysSinceImport()} days old</p>
                <p className="text-sm mt-1 text-amber-600 dark:text-amber-400">
                  We recommend updating your connections at least every 30 days to keep speaker matching accurate.
                </p>
              </div>
            </div>
          )}

          {linkedInError && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-2 rounded mb-4">
              {linkedInError}
            </div>
          )}

          {linkedInSuccess && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 px-4 py-2 rounded mb-4">
              {linkedInSuccess}
            </div>
          )}

          {loadingLinkedIn ? (
            <p className="text-gray-500 dark:text-gray-400">Loading LinkedIn data...</p>
          ) : (
            <>
              {/* Stats */}
              {linkedInStats?.lastImportAt && (
                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Last Import</p>
                      <p className="font-medium text-gray-900 dark:text-white">
                        {new Date(linkedInStats.lastImportAt).toLocaleDateString()}{' '}
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          ({getDaysSinceImport()} days ago)
                        </span>
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Source File</p>
                      <p className="font-medium text-gray-900 dark:text-white truncate">
                        {linkedInStats.importSource || 'Unknown'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Upload Area */}
              <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-6 text-center">
                <input
                  type="file"
                  id="linkedin-upload"
                  accept=".zip,.csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) uploadLinkedIn(file)
                  }}
                  disabled={uploadingLinkedIn}
                />
                <svg className="w-12 h-12 mx-auto text-gray-400 dark:text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <p className="text-gray-600 dark:text-gray-300 mb-2">
                  {linkedInStats?.totalConnections
                    ? 'Upload a new LinkedIn export to update your connections'
                    : 'Upload your LinkedIn data export'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                  Accepts ZIP file from LinkedIn data export or Connections.csv
                </p>
                <label
                  htmlFor="linkedin-upload"
                  className={`inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 ${
                    uploadingLinkedIn ? 'opacity-50 cursor-not-allowed' : ''
                  }`}
                >
                  {uploadingLinkedIn ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Uploading...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                      </svg>
                      Choose File
                    </>
                  )}
                </label>
              </div>

              {/* Delete Button */}
              {linkedInStats?.totalConnections && linkedInStats.totalConnections > 0 && (
                <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Delete All Connections</p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        Remove all imported LinkedIn data from your account
                      </p>
                    </div>
                    <button
                      onClick={deleteLinkedIn}
                      disabled={deletingLinkedIn}
                      className="px-4 py-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-2"
                    >
                      {deletingLinkedIn ? (
                        <>
                          <div className="w-4 h-4 border-2 border-red-500 border-t-transparent rounded-full animate-spin"></div>
                          Deleting...
                        </>
                      ) : (
                        <>
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete All
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {/* Instructions */}
              <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
                <h3 className="font-medium mb-2 text-gray-900 dark:text-white">How to export your LinkedIn connections</h3>
                <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600 dark:text-gray-300">
                  <li>Go to <span className="font-medium">LinkedIn Settings &amp; Privacy</span></li>
                  <li>Click <span className="font-medium">Data Privacy</span> → <span className="font-medium">Get a copy of your data</span></li>
                  <li>Select <span className="font-medium">Connections</span> and request your data</li>
                  <li>You&apos;ll receive an email with a download link (usually within 24 hours)</li>
                  <li>Upload the ZIP file here</li>
                </ol>
              </div>
            </>
          )}
        </section>

        {/* API Keys Section */}
        <section className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
          <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">API Keys</h2>
          <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
            API keys are used to authenticate external services like the Krisp webhook and MCP server.
            Each key can be revoked individually.
          </p>

          {/* New Key Display */}
          {newKey && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-6">
              <p className="text-green-800 dark:text-green-200 font-medium mb-2">
                Your new API key (copy it now - you won&apos;t see it again!):
              </p>
              <div className="flex items-center gap-2">
                <code className="bg-green-100 dark:bg-green-900/40 px-3 py-2 rounded text-sm font-mono flex-1 break-all text-green-900 dark:text-green-100">
                  {newKey}
                </code>
                <button
                  onClick={() => copyToClipboard(newKey)}
                  className="px-3 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                >
                  Copy
                </button>
                <button
                  onClick={() => setNewKey(null)}
                  className="px-3 py-2 bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Create New Key */}
          <div className="flex gap-2 mb-6">
            <input
              type="text"
              placeholder="Key name (e.g., Krisp Webhook)"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400"
              onKeyDown={(e) => e.key === 'Enter' && createKey()}
            />
            <button
              onClick={createKey}
              disabled={creating}
              className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create Key'}
            </button>
          </div>

          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 px-4 py-2 rounded mb-4">
              {error}
            </div>
          )}

          {/* Keys List */}
          {loading ? (
            <p className="text-gray-500 dark:text-gray-400">Loading keys...</p>
          ) : apiKeys.length === 0 ? (
            <p className="text-gray-500 dark:text-gray-400">No API keys yet. Create one above.</p>
          ) : (
            <div className="space-y-3">
              {apiKeys.map((key) => (
                <div
                  key={key.key_id}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700 rounded-lg"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-white">{key.name}</p>
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      ID: <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded text-gray-800 dark:text-gray-200">{key.key_id}</code>
                      {' | '}
                      Created: {new Date(key.created_at).toLocaleDateString()}
                      {key.last_used_at && (
                        <>
                          {' | '}
                          Last used: {new Date(key.last_used_at).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeKey(key.key_id)}
                    className="px-3 py-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Usage Instructions */}
          <div className="mt-8 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
            <h3 className="font-medium mb-2 text-gray-900 dark:text-white">How to use your API key</h3>
            <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-200">Krisp Webhook:</p>
                <p>
                  In Krisp settings, set the webhook URL and add your API key to the X-API-Key header.
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-700 dark:text-gray-200">MCP Server:</p>
                <p>
                  Set the <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded text-gray-800 dark:text-gray-200">KRISP_API_KEY</code> environment
                  variable in your Claude config.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </Shell>
  )
}

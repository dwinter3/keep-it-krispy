'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'
import Link from 'next/link'

interface ApiKey {
  key_id: string
  name: string
  created_at: string
  last_used_at?: string
}

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'authenticated') {
      loadApiKeys()
    }
  }, [status])

  if (status === 'loading') {
    return <div className="p-8">Loading...</div>
  }

  if (status === 'unauthenticated') {
    redirect('/api/auth/signin')
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

  return (
    <div className="max-w-4xl mx-auto p-8">
      <div className="mb-6">
        <Link
          href="/transcripts"
          className="text-sm text-primary-600 dark:text-primary-400 hover:underline flex items-center gap-1 mb-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
      </div>

      {/* User Info */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">Account</h2>
        <div className="space-y-2">
          <p>
            <span className="text-gray-500 dark:text-gray-400">Email:</span>{' '}
            <span className="font-medium text-gray-900 dark:text-white">{session?.user?.email}</span>
          </p>
          <p>
            <span className="text-gray-500 dark:text-gray-400">Name:</span>{' '}
            <span className="font-medium text-gray-900 dark:text-white">{session?.user?.name}</span>
          </p>
        </div>
      </section>

      {/* API Keys */}
      <section className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4 text-gray-900 dark:text-white">API Keys</h2>
        <p className="text-gray-600 dark:text-gray-300 text-sm mb-6">
          API keys are used to authenticate external services like the Krisp webhook and MCP server.
          Each key can be revoked individually.
        </p>

        {/* New Key Display */}
        {newKey && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
            <p className="text-green-800 font-medium mb-2">
              Your new API key (copy it now - you won&apos;t see it again!):
            </p>
            <div className="flex items-center gap-2">
              <code className="bg-green-100 px-3 py-2 rounded text-sm font-mono flex-1 break-all">
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
                className="px-3 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
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
                    {' • '}
                    Created: {new Date(key.created_at).toLocaleDateString()}
                    {key.last_used_at && (
                      <>
                        {' • '}
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
  )
}

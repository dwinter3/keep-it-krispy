'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { redirect } from 'next/navigation'

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
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* User Info */}
      <section className="bg-white rounded-lg shadow p-6 mb-8">
        <h2 className="text-lg font-semibold mb-4">Account</h2>
        <div className="space-y-2">
          <p>
            <span className="text-gray-500">Email:</span>{' '}
            <span className="font-medium">{session?.user?.email}</span>
          </p>
          <p>
            <span className="text-gray-500">Name:</span>{' '}
            <span className="font-medium">{session?.user?.name}</span>
          </p>
        </div>
      </section>

      {/* API Keys */}
      <section className="bg-white rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold mb-4">API Keys</h2>
        <p className="text-gray-600 text-sm mb-6">
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
            className="flex-1 px-3 py-2 border rounded-lg"
            onKeyDown={(e) => e.key === 'Enter' && createKey()}
          />
          <button
            onClick={createKey}
            disabled={creating}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {creating ? 'Creating...' : 'Create Key'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded mb-4">
            {error}
          </div>
        )}

        {/* Keys List */}
        {loading ? (
          <p className="text-gray-500">Loading keys...</p>
        ) : apiKeys.length === 0 ? (
          <p className="text-gray-500">No API keys yet. Create one above.</p>
        ) : (
          <div className="space-y-3">
            {apiKeys.map((key) => (
              <div
                key={key.key_id}
                className="flex items-center justify-between p-4 bg-gray-50 rounded-lg"
              >
                <div>
                  <p className="font-medium">{key.name}</p>
                  <p className="text-sm text-gray-500">
                    ID: <code className="bg-gray-200 px-1 rounded">{key.key_id}</code>
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
                  className="px-3 py-1 text-red-600 hover:bg-red-50 rounded"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Usage Instructions */}
        <div className="mt-8 p-4 bg-gray-50 rounded-lg">
          <h3 className="font-medium mb-2">How to use your API key</h3>
          <div className="space-y-3 text-sm text-gray-600">
            <div>
              <p className="font-medium text-gray-700">Krisp Webhook:</p>
              <p>
                In Krisp settings, set the webhook URL and add your API key to the Authorization header.
              </p>
            </div>
            <div>
              <p className="font-medium text-gray-700">MCP Server:</p>
              <p>
                Set the <code className="bg-gray-200 px-1 rounded">KRISP_API_KEY</code> environment
                variable in your Claude config.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

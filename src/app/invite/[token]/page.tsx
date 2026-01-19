'use client'

import { useEffect, useState } from 'react'
import { signIn, useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'

interface InviteDetails {
  valid: boolean
  inviterName?: string
  email?: string
  reason?: string
}

export default function InvitePage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const token = params.token as string

  const [inviteDetails, setInviteDetails] = useState<InviteDetails | null>(null)
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  // Validate the invite token on load
  useEffect(() => {
    async function validateInvite() {
      if (!token) {
        setInviteDetails({ valid: false, reason: 'No invitation token provided' })
        setLoading(false)
        return
      }

      try {
        const res = await fetch(`/api/invites/${token}/validate`)
        const data = await res.json()
        setInviteDetails(data)
      } catch {
        setInviteDetails({ valid: false, reason: 'Failed to validate invitation' })
      } finally {
        setLoading(false)
      }
    }

    validateInvite()
  }, [token])

  // If user is authenticated and invite is valid, try to accept it
  useEffect(() => {
    async function acceptInvite() {
      if (status !== 'authenticated' || !session || !inviteDetails?.valid || accepting || success) {
        return
      }

      // Check if signed-in email matches invite email
      const signedInEmail = session.user?.email?.toLowerCase()
      const invitedEmail = inviteDetails.email?.toLowerCase()

      if (signedInEmail !== invitedEmail) {
        setError(`This invitation was sent to ${inviteDetails.email}. You are signed in as ${session.user?.email}. Please sign out and sign in with the correct account.`)
        return
      }

      setAccepting(true)
      setError(null)

      try {
        const res = await fetch(`/api/invites/${token}/accept`, {
          method: 'POST',
        })
        const data = await res.json()

        if (data.success) {
          setSuccess(true)
          // Redirect to dashboard after a short delay
          setTimeout(() => {
            router.push('/dashboard')
          }, 2000)
        } else {
          setError(data.error || 'Failed to accept invitation')
        }
      } catch {
        setError('Failed to accept invitation. Please try again.')
      } finally {
        setAccepting(false)
      }
    }

    acceptInvite()
  }, [status, session, inviteDetails, token, accepting, success, router])

  const handleSignIn = () => {
    // Pass the current URL as callback so user returns here after auth
    signIn('google', { callbackUrl: `/invite/${token}` })
  }

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto"></div>
          <p className="mt-4 text-zinc-400">Validating invitation...</p>
        </div>
      </div>
    )
  }

  // Invalid invite
  if (!inviteDetails?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-full max-w-md p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-red-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Invalid Invitation</h1>
            <p className="text-zinc-400 mb-6">{inviteDetails?.reason || 'This invitation is no longer valid.'}</p>
            <button
              onClick={() => router.push('/login')}
              className="px-4 py-2 bg-zinc-800 text-white rounded-lg hover:bg-zinc-700 transition-colors"
            >
              Go to Login
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Success state
  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <div className="w-full max-w-md p-8">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Welcome to Keep It Krispy!</h1>
            <p className="text-zinc-400 mb-4">Your invitation has been accepted.</p>
            <p className="text-zinc-500 text-sm">Redirecting to dashboard...</p>
          </div>
        </div>
      </div>
    )
  }

  // Valid invite - show accept UI
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950">
      <div className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-white mb-2">You&apos;re Invited!</h1>
          <p className="text-zinc-400">
            <span className="text-white font-medium">{inviteDetails.inviterName}</span> has invited you to join Keep It Krispy.
          </p>
        </div>

        <div className="bg-zinc-900 rounded-lg p-6 mb-6">
          <div className="text-sm text-zinc-400 mb-2">Invitation for:</div>
          <div className="text-white font-medium">{inviteDetails.email}</div>
        </div>

        {error && (
          <div className="p-4 bg-red-900/50 border border-red-700 rounded-lg mb-6">
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {status === 'authenticated' ? (
          <div className="space-y-4">
            {accepting ? (
              <div className="flex items-center justify-center gap-3 py-3 px-4 bg-blue-600 text-white rounded-lg">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                <span>Accepting invitation...</span>
              </div>
            ) : (
              <div className="text-center text-zinc-400">
                <p className="mb-2">Signed in as {session?.user?.email}</p>
                {session?.user?.email?.toLowerCase() !== inviteDetails.email?.toLowerCase() && (
                  <button
                    onClick={() => signIn('google', { callbackUrl: `/invite/${token}` })}
                    className="text-blue-400 hover:underline"
                  >
                    Sign in with a different account
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <button
              onClick={handleSignIn}
              className="w-full flex items-center justify-center gap-3 py-3 px-4 bg-white hover:bg-gray-100 text-gray-900 font-medium rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Sign in with Google</span>
            </button>

            <p className="text-xs text-zinc-500 text-center">
              Please sign in with the email address this invitation was sent to.
            </p>
          </div>
        )}

        <div className="mt-8 pt-6 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 text-center">
            This invitation will expire in 7 days. Already have an account?{' '}
            <button onClick={() => router.push('/login')} className="text-blue-400 hover:underline">
              Sign in
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}

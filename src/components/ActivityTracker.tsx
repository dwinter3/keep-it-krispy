'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { signOut } from 'next-auth/react'

interface ActivityTrackerProps {
  /** Inactivity timeout in minutes (default: 15) */
  timeoutMinutes?: number
  /** Warning time before logout in minutes (default: 2) */
  warningMinutes?: number
}

export default function ActivityTracker({
  timeoutMinutes = 15,
  warningMinutes = 2,
}: ActivityTrackerProps) {
  const [showWarning, setShowWarning] = useState(false)
  const [remainingSeconds, setRemainingSeconds] = useState(0)
  const lastActivityRef = useRef<number>(Date.now())
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null)
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null)

  const timeoutMs = timeoutMinutes * 60 * 1000
  const warningMs = warningMinutes * 60 * 1000
  const warningThreshold = timeoutMs - warningMs

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now()
    setShowWarning(false)
    setRemainingSeconds(0)

    // Clear any existing countdown timer
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
      countdownTimerRef.current = null
    }
  }, [])

  const handleActivity = useCallback(() => {
    // Only reset if we're not in the warning phase, or if user explicitly interacts
    if (!showWarning) {
      resetActivity()
    }
  }, [showWarning, resetActivity])

  const handleStayLoggedIn = useCallback(() => {
    resetActivity()
  }, [resetActivity])

  const handleLogout = useCallback(async () => {
    if (warningTimerRef.current) {
      clearInterval(warningTimerRef.current)
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current)
    }
    await signOut({ callbackUrl: '/' })
  }, [])

  // Set up activity listeners
  useEffect(() => {
    const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart', 'click']

    const activityHandler = () => handleActivity()

    events.forEach((event) => {
      window.addEventListener(event, activityHandler, { passive: true })
    })

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, activityHandler)
      })
    }
  }, [handleActivity])

  // Check for inactivity periodically
  useEffect(() => {
    warningTimerRef.current = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastActivityRef.current

      if (elapsed >= timeoutMs) {
        // Time's up - log out
        handleLogout()
      } else if (elapsed >= warningThreshold && !showWarning) {
        // Show warning
        setShowWarning(true)
        setRemainingSeconds(Math.ceil((timeoutMs - elapsed) / 1000))

        // Start countdown timer
        countdownTimerRef.current = setInterval(() => {
          setRemainingSeconds((prev) => {
            if (prev <= 1) {
              handleLogout()
              return 0
            }
            return prev - 1
          })
        }, 1000)
      }
    }, 1000)

    return () => {
      if (warningTimerRef.current) {
        clearInterval(warningTimerRef.current)
      }
      if (countdownTimerRef.current) {
        clearInterval(countdownTimerRef.current)
      }
    }
  }, [timeoutMs, warningThreshold, showWarning, handleLogout])

  // Format remaining time
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    if (mins > 0) {
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }
    return `${secs}s`
  }

  if (!showWarning) {
    return null
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="bg-amber-50 dark:bg-amber-900/90 border border-amber-200 dark:border-amber-700 rounded-lg shadow-lg p-4 max-w-sm">
        <div className="flex items-start gap-3">
          {/* Warning icon */}
          <div className="flex-shrink-0">
            <svg
              className="w-5 h-5 text-amber-500"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </div>

          {/* Content */}
          <div className="flex-1">
            <h4 className="text-sm font-medium text-amber-800 dark:text-amber-200">
              Session Timeout Warning
            </h4>
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              You will be logged out in{' '}
              <span className="font-semibold">{formatTime(remainingSeconds)}</span> due to
              inactivity.
            </p>

            {/* Actions */}
            <div className="mt-3 flex gap-2">
              <button
                onClick={handleStayLoggedIn}
                className="px-3 py-1.5 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-md transition-colors"
              >
                Stay Logged In
              </button>
              <button
                onClick={handleLogout}
                className="px-3 py-1.5 text-sm font-medium text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-800 rounded-md transition-colors"
              >
                Log Out Now
              </button>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={handleStayLoggedIn}
            className="flex-shrink-0 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

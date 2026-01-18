'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the error to the console for debugging
    console.error('Transcripts page error:', error)
  }, [error])

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
        <h2 className="text-xl font-semibold text-red-600 dark:text-red-400 mb-4">
          Something went wrong
        </h2>
        <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-4 overflow-auto max-h-48">
          <pre className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
            {error.message}
          </pre>
          {error.stack && (
            <pre className="text-xs text-gray-500 dark:text-gray-400 whitespace-pre-wrap mt-2">
              {error.stack}
            </pre>
          )}
        </div>
        <button
          onClick={() => reset()}
          className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('Global app error:', error)
  }, [error])

  return (
    <html>
      <body>
        <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-xl font-semibold text-red-600 mb-4">
              Application Error
            </h2>
            <div className="bg-gray-100 rounded p-3 mb-4 overflow-auto max-h-48">
              <pre className="text-xs text-gray-700 whitespace-pre-wrap">
                {error.message}
              </pre>
              {error.stack && (
                <pre className="text-xs text-gray-500 whitespace-pre-wrap mt-2">
                  {error.stack}
                </pre>
              )}
            </div>
            <button
              onClick={() => reset()}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}

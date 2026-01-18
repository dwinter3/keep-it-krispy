'use client'

import { useState, useEffect, useCallback } from 'react'

interface SpeakerInference {
  originalName: string
  inferredName: string
  confidence: 'high' | 'medium' | 'low'
  evidence: string
}

interface SpeakerInferenceModalProps {
  isOpen: boolean
  meetingId: string
  onClose: () => void
  onApply: (corrections: Array<{ originalName: string; correctedName: string }>) => Promise<void>
}

/**
 * Modal for AI speaker name inference
 * Shows inferred names and allows user to apply them as speaker corrections
 */
export default function SpeakerInferenceModal({
  isOpen,
  meetingId,
  onClose,
  onApply,
}: SpeakerInferenceModalProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [inferences, setInferences] = useState<SpeakerInference[]>([])
  const [selectedInferences, setSelectedInferences] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)
  const [hasInferred, setHasInferred] = useState(false)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setInferences([])
      setSelectedInferences(new Set())
      setError(null)
      setHasInferred(false)
    }
  }, [isOpen])

  // Handle keyboard events
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const runInference = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      const res = await fetch(`/api/transcripts/${meetingId}/infer-speakers`, {
        method: 'POST',
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to infer speakers')
      }

      const data = await res.json()
      setInferences(data.inferences || [])
      setHasInferred(true)

      // Pre-select high confidence inferences
      const highConfidence = (data.inferences || [])
        .filter((inf: SpeakerInference) => inf.confidence === 'high')
        .map((inf: SpeakerInference) => inf.originalName)
      setSelectedInferences(new Set(highConfidence))
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }, [meetingId])

  const toggleSelection = (originalName: string) => {
    setSelectedInferences(prev => {
      const next = new Set(prev)
      if (next.has(originalName)) {
        next.delete(originalName)
      } else {
        next.add(originalName)
      }
      return next
    })
  }

  const selectAll = () => {
    setSelectedInferences(new Set(inferences.map(inf => inf.originalName)))
  }

  const deselectAll = () => {
    setSelectedInferences(new Set())
  }

  const handleApply = async () => {
    if (selectedInferences.size === 0) return

    setApplying(true)
    try {
      const corrections = inferences
        .filter(inf => selectedInferences.has(inf.originalName))
        .map(inf => ({
          originalName: inf.originalName,
          correctedName: inf.inferredName,
        }))

      await onApply(corrections)
      onClose()
    } catch (err) {
      setError(String(err))
    } finally {
      setApplying(false)
    }
  }

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
            High
          </span>
        )
      case 'medium':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">
            Medium
          </span>
        )
      case 'low':
        return (
          <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded-full">
            Low
          </span>
        )
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
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg">
              <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                AI Speaker Identification
              </h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Identify real names from transcript content
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-4 flex-1 overflow-y-auto">
          {!hasInferred && !loading && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-50 dark:bg-indigo-900/20 mb-4">
                <svg className="w-8 h-8 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                Identify Unknown Speakers
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6 max-w-sm mx-auto">
                AI will analyze the transcript to find self-introductions, when people address each other by name, and other context clues.
              </p>
              <button
                onClick={runInference}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium rounded-lg transition-colors flex items-center gap-2 mx-auto"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Analyze Transcript
              </button>
            </div>
          )}

          {loading && (
            <div className="text-center py-12">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mx-auto mb-4"></div>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Analyzing transcript for speaker identities...
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                This may take a few seconds
              </p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
              <button
                onClick={runInference}
                className="mt-2 text-xs text-red-700 dark:text-red-300 hover:underline"
              >
                Try again
              </button>
            </div>
          )}

          {hasInferred && !loading && inferences.length === 0 && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 mb-4">
                <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h4 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                No Speakers Identified
              </h4>
              <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm mx-auto">
                The AI could not identify any speaker names from the transcript content. The speakers may not have introduced themselves or mentioned names.
              </p>
            </div>
          )}

          {hasInferred && !loading && inferences.length > 0 && (
            <div className="space-y-4">
              {/* Selection controls */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {selectedInferences.size} of {inferences.length} selected
                </span>
                <div className="flex gap-2">
                  <button
                    onClick={selectAll}
                    className="text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    Select all
                  </button>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button
                    onClick={deselectAll}
                    className="text-gray-500 dark:text-gray-400 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Inference list */}
              <div className="space-y-3">
                {inferences.map((inference) => (
                  <div
                    key={inference.originalName}
                    onClick={() => toggleSelection(inference.originalName)}
                    className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                      selectedInferences.has(inference.originalName)
                        ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-300 dark:border-indigo-700'
                        : 'bg-gray-50 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div className="pt-0.5">
                        <input
                          type="checkbox"
                          checked={selectedInferences.has(inference.originalName)}
                          onChange={() => {}}
                          className="w-4 h-4 text-indigo-600 bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded focus:ring-indigo-500 focus:ring-2 cursor-pointer"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-gray-500 dark:text-gray-400 line-through text-sm">
                            {inference.originalName}
                          </span>
                          <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                          </svg>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {inference.inferredName}
                          </span>
                          {getConfidenceBadge(inference.confidence)}
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
                          {inference.evidence}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-700 flex justify-end gap-3 flex-shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={applying}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            {hasInferred && inferences.length > 0 ? 'Cancel' : 'Close'}
          </button>
          {hasInferred && inferences.length > 0 && (
            <button
              onClick={handleApply}
              disabled={applying || selectedInferences.size === 0}
              className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-600/50 text-white rounded-lg transition-colors flex items-center gap-2"
            >
              {applying ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Applying...
                </>
              ) : (
                <>
                  Apply {selectedInferences.size} Correction{selectedInferences.size !== 1 ? 's' : ''}
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

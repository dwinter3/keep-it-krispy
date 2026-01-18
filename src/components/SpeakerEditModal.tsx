'use client'

import { useState, useEffect, useRef } from 'react'

interface SpeakerEditModalProps {
  isOpen: boolean
  originalName: string
  currentName: string
  onSave: (newName: string) => void
  onCancel: () => void
}

/**
 * Modal for editing speaker names in transcripts
 * Allows correcting "Speaker 1" or fixing incorrect names
 */
export default function SpeakerEditModal({
  isOpen,
  originalName,
  currentName,
  onSave,
  onCancel
}: SpeakerEditModalProps) {
  const [name, setName] = useState(currentName)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName)
      // Focus input after a short delay for animation
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, currentName])

  // Handle keyboard events
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return
      if (e.key === 'Escape') {
        onCancel()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel])

  if (!isOpen) return null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || trimmedName === currentName) {
      onCancel()
      return
    }
    setSaving(true)
    try {
      await onSave(trimmedName)
    } finally {
      setSaving(false)
    }
  }

  const isGenericSpeaker = /^speaker\s+\d+$/i.test(originalName)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {isGenericSpeaker ? 'Identify Speaker' : 'Edit Speaker Name'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {isGenericSpeaker
              ? `Replace "${originalName}" with the actual person's name`
              : `Update the name for "${originalName}"`
            }
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div className="px-6 py-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Speaker Name
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
              placeholder="Enter the speaker's name"
              autoComplete="off"
            />

            {originalName !== currentName && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                Original transcript name: <span className="font-mono">{originalName}</span>
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
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
                'Save'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

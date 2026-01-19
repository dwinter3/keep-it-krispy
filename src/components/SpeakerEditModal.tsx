'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface SpeakerSuggestion {
  entity_id: string
  name: string
  company?: string
  role?: string
  linkedin?: string
  verified?: boolean
}

interface SpeakerEditModalProps {
  isOpen: boolean
  originalName: string
  currentName: string
  onSave: (newName: string, entityId?: string) => void
  onCancel: () => void
}

/**
 * Modal for editing speaker names in transcripts
 * Allows correcting "Speaker 1" or fixing incorrect names
 * Includes live suggestions from existing speaker entities
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
  const [suggestions, setSuggestions] = useState<SpeakerSuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [selectedEntityId, setSelectedEntityId] = useState<string | undefined>()
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const suggestionsRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<NodeJS.Timeout>(null)

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setName(currentName)
      setSuggestions([])
      setShowSuggestions(false)
      setSelectedEntityId(undefined)
      setHighlightedIndex(-1)
      // Focus input after a short delay for animation
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen, currentName])

  // Search for suggestions
  const searchSpeakers = useCallback(async (query: string) => {
    if (query.length < 2) {
      setSuggestions([])
      setShowSuggestions(false)
      return
    }

    setLoadingSuggestions(true)
    try {
      const response = await fetch(`/api/speakers/search?q=${encodeURIComponent(query)}`)
      if (response.ok) {
        const data = await response.json()
        setSuggestions(data.suggestions || [])
        setShowSuggestions(data.suggestions?.length > 0)
        setHighlightedIndex(-1)
      }
    } catch (error) {
      console.error('Error searching speakers:', error)
    } finally {
      setLoadingSuggestions(false)
    }
  }, [])

  // Debounced search on input change
  const handleInputChange = (value: string) => {
    setName(value)
    setSelectedEntityId(undefined) // Clear selection when typing

    // Clear previous debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Debounce search
    debounceRef.current = setTimeout(() => {
      searchSpeakers(value)
    }, 200)
  }

  // Handle suggestion selection
  const handleSelectSuggestion = (suggestion: SpeakerSuggestion) => {
    setName(suggestion.name)
    setSelectedEntityId(suggestion.entity_id)
    setShowSuggestions(false)
    setHighlightedIndex(-1)
  }

  // Handle keyboard navigation
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!isOpen) return

      if (e.key === 'Escape') {
        if (showSuggestions) {
          setShowSuggestions(false)
          e.stopPropagation()
        } else {
          onCancel()
        }
        return
      }

      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setHighlightedIndex(prev =>
            prev < suggestions.length - 1 ? prev + 1 : 0
          )
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          setHighlightedIndex(prev =>
            prev > 0 ? prev - 1 : suggestions.length - 1
          )
        } else if (e.key === 'Enter' && highlightedIndex >= 0) {
          e.preventDefault()
          handleSelectSuggestion(suggestions[highlightedIndex])
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onCancel, showSuggestions, suggestions, highlightedIndex])

  // Close suggestions on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

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
      await onSave(trimmedName, selectedEntityId)
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
            <div className="relative" ref={suggestionsRef}>
              <input
                ref={inputRef}
                type="text"
                value={name}
                onChange={(e) => handleInputChange(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                className="w-full px-4 py-2.5 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors"
                placeholder="Enter the speaker's name"
                autoComplete="off"
              />

              {/* Loading indicator */}
              {loadingSuggestions && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}

              {/* Suggestions dropdown */}
              {showSuggestions && suggestions.length > 0 && (
                <div className="absolute z-10 mt-1 w-full bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-60 overflow-auto">
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-600">
                    Existing speakers
                  </div>
                  {suggestions.map((suggestion, index) => (
                    <button
                      key={suggestion.entity_id}
                      type="button"
                      className={`w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors ${
                        index === highlightedIndex ? 'bg-gray-100 dark:bg-gray-600' : ''
                      }`}
                      onClick={() => handleSelectSuggestion(suggestion)}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-medium text-gray-900 dark:text-white">
                            {suggestion.name}
                          </span>
                          {suggestion.verified && (
                            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-400">
                              Verified
                            </span>
                          )}
                        </div>
                        {suggestion.linkedin && (
                          <svg className="w-4 h-4 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                          </svg>
                        )}
                      </div>
                      {(suggestion.company || suggestion.role) && (
                        <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
                          {suggestion.role && <span>{suggestion.role}</span>}
                          {suggestion.role && suggestion.company && <span> at </span>}
                          {suggestion.company && <span>{suggestion.company}</span>}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedEntityId && (
              <p className="text-xs text-green-600 dark:text-green-400 mt-2 flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Will link to existing speaker profile
              </p>
            )}

            {originalName !== currentName && !selectedEntityId && (
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

'use client'

import { useState, useEffect, useCallback } from 'react'

interface EntityOption {
  id: string
  name: string
  confidence?: number
  aliases?: string[]
}

interface MergePreview {
  target: EntityOption
  sources: EntityOption[]
  preview: {
    aliasesToAdd: string[]
    relationshipsToUpdate: number
    entitiesToMerge: number
  }
}

interface EntityMergeModalProps {
  isOpen: boolean
  entityType: 'speaker' | 'company'
  currentEntity: EntityOption
  onClose: () => void
  onMergeComplete: () => void
}

/**
 * Modal for merging duplicate entities
 * Shows a search to find entities to merge and previews the result
 */
export default function EntityMergeModal({
  isOpen,
  entityType,
  currentEntity,
  onClose,
  onMergeComplete,
}: EntityMergeModalProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<EntityOption[]>([])
  const [selectedEntities, setSelectedEntities] = useState<EntityOption[]>([])
  const [targetId, setTargetId] = useState<string>(currentEntity.id)
  const [preview, setPreview] = useState<MergePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [merging, setMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchQuery('')
      setSearchResults([])
      setSelectedEntities([])
      setTargetId(currentEntity.id)
      setPreview(null)
      setError(null)
    }
  }, [isOpen, currentEntity.id])

  // Search for entities
  const searchEntities = useCallback(
    async (query: string) => {
      if (query.length < 2) {
        setSearchResults([])
        return
      }

      setLoading(true)
      try {
        const endpoint =
          entityType === 'speaker'
            ? `/api/speakers/search?q=${encodeURIComponent(query)}`
            : `/api/companies?search=${encodeURIComponent(query)}`

        const response = await fetch(endpoint)
        if (response.ok) {
          const data = await response.json()
          // Filter out current entity and already selected entities
          const results = (
            entityType === 'speaker' ? data.suggestions : data.companies
          ) as EntityOption[]
          const filteredResults = results.filter(
            (r: EntityOption) =>
              r.id !== currentEntity.id &&
              !selectedEntities.some((s) => s.id === r.id)
          )
          setSearchResults(filteredResults.slice(0, 10))
        }
      } catch (err) {
        console.error('Search error:', err)
      } finally {
        setLoading(false)
      }
    },
    [entityType, currentEntity.id, selectedEntities]
  )

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      searchEntities(searchQuery)
    }, 300)
    return () => clearTimeout(timer)
  }, [searchQuery, searchEntities])

  // Add entity to selection
  const addEntity = (entity: EntityOption) => {
    setSelectedEntities([...selectedEntities, entity])
    setSearchResults(searchResults.filter((r) => r.id !== entity.id))
    setSearchQuery('')
  }

  // Remove entity from selection
  const removeEntity = (entityId: string) => {
    setSelectedEntities(selectedEntities.filter((e) => e.id !== entityId))
  }

  // Load merge preview
  const loadPreview = useCallback(async () => {
    if (selectedEntities.length === 0) {
      setPreview(null)
      return
    }

    setLoading(true)
    try {
      const sourceIds = selectedEntities.map((e) => e.id).join(',')
      const response = await fetch(
        `/api/entities/merge?sourceIds=${sourceIds}&targetId=${targetId}`
      )
      if (response.ok) {
        const data = await response.json()
        setPreview(data)
      }
    } catch (err) {
      console.error('Preview error:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedEntities, targetId])

  useEffect(() => {
    loadPreview()
  }, [loadPreview])

  // Perform merge
  const handleMerge = async () => {
    if (selectedEntities.length === 0) return

    setMerging(true)
    setError(null)

    try {
      const response = await fetch('/api/entities/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceIds: selectedEntities.map((e) => e.id),
          targetId,
          preserveTargetMetadata: true,
        }),
      })

      if (response.ok) {
        onMergeComplete()
        onClose()
      } else {
        const data = await response.json()
        setError(data.error || 'Merge failed')
      }
    } catch (err) {
      setError('Failed to merge entities')
    } finally {
      setMerging(false)
    }
  }

  if (!isOpen) return null

  const allEntities = [currentEntity, ...selectedEntities]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Merge {entityType === 'speaker' ? 'Speakers' : 'Companies'}
          </h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Combine duplicate {entityType}s into one
          </p>
        </div>

        {/* Content */}
        <div className="px-6 py-4 max-h-[60vh] overflow-y-auto">
          {/* Current selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Entities to merge
            </label>
            <div className="space-y-2">
              {allEntities.map((entity, index) => (
                <div
                  key={entity.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    entity.id === targetId
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="target"
                      checked={entity.id === targetId}
                      onChange={() => setTargetId(entity.id)}
                      className="w-4 h-4 text-primary-600"
                    />
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">
                        {entity.name}
                      </span>
                      {entity.id === targetId && (
                        <span className="ml-2 text-xs text-primary-600 dark:text-primary-400">
                          (keep this one)
                        </span>
                      )}
                      {entity.aliases && entity.aliases.length > 0 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          Also known as: {entity.aliases.slice(0, 3).join(', ')}
                        </p>
                      )}
                    </div>
                  </div>
                  {index > 0 && (
                    <button
                      onClick={() => removeEntity(entity.id)}
                      className="text-gray-400 hover:text-red-500 transition-colors"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Search for more */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Find duplicates to merge
            </label>
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={`Search for ${entityType}s...`}
                className="w-full px-4 py-2 bg-gray-50 dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-900 dark:text-white placeholder-gray-500 focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              {loading && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="animate-spin h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                </div>
              )}
            </div>

            {/* Search results */}
            {searchResults.length > 0 && (
              <div className="mt-2 border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-200 dark:divide-gray-700">
                {searchResults.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => addEntity(result)}
                    className="w-full px-3 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-gray-900 dark:text-white">{result.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Preview */}
          {preview && selectedEntities.length > 0 && (
            <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
              <h4 className="font-medium text-blue-900 dark:text-blue-300 mb-2">
                Merge Preview
              </h4>
              <ul className="text-sm text-blue-800 dark:text-blue-400 space-y-1">
                <li>
                  {preview.preview.entitiesToMerge} {entityType}
                  {preview.preview.entitiesToMerge > 1 ? 's' : ''} will be merged into "{preview.target.name}"
                </li>
                <li>
                  {preview.preview.relationshipsToUpdate} relationship
                  {preview.preview.relationshipsToUpdate !== 1 ? 's' : ''} will be updated
                </li>
                {preview.preview.aliasesToAdd.length > 0 && (
                  <li>
                    Aliases to preserve: {preview.preview.aliasesToAdd.slice(0, 5).join(', ')}
                    {preview.preview.aliasesToAdd.length > 5 && ` +${preview.preview.aliasesToAdd.length - 5} more`}
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-gray-50 dark:bg-gray-700/50 flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={merging}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleMerge}
            disabled={merging || selectedEntities.length === 0}
            className="px-4 py-2 text-sm font-medium bg-primary-600 hover:bg-primary-700 disabled:bg-primary-600/50 text-white rounded-lg transition-colors flex items-center gap-2"
          >
            {merging ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Merging...
              </>
            ) : (
              `Merge ${selectedEntities.length + 1} ${entityType}s`
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import Link from 'next/link'

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface ExpandableSpeakersProps {
  speakers: string[]
  speakerCorrections?: Record<string, SpeakerCorrection> | null
  /** Number of speakers to show before collapsing (default: 2) */
  initialCount?: number
  /** Whether to link speaker names to their profile pages */
  linkToProfiles?: boolean
  /** Additional class name for the container */
  className?: string
}

/**
 * Component that displays a list of speakers with expand/collapse functionality.
 * Shows first N speakers with a "+X more" badge that expands to show all.
 */
export default function ExpandableSpeakers({
  speakers,
  speakerCorrections,
  initialCount = 2,
  linkToProfiles = false,
  className = '',
}: ExpandableSpeakersProps) {
  const [expanded, setExpanded] = useState(false)

  // Filter out generic speaker names like "Speaker 1", "Speaker 2"
  const realSpeakers = speakers.filter(s => {
    const lower = s.toLowerCase()
    return !lower.startsWith('speaker ') && lower !== 'unknown' && lower !== 'guest'
  })

  if (realSpeakers.length === 0) {
    return null
  }

  // Apply speaker corrections
  const getCorrectedName = (originalName: string): { displayName: string; linkedin?: string } => {
    if (!speakerCorrections) {
      return { displayName: originalName }
    }
    const key = originalName.toLowerCase()
    const correction = speakerCorrections[key]
    if (correction) {
      return { displayName: correction.name, linkedin: correction.linkedin }
    }
    return { displayName: originalName }
  }

  const visibleSpeakers = expanded ? realSpeakers : realSpeakers.slice(0, initialCount)
  const hiddenCount = realSpeakers.length - initialCount
  const showExpandButton = hiddenCount > 0

  const renderSpeaker = (speaker: string, index: number) => {
    const { displayName, linkedin } = getCorrectedName(speaker)

    if (linkToProfiles) {
      return (
        <Link
          key={index}
          href={`/speakers/${encodeURIComponent(displayName)}`}
          className="text-gray-600 dark:text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 hover:underline inline-flex items-center gap-1"
          title={`View ${displayName}'s profile`}
        >
          {displayName}
          {linkedin && (
            <svg className="w-3 h-3 opacity-50" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
            </svg>
          )}
        </Link>
      )
    }

    return (
      <span key={index} className="text-gray-600 dark:text-gray-400">
        {displayName}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center flex-wrap gap-x-1 ${className}`}>
      {visibleSpeakers.map((speaker, index) => (
        <span key={speaker} className="inline-flex items-center">
          {renderSpeaker(speaker, index)}
          {index < visibleSpeakers.length - 1 && (
            <span className="text-gray-400 dark:text-gray-500">,</span>
          )}
        </span>
      ))}
      {showExpandButton && !expanded && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setExpanded(true)
          }}
          className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          title={`Show ${hiddenCount} more speaker${hiddenCount > 1 ? 's' : ''}`}
        >
          +{hiddenCount}
        </button>
      )}
      {expanded && showExpandButton && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            setExpanded(false)
          }}
          className="ml-1 px-1.5 py-0.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          title="Show less"
        >
          less
        </button>
      )}
    </span>
  )
}

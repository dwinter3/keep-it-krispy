'use client'

import { SpeakerStats, formatDurationLong, getSpeakerColor } from '@/lib/transcriptParser'

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface SpeakerTalkTimeProps {
  speakerStats: SpeakerStats[]
  speakerCorrections?: Record<string, SpeakerCorrection> | null
  onSpeakerClick?: (speaker: string) => void
  className?: string
}

/**
 * Displays speaker talk time statistics as a horizontal bar chart
 * Shows each speaker's speaking duration and percentage of total time
 */
export default function SpeakerTalkTime({
  speakerStats,
  speakerCorrections,
  onSpeakerClick,
  className = ''
}: SpeakerTalkTimeProps) {
  if (speakerStats.length === 0) {
    return null
  }

  // Get corrected speaker name
  const getCorrectedName = (originalName: string): { displayName: string; wasCorrected: boolean } => {
    if (!speakerCorrections) {
      return { displayName: originalName, wasCorrected: false }
    }
    const key = originalName.toLowerCase()
    const correction = speakerCorrections[key]
    if (correction) {
      return { displayName: correction.name, wasCorrected: true }
    }
    return { displayName: originalName, wasCorrected: false }
  }

  // Find max percentage for scaling
  const maxPercentage = Math.max(...speakerStats.map(s => s.percentage), 1)

  return (
    <div className={`bg-gray-50 dark:bg-gray-700/50 rounded-lg p-4 ${className}`}>
      <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        Speaker Talk Time
      </h3>

      <div className="space-y-3">
        {speakerStats.map((stat, index) => {
          const { displayName, wasCorrected } = getCorrectedName(stat.speaker)
          const color = getSpeakerColor(index)
          // Scale bar width relative to max percentage, with minimum of 5%
          const barWidth = Math.max((stat.percentage / maxPercentage) * 100, 5)

          return (
            <div key={stat.speaker} className="group">
              {/* Speaker name row */}
              <div className="flex items-center justify-between mb-1">
                <button
                  onClick={() => onSpeakerClick?.(stat.speaker)}
                  className={`text-sm font-medium transition-colors flex items-center gap-1.5 ${
                    onSpeakerClick
                      ? 'hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer'
                      : 'cursor-default'
                  } ${color.lightText}`}
                  title={wasCorrected ? `Corrected from: ${stat.speaker}. Click to edit.` : 'Click to edit speaker name'}
                >
                  {displayName}
                  {wasCorrected && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                      className="w-3 h-3 opacity-70"
                      aria-label="Corrected speaker name"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.739a.75.75 0 0 1 1.04-.208Z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                  {onSpeakerClick && (
                    <svg
                      className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                    </svg>
                  )}
                </button>
                <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                  <span>{formatDurationLong(stat.speakingTime)}</span>
                  <span className="text-gray-400 dark:text-gray-500">({stat.percentage.toFixed(0)}%)</span>
                </span>
              </div>

              {/* Progress bar */}
              <div className="h-3 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    index === 0 ? 'bg-blue-500' : 'bg-gray-400 dark:bg-gray-500'
                  }`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

'use client'

import { TranscriptSegment, groupConsecutiveSegments, getSpeakerColor, formatTimestamp } from '@/lib/transcriptParser'

interface SpeakerCorrection {
  name: string
  linkedin?: string
}

interface ChatTranscriptProps {
  segments: TranscriptSegment[]
  speakerColorMap: Map<string, number>
  speakerCorrections?: Record<string, SpeakerCorrection> | null
  onSpeakerClick?: (speaker: string) => void
  className?: string
}

/**
 * iMessage-style chat bubble view of transcript
 * - First speaker (typically user) aligned right with blue bubbles
 * - Other speakers aligned left with gray/colored bubbles
 * - Consecutive messages from same speaker are grouped
 * - Speaker name shown only on first message of a group
 */
export default function ChatTranscript({
  segments,
  speakerColorMap,
  speakerCorrections,
  onSpeakerClick,
  className = ''
}: ChatTranscriptProps) {
  if (segments.length === 0) {
    return (
      <div className="text-center text-gray-500 dark:text-gray-400 py-8">
        No transcript content available
      </div>
    )
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

  // Group consecutive messages from same speaker
  const messageGroups = groupConsecutiveSegments(segments)

  // First speaker is considered "self" (right-aligned, blue)
  const firstSpeaker = segments[0]?.speaker

  return (
    <div className={`space-y-4 ${className}`}>
      {messageGroups.map((group, groupIndex) => {
        const speaker = group[0].speaker
        const colorIndex = speakerColorMap.get(speaker) ?? 0
        const color = getSpeakerColor(colorIndex)
        const isSelf = speaker === firstSpeaker
        const { displayName, wasCorrected } = getCorrectedName(speaker)

        return (
          <div
            key={`group-${groupIndex}`}
            className={`flex flex-col ${isSelf ? 'items-end' : 'items-start'}`}
          >
            {/* Speaker name - only show on first message of group */}
            <button
              onClick={() => onSpeakerClick?.(speaker)}
              className={`text-xs mb-1 flex items-center gap-1 transition-colors ${
                isSelf ? 'mr-2' : 'ml-2'
              } ${
                onSpeakerClick
                  ? 'hover:text-primary-600 dark:hover:text-primary-400 cursor-pointer'
                  : 'cursor-default'
              } text-gray-500 dark:text-gray-400`}
              title={wasCorrected ? `Corrected from: ${speaker}. Click to edit.` : 'Click to edit speaker name'}
            >
              {displayName}
              {wasCorrected && (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className="w-2.5 h-2.5 opacity-70"
                  aria-label="Corrected speaker name"
                >
                  <path
                    fillRule="evenodd"
                    d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.739a.75.75 0 0 1 1.04-.208Z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>

            {/* Message bubbles for this group */}
            <div className={`flex flex-col gap-1 ${isSelf ? 'items-end' : 'items-start'} max-w-[85%]`}>
              {group.map((segment, segmentIndex) => (
                <div
                  key={`segment-${groupIndex}-${segmentIndex}`}
                  className={`relative px-4 py-2 text-sm ${
                    isSelf
                      ? 'bg-blue-500 text-white rounded-2xl rounded-br-md'
                      : `${color.bg} ${color.text} rounded-2xl rounded-bl-md`
                  }`}
                >
                  {segment.text}

                  {/* Timestamp - show on last message of group */}
                  {segmentIndex === group.length - 1 && (
                    <div
                      className={`text-[10px] mt-1 ${
                        isSelf ? 'text-blue-200' : 'text-gray-400 dark:text-gray-500'
                      }`}
                    >
                      {formatTimestamp(segment.timestampSeconds)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

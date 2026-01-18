/**
 * Transcript Parser Utility
 * Parses raw Krisp transcript format into structured speaker segments
 *
 * Format example:
 * david winter | 00:01
 * No, a second, I'm trying to figure out the mute.
 * Speaker 2 | 00:03
 * Are you David?
 */

export interface TranscriptSegment {
  speaker: string
  timestamp: string
  timestampSeconds: number
  text: string
  startTime: number // In seconds from start
  endTime: number // Estimated end time based on next segment or duration
}

export interface ParsedTranscript {
  segments: TranscriptSegment[]
  speakerStats: SpeakerStats[]
  totalDuration: number
}

export interface SpeakerStats {
  speaker: string
  speakingTime: number // in seconds
  percentage: number
  segmentCount: number
}

/**
 * Parse timestamp string (MM:SS or H:MM:SS) to seconds
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map(p => parseInt(p, 10))
  if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1]
  } else if (parts.length === 3) {
    // H:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }
  return 0
}

/**
 * Format seconds as MM:SS or H:MM:SS
 */
export function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60

  if (hours > 0) {
    return `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Format duration for display (e.g., "18:42" or "1h 5m")
 */
export function formatDurationLong(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`
  }
  const mins = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remainingMins = mins % 60
    if (remainingMins === 0) {
      return `${hours}h`
    }
    return `${hours}h ${remainingMins}m`
  }
  if (secs === 0) {
    return `${mins}m`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

/**
 * Parse raw transcript content into structured segments
 */
export function parseTranscript(rawContent: string, totalDuration?: number): ParsedTranscript {
  const lines = rawContent.split('\n')
  const segments: TranscriptSegment[] = []

  let currentSpeaker: string | null = null
  let currentTimestamp: string | null = null
  let currentTimestampSeconds = 0
  let currentText: string[] = []

  // Pattern: "speaker name | timestamp"
  const headerPattern = /^(.+?)\s*\|\s*(\d+:\d+(?::\d+)?)\s*$/

  for (const line of lines) {
    const trimmedLine = line.trim()
    if (!trimmedLine) continue

    const headerMatch = trimmedLine.match(headerPattern)

    if (headerMatch) {
      // Save previous segment if exists
      if (currentSpeaker && currentText.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          timestamp: currentTimestamp || '00:00',
          timestampSeconds: currentTimestampSeconds,
          text: currentText.join(' ').trim(),
          startTime: currentTimestampSeconds,
          endTime: parseTimestamp(headerMatch[2]) // Use next segment's start as end
        })
      }

      // Start new segment
      currentSpeaker = headerMatch[1].trim()
      currentTimestamp = headerMatch[2]
      currentTimestampSeconds = parseTimestamp(headerMatch[2])
      currentText = []
    } else {
      // Add text to current segment
      currentText.push(trimmedLine)
    }
  }

  // Don't forget the last segment
  if (currentSpeaker && currentText.length > 0) {
    segments.push({
      speaker: currentSpeaker,
      timestamp: currentTimestamp || '00:00',
      timestampSeconds: currentTimestampSeconds,
      text: currentText.join(' ').trim(),
      startTime: currentTimestampSeconds,
      endTime: totalDuration || currentTimestampSeconds + 30 // Estimate if no duration
    })
  }

  // Fix endTimes for all segments (last segment gets total duration or estimate)
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].endTime = segments[i + 1].startTime
  }

  // Calculate speaking time per speaker
  const speakerTimeMap = new Map<string, { time: number; count: number }>()

  for (const segment of segments) {
    const duration = segment.endTime - segment.startTime
    const existing = speakerTimeMap.get(segment.speaker) || { time: 0, count: 0 }
    speakerTimeMap.set(segment.speaker, {
      time: existing.time + duration,
      count: existing.count + 1
    })
  }

  // Calculate total speaking time
  const calcTotalDuration = totalDuration || (segments.length > 0
    ? segments[segments.length - 1].endTime
    : 0)

  // Build speaker stats sorted by speaking time (descending)
  const speakerStats: SpeakerStats[] = Array.from(speakerTimeMap.entries())
    .map(([speaker, data]) => ({
      speaker,
      speakingTime: data.time,
      percentage: calcTotalDuration > 0 ? (data.time / calcTotalDuration) * 100 : 0,
      segmentCount: data.count
    }))
    .sort((a, b) => b.speakingTime - a.speakingTime)

  return {
    segments,
    speakerStats,
    totalDuration: calcTotalDuration
  }
}

/**
 * Group consecutive segments by the same speaker
 */
export function groupConsecutiveSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const groups: TranscriptSegment[][] = []
  let currentGroup: TranscriptSegment[] = []
  let currentSpeaker: string | null = null

  for (const segment of segments) {
    if (segment.speaker !== currentSpeaker) {
      if (currentGroup.length > 0) {
        groups.push(currentGroup)
      }
      currentGroup = [segment]
      currentSpeaker = segment.speaker
    } else {
      currentGroup.push(segment)
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup)
  }

  return groups
}

/**
 * Assign consistent colors to speakers
 * First speaker gets the primary/user color
 */
const SPEAKER_COLORS = [
  { bg: 'bg-blue-500', text: 'text-white', border: 'border-blue-600', light: 'bg-blue-100 dark:bg-blue-900/30', lightText: 'text-blue-800 dark:text-blue-200' },
  { bg: 'bg-gray-200 dark:bg-gray-700', text: 'text-gray-900 dark:text-gray-100', border: 'border-gray-300 dark:border-gray-600', light: 'bg-gray-100 dark:bg-gray-800', lightText: 'text-gray-700 dark:text-gray-300' },
  { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-900 dark:text-green-100', border: 'border-green-300 dark:border-green-700', light: 'bg-green-50 dark:bg-green-900/20', lightText: 'text-green-800 dark:text-green-200' },
  { bg: 'bg-purple-100 dark:bg-purple-900/40', text: 'text-purple-900 dark:text-purple-100', border: 'border-purple-300 dark:border-purple-700', light: 'bg-purple-50 dark:bg-purple-900/20', lightText: 'text-purple-800 dark:text-purple-200' },
  { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-900 dark:text-orange-100', border: 'border-orange-300 dark:border-orange-700', light: 'bg-orange-50 dark:bg-orange-900/20', lightText: 'text-orange-800 dark:text-orange-200' },
  { bg: 'bg-pink-100 dark:bg-pink-900/40', text: 'text-pink-900 dark:text-pink-100', border: 'border-pink-300 dark:border-pink-700', light: 'bg-pink-50 dark:bg-pink-900/20', lightText: 'text-pink-800 dark:text-pink-200' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/40', text: 'text-cyan-900 dark:text-cyan-100', border: 'border-cyan-300 dark:border-cyan-700', light: 'bg-cyan-50 dark:bg-cyan-900/20', lightText: 'text-cyan-800 dark:text-cyan-200' },
]

export function getSpeakerColor(speakerIndex: number) {
  return SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length]
}

/**
 * Create a speaker-to-index mapping for consistent coloring
 */
export function createSpeakerColorMap(segments: TranscriptSegment[]): Map<string, number> {
  const colorMap = new Map<string, number>()
  let colorIndex = 0

  for (const segment of segments) {
    if (!colorMap.has(segment.speaker)) {
      colorMap.set(segment.speaker, colorIndex++)
    }
  }

  return colorMap
}

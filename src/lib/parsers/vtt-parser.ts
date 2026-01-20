/**
 * VTT (WebVTT) Parser for Microsoft Teams/Copilot Transcripts
 *
 * Parses WebVTT format commonly exported from Microsoft Teams meetings.
 *
 * VTT Format Example:
 * ```
 * WEBVTT
 *
 * 00:00:05.000 --> 00:00:10.000
 * <v David Winter>Let's get started with the planning session.
 *
 * 00:00:10.500 --> 00:00:15.000
 * <v Speaker 2>Sounds good, I'll share my screen.
 * ```
 */

export interface VTTCue {
  startTime: number // seconds
  endTime: number // seconds
  speaker: string
  text: string
}

export interface ParsedVTT {
  cues: VTTCue[]
  speakers: string[]
  duration: number
  rawContent: string // Krisp-style format for storage
}

/**
 * Parse VTT timestamp to seconds
 * Supports formats: HH:MM:SS.mmm, MM:SS.mmm, SS.mmm
 */
export function parseVTTTimestamp(timestamp: string): number {
  const parts = timestamp.trim().split(':')

  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseFloat(parts[0])
    const minutes = parseFloat(parts[1])
    const seconds = parseFloat(parts[2])
    return hours * 3600 + minutes * 60 + seconds
  } else if (parts.length === 2) {
    // MM:SS.mmm
    const minutes = parseFloat(parts[0])
    const seconds = parseFloat(parts[1])
    return minutes * 60 + seconds
  } else {
    // SS.mmm
    return parseFloat(parts[0])
  }
}

/**
 * Extract speaker name from VTT voice tag
 * Format: <v Speaker Name>text or just text
 */
function extractSpeaker(text: string): { speaker: string; content: string } {
  // Match voice tag: <v Speaker Name>content
  // Using [\s\S]* instead of .* with s flag for cross-line matching
  const voiceMatch = text.match(/^<v\s+([^>]+)>([\s\S]*)$/)
  if (voiceMatch) {
    return {
      speaker: voiceMatch[1].trim(),
      content: voiceMatch[2].trim()
    }
  }

  // No voice tag - return text as is with Unknown speaker
  return {
    speaker: 'Unknown',
    content: text.trim()
  }
}

/**
 * Format seconds to MM:SS for Krisp-style output
 */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Parse VTT content into structured cues
 */
export function parseVTT(content: string): ParsedVTT {
  const lines = content.split(/\r?\n/)
  const cues: VTTCue[] = []
  const speakerSet = new Set<string>()

  let i = 0

  // Skip WEBVTT header and any metadata
  while (i < lines.length && !lines[i].includes('-->')) {
    i++
  }

  while (i < lines.length) {
    const line = lines[i].trim()

    // Skip empty lines and cue identifiers (numeric lines before timestamp)
    if (!line || /^\d+$/.test(line)) {
      i++
      continue
    }

    // Look for timestamp line: 00:00:05.000 --> 00:00:10.000
    const timestampMatch = line.match(
      /^(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:?\d{2}:\d{2}[.,]\d{3})/
    )

    if (timestampMatch) {
      const startTime = parseVTTTimestamp(timestampMatch[1].replace(',', '.'))
      const endTime = parseVTTTimestamp(timestampMatch[2].replace(',', '.'))

      // Collect text lines until empty line or next timestamp
      const textLines: string[] = []
      i++

      while (i < lines.length) {
        const textLine = lines[i]
        // Stop at empty line or next timestamp
        if (!textLine.trim() || textLine.includes('-->')) {
          break
        }
        textLines.push(textLine.trim())
        i++
      }

      if (textLines.length > 0) {
        const fullText = textLines.join(' ')
        const { speaker, content: cueContent } = extractSpeaker(fullText)

        if (cueContent) {
          speakerSet.add(speaker)
          cues.push({
            startTime,
            endTime,
            speaker,
            text: cueContent
          })
        }
      }
    } else {
      i++
    }
  }

  // Calculate duration from last cue
  const duration = cues.length > 0
    ? Math.ceil(cues[cues.length - 1].endTime)
    : 0

  // Convert to Krisp-style raw content format
  // Group consecutive cues by speaker and merge
  const rawContentLines: string[] = []
  let currentSpeaker = ''
  let currentText: string[] = []
  let currentTimestamp = ''

  for (const cue of cues) {
    if (cue.speaker !== currentSpeaker) {
      // Output previous speaker's content
      if (currentSpeaker && currentText.length > 0) {
        rawContentLines.push(`${currentSpeaker} | ${currentTimestamp}`)
        rawContentLines.push(currentText.join(' '))
        rawContentLines.push('')
      }

      // Start new speaker
      currentSpeaker = cue.speaker
      currentTimestamp = formatTime(cue.startTime)
      currentText = [cue.text]
    } else {
      // Continue with same speaker
      currentText.push(cue.text)
    }
  }

  // Don't forget last speaker
  if (currentSpeaker && currentText.length > 0) {
    rawContentLines.push(`${currentSpeaker} | ${currentTimestamp}`)
    rawContentLines.push(currentText.join(' '))
  }

  return {
    cues,
    speakers: Array.from(speakerSet),
    duration,
    rawContent: rawContentLines.join('\n')
  }
}

/**
 * Validate that content is valid VTT format
 */
export function isValidVTT(content: string): boolean {
  const trimmed = content.trim()

  // Must start with WEBVTT
  if (!trimmed.startsWith('WEBVTT')) {
    return false
  }

  // Must have at least one timestamp
  return /\d{1,2}:?\d{2}:\d{2}[.,]\d{3}\s*-->\s*\d{1,2}:?\d{2}:\d{2}[.,]\d{3}/.test(trimmed)
}

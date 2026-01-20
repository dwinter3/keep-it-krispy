/**
 * Common Transcript Parser Interface
 *
 * Provides a unified interface for parsing transcripts from various sources:
 * - VTT (WebVTT) - Microsoft Teams/Copilot exports
 * - DOCX - Word document exports
 * - TXT - Plain text transcripts
 *
 * All parsers convert to a common format compatible with the existing
 * Krisp transcript structure for storage and processing.
 */

import { parseVTT, isValidVTT, type ParsedVTT } from './vtt-parser'
import {
  parseTranscriptWithAIFallback,
  shouldUseAIParsing,
  type AIParserResult,
} from './ai-transcript-parser'

export type TranscriptFormat = 'vtt' | 'docx' | 'txt' | 'unknown' | 'ai-parsed'

export interface ParsedTranscriptData {
  /** Meeting title (derived from filename if not in content) */
  title: string
  /** Transcript speakers */
  speakers: string[]
  /** Duration in seconds */
  duration: number
  /** Raw transcript content in Krisp format (speaker | timestamp \n text) */
  rawContent: string
  /** Source format */
  format: TranscriptFormat
  /** Original filename */
  filename: string
  /** Parse warnings (non-fatal issues) */
  warnings: string[]
  /** Parse confidence (0-100) - available when AI parsing is used */
  confidence?: number
  /** Whether AI was used for parsing */
  usedAI?: boolean
  /** AI's description of the detected format */
  formatDescription?: string
}

/**
 * Detect transcript format from file extension and content
 */
export function detectFormat(filename: string, content: string): TranscriptFormat {
  const extension = filename.split('.').pop()?.toLowerCase()

  switch (extension) {
    case 'vtt':
      return 'vtt'
    case 'docx':
      return 'docx'
    case 'txt':
      // Check if TXT content is actually VTT
      if (isValidVTT(content)) {
        return 'vtt'
      }
      return 'txt'
    default:
      // Try to detect from content
      if (isValidVTT(content)) {
        return 'vtt'
      }
      return 'unknown'
  }
}

/**
 * Extract title from filename
 * Removes extension and common suffixes
 */
function extractTitleFromFilename(filename: string): string {
  // Remove extension
  let title = filename.replace(/\.[^/.]+$/, '')

  // Remove common suffixes
  title = title
    .replace(/_transcript$/i, '')
    .replace(/-transcript$/i, '')
    .replace(/_Transcript$/i, '')
    .replace(/-Transcript$/i, '')
    .replace(/_recording$/i, '')
    .replace(/-recording$/i, '')

  // Replace underscores and dashes with spaces
  title = title.replace(/[_-]+/g, ' ')

  // Clean up multiple spaces
  title = title.replace(/\s+/g, ' ').trim()

  return title || 'Untitled Meeting'
}

/**
 * Parse plain text transcript
 * Attempts to detect speaker format or treats as single-speaker transcript
 */
function parsePlainText(content: string, filename: string): ParsedTranscriptData {
  const warnings: string[] = []
  const lines = content.split(/\r?\n/)

  // Try to detect Krisp-style format: "Speaker Name | 00:00"
  const krispPattern = /^(.+?)\s*\|\s*(\d+:\d+(?::\d+)?)\s*$/
  let hasKrispFormat = false

  for (const line of lines) {
    if (krispPattern.test(line.trim())) {
      hasKrispFormat = true
      break
    }
  }

  if (hasKrispFormat) {
    // Already in Krisp format - just extract speakers
    const speakers = new Set<string>()
    let lastTimestamp = 0

    for (const line of lines) {
      const match = line.trim().match(krispPattern)
      if (match) {
        speakers.add(match[1].trim())
        // Parse timestamp for duration
        const parts = match[2].split(':').map(p => parseInt(p, 10))
        if (parts.length === 2) {
          lastTimestamp = Math.max(lastTimestamp, parts[0] * 60 + parts[1])
        } else if (parts.length === 3) {
          lastTimestamp = Math.max(lastTimestamp, parts[0] * 3600 + parts[1] * 60 + parts[2])
        }
      }
    }

    return {
      title: extractTitleFromFilename(filename),
      speakers: Array.from(speakers),
      duration: lastTimestamp + 30, // Estimate extra time for last segment
      rawContent: content,
      format: 'txt',
      filename,
      warnings
    }
  }

  // Try to detect other common formats
  // Pattern: "Speaker Name: text" or "[Speaker Name] text"
  const colonPattern = /^([A-Z][A-Za-z\s]+):\s+(.+)$/
  const bracketPattern = /^\[([^\]]+)\]\s*(.+)$/

  let detectedSpeakers = new Set<string>()
  let detectedPattern: 'colon' | 'bracket' | 'none' = 'none'

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const colonMatch = trimmed.match(colonPattern)
    if (colonMatch && colonMatch[1].length < 50) {
      detectedSpeakers.add(colonMatch[1])
      detectedPattern = 'colon'
    }

    const bracketMatch = trimmed.match(bracketPattern)
    if (bracketMatch && bracketMatch[1].length < 50) {
      detectedSpeakers.add(bracketMatch[1])
      detectedPattern = 'bracket'
    }
  }

  if (detectedPattern !== 'none' && detectedSpeakers.size > 0 && detectedSpeakers.size <= 20) {
    // Convert to Krisp format
    const outputLines: string[] = []
    let currentTime = 0

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let speaker = 'Unknown'
      let text = trimmed

      if (detectedPattern === 'colon') {
        const match = trimmed.match(colonPattern)
        if (match) {
          speaker = match[1]
          text = match[2]
        }
      } else if (detectedPattern === 'bracket') {
        const match = trimmed.match(bracketPattern)
        if (match) {
          speaker = match[1]
          text = match[2]
        }
      }

      // Format timestamp
      const mins = Math.floor(currentTime / 60)
      const secs = currentTime % 60
      const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

      outputLines.push(`${speaker} | ${timestamp}`)
      outputLines.push(text)
      outputLines.push('')

      // Estimate speaking time based on word count (~150 words/minute)
      const wordCount = text.split(/\s+/).length
      currentTime += Math.ceil((wordCount / 150) * 60)
    }

    warnings.push('Timestamps are estimated based on word count')

    return {
      title: extractTitleFromFilename(filename),
      speakers: Array.from(detectedSpeakers),
      duration: currentTime,
      rawContent: outputLines.join('\n'),
      format: 'txt',
      filename,
      warnings
    }
  }

  // Plain text without speaker attribution
  warnings.push('No speaker format detected - treating as single speaker')

  // Split into paragraphs and create simple transcript
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim())
  const outputLines: string[] = []
  let currentTime = 0

  for (const paragraph of paragraphs) {
    const text = paragraph.trim().replace(/\s+/g, ' ')
    if (!text) continue

    const mins = Math.floor(currentTime / 60)
    const secs = currentTime % 60
    const timestamp = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`

    outputLines.push(`Speaker 1 | ${timestamp}`)
    outputLines.push(text)
    outputLines.push('')

    const wordCount = text.split(/\s+/).length
    currentTime += Math.ceil((wordCount / 150) * 60)
  }

  return {
    title: extractTitleFromFilename(filename),
    speakers: ['Speaker 1'],
    duration: currentTime,
    rawContent: outputLines.join('\n'),
    format: 'txt',
    filename,
    warnings
  }
}

/**
 * Parse transcript from any supported format
 */
export function parseTranscriptFile(
  content: string,
  filename: string
): ParsedTranscriptData {
  const format = detectFormat(filename, content)
  const warnings: string[] = []

  switch (format) {
    case 'vtt': {
      const parsed = parseVTT(content)
      return {
        title: extractTitleFromFilename(filename),
        speakers: parsed.speakers,
        duration: parsed.duration,
        rawContent: parsed.rawContent,
        format: 'vtt',
        filename,
        warnings
      }
    }

    case 'docx': {
      // DOCX parsing requires additional library (mammoth)
      // For now, return an error - this can be implemented later
      warnings.push('DOCX parsing requires server-side processing')
      return {
        title: extractTitleFromFilename(filename),
        speakers: [],
        duration: 0,
        rawContent: '',
        format: 'docx',
        filename,
        warnings
      }
    }

    case 'txt':
      return parsePlainText(content, filename)

    default:
      warnings.push('Unknown format - attempting plain text parsing')
      return parsePlainText(content, filename)
  }
}

/**
 * Validate parsed transcript has required data for import
 */
export function validateParsedTranscript(
  data: ParsedTranscriptData
): { valid: boolean; errors: string[] } {
  const errors: string[] = []

  if (!data.title) {
    errors.push('Missing title')
  }

  if (!data.rawContent || data.rawContent.trim().length < 10) {
    errors.push('Transcript content is too short or empty')
  }

  if (data.speakers.length === 0) {
    errors.push('No speakers detected in transcript')
  }

  return {
    valid: errors.length === 0,
    errors
  }
}

/**
 * Parse transcript with intelligent AI fallback
 *
 * This function first tries rule-based parsing, then falls back to AI
 * when the content can't be confidently parsed. The AI can interpret
 * virtually any transcript format and convert it to Krisp format.
 *
 * @param content - Raw transcript content
 * @param filename - Original filename (used for format detection and title)
 * @param options - Parsing options
 * @returns ParsedTranscriptData with confidence scores and AI usage info
 */
export async function parseTranscriptWithAI(
  content: string,
  filename: string,
  options: {
    /** Force AI parsing even if rule-based works */
    forceAI?: boolean
    /** Minimum confidence threshold for rule-based parsing (default: 70) */
    minConfidence?: number
  } = {}
): Promise<ParsedTranscriptData> {
  const { forceAI = false, minConfidence = 70 } = options

  // First try rule-based parsing
  const ruleBasedResult = parseTranscriptFile(content, filename)

  // If forced AI or rule-based has warnings, try AI
  if (forceAI || ruleBasedResult.warnings.length > 0 || shouldUseAIParsing(content)) {
    try {
      const aiResult = await parseTranscriptWithAIFallback(
        content,
        filename,
        {
          speakers: ruleBasedResult.speakers,
          duration: ruleBasedResult.duration,
          rawContent: ruleBasedResult.rawContent,
          warnings: ruleBasedResult.warnings,
        },
        { forceAI }
      )

      // Use AI result if it's better or if forced
      if (forceAI || aiResult.usedAI || aiResult.confidence > minConfidence) {
        return {
          title: ruleBasedResult.title,
          speakers: aiResult.speakers,
          duration: aiResult.duration,
          rawContent: aiResult.rawContent,
          format: aiResult.usedAI ? 'ai-parsed' : ruleBasedResult.format,
          filename,
          warnings: aiResult.notes,
          confidence: aiResult.confidence,
          usedAI: aiResult.usedAI,
          formatDescription: aiResult.formatDescription,
        }
      }
    } catch (error) {
      console.error('AI parsing failed, using rule-based result:', error)
      // Fall through to return rule-based result
    }
  }

  // Return rule-based result with confidence estimate
  let confidence = 100
  if (ruleBasedResult.warnings.some(w => w.includes('No speaker format'))) {
    confidence -= 40
  }
  if (ruleBasedResult.warnings.some(w => w.includes('estimated'))) {
    confidence -= 20
  }

  return {
    ...ruleBasedResult,
    confidence,
    usedAI: false,
    formatDescription: `Parsed as ${ruleBasedResult.format}`,
  }
}

// Re-export AI parser utilities for direct use
export { shouldUseAIParsing } from './ai-transcript-parser'
export type { AIParserResult } from './ai-transcript-parser'

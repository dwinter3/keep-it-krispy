/**
 * Formatting utilities for display
 */

/**
 * Generic platform titles that should be cleaned/replaced
 */
const GENERIC_TITLES = [
  'MS Teams meeting',
  'Microsoft Teams meeting',
  'Google Chrome meeting',
  'Zoom meeting',
  'Google Meet meeting',
  'Meeting',
  'Untitled Meeting',
]

/**
 * Clean a meeting title by removing generic platform names and date suffixes
 */
export function cleanMeetingTitle(title: string | null | undefined): string {
  if (!title) return 'Meeting'

  // Remove date suffix (e.g., "Google Chrome meeting January 16")
  const datePattern =
    /\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}$/i
  let cleaned = title.replace(datePattern, '')

  // Check if it's a generic title
  if (GENERIC_TITLES.some((generic) => cleaned.toLowerCase() === generic.toLowerCase())) {
    return 'Meeting'
  }

  // Check if title starts with a generic prefix
  for (const generic of GENERIC_TITLES) {
    if (cleaned.toLowerCase().startsWith(generic.toLowerCase() + ' - ')) {
      cleaned = cleaned.substring(generic.length + 3)
      break
    }
  }

  return cleaned || 'Meeting'
}

/**
 * Get the best display title for a transcript
 * Prefers topic over title, falls back to cleaned title
 */
export function getDisplayTitle(
  topic: string | null | undefined,
  title: string | null | undefined
): string {
  // Use topic if available and non-empty
  if (topic && topic.trim()) {
    return topic.trim()
  }

  // Fall back to cleaned title
  return cleanMeetingTitle(title)
}

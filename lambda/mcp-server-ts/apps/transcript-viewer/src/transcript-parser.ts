/**
 * Transcript Parser
 *
 * Parses raw Krisp transcript format into structured speaker segments.
 *
 * Format example:
 *   david winter | 00:01
 *   No, a second, I'm trying to figure out the mute.
 *   Speaker 2 | 00:03
 *   Are you David?
 */

// ── Interfaces ────────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  speaker: string;
  timestamp: string;
  timestampSeconds: number;
  text: string;
  startTime: number;
  endTime: number;
}

export interface ParsedTranscript {
  segments: TranscriptSegment[];
  speakerStats: SpeakerStats[];
  totalDuration: number;
}

export interface SpeakerStats {
  speaker: string;
  speakingTime: number;
  percentage: number;
  segmentCount: number;
}

// ── Speaker Colors ────────────────────────────────────────────────────────────

export interface SpeakerColor {
  bubble: string;
  text: string;
  light: string;
}

/**
 * Ordered speaker color palette.
 * Index 0 is reserved for the primary/user speaker (blue, right-aligned).
 * Remaining colors are assigned to other speakers in order of first appearance.
 */
export const SPEAKER_COLORS: SpeakerColor[] = [
  { bubble: '#3b82f6', text: '#ffffff', light: '#dbeafe' }, // blue (primary/user)
  { bubble: '#e5e7eb', text: '#111827', light: '#f3f4f6' }, // gray
  { bubble: '#d1fae5', text: '#065f46', light: '#ecfdf5' }, // green
  { bubble: '#ede9fe', text: '#5b21b6', light: '#f5f3ff' }, // purple
  { bubble: '#ffedd5', text: '#9a3412', light: '#fff7ed' }, // orange
  { bubble: '#fce7f3', text: '#9d174d', light: '#fdf2f8' }, // pink
  { bubble: '#cffafe', text: '#155e75', light: '#ecfeff' }, // cyan
];

/**
 * Get the color palette entry for a given speaker index.
 */
export function getSpeakerColor(index: number): SpeakerColor {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

/**
 * Build a stable speaker-to-index mapping from an ordered list of segments.
 * The first speaker encountered gets index 0 (the primary/user color).
 */
export function createSpeakerColorMap(segments: TranscriptSegment[]): Map<string, number> {
  const map = new Map<string, number>();
  let idx = 0;
  for (const seg of segments) {
    if (!map.has(seg.speaker)) {
      map.set(seg.speaker, idx++);
    }
  }
  return map;
}

// ── Timestamp Utilities ───────────────────────────────────────────────────────

/**
 * Parse a timestamp string (MM:SS or H:MM:SS) into total seconds.
 */
export function parseTimestamp(timestamp: string): number {
  const parts = timestamp.split(':').map((p) => parseInt(p, 10));
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return 0;
}

/**
 * Format seconds as MM:SS or H:MM:SS.
 */
export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Format a duration as a human-readable string (e.g. "1h 5m", "18m", "45s").
 */
export function formatDurationLong(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remaining = mins % 60;
    if (remaining === 0) return `${hours}h`;
    return `${hours}h ${remaining}m`;
  }
  if (secs === 0) return `${mins}m`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// ── Core Parser ───────────────────────────────────────────────────────────────

/**
 * Parse raw Krisp transcript text into structured segments with speaker stats.
 *
 * Lines matching `speaker name | MM:SS` are treated as header lines.
 * All subsequent non-empty lines are concatenated as the segment body.
 * End times are derived from the next segment's start time. The final segment
 * uses `totalDuration` (when provided) or a 30-second estimate.
 *
 * When timestamp-based duration is zero or negative (e.g. rapid-fire exchanges),
 * word-count estimation is used instead (2.5 words/second average speaking rate).
 */
export function parseTranscript(rawContent: string, totalDuration?: number): ParsedTranscript {
  const lines = rawContent.split('\n');
  const segments: TranscriptSegment[] = [];

  let currentSpeaker: string | null = null;
  let currentTimestamp: string | null = null;
  let currentTimestampSeconds = 0;
  let currentText: string[] = [];

  const headerPattern = /^(.+?)\s*\|\s*(\d+:\d+(?::\d+)?)\s*$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(headerPattern);
    if (match) {
      // Flush the previous segment
      if (currentSpeaker && currentText.length > 0) {
        segments.push({
          speaker: currentSpeaker,
          timestamp: currentTimestamp || '00:00',
          timestampSeconds: currentTimestampSeconds,
          text: currentText.join(' ').trim(),
          startTime: currentTimestampSeconds,
          endTime: parseTimestamp(match[2]),
        });
      }
      currentSpeaker = match[1].trim();
      currentTimestamp = match[2];
      currentTimestampSeconds = parseTimestamp(match[2]);
      currentText = [];
    } else {
      currentText.push(trimmed);
    }
  }

  // Flush final segment
  if (currentSpeaker && currentText.length > 0) {
    segments.push({
      speaker: currentSpeaker,
      timestamp: currentTimestamp || '00:00',
      timestampSeconds: currentTimestampSeconds,
      text: currentText.join(' ').trim(),
      startTime: currentTimestampSeconds,
      endTime: totalDuration || currentTimestampSeconds + 30,
    });
  }

  // Fix end times: each segment ends when the next one begins
  for (let i = 0; i < segments.length - 1; i++) {
    segments[i].endTime = segments[i + 1].startTime;
  }

  // ── Speaking-time statistics ──────────────────────────────────────────────
  const WORDS_PER_SECOND = 2.5;
  const speakerTimeMap = new Map<string, { time: number; count: number }>();

  for (const seg of segments) {
    let duration = seg.endTime - seg.startTime;
    if (duration <= 0) {
      const wordCount = seg.text.split(/\s+/).filter((w) => w.length > 0).length;
      duration = wordCount / WORDS_PER_SECOND;
    }
    const prev = speakerTimeMap.get(seg.speaker) || { time: 0, count: 0 };
    speakerTimeMap.set(seg.speaker, {
      time: prev.time + duration,
      count: prev.count + 1,
    });
  }

  const calcTotal =
    totalDuration || (segments.length > 0 ? segments[segments.length - 1].endTime : 0);

  const speakerStats: SpeakerStats[] = Array.from(speakerTimeMap.entries())
    .map(([speaker, data]) => ({
      speaker,
      speakingTime: data.time,
      percentage: calcTotal > 0 ? (data.time / calcTotal) * 100 : 0,
      segmentCount: data.count,
    }))
    .sort((a, b) => b.speakingTime - a.speakingTime);

  return { segments, speakerStats, totalDuration: calcTotal };
}

// ── Grouping Helper ───────────────────────────────────────────────────────────

/**
 * Group consecutive segments by the same speaker so that the UI can render
 * collapsed message clusters (avatar + name shown once per group).
 */
export function groupConsecutiveSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  const groups: TranscriptSegment[][] = [];
  let current: TranscriptSegment[] = [];
  let currentSpeaker: string | null = null;

  for (const seg of segments) {
    if (seg.speaker !== currentSpeaker) {
      if (current.length > 0) groups.push(current);
      current = [seg];
      currentSpeaker = seg.speaker;
    } else {
      current.push(seg);
    }
  }
  if (current.length > 0) groups.push(current);

  return groups;
}

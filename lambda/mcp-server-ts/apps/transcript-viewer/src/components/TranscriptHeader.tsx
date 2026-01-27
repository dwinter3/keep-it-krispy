import React from 'react';
import { Badge } from '@shared/components';
import { formatDurationLong } from '../transcript-parser';

interface TranscriptHeaderProps {
  title: string;
  date: string;
  duration: number;
  speakerCount: number;
  segmentCount: number;
}

/**
 * Renders the meeting title, date, duration, and speaker/segment counts.
 */
export function TranscriptHeader({
  title,
  date,
  duration,
  speakerCount,
  segmentCount,
}: TranscriptHeaderProps) {
  const formattedDate = formatDate(date);
  const formattedDuration = formatDurationLong(duration);

  return (
    <div style={{ marginBottom: 16 }}>
      <h1
        style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          margin: 0,
          lineHeight: 1.3,
        }}
      >
        {title}
      </h1>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginTop: 6,
          flexWrap: 'wrap',
        }}
      >
        <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {formattedDate}
        </span>

        <Badge label={formattedDuration} variant="accent" />
        <Badge label={`${speakerCount} speaker${speakerCount !== 1 ? 's' : ''}`} />
        <Badge label={`${segmentCount} segment${segmentCount !== 1 ? 's' : ''}`} />
      </div>
    </div>
  );
}

/** Best-effort date formatting. Falls back to the raw string if parsing fails. */
function formatDate(raw: string): string {
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return raw;
  }
}

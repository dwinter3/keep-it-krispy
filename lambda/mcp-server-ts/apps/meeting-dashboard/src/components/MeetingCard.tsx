import React from 'react';
import { Card, Badge, SpeakerAvatar } from '@shared/components';
import type { TranscriptMeta } from '@shared/types';

interface MeetingCardProps {
  meeting: TranscriptMeta;
  selected: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '--';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function MeetingCard({ meeting, selected, onToggleSelect, onOpen }: MeetingCardProps) {
  return (
    <Card selected={selected} onClick={onOpen} style={{ cursor: 'pointer' }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        {/* Checkbox */}
        <div
          data-checkbox
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect();
          }}
          style={{
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 20,
            height: 20,
            marginTop: 2,
            borderRadius: 'var(--radius-sm)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-color)'}`,
            background: selected ? 'var(--accent)' : 'transparent',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!selected) {
              e.currentTarget.style.borderColor = 'var(--accent)';
            }
          }}
          onMouseLeave={(e) => {
            if (!selected) {
              e.currentTarget.style.borderColor = 'var(--border-color)';
            }
          }}
        >
          {selected && (
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Title row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <div style={{
              fontWeight: 600,
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {meeting.title || 'Untitled Meeting'}
            </div>
            {meeting.topic && <Badge label={meeting.topic} variant="accent" />}
          </div>

          {/* Meta row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            marginBottom: 8,
          }}>
            <span>{formatDate(meeting.date)}</span>
            <span style={{ color: 'var(--border-color)' }}>|</span>
            <span>{formatDuration(meeting.duration)}</span>
          </div>

          {/* Speakers row */}
          {meeting.speakers && meeting.speakers.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {meeting.speakers.slice(0, 5).map((speaker) => (
                <div key={speaker} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <SpeakerAvatar name={speaker} size={22} />
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{speaker}</span>
                </div>
              ))}
              {meeting.speakers.length > 5 && (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  +{meeting.speakers.length - 5} more
                </span>
              )}
            </div>
          )}

          {/* Summary preview */}
          {meeting.summary && (
            <div style={{
              marginTop: 8,
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              lineHeight: '1.4',
            }}>
              {meeting.summary}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

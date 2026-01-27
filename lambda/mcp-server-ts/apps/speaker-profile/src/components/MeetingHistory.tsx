import React from 'react';
import { Card, LoadingSpinner } from '@shared/components';
import type { TranscriptMeta } from '@shared/types';

interface MeetingHistoryProps {
  transcriptCount?: number;
  totalDuration?: number;
  lastSeen?: string;
  transcripts: TranscriptMeta[];
  loading: boolean;
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '0m';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return 'Unknown';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatShortDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function MeetingHistory({
  transcriptCount,
  totalDuration,
  lastSeen,
  transcripts,
  loading,
}: MeetingHistoryProps) {
  const stats = [
    { label: 'Meetings', value: transcriptCount ?? 0 },
    { label: 'Total Time', value: formatDuration(totalDuration) },
    { label: 'Last Seen', value: formatDate(lastSeen) },
  ];

  return (
    <Card title="Meeting History">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Stats row */}
        <div style={{
          display: 'flex',
          gap: 0,
        }}>
          {stats.map((stat, i) => (
            <div key={stat.label} style={{
              flex: 1,
              textAlign: 'center',
              padding: '8px 4px',
              borderRight: i < stats.length - 1 ? '1px solid var(--border-color)' : 'none',
            }}>
              <div style={{
                fontSize: '1.2rem',
                fontWeight: 700,
                color: 'var(--text-primary)',
              }}>
                {stat.value}
              </div>
              <div style={{
                fontSize: '0.75rem',
                color: 'var(--text-muted)',
                marginTop: 2,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>
                {stat.label}
              </div>
            </div>
          ))}
        </div>

        {/* Recent meetings list */}
        {loading ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            gap: 8,
          }}>
            <LoadingSpinner size={16} />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              Loading meetings...
            </span>
          </div>
        ) : transcripts.length > 0 ? (
          <div style={{
            borderTop: '1px solid var(--border-color)',
            paddingTop: 8,
          }}>
            <div style={{
              fontSize: '0.8rem',
              fontWeight: 600,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 6,
            }}>
              Recent Meetings
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {transcripts.map((t) => (
                <div key={t.meeting_id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 8px',
                  borderRadius: 'var(--radius-sm)',
                  fontSize: '0.85rem',
                }}>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    flexShrink: 0,
                    width: 52,
                  }}>
                    {formatShortDate(t.date)}
                  </span>
                  <span style={{
                    color: 'var(--text-primary)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {t.title || 'Untitled Meeting'}
                  </span>
                  <span style={{
                    color: 'var(--text-muted)',
                    fontSize: '0.8rem',
                    flexShrink: 0,
                  }}>
                    {formatDuration(t.duration)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </Card>
  );
}

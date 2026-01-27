import React from 'react';
import { Card } from '@shared/components';
import type { TranscriptMeta } from '@shared/types';

interface StatsBarProps {
  meetings: TranscriptMeta[];
  allMeetings: TranscriptMeta[];
  refreshing: boolean;
  onRefresh: () => void;
}

function formatTotalDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  return `${minutes}m`;
}

function getDateRange(meetings: TranscriptMeta[]): string {
  if (meetings.length === 0) return '--';
  const dates = meetings
    .map((m) => m.date)
    .filter(Boolean)
    .sort();
  if (dates.length === 0) return '--';
  const first = formatShortDate(dates[0]);
  const last = formatShortDate(dates[dates.length - 1]);
  if (first === last) return first;
  return `${first} - ${last}`;
}

function formatShortDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

export function StatsBar({ meetings, allMeetings, refreshing, onRefresh }: StatsBarProps) {
  const totalDuration = meetings.reduce((sum, m) => sum + (m.duration || 0), 0);
  const uniqueSpeakers = new Set(meetings.flatMap((m) => m.speakers || []));
  const isFiltered = meetings.length !== allMeetings.length;

  return (
    <Card>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: 8,
      }}>
        <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
          <StatItem label="Meetings" value={String(meetings.length)} muted={isFiltered ? `of ${allMeetings.length}` : undefined} />
          <StatItem label="Duration" value={formatTotalDuration(totalDuration)} />
          <StatItem label="Speakers" value={String(uniqueSpeakers.size)} />
          <StatItem label="Dates" value={getDateRange(meetings)} />
        </div>
        <button
          onClick={onRefresh}
          disabled={refreshing}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            fontWeight: 500,
            border: '1px solid var(--border-color)',
            opacity: refreshing ? 0.6 : 1,
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!refreshing) {
              e.currentTarget.style.background = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>
    </Card>
  );
}

function StatItem({ label, value, muted }: { label: string; value: string; muted?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-primary)' }}>
        {value}
        {muted && <span style={{ fontSize: '0.8rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 4 }}>{muted}</span>}
      </div>
    </div>
  );
}

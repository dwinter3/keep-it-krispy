import React from 'react';
import { SearchInput } from '@shared/components';

interface FilterBarProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  speakerFilter: string;
  onSpeakerChange: (value: string) => void;
  dateRange: 'all' | 'week' | 'month';
  onDateRangeChange: (value: 'all' | 'week' | 'month') => void;
  speakers: string[];
}

const selectStyle: React.CSSProperties = {
  padding: '8px 12px',
  border: '1px solid var(--border-color)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-primary)',
  color: 'var(--text-primary)',
  fontSize: '1rem',
  outline: 'none',
  minWidth: 0,
  flex: '0 1 auto',
};

export function FilterBar({
  searchQuery,
  onSearchChange,
  speakerFilter,
  onSpeakerChange,
  dateRange,
  onDateRangeChange,
  speakers,
}: FilterBarProps) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'stretch' }}>
      <div style={{ flex: '1 1 180px', minWidth: 140 }}>
        <SearchInput
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search meetings..."
          debounceMs={250}
        />
      </div>

      <select
        value={speakerFilter}
        onChange={(e) => onSpeakerChange(e.target.value)}
        style={selectStyle}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
      >
        <option value="">All speakers</option>
        {speakers.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>

      <select
        value={dateRange}
        onChange={(e) => onDateRangeChange(e.target.value as 'all' | 'week' | 'month')}
        style={selectStyle}
        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; }}
      >
        <option value="all">All time</option>
        <option value="week">This week</option>
        <option value="month">This month</option>
      </select>
    </div>
  );
}

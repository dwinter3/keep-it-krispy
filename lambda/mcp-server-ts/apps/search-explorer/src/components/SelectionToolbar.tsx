import React from 'react';
import { LoadingSpinner } from '@shared/components';

interface SelectionToolbarProps {
  selectedCount: number;
  onClear: () => void;
  onWorkWithSelected: () => void;
  loading: boolean;
}

export function SelectionToolbar({
  selectedCount,
  onClear,
  onWorkWithSelected,
  loading,
}: SelectionToolbarProps) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      height: 56,
      background: 'var(--bg-card)',
      borderTop: '1px solid var(--border-color)',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      zIndex: 100,
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
      }}>
        <div style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          background: 'var(--accent)',
          color: 'white',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.75rem',
          fontWeight: 700,
        }}>
          {selectedCount}
        </div>
        <span style={{
          fontSize: '0.85rem',
          color: 'var(--text-primary)',
          fontWeight: 500,
        }}>
          selected
        </span>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClear}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 500,
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            opacity: loading ? 0.5 : 1,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!loading) (e.currentTarget.style.background = 'var(--bg-hover)');
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
          }}
        >
          Clear
        </button>

        <button
          onClick={onWorkWithSelected}
          disabled={loading}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'white',
            background: loading ? 'var(--accent-hover)' : 'var(--accent)',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: loading ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            if (!loading) (e.currentTarget.style.background = 'var(--accent-hover)');
          }}
          onMouseLeave={(e) => {
            if (!loading) (e.currentTarget.style.background = 'var(--accent)');
          }}
        >
          {loading && <LoadingSpinner size={14} />}
          {loading ? 'Sending...' : 'Work with Selected'}
        </button>
      </div>
    </div>
  );
}

import React from 'react';

interface SelectionToolbarProps {
  count: number;
  onClear: () => void;
  onWorkWithSelected: () => void;
}

export function SelectionToolbar({ count, onClear, onWorkWithSelected }: SelectionToolbarProps) {
  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '12px 16px',
      background: 'var(--bg-card)',
      borderTop: '1px solid var(--border-color)',
      boxShadow: '0 -2px 8px rgba(0,0,0,0.1)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      zIndex: 100,
    }}>
      <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontWeight: 500 }}>
        {count} meeting{count !== 1 ? 's' : ''} selected
      </span>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={onClear}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            fontSize: '0.85rem',
            fontWeight: 500,
            border: '1px solid var(--border-color)',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--bg-secondary)';
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          Clear
        </button>

        <button
          onClick={onWorkWithSelected}
          style={{
            padding: '6px 14px',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--accent)',
            color: 'white',
            fontSize: '0.85rem',
            fontWeight: 600,
            border: 'none',
            transition: 'all 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--accent)';
          }}
        >
          Work with Selected
        </button>
      </div>
    </div>
  );
}

import React from 'react';

interface ErrorBannerProps {
  error: string;
  onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  return (
    <div style={{
      padding: '12px 16px',
      background: 'var(--error-light)',
      border: `1px solid var(--error)`,
      borderRadius: 'var(--radius)',
      color: 'var(--text-primary)',
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <span style={{ flex: 1 }}>{error}</span>
      {onRetry && (
        <button onClick={onRetry} style={{
          padding: '4px 12px',
          background: 'var(--error)',
          color: 'white',
          borderRadius: 'var(--radius-sm)',
          fontSize: '0.85rem',
        }}>
          Retry
        </button>
      )}
    </div>
  );
}

import React from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
}

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div style={{
      textAlign: 'center',
      padding: '48px 24px',
      color: 'var(--text-muted)',
    }}>
      <div style={{ fontSize: '2rem', marginBottom: 12 }}>📭</div>
      <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--text-secondary)' }}>{title}</div>
      {description && <div style={{ marginTop: 4, fontSize: '0.9rem' }}>{description}</div>}
    </div>
  );
}

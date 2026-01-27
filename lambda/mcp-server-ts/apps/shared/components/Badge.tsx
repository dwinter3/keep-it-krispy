import React from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'accent';

const variantStyles: Record<BadgeVariant, { bg: string; color: string }> = {
  default: { bg: 'var(--bg-secondary)', color: 'var(--text-secondary)' },
  success: { bg: 'var(--success-light)', color: 'var(--success)' },
  warning: { bg: 'var(--warning-light)', color: 'var(--warning)' },
  error: { bg: 'var(--error-light)', color: 'var(--error)' },
  accent: { bg: 'var(--accent-light)', color: 'var(--accent)' },
};

export function Badge({ label, variant = 'default' }: { label: string; variant?: BadgeVariant }) {
  const s = variantStyles[variant];
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: '9999px',
      fontSize: '0.75rem',
      fontWeight: 500,
      background: s.bg,
      color: s.color,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

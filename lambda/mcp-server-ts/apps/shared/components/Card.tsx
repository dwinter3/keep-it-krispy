import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: string;
  onClick?: () => void;
  selected?: boolean;
  style?: React.CSSProperties;
}

export function Card({ children, title, onClick, selected, style }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? 'var(--bg-selected)' : 'var(--bg-card)',
        border: `1px solid ${selected ? 'var(--accent)' : 'var(--border-color)'}`,
        borderRadius: 'var(--radius)',
        padding: 16,
        boxShadow: 'var(--shadow-sm)',
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.15s ease',
        ...style,
      }}
      onMouseEnter={(e) => {
        if (onClick) (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      {title && (
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: '1rem' }}>{title}</div>
      )}
      {children}
    </div>
  );
}

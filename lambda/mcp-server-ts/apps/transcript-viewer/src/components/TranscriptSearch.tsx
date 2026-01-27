import React, { useCallback, useEffect, useRef } from 'react';
import { SearchInput } from '@shared/components';

interface TranscriptSearchProps {
  value: string;
  onChange: (value: string) => void;
  matchCount: number;
  currentMatch: number;
  onPrev: () => void;
  onNext: () => void;
}

/**
 * Search bar with match count badge and prev/next navigation.
 * The parent component is responsible for filtering / highlighting and scrolling.
 */
export function TranscriptSearch({
  value,
  onChange,
  matchCount,
  currentMatch,
  onPrev,
  onNext,
}: TranscriptSearchProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Keyboard shortcuts: Enter / Shift+Enter cycle through matches
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Enter' && value) {
        e.preventDefault();
        if (e.shiftKey) {
          onPrev();
        } else {
          onNext();
        }
      }
    },
    [value, onPrev, onNext],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('keydown', handleKeyDown);
    return () => el.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      ref={containerRef}
      style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}
    >
      <div style={{ flex: 1 }}>
        <SearchInput
          value={value}
          onChange={onChange}
          placeholder="Search transcript..."
          debounceMs={200}
        />
      </div>

      {value && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          <span>
            {matchCount > 0 ? `${currentMatch + 1}/${matchCount}` : 'No matches'}
          </span>

          {matchCount > 1 && (
            <>
              <NavButton label="Prev" onClick={onPrev} />
              <NavButton label="Next" onClick={onNext} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NavButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 22,
        height: 22,
        borderRadius: 'var(--radius-sm)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.7rem',
        color: 'var(--text-secondary)',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = 'var(--bg-secondary)';
      }}
    >
      {label === 'Prev' ? '\u25B2' : '\u25BC'}
    </button>
  );
}

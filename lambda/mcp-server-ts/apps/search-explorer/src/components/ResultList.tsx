import React from 'react';
import { LoadingSpinner, EmptyState } from '@shared/components';
import type { SearchResult } from '@shared/types';
import { ResultCard } from './ResultCard';

interface ResultListProps {
  results: SearchResult[];
  loading: boolean;
  hasSearched: boolean;
  query: string;
  selectedIds: Set<string>;
  onToggleSelect: (meetingId: string) => void;
  onOpenTranscript: (meetingId: string) => void;
}

export function ResultList({
  results,
  loading,
  hasSearched,
  query,
  selectedIds,
  onToggleSelect,
  onOpenTranscript,
}: ResultListProps) {
  // Initial state: no search performed yet
  if (!hasSearched && !loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
      }}>
        <div style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: 'var(--accent-light)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 16,
        }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
        </div>
        <div style={{
          fontWeight: 600,
          fontSize: '1.1rem',
          color: 'var(--text-secondary)',
          marginBottom: 4,
        }}>
          Search your meetings
        </div>
        <div style={{
          fontSize: '0.85rem',
          color: 'var(--text-muted)',
          textAlign: 'center',
          maxWidth: 320,
          lineHeight: 1.5,
        }}>
          Use natural language to find discussions, topics, and decisions across all your transcripts.
        </div>
      </div>
    );
  }

  // Loading state (only show full loader on initial search, not during typing)
  if (loading && results.length === 0) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '64px 24px',
        gap: 12,
      }}>
        <LoadingSpinner size={32} />
        <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
          Searching transcripts...
        </span>
      </div>
    );
  }

  // No results found
  if (hasSearched && results.length === 0 && !loading) {
    return (
      <EmptyState
        title="No results found"
        description={`No matches for "${query}". Try different keywords or a broader search.`}
      />
    );
  }

  // Results list
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {results.map((result) => (
        <ResultCard
          key={result.meetingId}
          result={result}
          query={query}
          selected={selectedIds.has(result.meetingId)}
          onToggleSelect={onToggleSelect}
          onOpenTranscript={onOpenTranscript}
        />
      ))}
    </div>
  );
}

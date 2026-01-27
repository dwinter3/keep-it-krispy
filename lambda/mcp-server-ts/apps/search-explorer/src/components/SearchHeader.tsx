import React from 'react';
import { SearchInput, LoadingSpinner } from '@shared/components';

interface SearchHeaderProps {
  query: string;
  onQueryChange: (query: string) => void;
  resultCount: number;
  loading: boolean;
  hasSearched: boolean;
  searchType: string;
}

export function SearchHeader({
  query,
  onQueryChange,
  resultCount,
  loading,
  hasSearched,
  searchType,
}: SearchHeaderProps) {
  return (
    <div style={{
      padding: '16px 16px 12px',
      borderBottom: '1px solid var(--border-color)',
      background: 'var(--bg-primary)',
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        marginBottom: 10,
      }}>
        <div style={{
          fontSize: '1.25rem',
          fontWeight: 700,
          color: 'var(--text-primary)',
          whiteSpace: 'nowrap',
        }}>
          Search Explorer
        </div>
      </div>

      <SearchInput
        value={query}
        onChange={onQueryChange}
        placeholder="Search your meetings..."
        debounceMs={300}
        autoFocus
      />

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
        minHeight: 20,
      }}>
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <LoadingSpinner size={14} />
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Searching...
            </span>
          </div>
        )}

        {!loading && hasSearched && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {resultCount === 0
              ? 'No results found'
              : `${resultCount} result${resultCount === 1 ? '' : 's'} found`}
            {searchType && (
              <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                ({searchType})
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

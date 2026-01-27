import React, { useState, useCallback, useRef } from 'react';
import { useApp, useHostStyleVariables } from '@modelcontextprotocol/ext-apps/react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { LoadingSpinner, ErrorBanner } from '@shared/components';
import type { SearchResult, SearchResponse } from '@shared/types';
import { SearchHeader } from './components/SearchHeader';
import { ResultList } from './components/ResultList';
import { SelectionToolbar } from './components/SelectionToolbar';

export function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [resultCount, setResultCount] = useState(0);
  const [searchType, setSearchType] = useState('');
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sendingToModel, setSendingToModel] = useState(false);
  const currentQueryRef = useRef('');

  const appRef = useRef<McpApp | null>(null);

  const handleInitialResults = useCallback((data: SearchResponse) => {
    setResults(data.results);
    setResultCount(data.count);
    setSearchType(data.searchType);
    setHasSearched(true);
    if (data.query) {
      setQuery(data.query);
    }
  }, []);

  const { app, isConnected, error: connectionError } = useApp({
    appInfo: { name: 'SearchExplorer', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (createdApp) => {
      appRef.current = createdApp;

      createdApp.ontoolinput = (params: { arguments?: Record<string, unknown> }) => {
        const initialQuery = params.arguments?.query as string | undefined;
        if (initialQuery) {
          setQuery(initialQuery);
        }
      };

      createdApp.ontoolresult = (params: { content?: Array<{ type: string; text?: string }> }) => {
        const text = params.content?.find((c) => c.type === 'text')?.text;
        if (!text) return;
        try {
          const data = JSON.parse(text) as SearchResponse | { initial_query: null; error?: string };
          if ('results' in data) {
            handleInitialResults(data);
          }
        } catch {
          // Ignore parse errors for non-search responses
        }
      };
    },
  });

  useHostStyleVariables(app);

  const executeSearch = useCallback(async (searchQuery: string) => {
    if (!app || !searchQuery.trim()) {
      if (!searchQuery.trim()) {
        setResults([]);
        setResultCount(0);
        setHasSearched(false);
      }
      return;
    }

    const trimmed = searchQuery.trim();
    currentQueryRef.current = trimmed;
    setLoading(true);
    setSearchError(null);

    try {
      const result = await app.callServerTool({
        name: 'search_transcripts',
        arguments: { query: trimmed, limit: 20 },
      });

      // Only update if this is still the current query
      if (currentQueryRef.current !== trimmed) return;

      const text = (result.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text'
      )?.text;

      if (text) {
        const data = JSON.parse(text) as SearchResponse;
        setResults(data.results);
        setResultCount(data.count);
        setSearchType(data.searchType);
        setHasSearched(true);
      }
    } catch (err) {
      if (currentQueryRef.current !== trimmed) return;
      setSearchError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      if (currentQueryRef.current === trimmed) {
        setLoading(false);
      }
    }
  }, [app]);

  const handleQueryChange = useCallback((newQuery: string) => {
    setQuery(newQuery);
    setSelectedIds(new Set());
    executeSearch(newQuery);
  }, [executeSearch]);

  const handleToggleSelect = useCallback((meetingId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(meetingId)) {
        next.delete(meetingId);
      } else {
        next.add(meetingId);
      }
      return next;
    });
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleOpenTranscript = useCallback(async (meetingId: string) => {
    if (!app) return;
    try {
      await app.callServerTool({
        name: 'transcript_viewer',
        arguments: { meeting_id: meetingId },
      });
    } catch {
      // Viewer may not be available; silently fail
    }
  }, [app]);

  const handleWorkWithSelected = useCallback(async () => {
    if (!app || selectedIds.size === 0) return;

    setSendingToModel(true);
    try {
      const selectedResults = results.filter((r) => selectedIds.has(r.meetingId));
      const markdown = buildSelectedMarkdown(query, selectedResults);

      await app.updateModelContext({
        content: [{ type: 'text', text: markdown }],
      });

      await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `I've selected ${selectedResults.length} search result${selectedResults.length === 1 ? '' : 's'} from my search for "${query}". Please review and analyze them.`,
          },
        ],
      });

      setSelectedIds(new Set());
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Failed to send results to Claude');
    } finally {
      setSendingToModel(false);
    }
  }, [app, selectedIds, results, query]);

  // Connection states
  if (connectionError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBanner error={`Connection error: ${connectionError}`} />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <LoadingSpinner size={32} />
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      overflow: 'hidden',
    }}>
      <SearchHeader
        query={query}
        onQueryChange={handleQueryChange}
        resultCount={resultCount}
        loading={loading}
        hasSearched={hasSearched}
        searchType={searchType}
      />

      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '0 16px 16px',
        paddingBottom: selectedIds.size > 0 ? 72 : 16,
      }}>
        {searchError && (
          <div style={{ marginBottom: 12 }}>
            <ErrorBanner
              error={searchError}
              onRetry={() => executeSearch(query)}
            />
          </div>
        )}

        <ResultList
          results={results}
          loading={loading}
          hasSearched={hasSearched}
          query={query}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onOpenTranscript={handleOpenTranscript}
        />
      </div>

      {selectedIds.size > 0 && (
        <SelectionToolbar
          selectedCount={selectedIds.size}
          onClear={handleClearSelection}
          onWorkWithSelected={handleWorkWithSelected}
          loading={sendingToModel}
        />
      )}
    </div>
  );
}

/**
 * Build a markdown summary of selected search results for model context.
 */
function buildSelectedMarkdown(query: string, results: SearchResult[]): string {
  const lines: string[] = [
    `## Selected Search Results`,
    `**Query:** "${query}"`,
    `**Selected:** ${results.length} result${results.length === 1 ? '' : 's'}`,
    '',
  ];

  for (const r of results) {
    lines.push(`### ${r.title}`);
    lines.push(`- **Date:** ${r.date}`);
    lines.push(`- **Speakers:** ${r.speakers.join(', ')}`);
    lines.push(`- **Relevance:** ${Math.round(r.relevanceScore * 100)}%`);
    if (r.topic) lines.push(`- **Topic:** ${r.topic}`);
    lines.push(`- **Meeting ID:** ${r.meetingId}`);
    if (r.snippets.length > 0) {
      lines.push('- **Snippets:**');
      for (const snippet of r.snippets) {
        lines.push(`  > ${snippet}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

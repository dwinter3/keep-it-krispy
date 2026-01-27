import React, { useState, useCallback, useRef } from 'react';
import { useApp, useHostStyleVariables } from '@modelcontextprotocol/ext-apps/react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { LoadingSpinner, ErrorBanner } from '@shared/components';
import { useServerTool } from '@shared/hooks/useServerTool';
import type { TranscriptMeta } from '@shared/types';
import { StatsBar } from './components/StatsBar';
import { FilterBar } from './components/FilterBar';
import { MeetingList } from './components/MeetingList';
import { SelectionToolbar } from './components/SelectionToolbar';

export function App() {
  const [meetings, setMeetings] = useState<TranscriptMeta[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [initialError, setInitialError] = useState<string | null>(null);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [speakerFilter, setSpeakerFilter] = useState('');
  const [dateRange, setDateRange] = useState<'all' | 'week' | 'month'>('all');

  const appRef = useRef<McpApp | null>(null);

  const { app, isConnected, error: connectionError } = useApp({
    appInfo: { name: 'MeetingDashboard', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (createdApp) => {
      appRef.current = createdApp;

      createdApp.ontoolresult = (params) => {
        try {
          const text = (params.content as Array<{ type: string; text?: string }>)?.find(
            (c) => c.type === 'text'
          )?.text;
          if (text) {
            const parsed = JSON.parse(text);
            if (parsed.error) {
              setInitialError(parsed.error);
            } else if (Array.isArray(parsed)) {
              setMeetings(parsed);
            } else if (parsed.transcripts && Array.isArray(parsed.transcripts)) {
              setMeetings(parsed.transcripts);
            }
          }
        } catch {
          // Parsing failed; will fall back to tool call
        }
        setInitialLoaded(true);
      };
    },
  });

  useHostStyleVariables(app, app?.getHostContext());

  // Fallback/refresh mechanism via callServerTool
  const {
    loading: refreshing,
    error: refreshError,
    execute: refreshData,
  } = useServerTool<TranscriptMeta[]>(app, 'list_transcripts', (text) => {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed;
    if (parsed.transcripts && Array.isArray(parsed.transcripts)) return parsed.transcripts;
    return [];
  });

  const handleRefresh = useCallback(async () => {
    const result = await refreshData({ limit: 50 });
    if (result) {
      setMeetings(result);
      setInitialLoaded(true);
      setInitialError(null);
    }
  }, [refreshData]);

  // Load data via tool call if ontoolresult doesn't fire within a delay
  React.useEffect(() => {
    if (isConnected && !initialLoaded) {
      const timer = setTimeout(() => {
        if (!initialLoaded) {
          handleRefresh();
        }
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isConnected, initialLoaded, handleRefresh]);

  // Selection handlers
  const toggleSelect = useCallback((meetingId: string) => {
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

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleOpenTranscript = useCallback(
    async (meetingId: string) => {
      if (!app) return;
      try {
        await app.callServerTool({
          name: 'transcript_viewer',
          arguments: { meeting_id: meetingId },
        });
      } catch (err) {
        console.error('Failed to open transcript viewer:', err);
      }
    },
    [app]
  );

  const handleWorkWithSelected = useCallback(async () => {
    if (!app || selectedIds.size === 0) return;

    const selectedMeetings = meetings.filter((m) => selectedIds.has(m.meeting_id));
    const summaryLines = selectedMeetings.map(
      (m) =>
        `- **${m.title}** (${m.date})${m.summary ? `: ${m.summary}` : ''}`
    );

    const markdown = `## Selected Meetings (${selectedMeetings.length})\n\n${summaryLines.join('\n')}\n\nMeeting IDs: ${selectedMeetings.map((m) => m.meeting_id).join(', ')}`;

    try {
      await app.updateModelContext({
        content: [{ type: 'text', text: markdown }],
      });
      await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `I've selected ${selectedMeetings.length} meeting(s) from the dashboard. What would you like to know about them?`,
          },
        ],
      });
    } catch (err) {
      console.error('Failed to send selected meetings:', err);
    }
  }, [app, selectedIds, meetings]);

  // Filtering logic
  const filteredMeetings = React.useMemo(() => {
    let result = meetings;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (m) =>
          m.title?.toLowerCase().includes(q) ||
          m.speakers?.some((s) => s.toLowerCase().includes(q)) ||
          m.topic?.toLowerCase().includes(q) ||
          m.summary?.toLowerCase().includes(q)
      );
    }

    // Speaker filter
    if (speakerFilter) {
      result = result.filter((m) =>
        m.speakers?.some((s) => s === speakerFilter)
      );
    }

    // Date range filter
    if (dateRange !== 'all') {
      const now = new Date();
      const cutoff = new Date();
      if (dateRange === 'week') {
        cutoff.setDate(now.getDate() - 7);
      } else {
        cutoff.setDate(now.getDate() - 30);
      }
      result = result.filter((m) => {
        const meetingDate = new Date(m.date);
        return meetingDate >= cutoff;
      });
    }

    return result;
  }, [meetings, searchQuery, speakerFilter, dateRange]);

  // Collect all unique speakers for the filter dropdown
  const allSpeakers = React.useMemo(() => {
    const speakerSet = new Set<string>();
    meetings.forEach((m) => m.speakers?.forEach((s) => speakerSet.add(s)));
    return Array.from(speakerSet).sort();
  }, [meetings]);

  // Connection/loading states
  if (connectionError) {
    return (
      <div style={{ padding: 16 }}>
        <ErrorBanner error={`Connection failed: ${connectionError.message}`} />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
        <LoadingSpinner size={20} />
        <span style={{ color: 'var(--text-secondary)' }}>Connecting...</span>
      </div>
    );
  }

  if (!initialLoaded && !refreshing) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 48, gap: 12 }}>
        <LoadingSpinner size={20} />
        <span style={{ color: 'var(--text-secondary)' }}>Loading meetings...</span>
      </div>
    );
  }

  const displayError = initialError || refreshError;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 12, minHeight: '100vh' }}>
      {displayError && (
        <ErrorBanner error={displayError} onRetry={handleRefresh} />
      )}

      <StatsBar meetings={filteredMeetings} allMeetings={meetings} refreshing={refreshing} onRefresh={handleRefresh} />

      <FilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        speakerFilter={speakerFilter}
        onSpeakerChange={setSpeakerFilter}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        speakers={allSpeakers}
      />

      <MeetingList
        meetings={filteredMeetings}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
        onOpenTranscript={handleOpenTranscript}
      />

      {selectedIds.size > 0 && (
        <SelectionToolbar
          count={selectedIds.size}
          onClear={clearSelection}
          onWorkWithSelected={handleWorkWithSelected}
        />
      )}
    </div>
  );
}

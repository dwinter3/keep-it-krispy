import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useApp, useHostStyleVariables } from '@modelcontextprotocol/ext-apps/react';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@shared/components';
import type { TranscriptContent } from '@shared/types';
import {
  parseTranscript,
  createSpeakerColorMap,
  type ParsedTranscript,
} from './transcript-parser';
import { TranscriptHeader } from './components/TranscriptHeader';
import { TalkTimeBar } from './components/TalkTimeBar';
import { TranscriptSearch } from './components/TranscriptSearch';
import { TranscriptBubbles } from './components/TranscriptBubbles';
import { ActionBar } from './components/ActionBar';

// ── Data State ────────────────────────────────────────────────────────────────

interface TranscriptData {
  meetingId: string;
  meta: TranscriptContent;
  parsed: ParsedTranscript;
  speakerColorMap: Map<string, number>;
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  const [data, setData] = useState<TranscriptData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [currentMatchIdx, setCurrentMatchIdx] = useState(0);

  // We keep the meeting ID from ontoolinput so we can fetch full content
  const meetingIdRef = useRef<string | null>(null);

  // ── MCP App connection ──────────────────────────────────────────────────

  const { app, isConnected, error: connectError } = useApp({
    appInfo: { name: 'TranscriptViewer', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (mcpApp) => {
      mcpApp.ontoolinput = (params) => {
        const args = params.arguments as { meeting_id?: string } | undefined;
        if (args?.meeting_id) {
          meetingIdRef.current = args.meeting_id;
        }
      };

      mcpApp.ontoolresult = (params) => {
        handleToolResult(params, mcpApp);
      };
    },
  });

  useHostStyleVariables(app, app?.getHostContext());

  // ── Handle tool result (initial data or full content) ───────────────────

  const handleToolResult = useCallback(
    async (
      params: { content?: Array<{ type: string; text?: string }>; isError?: boolean },
      mcpApp: import('@modelcontextprotocol/ext-apps').App,
    ) => {
      try {
        if (params.isError) {
          setError('Tool returned an error.');
          setLoading(false);
          return;
        }

        const text = params.content?.find((c) => c.type === 'text')?.text;
        if (!text) {
          setError('No data returned from tool.');
          setLoading(false);
          return;
        }

        const json = JSON.parse(text) as {
          meeting_id?: string;
          transcript?: TranscriptContent;
          error?: string;
        };

        if (json.error) {
          setError(json.error);
          setLoading(false);
          return;
        }

        const meta = json.transcript;
        if (!meta) {
          setError('Transcript data is missing.');
          setLoading(false);
          return;
        }

        const meetingId = json.meeting_id || meta.meeting_id;

        // If we don't have the full transcript text yet, fetch it
        if (!meta.transcript) {
          setLoading(true);
          try {
            const result = await mcpApp.callServerTool({
              name: 'get_transcripts',
              arguments: { meeting_ids: [meetingId] },
            });
            const resultText = (
              result.content as Array<{ type: string; text?: string }>
            )?.find((c) => c.type === 'text')?.text;

            if (resultText) {
              const fullData = JSON.parse(resultText);
              // get_transcripts returns an array
              const full: TranscriptContent | undefined = Array.isArray(fullData)
                ? fullData[0]
                : fullData;
              if (full?.transcript) {
                applyData(meetingId, { ...meta, ...full });
                return;
              }
            }

            // If we still have no raw text, show what we have
            if (meta.summary) {
              applyData(meetingId, meta);
            } else {
              setError('Full transcript content is unavailable.');
              setLoading(false);
            }
          } catch (fetchErr) {
            console.error('TranscriptViewer: failed to fetch full content', fetchErr);
            // Fall back to partial data if available
            applyData(meetingId, meta);
          }
        } else {
          applyData(meetingId, meta);
        }
      } catch (err) {
        console.error('TranscriptViewer: failed to parse tool result', err);
        setError('Failed to parse transcript data.');
        setLoading(false);
      }
    },
    [],
  );

  // ── Apply parsed data ──────────────────────────────────────────────────

  const applyData = useCallback((meetingId: string, meta: TranscriptContent) => {
    const rawText = meta.transcript || '';
    const parsed = parseTranscript(rawText, meta.duration);
    const colorMap = createSpeakerColorMap(parsed.segments);

    setData({ meetingId, meta, parsed, speakerColorMap: colorMap });
    setLoading(false);
    setError(null);
  }, []);

  // ── Search logic ───────────────────────────────────────────────────────

  const matchIndices: number[] = useMemo(() => {
    if (!searchTerm || !data) return [];
    const term = searchTerm.toLowerCase();
    const indices: number[] = [];
    data.parsed.segments.forEach((seg, i) => {
      if (seg.text.toLowerCase().includes(term)) {
        indices.push(i);
      }
    });
    return indices;
  }, [searchTerm, data]);

  // Reset current match when the term or match list changes
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
    setCurrentMatchIdx(0);
  }, []);

  const handlePrev = useCallback(() => {
    setCurrentMatchIdx((prev) => (prev <= 0 ? matchIndices.length - 1 : prev - 1));
  }, [matchIndices.length]);

  const handleNext = useCallback(() => {
    setCurrentMatchIdx((prev) => (prev >= matchIndices.length - 1 ? 0 : prev + 1));
  }, [matchIndices.length]);

  // ── Retry handler ──────────────────────────────────────────────────────

  const handleRetry = useCallback(async () => {
    if (!app || !meetingIdRef.current) return;
    setLoading(true);
    setError(null);
    try {
      const result = await app.callServerTool({
        name: 'get_transcripts',
        arguments: { meeting_ids: [meetingIdRef.current] },
      });
      const text = (result.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text',
      )?.text;
      if (text) {
        const parsed = JSON.parse(text);
        const full: TranscriptContent | undefined = Array.isArray(parsed) ? parsed[0] : parsed;
        if (full) {
          applyData(meetingIdRef.current!, full);
          return;
        }
      }
      setError('Failed to load transcript data.');
      setLoading(false);
    } catch {
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }, [app, applyData]);

  // ── Render ─────────────────────────────────────────────────────────────

  if (connectError) {
    return (
      <Container>
        <ErrorBanner error={`Connection failed: ${connectError.message}`} />
      </Container>
    );
  }

  if (!isConnected || loading) {
    return (
      <Container>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '64px 0',
            gap: 12,
          }}
        >
          <LoadingSpinner size={32} />
          <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
            {!isConnected ? 'Connecting...' : 'Loading transcript...'}
          </span>
        </div>
      </Container>
    );
  }

  if (error) {
    return (
      <Container>
        <ErrorBanner error={error} onRetry={handleRetry} />
      </Container>
    );
  }

  if (!data || data.parsed.segments.length === 0) {
    return (
      <Container>
        {data?.meta?.summary ? (
          <div>
            <TranscriptHeader
              title={data.meta.title || 'Untitled Meeting'}
              date={data.meta.date || ''}
              duration={data.meta.duration || 0}
              speakerCount={data.meta.speakers?.length || 0}
              segmentCount={0}
            />
            <div
              style={{
                padding: 16,
                background: 'var(--bg-secondary)',
                borderRadius: 'var(--radius)',
                color: 'var(--text-secondary)',
                fontSize: '0.9rem',
                lineHeight: 1.6,
              }}
            >
              <strong>Summary:</strong> {data.meta.summary}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No transcript content"
            description="This meeting does not have transcript text available."
          />
        )}
      </Container>
    );
  }

  const firstSpeaker = data.parsed.segments[0].speaker;

  return (
    <Container>
      <TranscriptHeader
        title={data.meta.title || 'Untitled Meeting'}
        date={data.meta.date || ''}
        duration={data.parsed.totalDuration}
        speakerCount={data.parsed.speakerStats.length}
        segmentCount={data.parsed.segments.length}
      />

      <TalkTimeBar
        speakerStats={data.parsed.speakerStats}
        speakerColorMap={data.speakerColorMap}
      />

      <TranscriptSearch
        value={searchTerm}
        onChange={handleSearchChange}
        matchCount={matchIndices.length}
        currentMatch={currentMatchIdx}
        onPrev={handlePrev}
        onNext={handleNext}
      />

      <TranscriptBubbles
        segments={data.parsed.segments}
        speakerColorMap={data.speakerColorMap}
        firstSpeaker={firstSpeaker}
        searchTerm={searchTerm.toLowerCase()}
        matchIndices={matchIndices}
        currentMatchIdx={currentMatchIdx}
      />

      <ActionBar
        app={app}
        title={data.meta.title || 'Untitled Meeting'}
        segments={data.parsed.segments}
      />
    </Container>
  );
}

// ── Layout Container ─────────────────────────────────────────────────────────

function Container({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        maxWidth: 640,
        margin: '0 auto',
        padding: '16px 12px 80px',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {children}
    </div>
  );
}

import React, { useState, useEffect, useCallback } from 'react';
import { useApp, useHostStyleVariables } from '@modelcontextprotocol/ext-apps/react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { LoadingSpinner, ErrorBanner, EmptyState } from '@shared/components';
import type { SpeakerContext, TranscriptMeta } from '@shared/types';
import { ProfileHeader } from './components/ProfileHeader';
import { LinkedInCard } from './components/LinkedInCard';
import { MeetingHistory } from './components/MeetingHistory';
import { TopicCloud } from './components/TopicCloud';
import { ActionBar } from './components/ActionBar';

export function App() {
  const [speakerName, setSpeakerName] = useState<string | null>(null);
  const [context, setContext] = useState<SpeakerContext | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transcriptsLoading, setTranscriptsLoading] = useState(false);

  const handleToolInput = useCallback((params: { arguments?: Record<string, unknown> }) => {
    const name = params.arguments?.speaker_name as string | undefined;
    if (name) {
      setSpeakerName(name);
    }
  }, []);

  const handleToolResult = useCallback((params: { content?: Array<{ type: string; text?: string }> }) => {
    try {
      const textContent = (params.content as Array<{ type: string; text?: string }>)?.find(
        (c) => c.type === 'text'
      );
      if (textContent?.text) {
        const parsed = JSON.parse(textContent.text) as SpeakerContext;
        setContext(parsed);
        setLoading(false);
      }
    } catch {
      // Result did not parse as SpeakerContext; we will fetch via fallback
    }
  }, []);

  const { app, isConnected, error: connError } = useApp({
    appInfo: { name: 'SpeakerProfile', version: '1.0.0' },
    capabilities: {},
    onAppCreated: (createdApp: McpApp) => {
      createdApp.ontoolinput = handleToolInput;
      createdApp.ontoolresult = handleToolResult;
    },
  });

  useHostStyleVariables(app);

  // Fetch speaker context as fallback when we have a name but no context yet
  useEffect(() => {
    if (!app || !speakerName || context) return;

    let cancelled = false;

    async function fetchContext() {
      setLoading(true);
      setError(null);
      try {
        const result = await app!.callServerTool({
          name: 'get_speaker_context',
          arguments: { speaker_name: speakerName },
        });
        if (cancelled) return;
        const text = (result.content as Array<{ type: string; text?: string }>)?.find(
          (c) => c.type === 'text'
        )?.text;
        if (text) {
          setContext(JSON.parse(text) as SpeakerContext);
        } else {
          setError('No speaker context data returned.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch speaker context.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchContext();
    return () => { cancelled = true; };
  }, [app, speakerName, context]);

  // Fetch recent transcripts for the speaker
  useEffect(() => {
    if (!app || !speakerName) return;

    let cancelled = false;

    async function fetchTranscripts() {
      setTranscriptsLoading(true);
      try {
        const result = await app!.callServerTool({
          name: 'list_transcripts',
          arguments: { speaker: speakerName, limit: 10 },
        });
        if (cancelled) return;
        const text = (result.content as Array<{ type: string; text?: string }>)?.find(
          (c) => c.type === 'text'
        )?.text;
        if (text) {
          const parsed = JSON.parse(text);
          const items = Array.isArray(parsed) ? parsed : parsed.transcripts ?? [];
          setTranscripts(items as TranscriptMeta[]);
        }
      } catch {
        // Non-critical; meeting history just stays empty
      } finally {
        if (!cancelled) setTranscriptsLoading(false);
      }
    }

    fetchTranscripts();
    return () => { cancelled = true; };
  }, [app, speakerName]);

  const handleRetry = useCallback(() => {
    setContext(null);
    setError(null);
    setLoading(true);
  }, []);

  // Connection error
  if (connError) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBanner error={`Connection error: ${connError}`} />
      </div>
    );
  }

  // Waiting for connection
  if (!isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
        <LoadingSpinner size={20} />
        <span style={{ color: 'var(--text-secondary)' }}>Connecting...</span>
      </div>
    );
  }

  // Waiting for speaker name
  if (!speakerName) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState title="No Speaker Selected" description="Waiting for speaker context from Claude..." />
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12 }}>
        <LoadingSpinner size={20} />
        <span style={{ color: 'var(--text-secondary)' }}>Loading profile for {speakerName}...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ padding: 24 }}>
        <ErrorBanner error={error} onRetry={handleRetry} />
      </div>
    );
  }

  // No context found
  if (!context) {
    return (
      <div style={{ padding: 24 }}>
        <EmptyState title={speakerName} description="No enrichment data available for this speaker." />
      </div>
    );
  }

  return (
    <div style={{
      padding: 24,
      maxWidth: 640,
      margin: '0 auto',
      display: 'flex',
      flexDirection: 'column',
      gap: 16,
      paddingBottom: 80,
    }}>
      <ProfileHeader context={context} />
      <LinkedInCard linkedinMatch={context.linkedinMatch} app={app} />
      <MeetingHistory
        transcriptCount={context.transcriptCount}
        totalDuration={context.totalDuration}
        lastSeen={context.lastSeen}
        transcripts={transcripts}
        loading={transcriptsLoading}
      />
      {context.enrichedProfile?.topics && context.enrichedProfile.topics.length > 0 && (
        <TopicCloud topics={context.enrichedProfile.topics} />
      )}
      <ActionBar speakerName={speakerName} app={app} />
    </div>
  );
}

import React, { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import type { TranscriptSegment } from '../transcript-parser';
import { formatTimestamp } from '../transcript-parser';

interface ActionBarProps {
  app: McpApp | null;
  title: string;
  segments: TranscriptSegment[];
}

/**
 * Fixed bottom action bar with a "Use This Transcript" button.
 *
 * When clicked, it:
 * 1. Calls `app.updateModelContext()` with the full transcript in markdown format.
 * 2. Calls `app.sendMessage()` to prompt Claude with a follow-up instruction.
 */
export function ActionBar({ app, title, segments }: ActionBarProps) {
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const handleClick = async () => {
    if (!app || sending || sent) return;
    setSending(true);

    try {
      // Build a markdown representation of the transcript
      const markdown = buildMarkdown(title, segments);

      await app.updateModelContext({
        content: [{ type: 'text', text: markdown }],
      });

      await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `I've loaded the transcript for "${title}". What would you like me to do with it?`,
          },
        ],
      });

      setSent(true);
    } catch (err) {
      console.error('ActionBar: failed to send context', err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      style={{
        position: 'sticky',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '10px 16px',
        background: 'var(--bg-primary)',
        borderTop: '1px solid var(--border-color)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 10,
      }}
    >
      <button
        onClick={handleClick}
        disabled={!app || sending || sent}
        style={{
          padding: '8px 20px',
          borderRadius: 'var(--radius)',
          fontWeight: 600,
          fontSize: '0.9rem',
          color: '#ffffff',
          background: sent
            ? 'var(--success)'
            : sending
              ? 'var(--accent-hover)'
              : 'var(--accent)',
          opacity: !app || sending ? 0.7 : 1,
          cursor: !app || sending || sent ? 'default' : 'pointer',
          transition: 'background 0.15s ease, opacity 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (!sending && !sent) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!sending && !sent) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
          }
        }}
      >
        {sent ? 'Transcript Loaded' : sending ? 'Sending...' : 'Use This Transcript'}
      </button>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildMarkdown(title: string, segments: TranscriptSegment[]): string {
  const lines = [
    `# Transcript: ${title}`,
    '',
  ];

  let lastSpeaker = '';
  for (const seg of segments) {
    if (seg.speaker !== lastSpeaker) {
      lines.push('');
      lines.push(`**${seg.speaker}** (${formatTimestamp(seg.timestampSeconds)})`);
      lastSpeaker = seg.speaker;
    }
    lines.push(seg.text);
  }

  return lines.join('\n');
}

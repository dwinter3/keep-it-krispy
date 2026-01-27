import React, { useState } from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';

interface ActionBarProps {
  speakerName: string;
  app: McpApp | null;
}

export function ActionBar({ speakerName, app }: ActionBarProps) {
  const [sending, setSending] = useState(false);

  const handleViewAllMeetings = async () => {
    if (!app || sending) return;
    setSending(true);
    try {
      await app.updateModelContext({
        content: [
          {
            type: 'text',
            text: `The user is viewing the Speaker Profile for "${speakerName}" and wants to see all their meetings.`,
          },
        ],
      });
      await app.sendMessage({
        role: 'user',
        content: [
          {
            type: 'text',
            text: `List all meetings with ${speakerName}.`,
          },
        ],
      });
    } catch {
      // Best effort; action bar is non-critical
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: 0,
      left: 0,
      right: 0,
      padding: '12px 24px',
      background: 'var(--bg-primary)',
      borderTop: '1px solid var(--border-color)',
      display: 'flex',
      justifyContent: 'center',
      gap: 12,
    }}>
      <button
        onClick={handleViewAllMeetings}
        disabled={!app || sending}
        style={{
          padding: '8px 20px',
          background: !app || sending ? 'var(--text-muted)' : 'var(--accent)',
          color: 'white',
          borderRadius: 'var(--radius)',
          fontSize: '0.9rem',
          fontWeight: 600,
          opacity: sending ? 0.7 : 1,
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          if (app && !sending) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (app && !sending) {
            (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
          }
        }}
      >
        {sending ? 'Asking Claude...' : 'View All Meetings'}
      </button>
    </div>
  );
}

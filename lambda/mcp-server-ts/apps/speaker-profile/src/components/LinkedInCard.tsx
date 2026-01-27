import React from 'react';
import type { App as McpApp } from '@modelcontextprotocol/ext-apps';
import { Card, Badge } from '@shared/components';
import type { SpeakerContext } from '@shared/types';

interface LinkedInCardProps {
  linkedinMatch: SpeakerContext['linkedinMatch'];
  app: McpApp | null;
}

function getConfidenceVariant(confidence: number): 'success' | 'warning' | 'error' {
  if (confidence > 0.8) return 'success';
  if (confidence > 0.5) return 'warning';
  return 'error';
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}% match`;
}

export function LinkedInCard({ linkedinMatch, app }: LinkedInCardProps) {
  if (!linkedinMatch) return null;

  const { name, position, company, email, confidence } = linkedinMatch;
  const variant = getConfidenceVariant(confidence);

  const handleViewProfile = async () => {
    // Try to find a LinkedIn URL from the enriched profile
    // The linkedinMatch itself may not carry a URL, but the parent enrichedProfile might
    // For now, we construct a search URL as fallback
    if (app) {
      const searchUrl = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`;
      await app.openLink({ url: searchUrl });
    }
  };

  const subtitle = [position, company].filter(Boolean).join(' at ');

  return (
    <Card title="LinkedIn Match">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 8,
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontWeight: 600,
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
            }}>
              {name}
            </div>
            {subtitle && (
              <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-secondary)',
                marginTop: 2,
              }}>
                {subtitle}
              </div>
            )}
          </div>
          <Badge label={formatConfidence(confidence)} variant={variant} />
        </div>

        {email && (
          <div style={{
            fontSize: '0.85rem',
            color: 'var(--text-secondary)',
          }}>
            {email}
          </div>
        )}

        {app && (
          <button
            onClick={handleViewProfile}
            style={{
              marginTop: 4,
              padding: '6px 14px',
              background: 'var(--accent)',
              color: 'white',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.85rem',
              fontWeight: 500,
              alignSelf: 'flex-start',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent-hover)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = 'var(--accent)';
            }}
          >
            View Profile
          </button>
        )}
      </div>
    </Card>
  );
}

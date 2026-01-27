import React from 'react';
import { SpeakerAvatar, Badge } from '@shared/components';
import type { SpeakerContext } from '@shared/types';

interface ProfileHeaderProps {
  context: SpeakerContext;
}

export function ProfileHeader({ context }: ProfileHeaderProps) {
  const { speakerName, enrichedProfile } = context;
  const role = enrichedProfile?.role;
  const company = enrichedProfile?.company;
  const summary = enrichedProfile?.summary;
  const isVerified = !!(enrichedProfile?.name && enrichedProfile?.role);

  const subtitle = [role, company].filter(Boolean).join(' at ');

  return (
    <div style={{
      display: 'flex',
      gap: 16,
      alignItems: 'flex-start',
    }}>
      <SpeakerAvatar name={speakerName} size={64} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
        }}>
          <h1 style={{
            fontSize: '1.4rem',
            fontWeight: 700,
            lineHeight: 1.2,
            margin: 0,
            color: 'var(--text-primary)',
          }}>
            {enrichedProfile?.name || speakerName}
          </h1>
          {isVerified && <Badge label="Verified" variant="success" />}
        </div>

        {subtitle && (
          <div style={{
            marginTop: 4,
            fontSize: '0.95rem',
            color: 'var(--text-secondary)',
          }}>
            {subtitle}
          </div>
        )}

        {summary ? (
          <p style={{
            marginTop: 8,
            fontSize: '0.9rem',
            color: 'var(--text-secondary)',
            lineHeight: 1.5,
          }}>
            {summary}
          </p>
        ) : (
          !enrichedProfile && (
            <p style={{
              marginTop: 8,
              fontSize: '0.9rem',
              color: 'var(--text-muted)',
              fontStyle: 'italic',
            }}>
              No enrichment data available
            </p>
          )
        )}
      </div>
    </div>
  );
}

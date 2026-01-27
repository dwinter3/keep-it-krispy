import React, { useState } from 'react';
import { SpeakerStats, getSpeakerColor } from '../transcript-parser';

interface TalkTimeBarProps {
  speakerStats: SpeakerStats[];
  speakerColorMap: Map<string, number>;
}

/**
 * Horizontal stacked bar chart showing each speaker's talk-time percentage.
 * Hovering over a segment highlights it and shows the speaker name + percentage.
 */
export function TalkTimeBar({ speakerStats, speakerColorMap }: TalkTimeBarProps) {
  const [hoveredSpeaker, setHoveredSpeaker] = useState<string | null>(null);

  if (speakerStats.length === 0) return null;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Bar */}
      <div
        style={{
          display: 'flex',
          borderRadius: 'var(--radius)',
          overflow: 'hidden',
          height: 24,
          background: 'var(--bg-secondary)',
        }}
      >
        {speakerStats.map((stat) => {
          const colorIdx = speakerColorMap.get(stat.speaker) ?? 0;
          const color = getSpeakerColor(colorIdx);
          const isHovered = hoveredSpeaker === stat.speaker;

          return (
            <div
              key={stat.speaker}
              onMouseEnter={() => setHoveredSpeaker(stat.speaker)}
              onMouseLeave={() => setHoveredSpeaker(null)}
              style={{
                width: `${Math.max(stat.percentage, 2)}%`,
                background: color.bubble,
                opacity: hoveredSpeaker === null || isHovered ? 1 : 0.4,
                transition: 'opacity 0.15s ease',
                cursor: 'default',
                position: 'relative',
              }}
              title={`${stat.speaker}: ${stat.percentage.toFixed(1)}%`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '6px 14px',
          marginTop: 6,
        }}
      >
        {speakerStats.map((stat) => {
          const colorIdx = speakerColorMap.get(stat.speaker) ?? 0;
          const color = getSpeakerColor(colorIdx);
          const isHovered = hoveredSpeaker === stat.speaker;

          return (
            <div
              key={stat.speaker}
              onMouseEnter={() => setHoveredSpeaker(stat.speaker)}
              onMouseLeave={() => setHoveredSpeaker(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.75rem',
                color: 'var(--text-secondary)',
                opacity: hoveredSpeaker === null || isHovered ? 1 : 0.5,
                transition: 'opacity 0.15s ease',
                fontWeight: isHovered ? 600 : 400,
                cursor: 'default',
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: color.bubble,
                  flexShrink: 0,
                }}
              />
              <span>{stat.speaker}</span>
              <span style={{ color: 'var(--text-muted)' }}>
                {stat.percentage.toFixed(0)}%
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

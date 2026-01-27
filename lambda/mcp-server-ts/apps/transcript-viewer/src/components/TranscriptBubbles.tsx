import React, { useEffect, useRef } from 'react';
import { SpeakerAvatar } from '@shared/components';
import {
  TranscriptSegment,
  groupConsecutiveSegments,
  getSpeakerColor,
  formatTimestamp,
} from '../transcript-parser';

interface TranscriptBubblesProps {
  segments: TranscriptSegment[];
  speakerColorMap: Map<string, number>;
  firstSpeaker: string;
  /** Lowercase search term for highlighting. Empty string means no highlight. */
  searchTerm: string;
  /** Indices (into the flat list of segments) that matched the search. */
  matchIndices: number[];
  /** The index into matchIndices that is currently focused. */
  currentMatchIdx: number;
}

/**
 * Chat-bubble style transcript display.
 *
 * - The first speaker's bubbles are right-aligned with the accent/blue color.
 * - All other speakers' bubbles are left-aligned with secondary colors.
 * - Consecutive messages from the same speaker are grouped: the avatar and
 *   speaker name are shown only on the first message of each group.
 * - Search matches are highlighted with a yellow `<mark>` element.
 * - The "current" match auto-scrolls into view.
 */
export function TranscriptBubbles({
  segments,
  speakerColorMap,
  firstSpeaker,
  searchTerm,
  matchIndices,
  currentMatchIdx,
}: TranscriptBubblesProps) {
  const currentMatchRef = useRef<HTMLDivElement>(null);

  // Scroll the current match into view whenever it changes
  useEffect(() => {
    currentMatchRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentMatchIdx, matchIndices]);

  const groups = groupConsecutiveSegments(segments);

  // Build a flat-index lookup: segmentIndex -> position in matchIndices (or -1)
  const matchSet = new Set(matchIndices);
  const currentMatchSegIdx = matchIndices[currentMatchIdx] ?? -1;

  let flatIdx = 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {groups.map((group, gi) => {
        const speaker = group[0].speaker;
        const colorIdx = speakerColorMap.get(speaker) ?? 0;
        const color = getSpeakerColor(colorIdx);
        const isSelf = speaker === firstSpeaker;

        return (
          <div
            key={`g-${gi}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: isSelf ? 'flex-end' : 'flex-start',
            }}
          >
            {/* Speaker row: avatar + name */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginBottom: 4,
                flexDirection: isSelf ? 'row-reverse' : 'row',
              }}
            >
              <SpeakerAvatar name={speaker} size={28} />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                }}
              >
                {speaker}
              </span>
            </div>

            {/* Bubbles */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                alignItems: isSelf ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                // Indent past the avatar
                ...(isSelf
                  ? { marginRight: 4 }
                  : { marginLeft: 34 }),
              }}
            >
              {group.map((seg, si) => {
                const segIdx = flatIdx++;
                const isMatch = matchSet.has(segIdx);
                const isCurrentMatch = segIdx === currentMatchSegIdx;
                const isFirst = si === 0;
                const isLast = si === group.length - 1;

                return (
                  <div
                    key={`s-${gi}-${si}`}
                    ref={isCurrentMatch ? currentMatchRef : undefined}
                    style={{
                      padding: '8px 12px',
                      fontSize: '0.9rem',
                      lineHeight: 1.45,
                      background: isSelf ? color.bubble : color.bubble,
                      color: isSelf ? color.text : color.text,
                      borderRadius: bubbleRadius(isSelf, isFirst, isLast),
                      outline: isCurrentMatch
                        ? '2px solid var(--accent)'
                        : isMatch
                          ? '1px solid var(--warning)'
                          : 'none',
                      outlineOffset: isCurrentMatch || isMatch ? 1 : 0,
                      wordBreak: 'break-word',
                    }}
                  >
                    {searchTerm ? highlightText(seg.text, searchTerm) : seg.text}

                    {/* Timestamp on the last bubble of the group */}
                    {isLast && (
                      <div
                        style={{
                          fontSize: '0.65rem',
                          marginTop: 3,
                          opacity: 0.65,
                        }}
                      >
                        {formatTimestamp(seg.timestampSeconds)}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute asymmetric border-radius so bubble groups look like chat messages.
 * Self (right-aligned): rounded except bottom-right on non-last bubbles.
 * Others (left-aligned): rounded except bottom-left on non-last bubbles.
 */
function bubbleRadius(isSelf: boolean, isFirst: boolean, isLast: boolean): string {
  const lg = '16px';
  const sm = '4px';

  if (isSelf) {
    // top-left, top-right, bottom-right, bottom-left
    return `${lg} ${isFirst ? lg : sm} ${isLast ? lg : sm} ${lg}`;
  }
  return `${isFirst ? lg : sm} ${lg} ${lg} ${isLast ? lg : sm}`;
}

/**
 * Wrap search matches with `<mark>` tags for highlighting.
 */
function highlightText(text: string, term: string): React.ReactNode {
  if (!term) return text;

  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            style={{
              background: '#fde68a',
              color: '#92400e',
              borderRadius: 2,
              padding: '0 1px',
            }}
          >
            {part}
          </mark>
        ) : (
          <React.Fragment key={i}>{part}</React.Fragment>
        ),
      )}
    </>
  );
}

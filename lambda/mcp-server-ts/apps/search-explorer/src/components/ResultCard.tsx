import React from 'react';
import { Card, Badge, SpeakerAvatar } from '@shared/components';
import type { SearchResult } from '@shared/types';

interface ResultCardProps {
  result: SearchResult;
  query: string;
  selected: boolean;
  onToggleSelect: (meetingId: string) => void;
  onOpenTranscript: (meetingId: string) => void;
}

/**
 * Format seconds into a human-readable duration string.
 * - Under 60 minutes: "Xm"
 * - 60 minutes or more: "Xh Ym"
 */
function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
}

/**
 * Format an ISO date string into a readable format, e.g. "Jan 15, 2025".
 */
function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

/**
 * Get relevance color based on score.
 * High (>=0.7): green, Medium (>=0.4): yellow/warning, Low: red/error
 */
function getRelevanceColor(score: number): string {
  if (score >= 0.7) return 'var(--success)';
  if (score >= 0.4) return 'var(--warning)';
  return 'var(--error)';
}

/**
 * Get relevance badge variant based on score.
 */
function getRelevanceVariant(score: number): 'success' | 'warning' | 'error' {
  if (score >= 0.7) return 'success';
  if (score >= 0.4) return 'warning';
  return 'error';
}

/**
 * Highlight query terms within a text snippet using <mark> elements.
 * Splits query into individual words and highlights each occurrence.
 */
function highlightSnippet(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;

  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);

  if (terms.length === 0) return text;

  // Build a regex that matches any of the query terms (case insensitive)
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  const parts = text.split(pattern);

  return parts.map((part, i) => {
    const isMatch = terms.some((t) => part.toLowerCase() === t);
    if (isMatch) {
      return (
        <mark
          key={i}
          style={{
            background: '#fef08a',
            color: 'var(--text-primary)',
            borderRadius: 2,
            padding: '0 1px',
          }}
        >
          {part}
        </mark>
      );
    }
    return part;
  });
}

export function ResultCard({
  result,
  query,
  selected,
  onToggleSelect,
  onOpenTranscript,
}: ResultCardProps) {
  const relevancePercent = Math.round(result.relevanceScore * 100);
  const relevanceColor = getRelevanceColor(result.relevanceScore);

  return (
    <Card
      selected={selected}
      style={{ padding: 0, overflow: 'hidden' }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'stretch',
      }}>
        {/* Checkbox column */}
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            padding: '14px 0 14px 12px',
            cursor: 'pointer',
            flexShrink: 0,
          }}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(result.meetingId);
          }}
        >
          <div style={{
            width: 18,
            height: 18,
            borderRadius: 'var(--radius-sm)',
            border: `2px solid ${selected ? 'var(--accent)' : 'var(--border-color)'}`,
            background: selected ? 'var(--accent)' : 'transparent',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            marginTop: 2,
          }}>
            {selected && (
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>
        </div>

        {/* Main content */}
        <div
          style={{
            flex: 1,
            padding: '12px 14px 12px 10px',
            cursor: 'pointer',
            minWidth: 0,
          }}
          onClick={() => onOpenTranscript(result.meetingId)}
        >
          {/* Title row */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 6,
          }}>
            <div style={{
              fontWeight: 600,
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {result.title}
            </div>

            {/* Relevance score */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flexShrink: 0,
            }}>
              <div style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                background: 'var(--bg-secondary)',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <div style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  height: '100%',
                  width: `${relevancePercent}%`,
                  background: relevanceColor,
                  borderRadius: 2,
                  transition: 'width 0.3s ease',
                }} />
              </div>
              <span style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: relevanceColor,
                whiteSpace: 'nowrap',
                fontFamily: 'var(--font-mono)',
              }}>
                {relevancePercent}%
              </span>
            </div>
          </div>

          {/* Metadata row */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
            flexWrap: 'wrap',
          }}>
            <span style={{
              fontSize: '0.8rem',
              color: 'var(--text-secondary)',
            }}>
              {formatDate(result.date)}
            </span>

            <span style={{
              fontSize: '0.8rem',
              color: 'var(--text-muted)',
            }}>
              {formatDuration(result.duration)}
            </span>

            {/* Speaker avatars */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {result.speakers.slice(0, 3).map((speaker) => (
                <SpeakerAvatar key={speaker} name={speaker} size={20} />
              ))}
              {result.speakers.length > 3 && (
                <span style={{
                  fontSize: '0.7rem',
                  color: 'var(--text-muted)',
                  marginLeft: 2,
                }}>
                  +{result.speakers.length - 3}
                </span>
              )}
              <span style={{
                fontSize: '0.8rem',
                color: 'var(--text-secondary)',
                marginLeft: 2,
              }}>
                {result.speakers.slice(0, 2).join(', ')}
                {result.speakers.length > 2 && ` +${result.speakers.length - 2}`}
              </span>
            </div>
          </div>

          {/* Badges row */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
            {result.topic && (
              <Badge label={result.topic} variant="accent" />
            )}
            {result.matchingChunks > 0 && (
              <Badge
                label={`${result.matchingChunks} chunk${result.matchingChunks === 1 ? '' : 's'}`}
                variant={getRelevanceVariant(result.relevanceScore)}
              />
            )}
            {result.type && result.type !== 'transcript' && (
              <Badge label={result.type} variant="default" />
            )}
          </div>

          {/* Snippets */}
          {result.snippets.length > 0 && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              {result.snippets.slice(0, 2).map((snippet, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '0.8rem',
                    lineHeight: 1.5,
                    color: 'var(--text-secondary)',
                    background: 'var(--bg-secondary)',
                    padding: '6px 10px',
                    borderRadius: 'var(--radius-sm)',
                    borderLeft: `3px solid ${relevanceColor}`,
                    overflow: 'hidden',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                  }}
                >
                  {highlightSnippet(snippet, query)}
                </div>
              ))}
              {result.snippets.length > 2 && (
                <span style={{
                  fontSize: '0.75rem',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic',
                }}>
                  +{result.snippets.length - 2} more snippet{result.snippets.length - 2 === 1 ? '' : 's'}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

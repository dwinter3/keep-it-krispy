import React from 'react';
import { EmptyState } from '@shared/components';
import type { TranscriptMeta } from '@shared/types';
import { MeetingCard } from './MeetingCard';

interface MeetingListProps {
  meetings: TranscriptMeta[];
  selectedIds: Set<string>;
  onToggleSelect: (meetingId: string) => void;
  onOpenTranscript: (meetingId: string) => void;
}

export function MeetingList({ meetings, selectedIds, onToggleSelect, onOpenTranscript }: MeetingListProps) {
  if (meetings.length === 0) {
    return (
      <EmptyState
        title="No meetings found"
        description="Try adjusting your filters or refreshing the data."
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {meetings.map((meeting) => (
        <MeetingCard
          key={meeting.meeting_id}
          meeting={meeting}
          selected={selectedIds.has(meeting.meeting_id)}
          onToggleSelect={() => onToggleSelect(meeting.meeting_id)}
          onOpen={() => onOpenTranscript(meeting.meeting_id)}
        />
      ))}
    </div>
  );
}

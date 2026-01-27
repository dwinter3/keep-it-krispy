import React from 'react';
import { Card, Badge } from '@shared/components';

interface TopicCloudProps {
  topics: string[];
}

export function TopicCloud({ topics }: TopicCloudProps) {
  if (topics.length === 0) return null;

  return (
    <Card title="Topics">
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 6,
      }}>
        {topics.map((topic) => (
          <Badge key={topic} label={topic} variant="accent" />
        ))}
      </div>
    </Card>
  );
}

/**
 * S3 client for accessing Krisp meeting transcripts.
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || '';  // Required: set via environment variable
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Key format regex: YYYYMMDD_HHMMSS_title_meetingId.json
const KEY_PATTERN = /^(\d{8})_(\d{6})_(.+)_([^_]+)\.json$/;

interface TranscriptMetadata {
  key: string;
  title: string;
  meetingId: string;
  date: Date;
  dateStr: string;
  size: number;
}

interface TranscriptContent {
  key: string;
  title: string;
  summary: string;
  notes: string;
  transcript: string;
  actionItems: string[];
  speakers: string[];
  receivedAt: string;
  eventType: string;
  error: string | null;
}

interface SearchResult extends TranscriptMetadata {
  snippet: string;
  summary: string;
  speakers: string[];
}

export class S3TranscriptClient {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.s3 = new S3Client({ region: AWS_REGION });
    this.bucket = BUCKET_NAME;
  }

  async listTranscripts(
    startDate?: Date,
    endDate?: Date,
    limit: number = 20
  ): Promise<TranscriptMetadata[]> {
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    const prefixes = this.generateDatePrefixes(start, end);
    const allObjects: TranscriptMetadata[] = [];

    for (const prefix of prefixes) {
      let continuationToken: string | undefined;

      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        });

        const response = await this.s3.send(command);

        for (const obj of response.Contents || []) {
          if (obj.Key?.endsWith('.json')) {
            const metadata = this.parseKeyMetadata(obj.Key, obj);
            if (metadata && metadata.date >= start && metadata.date <= end) {
              allObjects.push(metadata);
            }
          }
        }

        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
    }

    // Sort by date descending, apply limit
    allObjects.sort((a, b) => b.date.getTime() - a.date.getTime());
    return allObjects.slice(0, limit);
  }

  async getTranscript(key: string): Promise<unknown> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.s3.send(command);
    const bodyString = await response.Body?.transformToString();
    return JSON.parse(bodyString || '{}');
  }

  async getTranscripts(keys: string[]): Promise<TranscriptContent[]> {
    const results: TranscriptContent[] = [];

    for (const key of keys) {
      try {
        const content = await this.getTranscript(key) as Record<string, unknown>;
        const rawPayload = (content.raw_payload || {}) as Record<string, unknown>;
        const data = (rawPayload.data || {}) as Record<string, unknown>;
        const meeting = (data.meeting || {}) as Record<string, unknown>;
        const speakers = (meeting.speakers || []) as Array<{ first_name?: string; last_name?: string; index?: number }>;

        results.push({
          key,
          title: (meeting.title as string) || 'Untitled',
          summary: (data.raw_meeting as string) || '',
          notes: '',
          transcript: (data.raw_content as string) || '',
          actionItems: [],
          speakers: speakers.map(s => s.first_name ? `${s.first_name} ${s.last_name || ''}`.trim() : `Speaker ${s.index}`),
          receivedAt: (content.received_at as string) || '',
          eventType: (content.event_type as string) || '',
          error: null,
        });
      } catch (e) {
        results.push({
          key,
          title: '',
          summary: '',
          notes: '',
          transcript: '',
          actionItems: [],
          speakers: [],
          receivedAt: '',
          eventType: '',
          error: String(e),
        });
      }
    }

    return results;
  }

  async search(
    query: string,
    speaker?: string,
    limit: number = 10
  ): Promise<SearchResult[]> {
    // Search across last 90 days
    const recent = await this.listTranscripts(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      new Date(),
      200
    );

    const results: SearchResult[] = [];
    const queryLower = query.toLowerCase();

    for (const meta of recent) {
      try {
        const content = await this.getTranscript(meta.key) as Record<string, unknown>;
        const rawPayload = (content.raw_payload || {}) as Record<string, unknown>;
        const data = (rawPayload.data || {}) as Record<string, unknown>;
        const meeting = (data.meeting || {}) as Record<string, unknown>;
        const speakersList = (meeting.speakers || []) as Array<{ first_name?: string; last_name?: string; index?: number }>;

        // Check speaker filter
        if (speaker) {
          const speakerNames = speakersList.map(s =>
            s.first_name ? `${s.first_name} ${s.last_name || ''}`.toLowerCase() : ''
          );
          if (!speakerNames.some(name => name.includes(speaker.toLowerCase()))) {
            continue;
          }
        }

        // Search in relevant fields
        const searchable = [
          data.raw_content || '',
          data.raw_meeting || '',
          meeting.title || '',
        ].join(' ').toLowerCase();

        if (searchable.includes(queryLower)) {
          const snippet = this.extractSnippet(searchable, queryLower);
          results.push({
            ...meta,
            snippet,
            summary: ((data.raw_meeting as string) || '').slice(0, 300),
            speakers: speakersList.map(s => s.first_name ? `${s.first_name} ${s.last_name || ''}`.trim() : `Speaker ${s.index}`),
          });
        }

        if (results.length >= limit) {
          break;
        }
      } catch {
        continue;
      }
    }

    return results;
  }

  private parseKeyMetadata(
    key: string,
    obj: { LastModified?: Date; Size?: number }
  ): TranscriptMetadata | null {
    const parts = key.split('/');
    if (parts.length < 2) return null;

    const filename = parts[parts.length - 1];
    const match = filename.match(KEY_PATTERN);

    let date: Date;
    let title: string;
    let meetingId: string;

    if (match) {
      const [, dateStr, timeStr, rawTitle, id] = match;
      date = new Date(
        parseInt(dateStr.slice(0, 4)),
        parseInt(dateStr.slice(4, 6)) - 1,
        parseInt(dateStr.slice(6, 8)),
        parseInt(timeStr.slice(0, 2)),
        parseInt(timeStr.slice(2, 4)),
        parseInt(timeStr.slice(4, 6))
      );
      title = rawTitle.replace(/_/g, ' ');
      meetingId = id;
    } else {
      date = obj.LastModified || new Date();
      title = filename.replace('.json', '');
      meetingId = '';
    }

    return {
      key,
      title,
      meetingId,
      date,
      dateStr: date.toISOString().slice(0, 16).replace('T', ' '),
      size: obj.Size || 0,
    };
  }

  private generateDatePrefixes(start: Date, end: Date): string[] {
    const prefixes = new Set<string>();
    const current = new Date(start);

    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, '0');
      prefixes.add(`meetings/${year}/${month}/`);

      // Move to next month
      current.setMonth(current.getMonth() + 1);
      current.setDate(1);
    }

    return Array.from(prefixes).sort();
  }

  private extractSnippet(text: string, query: string, context: number = 100): string {
    const idx = text.indexOf(query);
    if (idx === -1) {
      return text.length > 200 ? text.slice(0, 200) + '...' : text;
    }

    const start = Math.max(0, idx - context);
    const end = Math.min(text.length, idx + query.length + context);
    let snippet = text.slice(start, end);

    if (start > 0) snippet = '...' + snippet;
    if (end < text.length) snippet = snippet + '...';

    return snippet;
  }
}

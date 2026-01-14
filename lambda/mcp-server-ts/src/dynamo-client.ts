/**
 * DynamoDB client for fast transcript metadata queries.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export interface SpeakerCorrection {
  name: string;
  linkedin?: string;
}

export interface TranscriptRecord {
  meeting_id: string;
  title: string;
  date: string;
  timestamp: string;
  duration: number;
  speakers?: string[];
  speaker_name?: string;
  speaker_corrections?: Record<string, SpeakerCorrection>;
  s3_key: string;
  event_type: string;
  received_at: string;
  url?: string;
  indexed_at: string;
}

export class DynamoTranscriptClient {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = TABLE_NAME;
  }

  /**
   * List transcripts by date range using GSI.
   */
  async listByDateRange(
    startDate: string,
    endDate: string,
    limit: number = 20
  ): Promise<TranscriptRecord[]> {
    // Get all unique dates in range
    const dates = this.generateDateRange(startDate, endDate);
    const allRecords: TranscriptRecord[] = [];

    for (const date of dates) {
      const command = new QueryCommand({
        TableName: this.tableName,
        IndexName: 'date-index',
        KeyConditionExpression: '#date = :date',
        ExpressionAttributeNames: {
          '#date': 'date',
        },
        ExpressionAttributeValues: {
          ':date': date,
        },
      });

      const response = await this.client.send(command);
      if (response.Items) {
        allRecords.push(...(response.Items as TranscriptRecord[]));
      }
    }

    // Sort by timestamp descending
    allRecords.sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date);
      const dateB = new Date(b.timestamp || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return allRecords.slice(0, limit);
  }

  /**
   * List transcripts by speaker using GSI.
   */
  async listBySpeaker(
    speakerName: string,
    limit: number = 20
  ): Promise<TranscriptRecord[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'speaker-index',
      KeyConditionExpression: 'speaker_name = :speaker',
      ExpressionAttributeValues: {
        ':speaker': speakerName.toLowerCase(),
      },
      Limit: limit,
      ScanIndexForward: false, // descending by date
    });

    const response = await this.client.send(command);
    return (response.Items as TranscriptRecord[]) || [];
  }

  /**
   * Get a specific transcript record by meeting_id.
   */
  async getByMeetingId(meetingId: string): Promise<TranscriptRecord | null> {
    const command = new GetCommand({
      TableName: this.tableName,
      Key: {
        meeting_id: meetingId,
      },
    });

    const response = await this.client.send(command);
    return (response.Item as TranscriptRecord) || null;
  }

  /**
   * List recent transcripts using date GSI for last 30 days.
   * This ensures we get the actual most recent records, not arbitrary scan results.
   */
  async listRecent(limit: number = 20): Promise<TranscriptRecord[]> {
    // Query the last 30 days using the date GSI
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    return this.listByDateRange(startDate, endDate, limit);
  }

  /**
   * Generate all dates in a range (YYYY-MM-DD format).
   */
  private generateDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    return dates;
  }

  /**
   * Update speaker corrections for a meeting.
   * Merges new corrections with existing ones.
   */
  async updateSpeakers(
    meetingId: string,
    corrections: Record<string, SpeakerCorrection>
  ): Promise<TranscriptRecord | null> {
    // Normalize keys to lowercase for consistent matching
    const normalizedCorrections: Record<string, SpeakerCorrection> = {};
    for (const [key, value] of Object.entries(corrections)) {
      normalizedCorrections[key.toLowerCase()] = value;
    }

    const command = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        meeting_id: meetingId,
      },
      UpdateExpression: 'SET speaker_corrections = if_not_exists(speaker_corrections, :empty) , speaker_corrections = :corrections',
      ExpressionAttributeValues: {
        ':empty': {},
        ':corrections': normalizedCorrections,
      },
      ReturnValues: 'ALL_NEW',
    });

    // First get existing corrections to merge
    const existing = await this.getByMeetingId(meetingId);
    if (!existing) {
      return null;
    }

    const merged = {
      ...(existing.speaker_corrections || {}),
      ...normalizedCorrections,
    };

    const mergeCommand = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        meeting_id: meetingId,
      },
      UpdateExpression: 'SET speaker_corrections = :corrections',
      ExpressionAttributeValues: {
        ':corrections': merged,
      },
      ReturnValues: 'ALL_NEW',
    });

    const response = await this.client.send(mergeCommand);
    return (response.Attributes as TranscriptRecord) || null;
  }

  /**
   * Get speaker corrections for a meeting.
   */
  async getSpeakerCorrections(meetingId: string): Promise<Record<string, SpeakerCorrection> | null> {
    const record = await this.getByMeetingId(meetingId);
    return record?.speaker_corrections || null;
  }
}

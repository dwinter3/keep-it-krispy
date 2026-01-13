/**
 * DynamoDB client for fast transcript metadata queries.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export interface TranscriptRecord {
  meeting_id: string;
  title: string;
  date: string;
  timestamp: string;
  duration: number;
  speakers?: string[];
  speaker_name?: string;
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
   * List recent transcripts (scan with limit).
   */
  async listRecent(limit: number = 20): Promise<TranscriptRecord[]> {
    // Use scan for simplicity - DynamoDB will handle efficiently for small datasets
    const command = new ScanCommand({
      TableName: this.tableName,
      Limit: Math.min(limit * 2, 100), // Get extra to allow for sorting
    });

    const response = await this.client.send(command);
    const records = (response.Items as TranscriptRecord[]) || [];

    // Sort by timestamp descending
    records.sort((a, b) => {
      const dateA = new Date(a.timestamp || a.date);
      const dateB = new Date(b.timestamp || b.date);
      return dateB.getTime() - dateA.getTime();
    });

    return records.slice(0, limit);
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
}

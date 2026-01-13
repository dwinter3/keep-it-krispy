/**
 * S3 Vectors client for semantic search of transcript chunks.
 */

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execFileAsync = promisify(execFile);

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors';
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks';
const MODEL_ID = 'amazon.titan-embed-text-v2:0';
const EMBEDDING_DIMENSIONS = 1024;

export interface VectorSearchResult {
  key: string;
  score: number;
  metadata: {
    meeting_id: string;
    s3_key: string;
    chunk_index: string;
    speaker: string;
    text: string;
  };
}

export class VectorsClient {
  private bedrock: BedrockRuntimeClient;
  private vectorBucket: string;
  private indexName: string;

  constructor() {
    this.bedrock = new BedrockRuntimeClient({ region: AWS_REGION });
    this.vectorBucket = VECTOR_BUCKET;
    this.indexName = INDEX_NAME;
  }

  /**
   * Generate embedding for a query string using Bedrock Titan.
   */
  async generateEmbedding(text: string): Promise<number[]> {
    // Truncate if too long (rough estimate: 4 chars per token)
    const maxChars = 8192 * 4;
    const truncatedText = text.length > maxChars ? text.slice(0, maxChars) : text;

    const command = new InvokeModelCommand({
      modelId: MODEL_ID,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: truncatedText,
        dimensions: EMBEDDING_DIMENSIONS,
        normalize: true,
      }),
    });

    const response = await this.bedrock.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));
    return responseBody.embedding;
  }

  /**
   * Search vectors using semantic similarity.
   */
  async search(
    query: string,
    topK: number = 10,
    meetingIdFilter?: string
  ): Promise<VectorSearchResult[]> {
    // Generate query embedding
    const queryEmbedding = await this.generateEmbedding(query);

    // Query vectors using AWS CLI
    const results = await this.queryVectors(
      queryEmbedding,
      topK,
      meetingIdFilter
    );

    return results;
  }

  /**
   * Query vectors using AWS CLI with safe file-based input.
   */
  private async queryVectors(
    queryVector: number[],
    topK: number,
    meetingIdFilter?: string
  ): Promise<VectorSearchResult[]> {
    // Build query parameters
    const queryParams: Record<string, unknown> = {
      vectorBucketName: this.vectorBucket,
      indexName: this.indexName,
      queryVector: {
        float32: queryVector,
      },
      topK,
      returnMetadata: true,
    };

    // Add filter if specified
    if (meetingIdFilter) {
      queryParams.filter = { equals: { key: 'meeting_id', value: meetingIdFilter } };
    }

    try {
      // Write query to temp file to avoid command line length limits
      const tmpFile = path.join(os.tmpdir(), `query-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(queryParams));

      try {
        // Use execFile for safety - no shell interpolation
        const { stdout } = await execFileAsync('aws', [
          's3vectors',
          'query-vectors',
          '--cli-input-json',
          `file://${tmpFile}`,
          '--region',
          AWS_REGION,
          '--output',
          'json',
        ], { maxBuffer: 10 * 1024 * 1024 });

        const response = JSON.parse(stdout);
        const results: VectorSearchResult[] = [];

        // S3 Vectors returns results ordered by similarity but without explicit scores
        // We assign a relative score based on position (1.0 for first, decreasing)
        const vectors = response.vectors || [];
        for (let i = 0; i < vectors.length; i++) {
          const item = vectors[i];
          results.push({
            key: item.key,
            // Calculate relative score: 1.0 for first result, decreasing by 0.05 per position
            score: Math.max(0, 1 - (i * 0.05)),
            metadata: item.metadata || {},
          });
        }

        return results;
      } finally {
        // Clean up temp file
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    } catch (error) {
      console.error('Vector query error:', error);
      return [];
    }
  }

  /**
   * Group search results by meeting and return aggregated results.
   */
  groupByMeeting(
    results: VectorSearchResult[]
  ): Map<string, { meetingId: string; s3Key: string; chunks: VectorSearchResult[]; topScore: number }> {
    const grouped = new Map<string, { meetingId: string; s3Key: string; chunks: VectorSearchResult[]; topScore: number }>();

    for (const result of results) {
      const meetingId = result.metadata.meeting_id;

      if (!grouped.has(meetingId)) {
        grouped.set(meetingId, {
          meetingId,
          s3Key: result.metadata.s3_key,
          chunks: [],
          topScore: result.score,
        });
      }

      const group = grouped.get(meetingId)!;
      group.chunks.push(result);
      if (result.score > group.topScore) {
        group.topScore = result.score;
      }
    }

    return grouped;
  }
}

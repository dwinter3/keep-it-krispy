/**
 * S3 Vectors Memory Provider
 *
 * Implementation using AWS S3 Vectors and Bedrock Titan embeddings.
 * This is the default provider for Keep It Krispy.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import {
  S3VectorsClient,
  QueryVectorsCommand,
  PutVectorsCommand,
  DeleteVectorsCommand,
  GetVectorsCommand,
} from '@aws-sdk/client-s3vectors'

import { MemoryProvider } from './provider'
import type {
  VectorDocument,
  VectorMetadata,
  SearchOptions,
  SearchResult,
  BatchResult,
  HealthStatus,
  ProviderCapabilities,
  ProviderConfig,
} from './types'

/**
 * S3 Vectors configuration with defaults
 */
export interface S3VectorsConfig extends ProviderConfig {
  bucket: string
  indexName: string
  embeddingModel?: string
  embeddingDimensions?: number
  region?: string
  credentials?: {
    accessKeyId: string
    secretAccessKey: string
  }
}

/**
 * S3 Vectors raw response type
 */
interface S3VectorResult {
  key: string
  metadata?: Record<string, string>
}

/**
 * S3 Vectors Memory Provider Implementation
 */
export class S3VectorsProvider extends MemoryProvider {
  private bedrock: BedrockRuntimeClient
  private vectorsClient: S3VectorsClient
  private bucket: string
  private indexName: string
  private modelId: string
  private dimensions: number

  constructor(config: S3VectorsConfig) {
    super(config)

    const region = config.region || process.env.APP_REGION || 'us-east-1'
    const credentials = config.credentials || (process.env.S3_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
        }
      : undefined)

    this.bucket = config.bucket || process.env.VECTOR_BUCKET || 'krisp-vectors'
    this.indexName = config.indexName || process.env.VECTOR_INDEX || 'transcript-chunks'
    this.modelId = config.embeddingModel || 'amazon.titan-embed-text-v2:0'
    this.dimensions = config.embeddingDimensions || 1024

    this.bedrock = new BedrockRuntimeClient({ region, credentials })
    this.vectorsClient = new S3VectorsClient({ region, credentials })
  }

  get name(): string {
    return 's3-vectors'
  }

  get capabilities(): ProviderCapabilities {
    return {
      maxVectorDimensions: 2048,
      maxBatchSize: 100,
      supportsFiltering: false, // S3 Vectors has limited filtering
      supportsMetadata: true,
      supportsDeletion: true,
      supportsUpdate: false, // Must delete and re-add
    }
  }

  // ============================================
  // EMBEDDING OPERATIONS
  // ============================================

  async generateEmbedding(text: string): Promise<number[]> {
    const command = new InvokeModelCommand({
      modelId: this.modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: text.slice(0, 8192 * 4), // Truncate if too long (~32k chars)
        dimensions: this.dimensions,
        normalize: true,
      }),
    })

    const response = await this.bedrock.send(command)
    const responseBody = JSON.parse(new TextDecoder().decode(response.body))
    return responseBody.embedding
  }

  // ============================================
  // VECTOR STORAGE OPERATIONS
  // ============================================

  async store(document: VectorDocument): Promise<void> {
    await this.storeBatch([document])
  }

  async storeBatch(documents: VectorDocument[]): Promise<BatchResult> {
    const batchSize = this.capabilities.maxBatchSize
    let successful = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    // Process in batches
    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)

      try {
        const command = new PutVectorsCommand({
          vectorBucketName: this.bucket,
          indexName: this.indexName,
          vectors: batch.map((doc) => ({
            key: doc.id,
            data: { float32: doc.vector },
            metadata: this.serializeMetadata(doc.metadata),
          })),
        })

        await this.vectorsClient.send(command)
        successful += batch.length
      } catch (error) {
        failed += batch.length
        for (const doc of batch) {
          errors.push({ id: doc.id, error: String(error) })
        }
      }
    }

    return { successful, failed, errors: errors.length > 0 ? errors : undefined }
  }

  async delete(id: string): Promise<void> {
    await this.deleteBatch([id])
  }

  async deleteBatch(ids: string[]): Promise<BatchResult> {
    let successful = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    try {
      const command = new DeleteVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.indexName,
        keys: ids,
      })

      await this.vectorsClient.send(command)
      successful = ids.length
    } catch (error) {
      failed = ids.length
      for (const id of ids) {
        errors.push({ id, error: String(error) })
      }
    }

    return { successful, failed, errors: errors.length > 0 ? errors : undefined }
  }

  async deleteByMeetingId(meetingId: string): Promise<BatchResult> {
    // S3 Vectors doesn't support filtering, so we need to query first
    // This is a limitation - for large datasets, consider tracking vector IDs in DynamoDB
    try {
      // Generate a dummy embedding to query (we'll match by metadata)
      // This is inefficient but necessary with S3 Vectors
      const dummyEmbedding = new Array(this.dimensions).fill(0)
      dummyEmbedding[0] = 1 // Non-zero for normalization

      const results = await this.search(dummyEmbedding, { topK: 1000 })
      const idsToDelete = results
        .filter((r) => r.metadata.meetingId === meetingId)
        .map((r) => r.id)

      if (idsToDelete.length === 0) {
        return { successful: 0, failed: 0 }
      }

      return this.deleteBatch(idsToDelete)
    } catch (error) {
      return {
        successful: 0,
        failed: 1,
        errors: [{ id: meetingId, error: String(error) }],
      }
    }
  }

  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<void> {
    // S3 Vectors doesn't support metadata updates
    // Must fetch, delete, and re-store
    throw new Error('S3 Vectors does not support metadata updates. Delete and re-store instead.')
  }

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  async search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.topK || 10

    try {
      const command = new QueryVectorsCommand({
        vectorBucketName: this.bucket,
        indexName: this.indexName,
        queryVector: { float32: embedding },
        topK,
        returnMetadata: options?.includeMetadata !== false,
      })

      const response = await this.vectorsClient.send(command)
      const vectors = (response.vectors || []) as S3VectorResult[]

      return vectors.map((v, i) => ({
        id: v.key,
        score: 1 - i * 0.05, // Relative score based on position (S3 Vectors doesn't return scores)
        metadata: this.deserializeMetadata(v.metadata || {}),
        vector: undefined, // S3 Vectors doesn't return vectors in query
      }))
    } catch (error) {
      console.error('S3 Vectors search error:', error)
      throw error
    }
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now()

    try {
      // Try a simple query with dummy embedding
      const dummyEmbedding = new Array(this.dimensions).fill(0)
      dummyEmbedding[0] = 1

      await this.search(dummyEmbedding, { topK: 1 })

      return {
        healthy: true,
        provider: this.name,
        latencyMs: Date.now() - start,
      }
    } catch (error) {
      return {
        healthy: false,
        provider: this.name,
        latencyMs: Date.now() - start,
        error: String(error),
      }
    }
  }

  async getVectorCount(): Promise<number> {
    // S3 Vectors doesn't provide a count API
    // This would require tracking in DynamoDB or doing a full scan
    throw new Error('S3 Vectors does not support vector count. Track in DynamoDB instead.')
  }

  // ============================================
  // PRIVATE HELPERS
  // ============================================

  private serializeMetadata(metadata: VectorMetadata): Record<string, string> {
    return {
      meeting_id: metadata.meetingId,
      s3_key: metadata.s3Key,
      chunk_index: String(metadata.chunkIndex),
      speaker: metadata.speaker || 'unknown',
      text: (metadata.text || '').substring(0, 500),
      user_id: metadata.userId || '',
    }
  }

  private deserializeMetadata(raw: Record<string, string>): VectorMetadata {
    return {
      meetingId: raw.meeting_id || '',
      s3Key: raw.s3_key || '',
      chunkIndex: parseInt(raw.chunk_index || '0', 10),
      speaker: raw.speaker,
      text: raw.text,
      userId: raw.user_id || undefined,
    }
  }
}

/**
 * Create S3 Vectors provider with environment defaults
 */
export function createS3VectorsProvider(config?: Partial<S3VectorsConfig>): S3VectorsProvider {
  return new S3VectorsProvider({
    bucket: config?.bucket || process.env.VECTOR_BUCKET || 'krisp-vectors',
    indexName: config?.indexName || process.env.VECTOR_INDEX || 'transcript-chunks',
    region: config?.region || process.env.APP_REGION || 'us-east-1',
    embeddingModel: config?.embeddingModel || 'amazon.titan-embed-text-v2:0',
    embeddingDimensions: config?.embeddingDimensions || 1024,
    ...config,
  })
}

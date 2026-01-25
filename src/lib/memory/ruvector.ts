/**
 * RuVector Memory Provider
 *
 * Implementation using RuVector HTTP API for vector storage and search.
 * RuVector is a high-performance vector database with built-in ONNX embeddings.
 */

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

// Default configuration
const DEFAULT_ENDPOINT = 'http://localhost:8080'
const DEFAULT_COLLECTION = 'transcript-chunks'
const DEFAULT_DIMENSIONS = 384 // all-MiniLM-L6-v2 dimensions

/**
 * RuVector configuration with defaults
 */
export interface RuVectorConfig extends ProviderConfig {
  endpoint?: string
  collection?: string
  model?: string
  useLocalEmbeddings?: boolean
}

/**
 * RuVector Memory Provider Implementation
 */
export class RuVectorProvider extends MemoryProvider {
  private endpoint: string
  private collection: string
  private model: string
  private useLocalEmbeddings: boolean
  private dimensions: number

  constructor(config: RuVectorConfig = {}) {
    super(config)

    this.endpoint = config.endpoint || process.env.RUVECTOR_ENDPOINT || DEFAULT_ENDPOINT
    this.collection = config.collection || process.env.RUVECTOR_COLLECTION || DEFAULT_COLLECTION
    this.model = config.model || process.env.RUVECTOR_MODEL || 'all-MiniLM-L6-v2'
    this.useLocalEmbeddings = config.useLocalEmbeddings ?? true
    this.dimensions = DEFAULT_DIMENSIONS
  }

  get name(): string {
    return 'ruvector'
  }

  get capabilities(): ProviderCapabilities {
    return {
      maxVectorDimensions: 4096,
      maxBatchSize: 100,
      supportsFiltering: true,
      supportsMetadata: true,
      supportsDeletion: true,
      supportsUpdate: true,
    }
  }

  // ============================================
  // HTTP CLIENT
  // ============================================

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    timeout = 30000
  ): Promise<T> {
    const url = `${this.endpoint}${path}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(url, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        throw new Error(`RuVector HTTP error ${response.status}: ${errorText}`)
      }

      if (response.status === 204) {
        return undefined as T
      }

      return response.json()
    } catch (error) {
      clearTimeout(timeoutId)
      if ((error as Error).name === 'AbortError') {
        throw new Error(`RuVector request timeout after ${timeout}ms`)
      }
      throw error
    }
  }

  // ============================================
  // EMBEDDING OPERATIONS
  // ============================================

  async generateEmbedding(text: string): Promise<number[]> {
    if (!this.useLocalEmbeddings) {
      throw new Error(
        'RuVectorProvider requires useLocalEmbeddings=true. ' +
        'For Bedrock embeddings, use S3VectorsProvider or DualProvider.'
      )
    }

    // Use RuVector's built-in ONNX embeddings
    const result = await this.request<{ embedding: number[] }>('POST', '/embed', {
      text,
      model: this.model,
    })
    return result.embedding
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    if (!this.useLocalEmbeddings) {
      throw new Error(
        'RuVectorProvider requires useLocalEmbeddings=true. ' +
        'For Bedrock embeddings, use S3VectorsProvider or DualProvider.'
      )
    }

    try {
      // Try batch endpoint
      const result = await this.request<{ embeddings: number[][] }>(
        'POST',
        '/embed/batch',
        { texts, model: this.model },
        60000
      )
      return result.embeddings
    } catch {
      // Fallback to sequential
      const embeddings: number[][] = []
      for (const text of texts) {
        embeddings.push(await this.generateEmbedding(text))
      }
      return embeddings
    }
  }

  // ============================================
  // VECTOR STORAGE OPERATIONS
  // ============================================

  async store(document: VectorDocument): Promise<void> {
    await this.request('POST', `/collections/${this.collection}/vectors`, {
      id: document.id,
      vector: document.vector,
      metadata: this.serializeMetadata(document.metadata),
    })
  }

  async storeBatch(documents: VectorDocument[]): Promise<BatchResult> {
    const batchSize = this.capabilities.maxBatchSize
    let successful = 0
    let failed = 0
    const errors: Array<{ id: string; error: string }> = []

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)

      try {
        const vectors = batch.map((doc) => ({
          id: doc.id,
          vector: doc.vector,
          metadata: this.serializeMetadata(doc.metadata),
        }))

        await this.request('POST', `/collections/${this.collection}/vectors/batch`, {
          vectors,
        })
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
    await this.request('DELETE', `/collections/${this.collection}/vectors/${id}`)
  }

  async deleteBatch(ids: string[]): Promise<BatchResult> {
    try {
      await this.request('POST', `/collections/${this.collection}/vectors/delete`, {
        ids,
      })
      return { successful: ids.length, failed: 0 }
    } catch (error) {
      return {
        successful: 0,
        failed: ids.length,
        errors: ids.map((id) => ({ id, error: String(error) })),
      }
    }
  }

  async deleteByMeetingId(meetingId: string): Promise<BatchResult> {
    try {
      const result = await this.request<{ deleted: number }>(
        'POST',
        `/collections/${this.collection}/vectors/delete-by-filter`,
        { filter: { field: 'meeting_id', value: meetingId } }
      )
      return { successful: result.deleted, failed: 0 }
    } catch (error) {
      return {
        successful: 0,
        failed: 1,
        errors: [{ id: meetingId, error: String(error) }],
      }
    }
  }

  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<void> {
    await this.request('PATCH', `/collections/${this.collection}/vectors/${id}`, {
      metadata: this.serializeMetadata(metadata as VectorMetadata),
    })
  }

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  async search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
    const topK = options?.topK || 10

    const queryData: Record<string, unknown> = {
      vector: embedding,
      top_k: topK,
      include_metadata: options?.includeMetadata !== false,
    }

    // Build filter
    if (options?.filter) {
      const filters: Array<{ field: string; value: string }> = []

      if (options.filter.meetingId) {
        filters.push({ field: 'meeting_id', value: options.filter.meetingId })
      }
      if (options.filter.userId) {
        filters.push({ field: 'user_id', value: options.filter.userId })
      }
      if (options.filter.speaker) {
        filters.push({ field: 'speaker', value: options.filter.speaker })
      }

      if (filters.length > 0) {
        queryData.filter = filters.length === 1 ? filters[0] : { and: filters }
      }
    }

    if (options?.includeVector) {
      queryData.include_vectors = true
    }

    const result = await this.request<{
      results: Array<{
        id: string
        score: number
        metadata?: Record<string, string>
        vector?: number[]
      }>
    }>('POST', `/collections/${this.collection}/query`, queryData)

    let results = result.results.map((item) => ({
      id: item.id,
      score: item.score,
      metadata: this.deserializeMetadata(item.metadata || {}),
      vector: item.vector,
    }))

    // Apply min_score filter
    if (options?.minScore !== undefined) {
      results = results.filter((r) => r.score >= options.minScore!)
    }

    return results
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now()

    try {
      await this.request('GET', '/health')

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
    const result = await this.request<{ vector_count: number }>(
      'GET',
      `/collections/${this.collection}/stats`
    )
    return result.vector_count
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
 * Create RuVector provider with environment defaults
 */
export function createRuVectorProvider(config?: Partial<RuVectorConfig>): RuVectorProvider {
  return new RuVectorProvider({
    endpoint: config?.endpoint || process.env.RUVECTOR_ENDPOINT || DEFAULT_ENDPOINT,
    collection: config?.collection || process.env.RUVECTOR_COLLECTION || DEFAULT_COLLECTION,
    ...config,
  })
}

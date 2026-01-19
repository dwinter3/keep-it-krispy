/**
 * Abstract Memory Provider Interface
 *
 * All memory backends must implement this interface.
 * This allows swapping between S3 Vectors, RuVector, Pinecone, etc.
 */

import type {
  VectorDocument,
  VectorMetadata,
  SearchOptions,
  SearchResult,
  MeetingSearchResult,
  BatchResult,
  HealthStatus,
  ProviderCapabilities,
  ProviderConfig,
} from './types'

/**
 * Abstract base class for memory providers
 */
export abstract class MemoryProvider {
  protected config: ProviderConfig

  constructor(config: ProviderConfig) {
    this.config = config
  }

  /**
   * Get provider name for logging/debugging
   */
  abstract get name(): string

  /**
   * Get provider capabilities
   */
  abstract get capabilities(): ProviderCapabilities

  // ============================================
  // EMBEDDING OPERATIONS
  // ============================================

  /**
   * Generate embedding for a single text
   */
  abstract generateEmbedding(text: string): Promise<number[]>

  /**
   * Generate embeddings for multiple texts
   * Default implementation calls generateEmbedding sequentially
   */
  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = []
    for (const text of texts) {
      embeddings.push(await this.generateEmbedding(text))
    }
    return embeddings
  }

  // ============================================
  // VECTOR STORAGE OPERATIONS
  // ============================================

  /**
   * Store a single vector with metadata
   */
  abstract store(document: VectorDocument): Promise<void>

  /**
   * Store multiple vectors in a batch
   */
  abstract storeBatch(documents: VectorDocument[]): Promise<BatchResult>

  /**
   * Delete a single vector by ID
   */
  abstract delete(id: string): Promise<void>

  /**
   * Delete multiple vectors by IDs
   */
  abstract deleteBatch(ids: string[]): Promise<BatchResult>

  /**
   * Delete all vectors for a meeting
   */
  abstract deleteByMeetingId(meetingId: string): Promise<BatchResult>

  /**
   * Update vector metadata (without changing the vector)
   */
  abstract updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<void>

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  /**
   * Search for similar vectors by embedding
   */
  abstract search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]>

  /**
   * Search by text query (generates embedding internally)
   */
  async searchByText(query: string, options?: SearchOptions): Promise<SearchResult[]> {
    const embedding = await this.generateEmbedding(query)
    return this.search(embedding, options)
  }

  /**
   * Search and group results by meeting
   */
  async searchByMeeting(query: string, options?: SearchOptions): Promise<MeetingSearchResult[]> {
    const results = await this.searchByText(query, options)
    return this.groupByMeeting(results)
  }

  /**
   * Group search results by meeting ID
   */
  protected groupByMeeting(results: SearchResult[]): MeetingSearchResult[] {
    const meetingMap = new Map<
      string,
      {
        meetingId: string
        s3Key: string
        scores: number[]
        snippets: string[]
      }
    >()

    for (const result of results) {
      const { meetingId, s3Key, text } = result.metadata
      if (!meetingId) continue

      const existing = meetingMap.get(meetingId)
      if (existing) {
        existing.scores.push(result.score)
        if (text) existing.snippets.push(text)
      } else {
        meetingMap.set(meetingId, {
          meetingId,
          s3Key: s3Key || '',
          scores: [result.score],
          snippets: text ? [text] : [],
        })
      }
    }

    return Array.from(meetingMap.values())
      .map((m) => ({
        meetingId: m.meetingId,
        s3Key: m.s3Key,
        score: Math.max(...m.scores),
        matchingChunks: m.scores.length,
        snippets: m.snippets.slice(0, 3), // Top 3 snippets
      }))
      .sort((a, b) => b.score - a.score)
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  /**
   * Check provider health
   */
  abstract healthCheck(): Promise<HealthStatus>

  /**
   * Get vector count (if supported)
   */
  abstract getVectorCount(): Promise<number>

  /**
   * Chunk text into smaller pieces for embedding
   */
  chunkText(text: string, chunkSize = 500, overlap = 50): string[] {
    const words = text.split(/\s+/)
    const chunks: string[] = []

    for (let i = 0; i < words.length; i += chunkSize - overlap) {
      const chunk = words.slice(i, i + chunkSize).join(' ')
      if (chunk.trim()) {
        chunks.push(chunk)
      }
    }

    return chunks
  }

  /**
   * Process a transcript into vectors
   */
  async processTranscript(
    meetingId: string,
    s3Key: string,
    content: string,
    speakers: string[] = [],
    userId?: string
  ): Promise<BatchResult> {
    // Chunk the content
    const chunks = this.chunkText(content)

    // Prepare speaker context
    const realSpeakers = speakers.filter(
      (s) => !s.match(/^(Speaker|Unknown|Participant)\s*\d*$/i)
    )
    const speakerContext =
      realSpeakers.length > 0 ? `Meeting participants: ${realSpeakers.join(', ')}. ` : ''

    // Generate embeddings and create documents
    const documents: VectorDocument[] = []

    for (let i = 0; i < chunks.length; i++) {
      const textWithContext = speakerContext + chunks[i]
      const embedding = await this.generateEmbedding(textWithContext)

      documents.push({
        id: `${meetingId}_chunk_${i.toString().padStart(4, '0')}`,
        vector: embedding,
        metadata: {
          meetingId,
          s3Key,
          chunkIndex: i,
          speaker: realSpeakers[0] || 'unknown',
          text: chunks[i].substring(0, 500),
          userId,
        },
      })
    }

    // Store in batches
    return this.storeBatch(documents)
  }
}

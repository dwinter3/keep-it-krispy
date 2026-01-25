/**
 * Dual-Write Memory Provider
 *
 * Writes to both primary and secondary backends for zero-downtime migration.
 * Reads from primary only. Secondary failures are logged but don't block.
 *
 * Usage:
 *   Set MEMORY_PROVIDER=dual
 *   Set PRIMARY_PROVIDER=s3-vectors
 *   Set SECONDARY_PROVIDER=ruvector
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

/**
 * Dual provider configuration
 */
export interface DualConfig extends ProviderConfig {
  primaryProvider?: string
  secondaryProvider?: string
}

/**
 * Dual-write memory provider
 *
 * Writes to both primary and secondary backends.
 * Reads from primary only.
 * Secondary failures are logged but don't block operations.
 */
export class DualProvider extends MemoryProvider {
  private primary: MemoryProvider
  private secondary: MemoryProvider

  constructor(config: DualConfig, primary: MemoryProvider, secondary: MemoryProvider) {
    super(config)
    this.primary = primary
    this.secondary = secondary
  }

  get name(): string {
    return `dual(${this.primary.name}+${this.secondary.name})`
  }

  get capabilities(): ProviderCapabilities {
    return this.primary.capabilities
  }

  /**
   * Get primary provider
   */
  getPrimary(): MemoryProvider {
    return this.primary
  }

  /**
   * Get secondary provider
   */
  getSecondary(): MemoryProvider {
    return this.secondary
  }

  /**
   * Execute write operation on secondary in background.
   * Logs errors but doesn't throw - secondary failures are non-blocking.
   */
  private async writeToSecondary<T>(
    operation: string,
    fn: () => Promise<T>
  ): Promise<T | undefined> {
    try {
      const result = await fn()
      console.log(`Dual: Secondary ${operation} succeeded`)
      return result
    } catch (error) {
      console.error(`Dual: Secondary ${operation} failed (non-blocking):`, error)
      return undefined
    }
  }

  // ============================================
  // EMBEDDING OPERATIONS
  // ============================================

  async generateEmbedding(text: string): Promise<number[]> {
    // Use primary for embeddings
    return this.primary.generateEmbedding(text)
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return this.primary.generateEmbeddings(texts)
  }

  // ============================================
  // VECTOR STORAGE OPERATIONS
  // ============================================

  async store(document: VectorDocument): Promise<void> {
    // Primary is blocking
    await this.primary.store(document)

    // Secondary is non-blocking (fire and forget)
    this.writeToSecondary('store', () => this.secondary.store(document))
  }

  async storeBatch(documents: VectorDocument[]): Promise<BatchResult> {
    // Primary is blocking
    const primaryResult = await this.primary.storeBatch(documents)

    // Secondary is non-blocking
    this.writeToSecondary('storeBatch', () => this.secondary.storeBatch(documents))

    return primaryResult
  }

  async delete(id: string): Promise<void> {
    // Primary is blocking
    await this.primary.delete(id)

    // Secondary is non-blocking
    this.writeToSecondary('delete', () => this.secondary.delete(id))
  }

  async deleteBatch(ids: string[]): Promise<BatchResult> {
    // Primary is blocking
    const primaryResult = await this.primary.deleteBatch(ids)

    // Secondary is non-blocking
    this.writeToSecondary('deleteBatch', () => this.secondary.deleteBatch(ids))

    return primaryResult
  }

  async deleteByMeetingId(meetingId: string): Promise<BatchResult> {
    // Primary is blocking
    const primaryResult = await this.primary.deleteByMeetingId(meetingId)

    // Secondary is non-blocking
    this.writeToSecondary('deleteByMeetingId', () =>
      this.secondary.deleteByMeetingId(meetingId)
    )

    return primaryResult
  }

  async updateMetadata(id: string, metadata: Partial<VectorMetadata>): Promise<void> {
    // Primary is blocking
    await this.primary.updateMetadata(id, metadata)

    // Secondary is non-blocking
    this.writeToSecondary('updateMetadata', () =>
      this.secondary.updateMetadata(id, metadata)
    )
  }

  // ============================================
  // SEARCH OPERATIONS
  // ============================================

  async search(embedding: number[], options?: SearchOptions): Promise<SearchResult[]> {
    // Read from primary only
    return this.primary.search(embedding, options)
  }

  // ============================================
  // UTILITY OPERATIONS
  // ============================================

  async healthCheck(): Promise<HealthStatus> {
    const start = Date.now()

    const [primaryHealth, secondaryHealth] = await Promise.all([
      this.primary.healthCheck(),
      this.secondary.healthCheck(),
    ])

    const bothHealthy = primaryHealth.healthy && secondaryHealth.healthy

    const errors: string[] = []
    if (!primaryHealth.healthy) {
      errors.push(`primary: ${primaryHealth.error}`)
    }
    if (!secondaryHealth.healthy) {
      errors.push(`secondary: ${secondaryHealth.error}`)
    }

    return {
      healthy: bothHealthy,
      provider: this.name,
      latencyMs: Date.now() - start,
      error: errors.length > 0 ? errors.join('; ') : undefined,
    }
  }

  async getVectorCount(): Promise<number> {
    // Count from primary
    return this.primary.getVectorCount()
  }
}

/**
 * Create dual provider with default configuration
 */
export function createDualProvider(
  primary: MemoryProvider,
  secondary: MemoryProvider,
  config?: Partial<DualConfig>
): DualProvider {
  return new DualProvider(
    {
      primaryProvider: primary.name,
      secondaryProvider: secondary.name,
      ...config,
    },
    primary,
    secondary
  )
}

/**
 * Memory Provider Factory
 *
 * Central entry point for memory/vector operations.
 * Allows easy swapping between different backends.
 *
 * Usage:
 *   import { getMemoryProvider } from '@/lib/memory'
 *   const memory = getMemoryProvider()
 *   const results = await memory.searchByText('quarterly review')
 */

import { MemoryProvider } from './provider'
import { S3VectorsProvider, createS3VectorsProvider } from './s3-vectors'
import { RuVectorProvider, createRuVectorProvider } from './ruvector'
import { DualProvider, createDualProvider } from './dual'
import { ABRouterProvider, createABRouterProvider } from './ab-router'
import type {
  ProviderType,
  ProviderConfig,
  VectorDocument,
  VectorMetadata,
  SearchOptions,
  SearchResult,
  MeetingSearchResult,
  BatchResult,
  HealthStatus,
  ProviderCapabilities,
} from './types'

// Re-export types for convenience
export type {
  ProviderType,
  ProviderConfig,
  VectorDocument,
  VectorMetadata,
  SearchOptions,
  SearchResult,
  MeetingSearchResult,
  BatchResult,
  HealthStatus,
  ProviderCapabilities,
}

// Re-export base class
export { MemoryProvider }

// Re-export providers
export { S3VectorsProvider, createS3VectorsProvider }
export { RuVectorProvider, createRuVectorProvider }
export { DualProvider, createDualProvider }
export { ABRouterProvider, createABRouterProvider }

/**
 * Singleton instance of the memory provider
 */
let memoryProviderInstance: MemoryProvider | null = null

/**
 * Get the memory provider type from environment
 */
function getProviderType(): ProviderType {
  const type = process.env.MEMORY_PROVIDER as ProviderType
  return type || 's3-vectors'
}

/**
 * Create a memory provider based on type
 */
export function createMemoryProvider(
  type?: ProviderType,
  config?: ProviderConfig
): MemoryProvider {
  const providerType = type || getProviderType()

  switch (providerType) {
    case 's3-vectors':
      return createS3VectorsProvider(config)

    case 'ruvector':
      return createRuVectorProvider(config)

    case 'dual': {
      // Create dual-write provider (S3 Vectors primary, RuVector secondary)
      const primary = createS3VectorsProvider(config)
      const secondary = createRuVectorProvider(config)
      return createDualProvider(primary, secondary, config)
    }

    case 'ab-router': {
      // Create A/B router (S3 Vectors control, RuVector experiment)
      const control = createS3VectorsProvider(config)
      const experiment = createRuVectorProvider(config)
      return createABRouterProvider(control, experiment, config)
    }

    case 'pinecone':
      // Future: import and create PineconeProvider
      throw new Error('Pinecone provider not yet implemented. Set MEMORY_PROVIDER=s3-vectors')

    case 'opensearch':
      // Future: import and create OpenSearchProvider
      throw new Error('OpenSearch provider not yet implemented. Set MEMORY_PROVIDER=s3-vectors')

    case 'mock':
      // Future: import and create MockProvider for testing
      throw new Error('Mock provider not yet implemented')

    default:
      throw new Error(`Unknown memory provider type: ${providerType}`)
  }
}

/**
 * Get the singleton memory provider instance
 * Creates one if it doesn't exist
 */
export function getMemoryProvider(): MemoryProvider {
  if (!memoryProviderInstance) {
    memoryProviderInstance = createMemoryProvider()
  }
  return memoryProviderInstance
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetMemoryProvider(): void {
  memoryProviderInstance = null
}

/**
 * Set a custom provider instance (useful for testing)
 */
export function setMemoryProvider(provider: MemoryProvider): void {
  memoryProviderInstance = provider
}

// ============================================
// CONVENIENCE FUNCTIONS
// ============================================

/**
 * Generate embedding for text
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  return getMemoryProvider().generateEmbedding(text)
}

/**
 * Search by text query
 */
export async function searchByText(
  query: string,
  options?: SearchOptions
): Promise<SearchResult[]> {
  return getMemoryProvider().searchByText(query, options)
}

/**
 * Search and group by meeting
 */
export async function searchByMeeting(
  query: string,
  options?: SearchOptions
): Promise<MeetingSearchResult[]> {
  return getMemoryProvider().searchByMeeting(query, options)
}

/**
 * Store vectors for a transcript
 */
export async function processTranscript(
  meetingId: string,
  s3Key: string,
  content: string,
  speakers?: string[],
  userId?: string
): Promise<BatchResult> {
  return getMemoryProvider().processTranscript(meetingId, s3Key, content, speakers, userId)
}

/**
 * Delete vectors for a meeting
 */
export async function deleteByMeetingId(meetingId: string): Promise<BatchResult> {
  return getMemoryProvider().deleteByMeetingId(meetingId)
}

/**
 * Health check
 */
export async function healthCheck(): Promise<HealthStatus> {
  return getMemoryProvider().healthCheck()
}

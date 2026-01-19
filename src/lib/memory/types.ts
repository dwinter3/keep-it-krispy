/**
 * Memory Provider Abstraction Types
 *
 * This module defines interfaces for vector storage and semantic search,
 * allowing easy swapping between backends (S3 Vectors, RuVector, Pinecone, etc.)
 */

/**
 * Configuration for embedding generation
 */
export interface EmbeddingConfig {
  model: string
  dimensions: number
  normalize?: boolean
}

/**
 * Vector with metadata for storage
 */
export interface VectorDocument {
  id: string
  vector: number[]
  metadata: VectorMetadata
}

/**
 * Metadata attached to each vector
 */
export interface VectorMetadata {
  meetingId: string
  s3Key: string
  chunkIndex: number
  speaker?: string
  text?: string // First N chars for preview
  userId?: string
  [key: string]: unknown // Allow additional metadata
}

/**
 * Search query options
 */
export interface SearchOptions {
  topK?: number
  filter?: SearchFilter
  includeMetadata?: boolean
  includeVector?: boolean
  minScore?: number
}

/**
 * Filter criteria for search
 */
export interface SearchFilter {
  meetingId?: string
  userId?: string
  speaker?: string
  dateFrom?: string
  dateTo?: string
  [key: string]: unknown
}

/**
 * Single search result
 */
export interface SearchResult {
  id: string
  score: number
  metadata: VectorMetadata
  vector?: number[]
}

/**
 * Grouped search results by meeting
 */
export interface MeetingSearchResult {
  meetingId: string
  s3Key: string
  score: number
  matchingChunks: number
  snippets: string[]
}

/**
 * Batch operation result
 */
export interface BatchResult {
  successful: number
  failed: number
  errors?: Array<{ id: string; error: string }>
}

/**
 * Provider health status
 */
export interface HealthStatus {
  healthy: boolean
  provider: string
  latencyMs?: number
  error?: string
}

/**
 * Memory provider capabilities
 */
export interface ProviderCapabilities {
  maxVectorDimensions: number
  maxBatchSize: number
  supportsFiltering: boolean
  supportsMetadata: boolean
  supportsDeletion: boolean
  supportsUpdate: boolean
}

/**
 * Provider configuration options
 */
export interface ProviderConfig {
  // S3 Vectors specific
  bucket?: string
  indexName?: string

  // Bedrock/Titan specific
  embeddingModel?: string
  embeddingDimensions?: number

  // Common
  region?: string
  maxBatchSize?: number

  // Future providers (RuVector, Pinecone, etc.)
  endpoint?: string
  apiKey?: string
  namespace?: string
}

/**
 * Supported provider types
 */
export type ProviderType = 's3-vectors' | 'ruvector' | 'pinecone' | 'opensearch' | 'mock'

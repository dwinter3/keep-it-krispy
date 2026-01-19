/**
 * Entity types and interfaces for the Keep It Krispy knowledge graph
 * @see docs/entity-relationship-model.md for full specification
 */

// Entity type enum
export type EntityType =
  | 'user'
  | 'speaker'
  | 'company'
  | 'topic'
  | 'transcript'
  | 'document'
  | 'deal'
  | 'project'
  | 'event'
  | 'action_item'
  | 'decision'
  | 'meeting_series'

// Entity status
export type EntityStatus = 'active' | 'archived' | 'merged'

// Enrichment source
export type EnrichmentSource = 'web' | 'linkedin' | 'manual' | 'ai'

/**
 * Base entity interface - all entities share these fields
 */
export interface BaseEntity {
  entity_id: string // UUID: "ent_xxxxxxxxxxxx"
  entity_type: EntityType
  user_id: string // Owner (tenant isolation)
  team_id?: string // If team-owned
  name: string // Display name
  canonical_name: string // Normalized for matching (lowercase)
  aliases?: string[] // Alternative names for matching
  status: EntityStatus

  // Enrichment
  enriched_at?: string
  enrichment_source?: EnrichmentSource
  confidence?: number // 0-100

  // Audit
  created_at: string
  created_by: string
  updated_at: string
  updated_by: string

  // Merge tracking
  merged_into?: string
  merged_from?: string[]
}

/**
 * Type-specific metadata interfaces
 */

export interface UserMetadata {
  email: string
  avatar?: string
  settings?: Record<string, unknown>
}

export interface SpeakerMetadata {
  linkedin?: string
  role?: string
  company_name?: string
  bio?: string
  email?: string
  phone?: string
  verified?: boolean
  last_seen?: string
  meeting_count?: number
}

export interface CompanyMetadata {
  website?: string
  industry?: string
  type?: 'customer' | 'prospect' | 'partner' | 'vendor' | 'competitor' | 'internal' | 'other'
  description?: string
  logo?: string
  linkedin?: string
  employee_count?: number
  location?: string
  notes?: string
}

export interface TopicMetadata {
  category?: string
  description?: string
  mention_count?: number
}

export interface TranscriptMetadata {
  duration?: number
  source?: string
  summary?: string
  s3_key?: string
  url?: string
}

export interface DocumentMetadata {
  file_type: string // pdf|docx|pptx|md|txt
  file_hash: string
  file_size: number
  s3_key: string
  source: 'upload' | 'url' | 'drive' | 'notion' | 'email'
  source_url?: string
  word_count?: number
  processed_at?: string
  chunk_count?: number
}

export interface DealMetadata {
  value?: number
  currency?: string
  stage?: string
  probability?: number
  close_date?: string
  description?: string
}

export interface ProjectMetadata {
  status?: 'active' | 'completed' | 'on_hold' | 'cancelled'
  start_date?: string
  end_date?: string
  description?: string
}

export interface EventMetadata {
  date: string
  location?: string
  type?: 'conference' | 'qbr' | 'webinar' | 'meeting' | 'other'
  description?: string
}

export interface ActionItemMetadata {
  assignee?: string // entity_id of speaker
  due_date?: string
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled'
  description?: string
  source_transcript?: string // entity_id of transcript
}

export interface DecisionMetadata {
  date: string
  rationale?: string
  participants?: string[] // entity_ids
  source_transcript?: string
}

export interface MeetingSeriesMetadata {
  frequency?: 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'
  participants?: string[] // entity_ids
  next_occurrence?: string
}

/**
 * Entity with typed metadata
 */
export interface Entity<T = Record<string, unknown>> extends BaseEntity {
  metadata: T
}

// Typed entity aliases for convenience
export type UserEntity = Entity<UserMetadata>
export type SpeakerEntity = Entity<SpeakerMetadata>
export type CompanyEntity = Entity<CompanyMetadata>
export type TopicEntity = Entity<TopicMetadata>
export type TranscriptEntity = Entity<TranscriptMetadata>
export type DocumentEntity = Entity<DocumentMetadata>
export type DealEntity = Entity<DealMetadata>
export type ProjectEntity = Entity<ProjectMetadata>
export type EventEntity = Entity<EventMetadata>
export type ActionItemEntity = Entity<ActionItemMetadata>
export type DecisionEntity = Entity<DecisionMetadata>
export type MeetingSeriesEntity = Entity<MeetingSeriesMetadata>

/**
 * Helper to generate entity IDs
 */
export function generateEntityId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'ent_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/**
 * Normalize name for canonical matching
 */
export function canonicalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
}

/**
 * Create a new entity with defaults
 */
export function createEntity<T>(
  type: EntityType,
  name: string,
  userId: string,
  metadata: T
): Entity<T> {
  const now = new Date().toISOString()
  return {
    entity_id: generateEntityId(),
    entity_type: type,
    user_id: userId,
    name,
    canonical_name: canonicalizeName(name),
    status: 'active',
    metadata,
    created_at: now,
    created_by: userId,
    updated_at: now,
    updated_by: userId,
  }
}

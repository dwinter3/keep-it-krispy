/**
 * Relationship types and interfaces for the Keep It Krispy knowledge graph
 * @see docs/entity-relationship-model.md for full specification
 */

import { EntityType } from './entities'

// Relationship types
export type RelationshipType =
  // Person/Company relationships
  | 'works_at'
  | 'worked_at'
  | 'founded'
  | 'knows'
  // Business relationships
  | 'customer_of'
  | 'partner_of'
  | 'competitor_of'
  | 'subsidiary_of'
  | 'vendor_of'
  // Participation relationships
  | 'participant'
  // Content relationships
  | 'discusses'
  | 'mentions'
  | 'documents'
  // Derived relationships
  | 'related_to'
  | 'similar_to'
  | 'derived_from'

// Relationship source
export type RelationshipSource = 'ai_inferred' | 'user_created' | 'imported'

/**
 * Base relationship interface
 */
export interface Relationship {
  relationship_id: string // UUID: "rel_xxxxxxxxxxxx"

  // Endpoints
  from_entity_id: string
  from_entity_type: EntityType // Denormalized for query efficiency
  to_entity_id: string
  to_entity_type: EntityType // Denormalized for query efficiency

  // Type and role
  rel_type: RelationshipType
  role?: string // Contextual role: "technical lead", "customer"

  // Metadata
  metadata?: Record<string, unknown>
  confidence?: number // 0-100
  source: RelationshipSource

  // Temporal
  valid_from?: string
  valid_to?: string // null = current/ongoing

  // Audit
  user_id: string // Who owns this relationship
  created_at: string
  created_by: string
}

/**
 * Helper to generate relationship IDs
 */
export function generateRelationshipId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let id = 'rel_'
  for (let i = 0; i < 12; i++) {
    id += chars[Math.floor(Math.random() * chars.length)]
  }
  return id
}

/**
 * Create a new relationship
 */
export function createRelationship(
  fromEntityId: string,
  fromEntityType: EntityType,
  toEntityId: string,
  toEntityType: EntityType,
  relType: RelationshipType,
  userId: string,
  options?: {
    role?: string
    confidence?: number
    source?: RelationshipSource
    metadata?: Record<string, unknown>
    valid_from?: string
    valid_to?: string
  }
): Relationship {
  const now = new Date().toISOString()
  return {
    relationship_id: generateRelationshipId(),
    from_entity_id: fromEntityId,
    from_entity_type: fromEntityType,
    to_entity_id: toEntityId,
    to_entity_type: toEntityType,
    rel_type: relType,
    role: options?.role,
    metadata: options?.metadata,
    confidence: options?.confidence ?? 100,
    source: options?.source ?? 'user_created',
    valid_from: options?.valid_from,
    valid_to: options?.valid_to,
    user_id: userId,
    created_at: now,
    created_by: userId,
  }
}

/**
 * Common relationship patterns
 */

export function createWorksAtRelationship(
  speakerId: string,
  companyId: string,
  userId: string,
  role?: string
): Relationship {
  return createRelationship(
    speakerId,
    'speaker',
    companyId,
    'company',
    'works_at',
    userId,
    { role }
  )
}

export function createParticipantRelationship(
  speakerId: string,
  targetId: string,
  targetType: 'transcript' | 'deal' | 'project' | 'event',
  userId: string,
  role?: string
): Relationship {
  return createRelationship(
    speakerId,
    'speaker',
    targetId,
    targetType,
    'participant',
    userId,
    { role }
  )
}

export function createCompanyParticipantRelationship(
  companyId: string,
  dealId: string,
  userId: string,
  role: 'seller' | 'buyer' | 'partner' | 'other'
): Relationship {
  return createRelationship(
    companyId,
    'company',
    dealId,
    'deal',
    'participant',
    userId,
    { role }
  )
}

export function createDiscussesRelationship(
  transcriptId: string,
  targetId: string,
  targetType: 'topic' | 'company',
  userId: string,
  confidence?: number
): Relationship {
  return createRelationship(
    transcriptId,
    'transcript',
    targetId,
    targetType,
    'discusses',
    userId,
    { confidence, source: 'ai_inferred' }
  )
}

export function createDocumentsRelationship(
  documentId: string,
  targetId: string,
  targetType: 'transcript' | 'deal' | 'project',
  userId: string,
  role?: string
): Relationship {
  return createRelationship(
    documentId,
    'document',
    targetId,
    targetType,
    'documents',
    userId,
    { role }
  )
}

/**
 * Relationship validation helpers
 */

const VALID_RELATIONSHIP_ENDPOINTS: Record<
  RelationshipType,
  { from: EntityType[]; to: EntityType[] }
> = {
  works_at: { from: ['speaker'], to: ['company'] },
  worked_at: { from: ['speaker'], to: ['company'] },
  founded: { from: ['speaker'], to: ['company'] },
  knows: { from: ['speaker'], to: ['speaker'] },
  customer_of: { from: ['company'], to: ['company'] },
  partner_of: { from: ['company'], to: ['company'] },
  competitor_of: { from: ['company'], to: ['company'] },
  subsidiary_of: { from: ['company'], to: ['company'] },
  vendor_of: { from: ['company'], to: ['company'] },
  participant: {
    from: ['speaker', 'company'],
    to: ['transcript', 'deal', 'project', 'event'],
  },
  discusses: { from: ['transcript'], to: ['topic', 'company'] },
  mentions: { from: ['transcript'], to: ['speaker'] },
  documents: { from: ['document'], to: ['transcript', 'deal', 'project'] },
  related_to: {
    from: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
    to: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
  },
  similar_to: {
    from: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
    to: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
  },
  derived_from: {
    from: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
    to: [
      'user',
      'speaker',
      'company',
      'topic',
      'transcript',
      'document',
      'deal',
      'project',
      'event',
      'action_item',
      'decision',
      'meeting_series',
    ],
  },
}

export function isValidRelationship(
  relType: RelationshipType,
  fromType: EntityType,
  toType: EntityType
): boolean {
  const endpoints = VALID_RELATIONSHIP_ENDPOINTS[relType]
  if (!endpoints) return false
  return endpoints.from.includes(fromType) && endpoints.to.includes(toType)
}

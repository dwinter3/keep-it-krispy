/**
 * DynamoDB client for fast transcript metadata queries.
 * Supports multi-tenant user isolation via user_id filtering.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  ScanCommand,
  GetCommand,
  UpdateCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'crypto';

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index';
const ENTITIES_TABLE = process.env.ENTITIES_TABLE || 'krisp-entities';
const RELATIONSHIPS_TABLE = process.env.RELATIONSHIPS_TABLE || 'krisp-relationships';
const LINKEDIN_TABLE = process.env.LINKEDIN_TABLE || 'krisp-linkedin-connections';
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers';
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

export interface SpeakerCorrection {
  name: string;
  linkedin?: string;
}

export interface TranscriptRecord {
  meeting_id: string;
  title: string;
  date: string;
  timestamp: string;
  duration: number;
  speakers?: string[];
  speaker_name?: string;
  speaker_corrections?: Record<string, SpeakerCorrection>;
  s3_key: string;
  event_type: string;
  received_at: string;
  url?: string;
  indexed_at: string;
  user_id?: string;
  shared_with_user_ids?: string[];
  isPrivate?: boolean;
  privacy_level?: 'work' | 'work_with_private' | 'likely_private';
  privacy_reason?: string;
  privacy_topics?: string[];
  privacy_confidence?: number;
  privacy_work_percent?: number;
}

export interface EntityRecord {
  entity_id: string;
  user_id: string;
  entity_type: 'speaker' | 'company' | 'topic' | 'document';
  canonical_name: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  status: 'active' | 'merged' | 'deleted';
  team_id?: string;
}

export interface RelationshipRecord {
  relationship_id: string;
  user_id: string;
  from_entity_id: string;
  to_entity_id: string;
  rel_type: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LinkedInConnection {
  email: string;
  firstName: string;
  lastName: string;
  fullName: string;
  company: string;
  position: string;
  connectedOn: string;
}

export interface LinkedInStats {
  totalConnections: number;
  lastImportAt: string | null;
  importSource: string | null;
}

export interface LinkedInMatch extends LinkedInConnection {
  confidence: number;
  matchReason: string;
}

export interface SpeakerProfile {
  name: string;
  displayName?: string;
  role?: string;
  company?: string;
  linkedin?: string;
  aiSummary?: string;
  topics?: string[];
  enrichedAt?: string;
  enrichedConfidence?: number;
  linkedInMatch?: LinkedInMatch;
}

export class DynamoTranscriptClient {
  private client: DynamoDBDocumentClient;
  private tableName: string;
  private entitiesTable: string;
  private relationshipsTable: string;
  private linkedinTable: string;
  private speakersTable: string;

  constructor() {
    const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    this.tableName = TABLE_NAME;
    this.entitiesTable = ENTITIES_TABLE;
    this.relationshipsTable = RELATIONSHIPS_TABLE;
    this.linkedinTable = LINKEDIN_TABLE;
    this.speakersTable = SPEAKERS_TABLE;
  }

  /**
   * List transcripts by user using user-index GSI.
   * Primary method for multi-tenant isolation.
   */
  async listByUser(
    userId: string,
    limit: number = 20
  ): Promise<TranscriptRecord[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: 'attribute_not_exists(isPrivate) OR isPrivate = :false',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':false': false,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    });

    const response = await this.client.send(command);
    return (response.Items as TranscriptRecord[]) || [];
  }

  /**
   * List transcripts by date range for a specific user.
   * Filters by user_id for multi-tenant isolation.
   */
  async listByDateRange(
    userId: string,
    startDate: string,
    endDate: string,
    limit: number = 20
  ): Promise<TranscriptRecord[]> {
    // Query user-index and filter by date range
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId AND #ts BETWEEN :start AND :end',
      FilterExpression: 'attribute_not_exists(isPrivate) OR isPrivate = :false',
      ExpressionAttributeNames: {
        '#ts': 'timestamp',
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':start': startDate,
        ':end': endDate + 'T23:59:59.999Z',
        ':false': false,
      },
      ScanIndexForward: false,
      Limit: limit,
    });

    const response = await this.client.send(command);
    return (response.Items as TranscriptRecord[]) || [];
  }

  /**
   * List transcripts by speaker for a specific user.
   * Filters by user_id for multi-tenant isolation.
   */
  async listBySpeaker(
    userId: string,
    speakerName: string,
    limit: number = 20
  ): Promise<TranscriptRecord[]> {
    const command = new QueryCommand({
      TableName: this.tableName,
      IndexName: 'speaker-index',
      KeyConditionExpression: 'speaker_name = :speaker',
      FilterExpression: '(attribute_not_exists(isPrivate) OR isPrivate = :false) AND user_id = :userId',
      ExpressionAttributeValues: {
        ':speaker': speakerName.toLowerCase(),
        ':false': false,
        ':userId': userId,
      },
      Limit: limit * 2, // Request more since we're filtering
      ScanIndexForward: false,
    });

    const response = await this.client.send(command);
    const items = (response.Items as TranscriptRecord[]) || [];
    return items.slice(0, limit);
  }

  /**
   * Get a specific transcript record by meeting_id.
   * Does NOT verify ownership - use verifyOwnership() for that.
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
   * Verify user has access to a transcript.
   * Returns true if user owns it or it's shared with them.
   */
  canUserAccess(record: TranscriptRecord, userId: string): boolean {
    // Owner can always access
    if (record.user_id === userId) {
      return true;
    }

    // Check if shared with user
    if (record.shared_with_user_ids?.includes(userId)) {
      return true;
    }

    return false;
  }

  /**
   * Get a transcript by meeting_id with ownership verification.
   * Returns null if not found or user doesn't have access.
   */
  async getByMeetingIdForUser(
    meetingId: string,
    userId: string
  ): Promise<{ record: TranscriptRecord | null; accessDenied: boolean }> {
    const record = await this.getByMeetingId(meetingId);

    if (!record) {
      return { record: null, accessDenied: false };
    }

    if (!this.canUserAccess(record, userId)) {
      return { record: null, accessDenied: true };
    }

    return { record, accessDenied: false };
  }

  /**
   * List recent transcripts for a user.
   * Uses user-index GSI for efficient multi-tenant query.
   */
  async listRecent(userId: string, limit: number = 20): Promise<TranscriptRecord[]> {
    return this.listByUser(userId, limit);
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

  /**
   * Update speaker corrections for a meeting.
   * Requires ownership verification before calling.
   * Merges new corrections with existing ones.
   */
  async updateSpeakers(
    meetingId: string,
    userId: string,
    corrections: Record<string, SpeakerCorrection>
  ): Promise<{ record: TranscriptRecord | null; accessDenied: boolean; notFound: boolean }> {
    // First verify ownership
    const { record: existing, accessDenied } = await this.getByMeetingIdForUser(meetingId, userId);

    if (accessDenied) {
      return { record: null, accessDenied: true, notFound: false };
    }

    if (!existing) {
      return { record: null, accessDenied: false, notFound: true };
    }

    // Normalize keys to lowercase for consistent matching
    const normalizedCorrections: Record<string, SpeakerCorrection> = {};
    for (const [key, value] of Object.entries(corrections)) {
      normalizedCorrections[key.toLowerCase()] = value;
    }

    const merged = {
      ...(existing.speaker_corrections || {}),
      ...normalizedCorrections,
    };

    const mergeCommand = new UpdateCommand({
      TableName: this.tableName,
      Key: {
        meeting_id: meetingId,
      },
      UpdateExpression: 'SET speaker_corrections = :corrections',
      ExpressionAttributeValues: {
        ':corrections': merged,
      },
      ReturnValues: 'ALL_NEW',
    });

    const response = await this.client.send(mergeCommand);
    const updatedRecord = (response.Attributes as TranscriptRecord) || null;

    // Also create/update speaker entities
    for (const correction of Object.values(normalizedCorrections)) {
      await this.upsertSpeakerEntity(userId, correction.name, correction.linkedin);
    }

    return { record: updatedRecord, accessDenied: false, notFound: false };
  }

  /**
   * Get speaker corrections for a meeting.
   */
  async getSpeakerCorrections(meetingId: string): Promise<Record<string, SpeakerCorrection> | null> {
    const record = await this.getByMeetingId(meetingId);
    return record?.speaker_corrections || null;
  }

  // ==================== Entity Methods ====================

  /**
   * List entities by type for a user.
   */
  async listEntities(
    userId: string,
    entityType?: string,
    limit: number = 50
  ): Promise<EntityRecord[]> {
    if (entityType) {
      // Query by user_id and entity_type using user-type-index
      const command = new QueryCommand({
        TableName: this.entitiesTable,
        IndexName: 'user-type-index',
        KeyConditionExpression: 'user_id = :userId AND entity_type = :entityType',
        FilterExpression: '#status = :active',
        ExpressionAttributeNames: {
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':userId': userId,
          ':entityType': entityType,
          ':active': 'active',
        },
        Limit: limit,
      });

      const response = await this.client.send(command);
      return (response.Items as EntityRecord[]) || [];
    }

    // Query all entities for user
    const command = new QueryCommand({
      TableName: this.entitiesTable,
      IndexName: 'user-type-index',
      KeyConditionExpression: 'user_id = :userId',
      FilterExpression: '#status = :active',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':active': 'active',
      },
      Limit: limit,
    });

    const response = await this.client.send(command);
    return (response.Items as EntityRecord[]) || [];
  }

  /**
   * List speakers for a user from the entity store.
   */
  async listSpeakers(
    userId: string,
    options: { limit?: number; company?: string; verifiedOnly?: boolean } = {}
  ): Promise<EntityRecord[]> {
    const { limit = 50, company, verifiedOnly } = options;

    let entities = await this.listEntities(userId, 'speaker', limit * 2);

    // Apply additional filters
    if (company) {
      entities = entities.filter((e) => {
        const meta = e.metadata as { company?: string } | undefined;
        return meta?.company?.toLowerCase() === company.toLowerCase();
      });
    }

    if (verifiedOnly) {
      entities = entities.filter((e) => {
        const meta = e.metadata as { verified?: boolean } | undefined;
        return meta?.verified === true;
      });
    }

    return entities.slice(0, limit);
  }

  /**
   * List companies for a user from the entity store.
   */
  async listCompanies(
    userId: string,
    options: { limit?: number; type?: string } = {}
  ): Promise<EntityRecord[]> {
    const { limit = 50, type } = options;

    let entities = await this.listEntities(userId, 'company', limit * 2);

    // Apply type filter if provided
    if (type) {
      entities = entities.filter((e) => {
        const meta = e.metadata as { company_type?: string } | undefined;
        return meta?.company_type?.toLowerCase() === type.toLowerCase();
      });
    }

    return entities.slice(0, limit);
  }

  /**
   * Get an entity by ID.
   */
  async getEntity(entityId: string): Promise<EntityRecord | null> {
    const command = new GetCommand({
      TableName: this.entitiesTable,
      Key: {
        entity_id: entityId,
      },
    });

    const response = await this.client.send(command);
    return (response.Item as EntityRecord) || null;
  }

  /**
   * Create or update a speaker entity.
   */
  async upsertSpeakerEntity(
    userId: string,
    name: string,
    linkedin?: string
  ): Promise<EntityRecord> {
    const now = new Date().toISOString();
    const canonicalName = name.toLowerCase().trim();

    // Check if entity already exists by canonical name
    const existing = await this.findEntityByName(userId, 'speaker', canonicalName);

    if (existing) {
      // Update existing entity
      const command = new UpdateCommand({
        TableName: this.entitiesTable,
        Key: {
          entity_id: existing.entity_id,
        },
        UpdateExpression: 'SET updated_at = :now, canonical_name = :name' +
          (linkedin ? ', metadata.linkedin = :linkedin' : ''),
        ExpressionAttributeValues: {
          ':now': now,
          ':name': canonicalName,
          ...(linkedin && { ':linkedin': linkedin }),
        },
        ReturnValues: 'ALL_NEW',
      });

      const response = await this.client.send(command);
      return response.Attributes as EntityRecord;
    }

    // Create new entity
    const entityId = `speaker_${randomUUID()}`;
    const newEntity: EntityRecord = {
      entity_id: entityId,
      user_id: userId,
      entity_type: 'speaker',
      canonical_name: canonicalName,
      aliases: [name],
      metadata: {
        display_name: name,
        ...(linkedin && { linkedin }),
      },
      created_at: now,
      updated_at: now,
      status: 'active',
    };

    const command = new PutCommand({
      TableName: this.entitiesTable,
      Item: newEntity,
    });

    await this.client.send(command);
    return newEntity;
  }

  /**
   * Find an entity by canonical name.
   */
  async findEntityByName(
    userId: string,
    entityType: string,
    canonicalName: string
  ): Promise<EntityRecord | null> {
    const command = new QueryCommand({
      TableName: this.entitiesTable,
      IndexName: 'type-name-index',
      KeyConditionExpression: 'entity_type = :type AND canonical_name = :name',
      FilterExpression: 'user_id = :userId AND #status = :active',
      ExpressionAttributeNames: {
        '#status': 'status',
      },
      ExpressionAttributeValues: {
        ':type': entityType,
        ':name': canonicalName,
        ':userId': userId,
        ':active': 'active',
      },
      Limit: 1,
    });

    const response = await this.client.send(command);
    const items = response.Items || [];
    return items.length > 0 ? (items[0] as EntityRecord) : null;
  }

  // ==================== Relationship Methods ====================

  /**
   * Get relationships for an entity.
   */
  async getEntityRelationships(
    userId: string,
    entityId: string,
    options: { direction?: 'from' | 'to' | 'both'; relType?: string } = {}
  ): Promise<RelationshipRecord[]> {
    const { direction = 'both', relType } = options;
    const results: RelationshipRecord[] = [];

    if (direction === 'from' || direction === 'both') {
      const fromCommand = new QueryCommand({
        TableName: this.relationshipsTable,
        IndexName: 'from-index',
        KeyConditionExpression: relType
          ? 'from_entity_id = :entityId AND rel_type = :relType'
          : 'from_entity_id = :entityId',
        FilterExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':entityId': entityId,
          ':userId': userId,
          ...(relType && { ':relType': relType }),
        },
      });

      const fromResponse = await this.client.send(fromCommand);
      results.push(...((fromResponse.Items as RelationshipRecord[]) || []));
    }

    if (direction === 'to' || direction === 'both') {
      const toCommand = new QueryCommand({
        TableName: this.relationshipsTable,
        IndexName: 'to-index',
        KeyConditionExpression: relType
          ? 'to_entity_id = :entityId AND rel_type = :relType'
          : 'to_entity_id = :entityId',
        FilterExpression: 'user_id = :userId',
        ExpressionAttributeValues: {
          ':entityId': entityId,
          ':userId': userId,
          ...(relType && { ':relType': relType }),
        },
      });

      const toResponse = await this.client.send(toCommand);
      results.push(...((toResponse.Items as RelationshipRecord[]) || []));
    }

    return results;
  }

  /**
   * Create a relationship between two entities.
   */
  async createRelationship(
    userId: string,
    fromEntityId: string,
    toEntityId: string,
    relType: string,
    metadata?: Record<string, unknown>
  ): Promise<RelationshipRecord> {
    const now = new Date().toISOString();
    const relationshipId = `rel_${randomUUID()}`;

    const relationship: RelationshipRecord = {
      relationship_id: relationshipId,
      user_id: userId,
      from_entity_id: fromEntityId,
      to_entity_id: toEntityId,
      rel_type: relType,
      metadata,
      created_at: now,
      updated_at: now,
    };

    const command = new PutCommand({
      TableName: this.relationshipsTable,
      Item: relationship,
    });

    await this.client.send(command);
    return relationship;
  }

  // ==================== LinkedIn Connection Methods ====================

  /**
   * Get LinkedIn connection stats for a user.
   */
  async getLinkedInStats(userId: string): Promise<LinkedInStats> {
    const command = new QueryCommand({
      TableName: this.linkedinTable,
      KeyConditionExpression: 'user_id = :userId AND email = :email',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':email': '_metadata',
      },
    });

    const response = await this.client.send(command);
    const metadata = response.Items?.[0];

    return {
      totalConnections: (metadata?.total_connections as number) || 0,
      lastImportAt: (metadata?.last_import_at as string) || null,
      importSource: (metadata?.import_source as string) || null,
    };
  }

  /**
   * List LinkedIn connections for a user.
   */
  async listLinkedInConnections(
    userId: string,
    options: { limit?: number; search?: string } = {}
  ): Promise<LinkedInConnection[]> {
    const { limit = 50, search } = options;

    if (search) {
      // Search by normalized name using GSI
      const normalizedSearch = search
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      const command = new QueryCommand({
        TableName: this.linkedinTable,
        IndexName: 'name-index',
        KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':search': normalizedSearch,
        },
        Limit: limit,
      });

      const response = await this.client.send(command);
      return ((response.Items || []) as Record<string, unknown>[])
        .filter(c => c.email !== '_metadata')
        .map(c => ({
          email: c.email as string,
          firstName: c.first_name as string,
          lastName: c.last_name as string,
          fullName: c.full_name as string,
          company: c.company as string,
          position: c.position as string,
          connectedOn: c.connected_on as string,
        }));
    }

    // List all connections
    const command = new QueryCommand({
      TableName: this.linkedinTable,
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: {
        ':userId': userId,
      },
      Limit: limit + 1, // +1 to account for metadata row
    });

    const response = await this.client.send(command);
    return ((response.Items || []) as Record<string, unknown>[])
      .filter(c => c.email !== '_metadata')
      .slice(0, limit)
      .map(c => ({
        email: c.email as string,
        firstName: c.first_name as string,
        lastName: c.last_name as string,
        fullName: c.full_name as string,
        company: c.company as string,
        position: c.position as string,
        connectedOn: c.connected_on as string,
      }));
  }

  /**
   * Search LinkedIn connections for a speaker name match.
   */
  async matchLinkedInConnection(
    userId: string,
    speakerName: string,
    context?: { companies?: string[] }
  ): Promise<LinkedInMatch | null> {
    const normalizedSearch = speakerName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const searchWords = normalizedSearch.split(' ').filter(w => w.length > 1);
    if (searchWords.length === 0) return null;

    const matches: LinkedInMatch[] = [];

    // Strategy 1: Exact prefix match on normalized name
    const exactCommand = new QueryCommand({
      TableName: this.linkedinTable,
      IndexName: 'name-index',
      KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
      ExpressionAttributeValues: {
        ':userId': userId,
        ':search': normalizedSearch,
      },
      Limit: 10,
    });
    const exactResult = await this.client.send(exactCommand);

    for (const item of (exactResult.Items || []) as Record<string, unknown>[]) {
      if (item.email === '_metadata') continue;

      const fullNameNorm = ((item.full_name as string) || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      let confidence = 50; // Base confidence
      if (normalizedSearch === fullNameNorm) {
        confidence = 95; // Exact match
      } else if (fullNameNorm.includes(normalizedSearch) || normalizedSearch.includes(fullNameNorm)) {
        confidence = 85; // Partial match
      }

      // Boost if context matches company
      if (context?.companies && item.company) {
        const companyNorm = (item.company as string).toLowerCase();
        for (const contextCompany of context.companies) {
          if (companyNorm.includes(contextCompany.toLowerCase()) ||
              contextCompany.toLowerCase().includes(companyNorm)) {
            confidence += 15;
            break;
          }
        }
      }

      matches.push({
        email: item.email as string,
        firstName: item.first_name as string,
        lastName: item.last_name as string,
        fullName: item.full_name as string,
        company: item.company as string,
        position: item.position as string,
        connectedOn: item.connected_on as string,
        confidence: Math.min(100, confidence),
        matchReason: `1st-degree LinkedIn connection: "${speakerName}" → "${item.full_name}"`,
      });
    }

    // Strategy 2: First name match if single word
    if (searchWords.length === 1 && matches.filter(m => m.confidence >= 70).length === 0) {
      const firstNameCommand = new QueryCommand({
        TableName: this.linkedinTable,
        IndexName: 'name-index',
        KeyConditionExpression: 'user_id = :userId AND begins_with(normalized_name, :search)',
        ExpressionAttributeValues: {
          ':userId': userId,
          ':search': searchWords[0],
        },
        Limit: 20,
      });
      const firstNameResult = await this.client.send(firstNameCommand);

      for (const item of (firstNameResult.Items || []) as Record<string, unknown>[]) {
        if (item.email === '_metadata') continue;
        if (matches.some(m => m.email === item.email)) continue;

        const firstName = ((item.first_name as string) || '')
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, '')
          .trim();

        if (firstName === searchWords[0] || firstName.startsWith(searchWords[0])) {
          let confidence = 60;

          if (context?.companies && item.company) {
            const companyNorm = (item.company as string).toLowerCase();
            for (const contextCompany of context.companies) {
              if (companyNorm.includes(contextCompany.toLowerCase()) ||
                  contextCompany.toLowerCase().includes(companyNorm)) {
                confidence += 20;
                break;
              }
            }
          }

          matches.push({
            email: item.email as string,
            firstName: item.first_name as string,
            lastName: item.last_name as string,
            fullName: item.full_name as string,
            company: item.company as string,
            position: item.position as string,
            connectedOn: item.connected_on as string,
            confidence: Math.min(100, confidence),
            matchReason: `1st-degree LinkedIn (first name): "${speakerName}" → "${item.full_name}"`,
          });
        }
      }
    }

    // Sort by confidence and return best match if >= 50
    matches.sort((a, b) => b.confidence - a.confidence);
    const best = matches[0];
    return best && best.confidence >= 50 ? best : null;
  }

  // ==================== Speaker Profile Methods ====================

  /**
   * Get enriched speaker profile by name.
   */
  async getSpeakerProfile(speakerName: string): Promise<SpeakerProfile | null> {
    const normalizedName = speakerName.toLowerCase().trim();

    const command = new GetCommand({
      TableName: this.speakersTable,
      Key: { name: normalizedName },
    });

    const response = await this.client.send(command);
    const item = response.Item;

    if (!item) return null;

    return {
      name: normalizedName,
      displayName: item.displayName as string | undefined,
      role: item.role as string | undefined,
      company: item.company as string | undefined,
      linkedin: item.linkedin as string | undefined,
      aiSummary: item.aiSummary as string | undefined,
      topics: item.topics as string[] | undefined,
      enrichedAt: item.enrichedAt as string | undefined,
      enrichedConfidence: item.enrichedConfidence as number | undefined,
      linkedInMatch: item.linkedInMatch as LinkedInMatch | undefined,
    };
  }

  /**
   * Get speaker context with LinkedIn match for a user.
   */
  async getSpeakerContext(
    userId: string,
    speakerName: string
  ): Promise<{
    profile: SpeakerProfile | null;
    linkedInMatch: LinkedInMatch | null;
    entity: EntityRecord | null;
    transcriptCount: number;
  }> {
    // Get speaker profile from krisp-speakers
    const profile = await this.getSpeakerProfile(speakerName);

    // Search for LinkedIn match
    const linkedInMatch = await this.matchLinkedInConnection(userId, speakerName, {
      companies: profile?.company ? [profile.company] : undefined,
    });

    // Find speaker entity
    const entity = await this.findEntityByName(userId, 'speaker', speakerName.toLowerCase().trim());

    // Count transcripts with this speaker
    const transcripts = await this.listBySpeaker(userId, speakerName, 100);
    const transcriptCount = transcripts.length;

    return {
      profile,
      linkedInMatch: linkedInMatch || profile?.linkedInMatch || null,
      entity,
      transcriptCount,
    };
  }
}

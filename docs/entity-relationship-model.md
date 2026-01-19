# Keep It Krispy — Entity & Relationship Model Specification

## 1) Overview

This document defines the extensible data model for Keep It Krispy's knowledge graph. The model supports:
- Universal entity types (speakers, companies, deals, projects, etc.)
- Flexible relationships between any entities
- Multi-party scenarios (deals involving 3+ companies)
- AI-inferred and human-verified connections
- Full audit trail and tenant isolation

## 2) Design Principles

1. **Extensibility**: Add new entity types without schema changes
2. **Flexibility**: Any entity can relate to any other entity
3. **Auditability**: Track who created/modified, when, and confidence
4. **Isolation**: User-owned by default, explicit sharing to teams
5. **Performance**: Optimized for common query patterns via GSIs

## 3) Core Tables

### 3.1 krisp-entities

Universal entity store for all typed objects.

```
Table: krisp-entities
──────────────────────────────────────────────────────────────────────
PK: entity_id (string)         - UUID: "ent_xxxxxxxxxxxx"

Attributes:
  entity_type: string          - user|speaker|company|topic|document|
                                 transcript|deal|project|event|action_item
  user_id: string              - Owner (tenant isolation)
  team_id: string (optional)   - If team-owned
  name: string                 - Display name
  canonical_name: string       - Normalized for matching (lowercase, etc.)
  aliases: string[]            - Alternative names for matching
  status: string               - active|archived|merged

  # Type-specific metadata (schemaless)
  metadata: Map                - JSON object with type-specific fields

  # Enrichment
  enriched_at: string          - Last enrichment timestamp
  enrichment_source: string    - web|linkedin|manual|ai
  confidence: number           - 0-100 confidence in entity data

  # Audit
  created_at: string
  created_by: string           - user_id who created
  updated_at: string
  updated_by: string

  # Merge tracking
  merged_into: string          - If merged, points to canonical entity_id
  merged_from: string[]        - IDs that were merged into this

GSIs:
  - user-type-index: (user_id, entity_type) - "All my speakers"
  - type-name-index: (entity_type, canonical_name) - "Find company by name"
  - team-type-index: (team_id, entity_type) - "All team's deals"
```

### 3.2 krisp-relationships

Graph edges connecting any two entities.

```
Table: krisp-relationships
──────────────────────────────────────────────────────────────────────
PK: relationship_id (string)   - UUID: "rel_xxxxxxxxxxxx"

Attributes:
  from_entity_id: string       - Source entity
  from_entity_type: string     - Denormalized for query efficiency
  to_entity_id: string         - Target entity
  to_entity_type: string       - Denormalized for query efficiency

  rel_type: string             - Relationship type (see Section 4)
  role: string (optional)      - Contextual role: "technical lead", "customer"

  # Relationship metadata
  metadata: Map                - Type-specific attributes
  confidence: number           - 0-100 confidence score
  source: string               - ai_inferred|user_created|imported

  # Temporal (optional)
  valid_from: string           - When relationship started
  valid_to: string             - When relationship ended (null = current)

  # Audit
  user_id: string              - Who owns this relationship
  created_at: string
  created_by: string

GSIs:
  - from-index: (from_entity_id, rel_type) - "All relationships from entity X"
  - to-index: (to_entity_id, rel_type) - "All relationships to entity X"
  - user-type-index: (user_id, rel_type) - "All my 'works_at' relationships"
```

### 3.3 krisp-transcripts (Enhanced)

Transcripts remain a dedicated table for performance but link to entities.

```
Table: krisp-transcripts (existing, enhanced)
──────────────────────────────────────────────────────────────────────
PK: meeting_id (string)        - Existing

New/Modified Attributes:
  entity_id: string            - Link to krisp-entities record

  # Existing fields remain...
  user_id, s3_key, title, date, timestamp, duration, etc.

  # Remove denormalized arrays (replaced by relationships):
  # speakers: string[]         - DEPRECATED: use relationships
  # topics: string[]           - DEPRECATED: use relationships
```

### 3.4 krisp-documents (New)

Dedicated document storage (moved out of transcripts table hack).

```
Table: krisp-documents
──────────────────────────────────────────────────────────────────────
PK: document_id (string)       - UUID: "doc_xxxxxxxxxxxx"

Attributes:
  entity_id: string            - Link to krisp-entities record
  user_id: string              - Owner

  # File info
  filename: string
  file_type: string            - pdf|docx|pptx|md|txt
  file_hash: string            - SHA256 for deduplication
  file_size: number
  s3_key: string

  # Metadata
  title: string
  source: string               - upload|url|drive|notion|email
  source_url: string (optional)
  word_count: number

  # Processing
  processed_at: string
  chunk_count: number          - Number of vector chunks

  # Audit
  created_at: string
  is_private: boolean

GSIs:
  - user-index: (user_id, created_at)
  - hash-index: (file_hash) - Deduplication lookup
```

## 4) Entity Types

### 4.1 Core Entity Types

| Type | Description | Key Metadata Fields |
|------|-------------|---------------------|
| `user` | Platform user | email, avatar, settings |
| `speaker` | Person in transcripts | linkedin, role, company_name, bio |
| `company` | Organization | website, industry, type, description, logo |
| `topic` | Discussion theme | category, description |
| `transcript` | Meeting record | duration, source, summary |
| `document` | File/artifact | file_type, source, word_count |

### 4.2 Extended Entity Types (Phase 2+)

| Type | Description | Key Metadata Fields |
|------|-------------|---------------------|
| `deal` | Sales opportunity | value, stage, close_date, probability |
| `project` | Initiative/engagement | status, start_date, end_date |
| `event` | Conference, QBR, etc. | date, location, type |
| `action_item` | Task from meeting | assignee, due_date, status |
| `decision` | Key decision made | date, rationale, participants |
| `meeting_series` | Recurring meetings | frequency, participants |

## 5) Relationship Types

### 5.1 Person/Company Relationships

| rel_type | From | To | Description |
|----------|------|-----|-------------|
| `works_at` | speaker | company | Employment |
| `worked_at` | speaker | company | Past employment |
| `founded` | speaker | company | Founder relationship |
| `knows` | speaker | speaker | Professional connection |

### 5.2 Business Relationships

| rel_type | From | To | Description |
|----------|------|-----|-------------|
| `customer_of` | company | company | Customer relationship |
| `partner_of` | company | company | Partnership |
| `competitor_of` | company | company | Competition |
| `subsidiary_of` | company | company | Corporate structure |
| `vendor_of` | company | company | Vendor/supplier |

### 5.3 Participation Relationships

| rel_type | From | To | Role Examples |
|----------|------|-----|---------------|
| `participant` | speaker | transcript | "attendee", "presenter" |
| `participant` | speaker | deal | "account exec", "technical lead" |
| `participant` | company | deal | "seller", "buyer", "partner" |
| `participant` | speaker | project | "lead", "contributor" |

### 5.4 Content Relationships

| rel_type | From | To | Description |
|----------|------|-----|-------------|
| `discusses` | transcript | topic | Topic discussed in meeting |
| `discusses` | transcript | company | Company mentioned |
| `mentions` | transcript | speaker | Person mentioned (not present) |
| `documents` | document | transcript | File related to meeting |
| `documents` | document | deal | File related to deal |
| `documents` | document | project | File related to project |

### 5.5 Derived Relationships

| rel_type | From | To | Description |
|----------|------|-----|-------------|
| `related_to` | any | any | Generic relationship |
| `similar_to` | any | any | AI-detected similarity |
| `derived_from` | any | any | Source relationship |

## 6) Example: Multi-Party Deal

```
Deal: "Ford Cloud Migration Q1 2026"
entity_type: deal
metadata: {
  value: 2000000,
  currency: "USD",
  stage: "negotiation",
  probability: 60,
  close_date: "2026-03-31",
  description: "AWS cloud migration for Ford manufacturing"
}

Relationships:
┌────────────────────────────────────────────────────────────────────┐
│ from: deal_ford_q1    to: company_orion     type: participant      │
│                                             role: "prime contractor"│
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: company_aws       type: participant      │
│                                             role: "technology partner"│
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: company_ford      type: participant      │
│                                             role: "customer"        │
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: speaker_jeff      type: participant      │
│                                             role: "technical lead"  │
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: transcript_jan7   type: documents        │
│                                             role: "discovery call"  │
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: doc_proposal      type: documents        │
│                                             role: "proposal"        │
├────────────────────────────────────────────────────────────────────┤
│ from: deal_ford_q1    to: topic_cloud       type: discusses        │
└────────────────────────────────────────────────────────────────────┘
```

## 7) Query Patterns

### 7.1 Common Queries

```typescript
// All speakers for a user
Query: user-type-index WHERE user_id = X AND entity_type = "speaker"

// All transcripts mentioning a company
Query: to-index WHERE to_entity_id = company_id AND rel_type = "discusses"
Then: Fetch transcripts by entity_id

// All participants in a deal
Query: from-index WHERE from_entity_id = deal_id AND rel_type = "participant"

// Speaker's employment history
Query: from-index WHERE from_entity_id = speaker_id AND rel_type IN ("works_at", "worked_at")

// Companies related to a speaker (via deals, transcripts, employment)
Query: from-index WHERE from_entity_id = speaker_id
Filter: to_entity_type = "company"
```

### 7.2 Graph Traversal

For complex queries (2+ hops), use application-level traversal or consider:
- Neptune (AWS graph database) for production scale
- OpenSearch for complex aggregations
- Materialized views for common patterns

## 8) Migration Strategy

### Phase 1: Create New Tables (Non-Breaking)
- Create krisp-entities table
- Create krisp-relationships table
- Create krisp-documents table
- Existing tables continue to work

### Phase 2: Dual-Write
- Processor Lambda writes to both old and new models
- Backfill existing data to new model
- API reads from new model, falls back to old

### Phase 3: Migrate Reads
- Update all API endpoints to read from new model
- Update UI components
- Validate data consistency

### Phase 4: Deprecate Old Model
- Remove dual-write
- Archive old denormalized fields
- Clean up code

## 9) Tenant Isolation

All entities and relationships include:
- `user_id`: Owner of the record
- `team_id`: If shared/transferred to team

Access rules:
1. User can access own records (user_id match)
2. User can access team records (team membership check)
3. Relationships visible if user can access BOTH endpoints

## 10) Vector Integration

Vector embeddings in S3 Vectors include metadata:
```json
{
  "entity_id": "ent_xxx",
  "entity_type": "transcript",
  "user_id": "usr_xxx",
  "chunk_index": 0,
  "source_text": "..."
}
```

This enables:
- Semantic search scoped to entity types
- Finding similar entities
- RAG with entity context

## 11) Future Considerations

- **Graph Database**: Neptune for complex traversals at scale
- **Event Sourcing**: Track all changes for replay/audit
- **ML Pipeline**: Continuous relationship inference
- **External Integrations**: CRM sync (Dynamics, Salesforce)

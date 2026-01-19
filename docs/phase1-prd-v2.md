# Phase 1 PRD v2 — Secure SaaS + Knowledge Graph Foundation

## 1) Summary

Phase 1 builds the secure SaaS foundation AND the extensible knowledge graph that powers Keep It Krispy's relationship intelligence. This phase establishes:
- **Tenant isolation** with invite-only onboarding
- **Entity-relationship model** for speakers, companies, topics, and beyond
- **Search-first experience** across the knowledge graph
- **Foundation for deals, projects, and multi-party relationships**

## 2) Vision

Keep It Krispy transforms meeting transcripts into a **living knowledge graph** that connects:
- **People** (speakers) you interact with
- **Companies** (employers, customers, partners, discussed)
- **Topics** (themes across conversations)
- **Content** (transcripts, documents, artifacts)
- **Opportunities** (deals, projects, initiatives)

The system **infers relationships** from transcripts and allows users to **verify, correct, and enrich** the graph.

## 3) Goals

- Ship secure, invite-only SaaS for early enterprise pilots
- Implement extensible entity-relationship model (see `entity-relationship-model.md`)
- Deliver vector search across all entity types
- Enable identity resolution (merge/split speakers, companies)
- Lay groundwork for SOC2 Type II readiness

## 4) Non-Goals (Phase 1)

- Visual graph UI / mindmap (Phase 2)
- Proactive intelligence alerts (Phase 2)
- Full CRM integration - Dynamics/Salesforce (Phase 2)
- Deal management UI (Phase 2)
- Complex role hierarchy beyond Admin/Member

## 5) Target Users

- Sales leaders tracking customer relationships
- Account executives managing deals across partners
- Consultants juggling multiple client engagements

## 6) Core Objects

| Object | Description | Phase 1 Scope |
|--------|-------------|---------------|
| **User** | Platform user with isolated data | Full |
| **Transcript** | Meeting record from any source | Full |
| **Speaker** | Person appearing in transcripts | Full |
| **Company** | Organization (employer/customer/etc) | Full |
| **Topic** | Discussion theme | Full |
| **Document** | Files/artifacts linked to transcripts | Full |
| **Deal** | Multi-party sales opportunity | Schema only |
| **Project** | Engagement/initiative | Schema only |
| **Relationship** | Edge connecting any two entities | Full |

## 7) Epics

### Epic A: Secure SaaS Foundation
Infrastructure for multi-tenant, invite-only SaaS.

| ID | Task | Priority |
|----|------|----------|
| A1 | Invite-only onboarding flow | P0 |
| A2 | Team/workspace creation | P0 |
| A3 | Tenant isolation middleware | P0 (Done) |
| A4 | Audit logging pipeline | P1 |

### Epic B: Entity Model Implementation
Create the extensible entity-relationship data model.

| ID | Task | Priority |
|----|------|----------|
| B1 | Create krisp-entities table | P0 |
| B2 | Create krisp-relationships table | P0 |
| B3 | Create krisp-documents table | P0 |
| B4 | Migrate speakers to entity model | P1 |
| B5 | Implement companies as entities | P1 |
| B6 | Implement topics as entities | P1 |
| B7 | Link transcripts to entity graph | P1 |

### Epic C: Relationship Intelligence
Build the graph that connects everything.

| ID | Task | Priority |
|----|------|----------|
| C1 | Auto-create speaker entities from transcripts | P0 |
| C2 | Infer speaker→company relationships | P1 |
| C3 | Extract company mentions from transcripts | P1 |
| C4 | Link documents to transcripts/speakers | P1 |
| C5 | Entity merge/split workflow | P1 |
| C6 | Relationship confidence scoring | P2 |

### Epic D: Search & Discovery
Unified search across the knowledge graph.

| ID | Task | Priority |
|----|------|----------|
| D1 | Vector search API (existing, enhance) | P0 (Done) |
| D2 | Search by entity type filters | P1 |
| D3 | Search relationships ("who knows who") | P2 |
| D4 | MCP integration with entity context | P1 |

### Epic E: Sharing & Ownership
Control over data visibility and ownership.

| ID | Task | Priority |
|----|------|----------|
| E1 | Manual transcript sharing | P1 |
| E2 | Auto-share setting | P2 |
| E3 | Relinquish to team | P2 |
| E4 | Entity-level sharing (speakers, companies) | P2 |

### Epic F: UI & Experience
Frontend to interact with the knowledge graph.

| ID | Task | Priority |
|----|------|----------|
| F1 | Speaker profiles with relationships | P0 (Partial) |
| F2 | Company profiles and discovery | P1 |
| F3 | Topic pages with entity links | P1 |
| F4 | Document library with linking | P1 |
| F5 | Relationship visualization (basic) | P2 |

## 8) Data Model Summary

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PHASE 1 DATA MODEL                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐         ┌──────────────────────────────────────┐  │
│  │   USERS     │         │           ENTITIES                   │  │
│  │ (existing)  │         │ (NEW - universal entity store)       │  │
│  └─────────────┘         │                                      │  │
│         │                │  entity_id, entity_type, user_id     │  │
│         │ owns           │  name, aliases, metadata             │  │
│         ▼                │                                      │  │
│  ┌─────────────┐         │  Types: speaker, company, topic,     │  │
│  │ TRANSCRIPTS │────────▶│         document, deal*, project*    │  │
│  │ (existing)  │         │                                      │  │
│  │ + entity_id │         │  * schema ready, UI in Phase 2       │  │
│  └─────────────┘         └──────────────────────────────────────┘  │
│                                         │                          │
│                                         │                          │
│                                         ▼                          │
│                          ┌──────────────────────────────────────┐  │
│                          │        RELATIONSHIPS                 │  │
│                          │ (NEW - graph edges)                  │  │
│                          │                                      │  │
│                          │  from_entity_id, to_entity_id        │  │
│                          │  rel_type, role, confidence          │  │
│                          │                                      │  │
│                          │  Types: works_at, customer_of,       │  │
│                          │         participant, discusses, etc. │  │
│                          └──────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    DOCUMENTS (NEW)                            │  │
│  │  Dedicated table for files (moved from transcript hack)       │  │
│  │  document_id, entity_id, file_hash, s3_key                   │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    VECTORS (existing)                         │  │
│  │  S3 Vectors with entity_id in metadata                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## 9) Migration Path

### Sprint 1-2: Foundation
- Create new DynamoDB tables (entities, relationships, documents)
- Update CloudFormation
- Dual-write infrastructure

### Sprint 3-4: Entity Population
- Backfill speakers as entities
- Create companies from speaker data
- Generate transcript↔speaker relationships

### Sprint 5-6: UI Integration
- Update speaker pages to use entity model
- Launch company pages
- Document library migration

### Sprint 7-8: Relationship Intelligence
- Auto-extraction in processor Lambda
- Merge/split workflows
- Search enhancements

## 10) Success Metrics

| Metric | Target |
|--------|--------|
| Entities created per user | 50+ speakers, 20+ companies |
| Relationships per transcript | 5+ (speakers, topics, companies) |
| Search latency (p95) | < 2 seconds |
| Entity resolution accuracy | 90%+ with user corrections |

## 11) Risks

| Risk | Mitigation |
|------|------------|
| Migration complexity | Dual-write, gradual rollout |
| Performance at scale | GSIs, caching, pagination |
| Entity resolution errors | User correction UI, confidence scores |
| Scope creep to Phase 2 | Strict P0/P1 focus |

## 12) Related Documents

- `entity-relationship-model.md` - Detailed data model spec
- `permissions-tenancy-spec.md` - Sharing and ownership rules
- `soc2-type2-readiness.md` - Compliance requirements
- `dynamics-integration-mvp.md` - Future CRM integration

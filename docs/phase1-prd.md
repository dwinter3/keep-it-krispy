# Phase 1 PRD — Secure SaaS + Search MVP

## 1) Summary
Phase 1 builds the secure SaaS foundation for Keep It Krispy (KIK) and delivers a reliable **search-first** experience for sales leaders/executives. This phase prioritizes **tenant isolation**, **identity resolution**, **invite-only onboarding**, and **vector search** across transcripts and documents, with **MCP integration** as a core access path.

## 2) Goals
- Ship a secure, invite-only SaaS suitable for early enterprise pilots.
- Deliver high-quality vector search across transcripts (and documents where available).
- Provide identity resolution for people/companies to enable future relationship intelligence.
- Lay groundwork for SOC2 Type II readiness (controls, logging, access).

## 3) Non-Goals (Phase 1)
- Visual graph UI.
- Proactive intelligence alerts.
- Full CRM integration (Dynamics starts in Phase 2).
- Complex role hierarchy beyond Admin/Member.

## 4) Target Users (Phase 1)
- Sales leaders and executives who need to search and recall key details across calls.

## 5) Core User Journeys
1) **Invite-only onboarding**
   - User receives invite → creates account → can invite others.
2) **Search by idea**
   - User types a fuzzy query → results show transcripts, speakers, topics.
3) **Identity resolution**
   - User corrects speaker/company names to canonical identities.
4) **Sharing to team**
   - User manually shares transcript to team, or enables auto-share.

## 6) Functional Requirements
### 6.1 Authentication & Onboarding
- Invite-only flow: any user can invite.
- Email-based invite tokens with expiry.
- First user of a workspace becomes team admin.

### 6.2 Tenant Isolation
- All API routes enforce owner/team isolation rules (see `permissions-tenancy-spec.md`).
- Storage isolation at S3/DynamoDB/Vectors.

### 6.3 Search Experience
- Vector search over transcripts (and documents when uploaded).
- Results include snippet, date, speakers, company/topic tags.

### 6.4 Identity Resolution (v1)
- Canonical entities: Person, Company, Domain.
- Admin/user can rename or merge entities.
- Allow manual correction of speaker names per transcript.

### 6.5 Sharing & Ownership
- Manual share per transcript (default).
- Optional auto-share for all future transcripts.
- Relinquish to team for team-owned data.

### 6.6 Notifications (Email)
- System email infrastructure set up (invite emails, basic notifications).

### 6.7 Retention & Deletion
- Retention policy: 5 years by default.
- User can delete any owned data immediately.

## 7) Non-Functional Requirements
- Encryption in transit and at rest.
- Audit logging for access/share/export/delete events.
- Multi-region-ready architecture with region stored at workspace level.
- US deployment for Phase 1.

## 8) Epics and Decomposition
### Epic A: Secure SaaS Foundation
- A1: Invite-only onboarding
- A2: Workspace/team creation
- A3: Tenant isolation middleware
- A4: Audit logging pipeline

### Epic B: Search MVP
- B1: Vector search API stabilization
- B2: Search UI improvements (filters, snippets)
- B3: MCP integration polish + docs

### Epic C: Identity Resolution v1
- C1: Canonical person/company model
- C2: Merge/split workflow
- C3: Speaker correction UI

### Epic D: Sharing & Ownership
- D1: Manual share per transcript
- D2: Auto-share setting
- D3: Relinquish-to-team flow

## 9) Acceptance Criteria
- User can search by idea and find transcript results within 2 seconds.
- All data access requests are denied if tenant checks fail.
- Manual share requires explicit action; auto-share only applies to future items.
- User can delete owned transcripts and confirm removal from UI.
- Audit logs record share, delete, export, and access events.

## 10) Analytics & Success Metrics
- Daily active users (DAU)
- Weekly searches per active user
- Invite acceptance rate
- Search success rate (click-through or result opens)

## 11) Risks
- Weak identity resolution leads to poor relationship insights.
- Multi-tenant bugs could block enterprise onboarding.
- Search relevance might be insufficient for executive workflows.

## 12) Milestones (Draft)
- M1 (Month 1): Invite-only onboarding + tenant isolation MVP
- M2 (Month 2): Search improvements + MCP doc polish
- M3 (Month 3): Identity resolution + sharing flows

## 13) Open Questions
- Final IAM model for admin vs member permissions.
- UI surface for audit log (admin-only?).
- Delete semantics for shared items (hard vs soft delete).


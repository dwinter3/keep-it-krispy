# Keep It Krispy (KIK) — Permissions, Tenancy, and Ownership Spec

## 1) Overview
KIK is a multi-tenant SaaS where **users own their intelligence by default**, can optionally share selected items with a **team**, and can **relinquish** items to become team-owned. The system must support **user-level private intelligence**, **team intelligence**, and **clear ownership boundaries** with auditability and SOC2 requirements.

This doc defines:
- Ownership and sharing rules
- Team membership behaviors (join/leave)
- Data visibility and export
- Audit logging requirements
- Data model implications

## 2) Goals
- Ensure strict tenant isolation for all data access.
- Preserve user-owned intelligence by default.
- Allow selective sharing to teams with a **manual default** and optional **auto-share**.
- Prevent departing users from taking team-owned knowledge.
- Provide team admin export for shared intelligence.
- Maintain complete audit trails for access, sharing, relinquish, delete, and export events.

## 3) Non-Goals (Phase 1)
- Open org-to-org data sharing.
- Public links or external sharing.
- Advanced role hierarchies beyond Admin/Member.

## 4) Definitions
- **User**: A single authenticated person with private intelligence.
- **Team**: A workspace where shared intelligence is pooled.
- **User-Owned Data**: Created by user; only visible to the user by default.
- **Team-Shared Data**: User-owned data explicitly shared with a team; still user-owned.
- **Team-Owned Data**: Data user explicitly relinquishes to team; no longer owned by user.
- **Relinquish**: Transfer of ownership from user to team.
- **Auto-share**: User setting that automatically shares future items to a team.
- **Manual share**: User explicitly shares each item with a team.

## 5) Ownership and Visibility Rules
### 5.1 Default Ownership
- All new items are **user-owned** by default.

### 5.2 Sharing to Team (Default Manual)
- A user must opt in to share data with a team **after joining**.
- Default is **manual per item**.
- User can enable **auto-share** for future items.

### 5.3 Relinquish to Team
- User can explicitly **relinquish** selected items to a team.
- Relinquished items become **team-owned**.
- User can still access team-owned items **only while a team member**.
- If a user leaves the team, relinquished items **remain** with the team.

### 5.4 Leaving a Team
- User leaves or is removed from team.
- User loses access to **team-owned** items.
- User does **not** take team-owned intelligence.
- User retains their **user-owned** data (including any items not relinquished).

### 5.5 Team Admin Export
- Team admin may export team-owned and team-shared items.
- Export is **audited**.

## 6) Sharing Settings
- **Manual share (default)**: user shares each transcript individually.
- **Auto-share**: user can opt in to share all future transcripts with a chosen team.
- Auto-share is **revocable** and affects **future items only** (no retroactive sharing).

## 7) Audit Requirements (All Phases)
Audit events must include actor, timestamp, target, and reason (if provided):
- `team.join`, `team.leave`, `team.remove`
- `share.enable_auto`, `share.disable_auto`
- `share.item` (manual share)
- `relinquish.item` (ownership transfer)
- `access.item` (privileged access or export)
- `delete.item`
- `export.team`

## 8) Data Model (Logical)
### 8.1 Core Entities
- User
- Team
- TeamMembership
- Transcript
- Document
- Entity (Person, Company, Topic)
- Relationship (edges)
- AuditLog

### 8.2 Ownership and Visibility Fields (example)
- `owner_type`: `user|team`
- `owner_id`: user_id or team_id
- `shared_with_team_ids`: list of team_ids
- `is_relinquished`: boolean (true if ownership transferred)
- `visibility`: `private|team_shared|team_owned`

## 9) Access Control Rules (Enforcement)
All API paths must evaluate these rules server-side:
1. **Private access**: User can access items where owner_type = user AND owner_id = user.
2. **Team-shared access**: User can access items shared with any team where the user is a member.
3. **Team-owned access**: User can access items owned by teams where user is a member.
4. **No cross-team access**: If not a member, access is denied.

## 10) Workflow Examples
### Example A: Manual Share
- User creates transcript → user-owned.
- User clicks “Share to Team” → item becomes team-shared.
- User leaves team → user keeps the item; team loses access (if not relinquished).

### Example B: Relinquish
- User creates transcript → user-owned.
- User clicks “Relinquish to Team” → item becomes team-owned.
- User leaves team → item remains with team; user loses access.

### Example C: Auto-Share
- User enables auto-share.
- New transcripts automatically add `shared_with_team_ids`.
- User disables auto-share → no effect on past shares.

## 11) Edge Cases
- User is in multiple teams: manual share per team; auto-share per team.
- User is removed by admin: same as leaving (no team-owned data retained).
- Team deleted: team-owned items should be exported or reassigned per policy.

## 12) Open Questions (for future)
- Should team admins be allowed to **reassign ownership** of team-owned items?
- Should team-shared items be convertible to team-owned without user consent?
- Do we support enterprise role hierarchy (Owner/Admin/Member/Viewer)?


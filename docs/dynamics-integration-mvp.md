# Microsoft Dynamics Integration — MVP Scope

## 1) Objective
Enable KIK to ingest core CRM entities from Microsoft Dynamics to improve **identity resolution** and link transcripts to **Accounts, Contacts, and Opportunities**.

## 2) MVP Outcomes
- Connect a Dynamics tenant via OAuth (Azure AD).
- Sync Accounts and Contacts into KIK.
- Use CRM data to improve matching of people/companies in transcripts.
- Surface Dynamics metadata on transcript and entity pages.

## 3) Non-Goals (MVP)
- Write-back to Dynamics.
- Two-way sync.
- Full activity logging sync.
- Complex conflict resolution.

## 4) Entities and Mapping
### 4.1 Dynamics → KIK
- **Account** → Company
- **Contact** → Person
- **Opportunity** → Deal (future; optional in MVP)
- **Activity/PhoneCall** → Transcript metadata (future)

### 4.2 Matching Strategy (Phase 1)
- **Company**: match by domain and normalized name.
- **Person**: match by email if available; fallback to name + company.

## 5) Auth & Permissions
- OAuth 2.0 with Azure AD (client ID/secret per KIK).
- Scope: read-only on Accounts/Contacts.
- Store tokens encrypted (KMS).

## 6) Sync Strategy
- **Initial import**: pull Accounts + Contacts on connect.
- **Incremental sync**: scheduled job every 6–12 hours.
- **Reconciliation**: mark stale records and refresh.

## 7) UI/UX
- Settings page: Connect/Disconnect Dynamics.
- Sync status indicator (last sync, records imported).
- Entity pages show Dynamics metadata (account owner, region, industry).

## 8) Security Considerations
- Tenant isolation enforced (tokens scoped to a team).
- Store CRM data under team-owned namespace.
- Audit log on connect/disconnect and sync events.

## 9) Rollout Plan
- Internal test tenant.
- Limited beta to 3–5 customers.
- Add error logging and retry behavior.

## 10) Open Questions
- Is Opportunity sync required for MVP?
- Do we need field mapping customization?
- Should Dynamics data be visible to all team members by default?


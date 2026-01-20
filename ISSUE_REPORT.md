# Issue Report (Ready for GitHub Issues)

Below are discrete, copy‑ready issues. Each block can be pasted into a GitHub issue. If you want me to open them with `gh issue create`, say the word.

---

## 1) Remove Google OAuth client secret from repo tree

**Summary**
A Google client secret JSON file exists in the project directory. Even if ignored by Git, this is a security and operational risk (accidental inclusion in images, zips, or uploads).

**Impact**
- Risk of credential leakage
- Risk of including secrets in Docker images or artifacts

**Where**
`client_secret_834550092401-003sslti01tvg35t2gs7vij10cg1ncuf.apps.googleusercontent.com.json`

**Proposed Fix**
- Move the file outside the repo (e.g., `~/.config/krisp-buddy/`)
- Add an explicit ignore rule to `.dockerignore`
- (Optional) add a `SECURITY.md` note describing secret handling

**Acceptance Criteria**
- The file is no longer under the project root
- `.dockerignore` contains `client_secret_*.json`
- Secrets are documented and stored out of repo

---

## 2) Harden webhook authentication and logging

**Summary**
`lambda/handler.py` validates a static auth header and logs part of the secret. This is weak and potentially leaks credentials via logs.

**Impact**
- Security risk via log leakage
- Auth bypass risk if shared header is leaked

**Where**
`lambda/handler.py`

**Proposed Fix**
- Use HMAC signature verification (shared secret + request body)
- Remove any logging of secret material
- Return 401 on missing/invalid signature

**Acceptance Criteria**
- Webhook rejects unsigned/invalid requests
- No secret material appears in logs
- Document signature format in README or install docs

---

## 3) Fail fast when required env vars are missing (webhook lambda)

**Summary**
`KRISP_S3_BUCKET` can be empty in `lambda/handler.py`. This can silently fail or write to the wrong location.

**Impact**
- Hard‑to‑diagnose missing data
- Misconfiguration risk

**Where**
`lambda/handler.py`

**Proposed Fix**
- Validate required envs on cold start
- Return a 500 with a clear error if missing

**Acceptance Criteria**
- Function returns a clear error when `KRISP_S3_BUCKET` is unset
- Logs contain an actionable message

---

## 4) Add encryption + retention policies (S3/DynamoDB)

**Summary**
Transcripts contain sensitive PII. Infrastructure should enforce SSE‑KMS and retention/TTL policies.

**Impact**
- Compliance risk
- Data exposure risk

**Where**
`cloudformation.yaml`

**Proposed Fix**
- S3: SSE‑KMS, block public access, bucket policy for TLS only
- DynamoDB: SSE enabled (KMS if needed)
- Add TTL attribute (e.g., `expires_at`) and optional retention config

**Acceptance Criteria**
- S3 and DynamoDB are encrypted at rest
- Bucket enforces TLS and blocks public access
- TTL or retention is documented and available

---

## 5) Fix transcript stats: `thisWeek` is inaccurate

**Summary**
The `/api/transcripts?action=stats` endpoint returns `thisWeek` equal to total count and has a TODO.

**Impact**
- Incorrect dashboard metrics

**Where**
`src/app/api/transcripts/route.ts`

**Repro**
1. Call `/api/transcripts?action=stats`
2. Compare `thisWeek` to total count

**Proposed Fix**
- Add date‑range filtering in DynamoDB (or precomputed weekly stats)
- Use an index on `user_id + timestamp` or store week partition

**Acceptance Criteria**
- `thisWeek` returns only meetings within the last 7 days
- Unit or integration test verifies date logic

---

## 6) Paginate DynamoDB queries to avoid truncation

**Summary**
Multiple endpoints use DynamoDB queries without handling pagination, which truncates results over 1MB.

**Impact**
- Missing transcripts/speakers in UI
- Incomplete analytics

**Where**
`src/app/api/transcripts/route.ts` (stats + speakers)
`src/app/api/speakers/*` and others (audit all query/scan usage)

**Repro**
1. Add >1MB worth of items
2. Call endpoints, observe missing results

**Proposed Fix**
- Implement pagination loops for DynamoDB queries/scans
- Add tests for multi‑page responses

**Acceptance Criteria**
- All query/scan handlers page until completion (or provide cursors)
- Tests cover a >1MB dataset

---

## 7) Make vector deletion fully paginated

**Summary**
`delete_vectors_by_meeting` deletes only the first page of vectors, leaving stale embeddings behind.

**Impact**
- Orphaned vectors
- Search results can include deleted meetings

**Where**
`lambda/processor/vectors.py`

**Proposed Fix**
- Loop over `list_vectors` pagination until all keys are deleted
- Consider batching deletes for large sets

**Acceptance Criteria**
- Deleting a meeting removes all vectors for that meeting
- Integration test covers multi‑page deletion

---

## 8) Ensure idempotent processing for S3 events

**Summary**
S3 can deliver duplicate events. The processor should be idempotent to avoid duplicate vectors or metadata.

**Impact**
- Duplicate vectors and inconsistent search results
- Increased costs

**Where**
`lambda/processor/handler.py`

**Proposed Fix**
- Use deterministic vector keys (hash of chunk + meeting ID)
- Conditional write in DynamoDB (skip if already processed)
- Track processed S3 object keys

**Acceptance Criteria**
- Reprocessing the same S3 object does not create duplicates
- Tests simulate duplicate events

---

## 9) Add timeouts/retries and DLQ to processor Lambda

**Summary**
Bedrock calls and vector writes can fail transiently. Without retries and DLQ, data is lost.

**Impact**
- Silent data loss
- Incomplete indexing

**Where**
`lambda/processor/handler.py`, `cloudformation.yaml`

**Proposed Fix**
- Add retry logic with backoff for Bedrock and vector operations
- Configure DLQ and alarms

**Acceptance Criteria**
- Transient failures are retried
- Failed events land in DLQ
- CloudWatch alarm on DLQ depth

---

## 10) Add CI (lint/typecheck/test) with GitHub Actions

**Summary**
There are no CI workflows; regressions can ship unnoticed.

**Impact**
- Increased risk of production breakages

**Where**
Add `.github/workflows/ci.yml`

**Proposed Fix**
- Node: `npm ci`, `npm run lint`, `tsc --noEmit`
- Python (lambda): `pip install -r requirements.txt` + lint

**Acceptance Criteria**
- CI runs on PRs and main
- Failing lint/typecheck blocks merges

---

## 11) Add issue/PR templates and SECURITY.md

**Summary**
No GitHub templates or security policy exist.

**Impact**
- Inconsistent reporting
- Poor security disclosure process

**Where**
Add `.github/ISSUE_TEMPLATE/*`, `.github/PULL_REQUEST_TEMPLATE.md`, `SECURITY.md`

**Proposed Fix**
- Provide bug/feature templates
- Add security contact + disclosure process

**Acceptance Criteria**
- Templates appear in GitHub UI
- SECURITY.md is present and referenced in README

---

## 12) Add version pinning for Node/Python

**Summary**
Project depends on Node 18+ and Python 3.11+, but there is no `.nvmrc` / `.tool-versions`.

**Impact**
- Inconsistent local dev and CI

**Where**
Add `.nvmrc` and/or `.tool-versions`

**Proposed Fix**
- Add `.nvmrc` with Node version
- Add `.tool-versions` with Node + Python

**Acceptance Criteria**
- Devs can quickly align runtimes
- CI uses the same versions

---

## 13) Add automated tests for transcript parsing + privacy/relevance

**Summary**
There are only manual scripts in `test/`. Core parsing and classification logic lacks tests.

**Impact**
- High regression risk

**Where**
`lambda/processor/`, `src/lib/*`, `test/`

**Proposed Fix**
- Add unit tests for transcript parsing and metadata extraction
- Add deterministic fixtures for privacy/relevance detection

**Acceptance Criteria**
- Unit tests run in CI
- Coverage for core parsing and classification logic

---

## 14) Document data retention and privacy guarantees

**Summary**
The README and docs describe features, but do not document retention/PII handling clearly.

**Impact**
- User trust risk
- Compliance ambiguity

**Where**
`README.md`, `website/` docs

**Proposed Fix**
- Add a section describing encryption, retention, deletion, and user control

**Acceptance Criteria**
- README contains a clear privacy/retention section
- Website docs reflect the same


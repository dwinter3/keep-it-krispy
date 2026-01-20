# Keep It Krispy - Progress Summary

**Date:** January 20, 2026
**Session Focus:** Infrastructure, Documentation, and SaaS Transition

---

## Completed This Session

### 1. AWS CDK Infrastructure ✅

- **Deployed CDK stack** (`krisp-buddy`) to AWS
- Ran `cdk bootstrap` to initialize CDK in the account
- Modified stack to **import existing resources** using `fromXxx` methods (buckets, tables, Lambdas)
- Created **GitHub OIDC provider** for secure CI/CD
- Created **GitHubActionsCDKRole** for automated deployments

**Files:**
- `infra/lib/infra-stack.ts` - Main CDK stack definition

### 2. MCP Plugin Fix ✅

- Identified missing `KRISP_USER_ID` in Claude Desktop config
- Added user ID `usr_admin_001` to config
- Fixed `VECTOR_BUCKET` environment variable
- Verified MCP server now connects successfully

**Files:**
- `~/Library/Application Support/Claude/claude_desktop_config.json`

### 3. Documentation Updates ✅

- Updated `README.md` with new Quick Start flow, MCP tools, pricing
- Updated `CHANGELOG.md` with v1.4.0 release notes
- Updated `website/changelog.html` with v1.4.0 features
- Updated `CLAUDE.md` to reflect CDK architecture

### 4. SaaS-Only Transition ✅

Converted from self-hosted (CloudFormation) to SaaS-only model:

| File | Changes |
|------|---------|
| `website/install.sh` | Now MCP-only installer (no AWS deployment) |
| `website/install.html` | New 3-step SaaS flow (sign up → install MCP → configure Krisp) |
| `website/index.html` | Added sign-in button, removed install preview modal |
| `README.md` | Updated installation guide, simplified architecture diagram |

### 5. Bug Filed ✅

- Created **GitHub Issue #100** for transcript date grouping timezone issue

---

## Current Architecture

```
User Flow:
1. Sign up at app.krispy.alpha-pm.dev (Google OAuth)
2. Get User ID + API Key from dashboard
3. Run install.sh to set up MCP server locally
4. Configure Krisp webhook with API key
5. Transcripts auto-sync to Keep It Krispy cloud

Infrastructure (AWS):
├── S3: krisp-transcripts-754639201213 (raw JSON)
├── S3: krisp-vectors-754639201213 (embeddings)
├── DynamoDB: 8 tables (transcripts, entities, relationships, etc.)
├── Lambda: 4 functions (webhook, processor, briefing, enrichment)
├── EventBridge: Daily schedules (7am briefings, 2am enrichment)
├── Amplify: Web dashboard
└── CloudFront: Marketing site
```

---

## Suggested Next Steps

### High Priority

#### 1. Speaker Bio Enrichment Improvements
**Issue:** Confidence scores are too low for correct matches (David Winter shows 30%)

**Tasks:**
- [ ] Pass actual speaker dialogue to `validateWebResult()` for better context
- [ ] Update entity table after enrichment (currently only updates `krisp-speakers`)
- [ ] Create company entity and `works_at` relationship when company found
- [ ] Improve source display in UI (show full URLs, not just domains)

**Files:** `src/app/api/speakers/[name]/enrich/route.ts`, `src/app/speakers/[name]/page.tsx`

#### 2. Auto-Trigger Enrichment on Entity Creation
**Issue:** Creating "Scott Kohler" from "Speaker 3" doesn't trigger enrichment

**Tasks:**
- [ ] Fire async enrichment call after `createSpeakerEntity()` in transcripts API
- [ ] Non-blocking with 5s timeout

**Files:** `src/app/api/transcripts/route.ts`

#### 3. Fix Date Grouping Bug (#100)
**Issue:** Transcripts grouped by wrong date (timezone issue)

**Tasks:**
- [ ] Investigate date handling in transcript list
- [ ] Ensure consistent timezone (UTC vs local)

### Medium Priority

#### 4. Deploy Speaker Enrichment Lambda
**Status:** CloudFormation has placeholder, need to deploy actual code

**Tasks:**
- [ ] Write `lambda/speaker-enrichment/handler.py`
- [ ] Deploy to AWS
- [ ] Verify EventBridge trigger works at 2am UTC

#### 5. Deploy Morning Briefing Lambda
**Status:** CloudFormation has placeholder, need to deploy actual code

**Tasks:**
- [ ] Write `lambda/morning-briefing/handler.py`
- [ ] Deploy to AWS
- [ ] Verify EventBridge trigger works at 7am UTC

#### 6. Settings Page - Webhook Configuration
**Issue:** Users need to get API key and webhook URL from dashboard

**Tasks:**
- [ ] Add API key display/generation to `/settings`
- [ ] Show webhook URL on settings page
- [ ] Add "Copy" buttons for easy configuration

### Low Priority

#### 7. GitHub Actions CI/CD
**Status:** OIDC role created, workflows exist but need testing

**Tasks:**
- [ ] Test `cdk-deploy.yml` workflow on push to main
- [ ] Test `cdk-drift-detection.yml` daily job
- [ ] Add workflow status badges to README

#### 8. Remove Self-Hosted Artifacts
Now that we're SaaS-only:

**Tasks:**
- [ ] Archive or remove `cloudformation.yaml` (or keep for reference)
- [ ] Remove `cloudformation-admin.yaml`
- [ ] Clean up `iam-policy.json`

#### 9. Onboarding Flow
**Tasks:**
- [ ] First-time user welcome screen
- [ ] Guided Krisp webhook setup with screenshots
- [ ] "Test webhook" button to verify connection

---

## Files Changed This Session

| File | Status |
|------|--------|
| `infra/lib/infra-stack.ts` | Modified (import existing resources, add GitHub OIDC) |
| `README.md` | Modified (SaaS flow, simplified architecture) |
| `CHANGELOG.md` | Modified (v1.4.0 release notes) |
| `CLAUDE.md` | Modified (CDK architecture) |
| `website/install.sh` | Rewritten (MCP-only installer) |
| `website/install.html` | Rewritten (SaaS onboarding flow) |
| `website/index.html` | Modified (sign-in button, removed preview modal) |
| `website/changelog.html` | Modified (v1.4.0 section) |

---

## Key URLs

| Resource | URL |
|----------|-----|
| Marketing Site | https://krispy.alpha-pm.dev |
| Dashboard | https://app.krispy.alpha-pm.dev |
| GitHub | https://github.com/dwinter3/keep-it-krispy |
| Webhook | https://uuv3kmdcsulw2voxcvppbhyul40jfdio.lambda-url.us-east-1.on.aws/ |

---

## Commands Reference

```bash
# Deploy marketing site
aws s3 sync website/ s3://keepitkrispy-website/ --profile krisp-buddy --delete
aws cloudfront create-invalidation --distribution-id E29BWHIS0Y6I7T --paths "/*" --profile krisp-buddy

# Deploy CDK
cd infra && npx cdk deploy --profile krisp-buddy

# Deploy dashboard (auto on push)
git push origin main

# View Lambda logs
aws logs tail /aws/lambda/krisp-transcript-processor --profile krisp-buddy --follow
```

# Keep It Krispy - Claude Code Context

## Project Vision

**Keep It Krispy** transforms meeting transcripts into a **living knowledge graph** that connects people, companies, topics, content, and opportunities - giving users total recall of every professional interaction.

**Master Plan:** GitHub Issue #95 (Full Product Roadmap)
**Phase 1 Plan:** GitHub Issue #94 (Secure SaaS + Knowledge Graph Foundation)

## URLs & Access

| Environment | URL | Platform |
|-------------|-----|----------|
| Marketing Site | https://krispy.alpha-pm.dev | S3 + CloudFront |
| SaaS Dashboard | https://app.krispy.alpha-pm.dev | AWS Amplify |
| Amplify Default | https://main.dh65gpsgmkx3x.amplifyapp.com | AWS Amplify |
| Webhook Endpoint | https://uuv3kmdcsulw2voxcvppbhyul40jfdio.lambda-url.us-east-1.on.aws/ | Lambda URL |
| MCP Server | https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/ | Lambda URL |
| GitHub | https://github.com/dwinter3/keep-it-krispy | GitHub |

## AWS Configuration

**AWS CLI Profile**: `krisp-buddy`
**Region**: `us-east-1`
**Account ID**: `754639201213`

Always use this profile for AWS commands:
```bash
aws <command> --profile krisp-buddy --region us-east-1
```

### S3 Buckets

| Bucket | Purpose |
|--------|---------|
| `krisp-transcripts-754639201213` | Raw transcript JSON files |
| `krisp-vectors-754639201213` | Vector embeddings (S3 Vectors) |
| `krisp-audio-754639201213` | Meeting audio files for voice print processing |
| `keepitkrispy-website` | Marketing site static files |

### DynamoDB Tables

| Table | Purpose | PK |
|-------|---------|-----|
| `krisp-transcripts-index` | Transcript metadata | `meeting_id` |
| `krisp-speakers` | Speaker profiles | `name` |
| `krisp-entities` | Knowledge graph entities | `entity_id` |
| `krisp-relationships` | Knowledge graph edges | `relationship_id` |
| `krisp-documents` | Files/artifacts | `document_id` |
| `krisp-users` | Platform users | `user_id` |
| `krisp-api-keys` | User API keys | `api_key` |
| `krisp-email-mapping` | Email → user mapping | `email` |
| `krisp-briefings` | Morning briefings | `briefing_id` |
| `krisp-invites` | User invitations | `invite_token` |
| `krisp-audit-logs` | Audit trail | `log_id` |
| `krisp-companies` | Company entities | `id` |
| `krisp-voice-prints` | Speaker voice embeddings | `voice_print_id` |

### Lambda Functions

| Function | Runtime | Purpose |
|----------|---------|---------|
| `krisp-webhook-receiver` | Python 3.12 | Receives Krisp webhooks |
| `krisp-transcript-processor` | Python 3.12 | Processes transcripts, generates embeddings |
| `krisp-buddy-morning-briefing` | Python 3.12 | Daily briefing generation (7am UTC) |
| `krisp-buddy-speaker-enrichment` | Python 3.12 | Speaker bio enrichment (2am UTC) |
| `krisp-mcp-server` | Node.js 20.x | MCP server for Claude integration |
| `krisp-voice-print-processor` | Python 3.12 | Speaker diarization & voice print extraction |

### CloudWatch Log Groups

| Log Group | Source |
|-----------|--------|
| `/aws/lambda/krisp-webhook-receiver` | Webhook Lambda |
| `/aws/lambda/krisp-transcript-processor` | Processor Lambda |
| `/aws/lambda/krisp-mcp-server` | MCP Server Lambda |
| `/aws/amplify/dh65gpsgmkx3x` | Amplify builds |

### Other AWS Resources

| Resource | ID/Name |
|----------|---------|
| Amplify App | `dh65gpsgmkx3x` |
| CloudFormation Stack | `krisp-buddy` |
| CloudFront Distribution | `E29BWHIS0Y6I7T` |
| CloudFront Domain | `d2jyxueb2eip8f.cloudfront.net` |
| Route 53 Hosted Zone | `Z03566341KPFWJ5LEPWSY` (krispy.alpha-pm.dev) |
| Vector Index | `transcript-chunks` |

## DNS & Cloudflare

**Domain**: `krispy.alpha-pm.dev` (subdomain of alpha-pm.dev)
**DNS Provider**: Route 53 (hosted zone in AWS)
**Parent Domain**: `alpha-pm.dev` (managed in Cloudflare)

| Subdomain | Target |
|-----------|--------|
| `krispy.alpha-pm.dev` | CloudFront `d2jyxueb2eip8f.cloudfront.net` |
| `app.krispy.alpha-pm.dev` | Amplify (CNAME to Amplify domain) |

## Architecture

### Data Flow
```
Krisp App → Webhook Lambda → S3 (raw JSON)
                                   ↓
                           Processor Lambda
                                   ↓
                    ┌──────────────┼──────────────┐
                    ↓              ↓              ↓
               DynamoDB      S3 Vectors      Bedrock
              (metadata)    (embeddings)   (AI analysis)
                    ↓              ↓
                    └──────────────┼──────────────┘
                                   ↓
                           Next.js Dashboard
                                   ↓
                              MCP Server → Claude
```

### Authentication
- NextAuth.js with Google OAuth provider
- User isolation via `user_id` field in all tables
- Session-based auth for API routes (`auth()` from `@/lib/auth`)

## Deployment Commands

### Deploy Marketing Site (S3 + CloudFront)
```bash
aws s3 sync website/ s3://keepitkrispy-website/ --profile krisp-buddy --region us-east-1 --delete
aws cloudfront create-invalidation --distribution-id E29BWHIS0Y6I7T --paths "/*" --profile krisp-buddy --region us-east-1
```

### Deploy SaaS Dashboard (Amplify)
```bash
git push origin main
aws amplify start-job --app-id dh65gpsgmkx3x --branch-name main --job-type RELEASE --profile krisp-buddy --region us-east-1
```

### Deploy Infrastructure (CDK)

Infrastructure is managed via AWS CDK in the `infra/` directory. CDK auto-deploys on push to `main` via GitHub Actions.

```bash
# Manual deployment
cd infra && npx cdk deploy --profile krisp-buddy

# Check for drift
cd infra && npx cdk diff --profile krisp-buddy

# Synthesize CloudFormation template
cd infra && npx cdk synth
```

**GitHub Actions Workflows:**
- `cdk-deploy.yml` - Auto-deploys on push to `main` (when `infra/` or `lambda/` changes)
- `cdk-drift-detection.yml` - Daily drift check at 6am UTC, creates issue if drift detected

### Deploy Lambda Functions
```bash
# Processor Lambda
cd lambda/processor && zip -r function.zip handler.py requirements.txt
aws lambda update-function-code --function-name krisp-transcript-processor --zip-file fileb://function.zip --profile krisp-buddy --region us-east-1

# Webhook Lambda
cd lambda && zip handler.zip handler.py
aws lambda update-function-code --function-name krisp-webhook-receiver --zip-file fileb://handler.zip --profile krisp-buddy --region us-east-1

# MCP Server (TypeScript)
cd lambda/mcp-server-ts && npm run build:stdio
# Then rebuild and deploy via CDK or update function code directly
```

## CloudWatch Logs

### Viewing Logs
```bash
# Tail processor logs (live)
aws logs tail /aws/lambda/krisp-transcript-processor --profile krisp-buddy --region us-east-1 --follow

# Tail webhook logs
aws logs tail /aws/lambda/krisp-webhook-receiver --profile krisp-buddy --region us-east-1 --follow

# Search for errors in last hour
aws logs filter-log-events --log-group-name /aws/lambda/krisp-transcript-processor --filter-pattern "ERROR" --start-time $(date -v-1H +%s)000 --profile krisp-buddy --region us-east-1
```

### TODO: Common Logging Function
Create a shared logging utility that all Lambdas and API routes use:
- Structured JSON logging
- Correlation IDs across services
- Log levels (DEBUG, INFO, WARN, ERROR)
- Automatic context (user_id, request_id, function_name)
- CloudWatch Insights compatible format

See Issue #84 (Audit Logging Pipeline) for implementation.

## Project Documentation

| Document | Purpose |
|----------|---------|
| `docs/phase1-prd-v2.md` | Phase 1 Product Requirements |
| `docs/entity-relationship-model.md` | Knowledge graph data model spec |
| `docs/permissions-tenancy-spec.md` | Sharing & ownership rules |
| `docs/soc2-type2-readiness.md` | Compliance requirements |
| `docs/dynamics-integration-mvp.md` | Future CRM integration |

## GitHub Workflow

### Repository
- **Repo**: `dwinter3/keep-it-krispy`
- **Main Branch**: `main` (production)
- **Issues**: GitHub Issues for backlog

### Commit Messages
Always include co-author when Claude helps:
```
<summary>

<description>

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
```

### Issue Management

**Reference Issues:**
- #95 - Full Product Roadmap (all phases)
- #94 - Phase 1 Master Plan

**When completing work:**
1. Update the relevant issue with a comment summarizing:
   - What was implemented
   - Files changed
   - Test results (automated and manual)
   - Any follow-up needed
2. Check off completed items in epic checklists
3. Close issues when fully complete
4. Reference commits in issue comments

**Creating Issues:**
```bash
gh issue create --title "Title" --body "Description"
gh issue list --state open
gh issue close <number> --comment "Completed in commit abc123"
```

## Parallel Development

### Git Worktrees
Use worktrees to work on multiple features simultaneously without branch switching:

```bash
# Create a worktree for a feature branch
git worktree add ../krisp-buddy-feature-name feature/feature-name

# List worktrees
git worktree list

# Remove worktree when done
git worktree remove ../krisp-buddy-feature-name
```

**Worktree naming convention:** `krisp-buddy-<issue-number>` or `krisp-buddy-<feature-name>`

### Subagents for Parallel Work
When multiple independent tasks can be done simultaneously, use the Task tool to spawn subagents:

```
Example: Need to create 3 DynamoDB tables (#90, #91, #92)
- These are independent and can be done in parallel
- Spawn 3 subagents, each handling one table
- Each subagent updates cloudformation.yaml (coordinate to avoid conflicts)
- Or: one subagent per table's TypeScript types while another does CloudFormation
```

**When to use parallel subagents:**
- Independent infrastructure changes (different tables, different Lambdas)
- Research tasks (exploring different parts of codebase)
- Testing multiple things simultaneously
- Creating multiple GitHub issues

**When NOT to parallelize:**
- Changes to the same file (will conflict)
- Sequential dependencies (B depends on A completing)
- Database migrations that must be ordered

### Parallel Development Strategy

For large features, break work into parallel tracks:

```
Track A: Infrastructure     Track B: Backend          Track C: Frontend
─────────────────────────   ─────────────────────     ─────────────────
CloudFormation tables       API routes                UI components
Lambda updates              TypeScript types          Pages
DynamoDB indexes            Utility functions         State management
```

**Coordination:**
- Use feature branches for large changes
- Merge infrastructure first, then backend, then frontend
- Run `npm run build` after merging to catch integration issues

## Automated Testing

### Philosophy
- **Automate everything possible** - don't ask human for UI testing unless necessary
- **Test before deploying** - run tests locally, verify in logs
- **Log test results in issues** - document what was tested

### Build Validation
```bash
# Always run before deploying
npm run build

# Check for TypeScript errors
npx tsc --noEmit
```

### Lambda Testing
```bash
# Test Lambda locally with sample event
cd lambda/processor
python -c "
import json
from handler import handler
event = {'Records': [{'s3': {'bucket': {'name': 'test'}, 'object': {'key': 'test.json'}}}]}
print(handler(event, None))
"

# Invoke Lambda with test payload
aws lambda invoke --function-name krisp-transcript-processor \
  --payload '{"test": true}' \
  --profile krisp-buddy --region us-east-1 \
  output.json && cat output.json
```

### API Testing
```bash
# Test API endpoints (requires running dev server or deployed)
# Health check
curl -s https://app.krispy.alpha-pm.dev/api/transcripts | head -100

# Test with auth (get cookie from browser)
curl -s -H "Cookie: <session-cookie>" https://app.krispy.alpha-pm.dev/api/transcripts
```

### Integration Testing
```bash
# Verify DynamoDB after changes
aws dynamodb scan --table-name krisp-transcripts-index \
  --max-items 5 --profile krisp-buddy --region us-east-1

# Verify S3 objects
aws s3 ls s3://krisp-transcripts-754639201213/ --profile krisp-buddy --region us-east-1 | tail -10

# Check CloudWatch for errors after deployment
aws logs filter-log-events \
  --log-group-name /aws/lambda/krisp-transcript-processor \
  --filter-pattern "ERROR" \
  --start-time $(date -v-5M +%s)000 \
  --profile krisp-buddy --region us-east-1
```

### Test Checklist for PRs
Before marking work complete:
- [ ] `npm run build` passes
- [ ] No TypeScript errors
- [ ] Lambda tested locally or invoked successfully
- [ ] API endpoints return expected responses
- [ ] CloudWatch logs show no errors
- [ ] DynamoDB data looks correct
- [ ] UI works (if applicable - test in browser)

## Project Structure

```
├── infra/                       # AWS CDK infrastructure
│   ├── bin/infra.ts             # CDK app entry point
│   ├── lib/infra-stack.ts       # Main infrastructure stack
│   └── package.json             # CDK dependencies
├── .github/workflows/           # GitHub Actions
│   ├── cdk-deploy.yml           # Auto-deploy on push
│   └── cdk-drift-detection.yml  # Daily drift check
├── docs/                        # Specifications and planning
│   ├── phase1-prd-v2.md
│   ├── entity-relationship-model.md
│   ├── permissions-tenancy-spec.md
│   └── ...
├── lambda/
│   ├── handler.py               # Webhook receiver
│   ├── processor/               # Transcript processor
│   ├── morning-briefing/        # Daily briefing Lambda
│   ├── speaker-enrichment/      # Bio enrichment Lambda
│   └── mcp-server-ts/           # MCP server (TypeScript)
├── website/                     # Marketing site (S3)
├── scripts/                     # Maintenance scripts
├── src/                         # Next.js dashboard
│   ├── app/
│   │   ├── api/                 # API routes
│   │   ├── transcripts/         # Transcript pages
│   │   ├── speakers/            # Speaker pages
│   │   ├── topics/              # Topic pages
│   │   ├── companies/           # Company pages
│   │   ├── documents/           # Document library
│   │   ├── search/              # Search page
│   │   └── settings/            # Settings
│   ├── components/              # React components
│   └── lib/                     # Utilities
│       ├── auth.ts              # NextAuth config
│       ├── users.ts             # User management
│       └── tenant.ts            # Multi-tenant isolation
└── CLAUDE.md                    # This file
```

## API Endpoints

### Transcripts
- `GET /api/transcripts` - List (cursor pagination)
- `GET /api/transcripts/[id]` - Get by ID
- `PATCH /api/transcripts/[id]` - Update
- `DELETE /api/transcripts/[id]` - Delete (cascades)
- `POST /api/transcripts/bulk` - Bulk operations
- `POST /api/transcripts/[id]/summarize` - Generate AI summary

### Speakers
- `GET /api/speakers` - List all
- `GET /api/speakers/[name]` - Get profile
- `POST /api/speakers/[name]/enrich` - Bio enrichment
- `GET /api/speakers/[name]/context` - AI context

### Other
- `GET /api/topics` - List topics
- `GET /api/companies` - List companies
- `GET /api/documents` - List documents
- `GET /api/search?q=<query>` - Semantic search
- `GET/POST /api/settings/api-keys` - API key management

## Environment Variables

Required in `.env.local`:
```
NEXTAUTH_SECRET=<secret>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
KRISP_S3_BUCKET=krisp-transcripts-754639201213
VECTOR_BUCKET=krisp-vectors-754639201213
VECTOR_INDEX=transcript-chunks
DYNAMODB_TABLE=krisp-transcripts-index
SPEAKERS_TABLE=krisp-speakers
APP_REGION=us-east-1
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
```

## Build & Development

```bash
npm install              # Install dependencies
npm run dev              # Local dev server (http://localhost:3000)
npm run build            # Production build (ALWAYS run before deploy)
npm run lint             # Run linter
```

## Quick Reference

```bash
# Deploy everything after changes
npm run build && git add -A && git commit -m "message" && git push origin main

# Check Amplify build status
aws amplify list-jobs --app-id dh65gpsgmkx3x --branch-name main --profile krisp-buddy --region us-east-1 --max-items 1

# View recent Lambda errors
aws logs filter-log-events --log-group-name /aws/lambda/krisp-transcript-processor --filter-pattern "ERROR" --start-time $(date -v-1H +%s)000 --profile krisp-buddy --region us-east-1

# List open issues
gh issue list --repo dwinter3/keep-it-krispy --state open
```

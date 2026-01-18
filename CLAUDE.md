# Keep It Krispy - Claude Code Context

## Project Overview

**Keep It Krispy** (repo: `krisp-buddy`) - AI-powered meeting memory that turns Krisp transcripts into a searchable knowledge base for Claude.

- **Marketing Site**: https://krispy.alpha-pm.dev (S3 + CloudFront)
- **SaaS Dashboard**: https://app.krispy.alpha-pm.dev (AWS Amplify)
- **GitHub**: https://github.com/dwinter3/keep-it-krispy

## Architecture

### Data Flow
1. **Krisp** sends webhook with transcript data to API Gateway
2. **Lambda (handler.py)** receives webhook, stores raw JSON in S3
3. **S3 Event** triggers **Processor Lambda** which:
   - Parses transcript content
   - Generates embeddings via Bedrock
   - Stores vectors in S3 Vectors for semantic search
   - Updates DynamoDB index with metadata
4. **MCP Server** (Lambda) provides Claude with tools to search/query transcripts
5. **Next.js Dashboard** (Amplify) provides web UI for browsing transcripts

### Authentication
- NextAuth.js with Google OAuth provider
- User isolation via `user_id` field in DynamoDB
- Session-based auth for API routes (`auth()` from `@/lib/auth`)

## AWS Configuration

**AWS CLI Profile**: `krisp-buddy`
**Region**: `us-east-1`
**Account ID**: `754639201213`

Always use this profile for AWS commands:
```bash
aws <command> --profile krisp-buddy --region us-east-1
```

### Key Resources

| Resource | Name/ID |
|----------|---------|
| **SaaS Dashboard** | |
| Amplify App | `dh65gpsgmkx3x` |
| DynamoDB Table | `krisp-transcripts-index` |
| S3 Transcripts | `krisp-transcripts-754639201213` |
| S3 Vectors | `krisp-vectors-754639201213` |
| Vector Index | `transcript-chunks` |
| CloudFormation Stack | `krisp-buddy` |
| **Marketing Site** | |
| S3 Bucket | `keepitkrispy-website` |
| CloudFront Distribution | `E29BWHIS0Y6I7T` |
| CloudFront Domain | `d2jyxueb2eip8f.cloudfront.net` |

### Useful AWS Commands

```bash
# Check DynamoDB table
aws dynamodb scan --table-name krisp-transcripts-index --profile krisp-buddy --region us-east-1 | head -50

# List S3 transcripts
aws s3 ls s3://krisp-transcripts-754639201213/ --profile krisp-buddy --region us-east-1

# Query vectors (requires s3vectors CLI)
aws s3vectors list-vectors --vector-bucket-name krisp-vectors-754639201213 --index-name transcript-chunks --profile krisp-buddy --region us-east-1

# Check Amplify build status
aws amplify list-jobs --app-id dh65gpsgmkx3x --branch-name main --profile krisp-buddy --region us-east-1

# View Lambda logs
aws logs tail /aws/lambda/krisp-buddy-processor --profile krisp-buddy --region us-east-1 --follow
```

## Deployment

### Deploy Marketing Site (S3 + CloudFront)
```bash
# Sync website folder to S3
aws s3 sync website/ s3://keepitkrispy-website/ --profile krisp-buddy --region us-east-1 --delete

# Invalidate CloudFront cache (required for changes to appear)
aws cloudfront create-invalidation --distribution-id E29BWHIS0Y6I7T --paths "/*" --profile krisp-buddy --region us-east-1
```

### Deploy SaaS Dashboard (Amplify)
```bash
git push origin main
aws amplify start-job --app-id dh65gpsgmkx3x --branch-name main --job-type RELEASE --profile krisp-buddy --region us-east-1
```

### Deploy Infrastructure (CloudFormation)
```bash
aws cloudformation deploy --template-file cloudformation.yaml --stack-name krisp-buddy --capabilities CAPABILITY_NAMED_IAM --profile krisp-buddy --region us-east-1
```

### Deploy Processor Lambda
```bash
cd lambda/processor
zip -r ../processor.zip .
aws lambda update-function-code --function-name krisp-buddy-processor --zip-file fileb://../processor.zip --profile krisp-buddy --region us-east-1
```

## GitHub Workflow

- **Repository**: `dwinter3/keep-it-krispy`
- **Main Branch**: `main` (production)
- **Issues**: GitHub Issues for backlog and bug tracking
- **Commits**: Include `Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>` when Claude helps

### Creating Issues
```bash
gh issue create --title "Title" --body "Description"
gh issue list
gh issue view <number>
```

## Project Structure

```
├── cloudformation.yaml          # AWS infrastructure (Lambda, API Gateway, S3, DynamoDB)
├── lambda/
│   ├── handler.py               # Webhook receiver Lambda
│   ├── processor/               # S3 event processor (embeddings, vectors)
│   ├── mcp-server/              # MCP server for Claude (Python)
│   └── mcp-server-ts/           # MCP server for Claude (TypeScript)
├── website/                     # Marketing site (S3 → krispy.alpha-pm.dev)
├── scripts/                     # Backfill and maintenance scripts
├── src/                         # Next.js web dashboard
│   ├── app/
│   │   ├── api/                 # API routes (see below)
│   │   ├── transcripts/         # Transcript browser
│   │   ├── transcripts/private/ # Private transcripts view
│   │   ├── speakers/            # Speakers directory
│   │   ├── speakers/[name]/     # Speaker profile pages
│   │   ├── topics/              # Topics overview
│   │   ├── topics/[topic]/      # Topic detail pages
│   │   ├── companies/           # Companies directory
│   │   ├── documents/           # Document library
│   │   ├── search/              # Semantic search
│   │   ├── settings/            # User settings (API keys)
│   │   ├── upload/              # Manual upload
│   │   └── login/               # Auth page
│   ├── components/              # React components
│   │   ├── Shell.tsx            # Main layout wrapper
│   │   ├── ChatTranscript.tsx   # Chat bubble transcript view
│   │   ├── SpeakerTalkTime.tsx  # Talk time visualization
│   │   └── ...
│   └── lib/                     # Utilities
│       ├── auth.ts              # NextAuth configuration
│       ├── users.ts             # User management (DynamoDB)
│       ├── tenant.ts            # Multi-tenant isolation
│       ├── transcriptParser.ts  # Parse raw transcript text
│       └── documentParser.ts    # Parse uploaded documents
└── infra/                       # Infrastructure config files
```

## API Endpoints

### Transcripts
- `GET /api/transcripts` - List transcripts (cursor pagination)
  - Query: `cursor`, `limit`, `key` (fetch specific), `action=stats`
- `GET /api/transcripts/[id]` - Get transcript by meeting ID
- `PATCH /api/transcripts/[id]` - Update transcript (privacy, dismiss warning)
- `DELETE /api/transcripts/[id]` - Delete transcript (cascades to S3, vectors)
- `POST /api/transcripts/bulk` - Bulk operations
  - Body: `{ action: 'delete' | 'markPrivate', meetingIds: string[] }`

### Speakers
- `GET /api/speakers` - List all speakers with stats
- `GET /api/speakers/[name]` - Get speaker profile
- `POST /api/speakers/[name]/enrich` - Trigger bio enrichment
- `GET /api/speakers/[name]/context` - Get speaker context for AI

### Other
- `GET /api/topics` - List topics with meeting counts
- `GET /api/companies` - List companies
- `GET /api/companies/[id]` - Get company details
- `GET /api/documents` - List documents
- `POST /api/documents/import-url` - Import document from URL
- `GET /api/search` - Semantic search across transcripts
- `GET /api/settings/api-keys` - Get user API key status
- `POST /api/settings/api-keys` - Save API keys

## Key Features

### Transcript Management
- Browse transcripts with date/speaker filters
- Multi-select with bulk delete/mark private
- Privacy detection (AI-classified private content warnings)
- Chat bubble view with speaker talk time stats

### Speaker Management
- Auto-extracted speaker directory
- Speaker corrections (rename misidentified speakers)
- Bio enrichment via web search
- LinkedIn profile linking
- Speaker profile pages with meeting history

### Topic Analysis
- AI-generated topic classification
- Topic-based transcript grouping
- Topic detail pages

## Build & Test

```bash
npm install              # Install dependencies
npm run dev              # Local dev server (http://localhost:3000)
npm run build            # Production build
npm run lint             # Run linter
```

## Environment Variables

Required in `.env.local` for local development:
```
NEXTAUTH_SECRET=<secret>
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
KRISP_S3_BUCKET=krisp-transcripts-754639201213
VECTOR_BUCKET=krisp-vectors-754639201213
VECTOR_INDEX=transcript-chunks
DYNAMODB_TABLE=krisp-transcripts-index
APP_REGION=us-east-1
S3_ACCESS_KEY_ID=<access-key>
S3_SECRET_ACCESS_KEY=<secret-key>
```

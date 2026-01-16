# Keep It Krispy - Claude Code Context

## Project Overview

**Keep It Krispy** (repo: `krisp-buddy`) - AI-powered meeting memory that turns Krisp transcripts into a searchable knowledge base for Claude.

- **Website**: https://krispy.alpha-pm.dev
- **Web Dashboard**: https://main.dh65gpsgmkx3x.amplifyapp.com
- **GitHub**: https://github.com/dwinter3/keep-it-krispy

## Development Workflow

- **Version Control**: GitHub (`dwinter3/keep-it-krispy`)
- **Backlog**: GitHub Issues - check issues for planned work and bugs
- **Main Branch**: `main` - production deployments trigger from here

## AWS Configuration

**AWS CLI Profile**: `krisp-buddy`

Always use this profile for AWS commands:
```bash
aws <command> --profile krisp-buddy --region us-east-1
```

### Key Resources
- **Amplify App ID**: `dh65gpsgmkx3x`
- **DynamoDB Table**: `krisp-transcripts-index`
- **S3 Buckets**: `krisp-transcripts-{account-id}`, `krisp-vectors-{account-id}`
- **Region**: `us-east-1`

### Deployment Commands

**Deploy to Amplify**:
```bash
git push origin main
aws amplify start-job --app-id dh65gpsgmkx3x --branch-name main --job-type RELEASE --profile krisp-buddy --region us-east-1
```

**Deploy CloudFormation**:
```bash
aws cloudformation deploy --template-file cloudformation.yaml --stack-name krisp-buddy --capabilities CAPABILITY_NAMED_IAM --profile krisp-buddy --region us-east-1
```

## Project Structure

```
├── cloudformation.yaml        # AWS infrastructure
├── lambda/
│   ├── mcp-server-ts/         # MCP server for Claude
│   └── processor/             # S3 event processor (embeddings)
├── website/                   # Static website (krispy.alpha-pm.dev)
├── scripts/                   # Backfill and maintenance scripts
├── src/                       # Next.js web dashboard
└── infra/                     # Infrastructure config files
```

## Build & Test

```bash
npm install
npm run build          # Build Next.js app
npm run dev            # Local development server
```

# Keep It Krispy

**AI-Powered Meeting Memory** — Turn your Krisp transcripts into a searchable knowledge base for Claude.

🌐 **Website:** [krispy.alpha-pm.dev](https://krispy.alpha-pm.dev)

```bash
# One-line install (deploys to your AWS account)
curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash
```

---

## What It Does

Every Krisp call is automatically captured, indexed, and made searchable by Claude:

- **"What was my last meeting about?"** — Instant recall of any conversation
- **"What did Ken commit to?"** — Extract action items and commitments
- **"Find meetings where we discussed budget"** — Semantic search across all your calls
- **"Summarize my calls with Sarah this week"** — AI-powered synthesis

The whole thing runs as an MCP server, so Claude treats your meeting history like a native tool.

---

## The Stack

```
Krisp App → Webhook Lambda → S3 (raw JSON) → DynamoDB (instant writes)
                                   ↓
                           S3 Event Trigger
                                   ↓
                          Processing Lambda
                                   ↓
                   ┌───────────────┼───────────────┐
                   ↓               ↓               ↓
              DynamoDB      Bedrock Titan      S3 Vectors
             (metadata)     (embeddings)    (semantic index)
                   └───────────────┴───────────────┘
                                   ↓
                        MCP Server (stdio)
                                   ↓
                   ┌───────────────┴───────────────┐
                   ↓                               ↓
            Claude Desktop                   Claude Code
```

**Total AWS cost: < $2/month.** No OpenSearch cluster burning $350/month. Pure serverless.

---

## MCP Tools

The MCP server provides three tools to Claude:

| Tool | Description |
|------|-------------|
| `list_transcripts` | List recent meetings with metadata. Filter by date or speaker. |
| `search_transcripts` | Semantic search — find "budget concerns" even if you said "cost overruns" |
| `get_transcripts` | Fetch full transcript content (summary, notes, action items, text) |

---

## Quick Start

### Prerequisites
- [Krisp.ai Pro](https://krisp.ai) with webhook access
- AWS account
- Node.js 18+, Python 3.11+, AWS CLI

### Install

```bash
curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash
```

The installer:
1. Deploys AWS infrastructure (S3, DynamoDB, Lambda)
2. Builds the MCP server locally
3. Prints your webhook URL and MCP config

### Configure Krisp

Add your webhook URL to Krisp:
1. Krisp app → Settings → Integrations → Webhooks
2. Paste the webhook URL from the installer
3. Done — every call is now automatically captured

### Configure Claude

**Claude Desktop** — Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "krisp": {
      "command": "node",
      "args": ["~/keep-it-krispy/lambda/mcp-server-ts/dist/stdio-server.cjs"],
      "env": {
        "AWS_REGION": "us-east-1",
        "KRISP_S3_BUCKET": "krisp-transcripts-{account-id}",
        "DYNAMODB_TABLE": "krisp-transcripts-index",
        "VECTOR_BUCKET": "krisp-vectors-{account-id}",
        "VECTOR_INDEX": "transcript-chunks",
        "AWS_PROFILE": "default"
      }
    }
  }
}
```

**Claude Code**:

```bash
claude mcp add --transport stdio \
  --env AWS_REGION=us-east-1 \
  --env KRISP_S3_BUCKET=krisp-transcripts-{account-id} \
  --env DYNAMODB_TABLE=krisp-transcripts-index \
  --env VECTOR_BUCKET=krisp-vectors-{account-id} \
  --env VECTOR_INDEX=transcript-chunks \
  --scope user \
  krisp -- node ~/keep-it-krispy/lambda/mcp-server-ts/dist/stdio-server.cjs
```

---

## Documentation

- **[Installation Guide](https://krispy.alpha-pm.dev/install.html)** — Full setup walkthrough
- **[MCP Setup](https://krispy.alpha-pm.dev/mcp.html)** — Claude Desktop, Code, and other clients
- **[Examples](https://krispy.alpha-pm.dev/examples.html)** — Real-world usage demos

---

## Project Structure

```
├── cloudformation.yaml        # AWS infrastructure (one-click deploy)
├── lambda/
│   ├── mcp-server-ts/         # MCP server for Claude
│   │   ├── src/
│   │   │   ├── stdio-server.ts
│   │   │   ├── s3-client.ts
│   │   │   ├── dynamo-client.ts
│   │   │   └── vectors-client.ts
│   │   └── dist/
│   │       └── stdio-server.cjs
│   └── processor/             # S3 event processor (embeddings)
├── website/                   # Static website (krispy.alpha-pm.dev)
├── scripts/
│   └── backfill_vectors.py    # Index existing transcripts
└── src/                       # Next.js web dashboard (optional)
```

---

## Cost Breakdown

| Component | Monthly Cost |
|-----------|--------------|
| DynamoDB | Free tier |
| S3 Storage | ~$0.02 |
| S3 Vectors | ~$0.01 |
| Bedrock Embeddings | ~$0.05 (one-time) |
| Lambda | Free tier |
| **Total** | **< $2/month** |

---

## What is Krisp.ai?

[Krisp.ai](https://krisp.ai) is a desktop app that provides real-time transcription for any meeting — Zoom, Teams, Meet, phone calls, anything with audio.

**Why Krisp Pro?** The free tier does transcription, but **webhooks require Pro or Business**. Webhooks are the unlock — they automatically send transcripts to your infrastructure the moment a call ends.

---

## License

MIT — do whatever you want with it.

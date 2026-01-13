# Keep It Krispy

## The Brag

So I built a thing over the weekend. You know how Krisp has that webhook feature for transcripts? I wired it up so every meeting I have automatically flows into Claude's memory.

Now I can literally ask Claude: *"What did Caroline say about the legal docs?"* or *"Summarize my calls from last week"* and it just... knows. Pulls the exact context from my meeting history and gives me a real answer.

The kicker? **Semantic search.** I can search for "budget concerns" and it finds meetings where we talked about "cost overruns" or "we're spending too much" — no keyword matching, actual meaning. I even indexed speaker names into the embeddings so searching "meetings with Brian" works even if his name isn't in the transcript text.

**The stack:**
- Krisp webhook → Lambda → S3 (you guys handle the hard part)
- S3 event trigger → Processing Lambda that chunks transcripts
- Bedrock Titan for embeddings (1024 dimensions, ~$0.05 to index 500 meetings)
- S3 Vectors for similarity search (the new serverless vector DB from AWS — way cheaper than OpenSearch)
- DynamoDB for fast metadata queries
- MCP server so Claude Desktop and Claude Code can query it natively
- Next.js dashboard on Amplify for a web UI

**Total AWS cost: < $2/month.** No OpenSearch cluster burning $350/month. No always-on anything. Pure serverless, pay-per-query.

The whole thing runs as an MCP server, so Claude treats my meeting history like a native tool. I say "find meetings about the Q1 roadmap" and it does a vector similarity search, pulls the relevant chunks, and synthesizes an answer with citations.

Basically turned Krisp into my external brain. Every conversation I have is now permanently searchable and summarizable by AI.

**Would not have been possible without the webhook API.** That's the unlock. Real-time transcript delivery means everything is indexed within seconds of hanging up.

---

## Architecture

```
Krisp App → Webhook Lambda → S3 (raw JSON)
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
                   ┌───────────────┼───────────────┐
                   ↓               ↓               ↓
            Claude Desktop   Claude Code    Next.js Web App
```

## Project Structure

```
├── lambda/
│   ├── handler.py              # Webhook receiver (Krisp → S3)
│   ├── processor/              # S3 event processor
│   │   ├── handler.py          # Chunks transcripts, generates embeddings
│   │   ├── embeddings.py       # Bedrock Titan client
│   │   ├── dynamo.py           # DynamoDB operations
│   │   └── vectors.py          # S3 Vectors operations
│   └── mcp-server-ts/          # MCP server for Claude
│       ├── src/
│       │   ├── stdio-server.ts # Claude Desktop/Code integration
│       │   └── s3-client.ts    # AWS service clients
│       └── dist/
│           └── stdio-server.cjs # Built server
├── src/
│   └── app/                    # Next.js web dashboard
│       ├── api/
│       │   ├── transcripts/    # REST API for transcript list
│       │   └── search/         # Semantic search endpoint
│       ├── transcripts/        # Browse transcripts UI
│       └── search/             # Search UI
├── scripts/
│   └── backfill_vectors.py     # One-time indexing of existing transcripts
└── infra/
    └── dynamodb.json           # Table definition
```

## Setup

### Prerequisites
- AWS account with Bedrock access (Titan embeddings)
- Krisp Pro with webhook access
- Node.js 18+
- Python 3.11+

### Quick Start

1. Deploy the webhook Lambda and point Krisp webhooks at it
2. Create DynamoDB table and S3 Vectors index
3. Deploy the processor Lambda with S3 event trigger
4. Build and configure the MCP server for Claude Desktop/Code
5. (Optional) Deploy Next.js dashboard to Amplify

### Claude Desktop Config

```json
{
  "mcpServers": {
    "krisp": {
      "command": "node",
      "args": ["/path/to/dist/stdio-server.cjs"],
      "env": {
        "AWS_REGION": "us-east-1",
        "KRISP_S3_BUCKET": "your-bucket",
        "DYNAMODB_TABLE": "krisp-transcripts-index",
        "VECTOR_BUCKET": "krisp-vectors",
        "VECTOR_INDEX": "transcript-chunks",
        "AWS_PROFILE": "your-profile"
      }
    }
  }
}
```

### Claude Code Config

```bash
claude mcp add --transport stdio \
  --env AWS_REGION=us-east-1 \
  --env KRISP_S3_BUCKET=your-bucket \
  --env DYNAMODB_TABLE=krisp-transcripts-index \
  --env VECTOR_BUCKET=krisp-vectors \
  --env VECTOR_INDEX=transcript-chunks \
  --env AWS_PROFILE=your-profile \
  --scope user \
  krisp -- node /path/to/dist/stdio-server.cjs
```

## Cost Breakdown (500 transcripts/month)

| Component | Cost |
|-----------|------|
| DynamoDB | Free tier |
| S3 Vectors storage | ~$0.01 |
| S3 Vectors queries | ~$0.01 |
| Bedrock Titan embeddings | ~$0.05 (one-time) |
| Lambda compute | Free tier |
| S3 storage | ~$0.02 |
| **Total** | **< $2/month** |

## License

MIT — do whatever you want with it.

# Keep It Krispy MCP Server

MCP (Model Context Protocol) server that gives Claude access to your Krisp meeting transcripts, speakers, companies, and LinkedIn connections.

Three implementations are available:
- **Stdio Server** - For Claude Desktop (local usage)
- **Lambda Handler** - For remote HTTP access via AWS Lambda
- **Amplify Proxy** - For web dashboard integration (session-based auth)

## Quick Start

### Claude Desktop (Recommended)

1. Build the stdio server:
   ```bash
   cd lambda/mcp-server-ts
   npm install
   npm run build:stdio
   ```

2. Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "krisp": {
         "command": "node",
         "args": ["/path/to/krisp-buddy/lambda/mcp-server-ts/dist/stdio-server.cjs"],
         "env": {
           "KRISP_USER_ID": "your-user-id-from-dashboard",
           "KRISP_API_KEY": "your-api-key-from-dashboard",
           "AWS_PROFILE": "krisp-buddy",
           "AWS_REGION": "us-east-1",
           "KRISP_S3_BUCKET": "krisp-transcripts-754639201213",
           "DYNAMODB_TABLE": "krisp-transcripts-index",
           "VECTOR_BUCKET": "krisp-vectors-754639201213",
           "VECTOR_INDEX": "transcript-chunks"
         }
       }
     }
   }
   ```

   Note: `KRISP_API_KEY` is optional but enables the `semantic_search` tool for API-based search.

3. Restart Claude Desktop

4. Ask Claude: "List my recent meetings" or "Search my transcripts for budget discussions"

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      MCP Clients                             │
├─────────────────────────────────────────────────────────────┤
│  Claude Desktop     Web Dashboard      Third-Party Apps     │
│        │                  │                   │              │
│        ▼                  ▼                   ▼              │
│   ┌─────────┐       ┌──────────┐        ┌─────────┐        │
│   │ Stdio   │       │ Amplify  │        │  HTTP   │        │
│   │ Server  │       │  Proxy   │        │ Direct  │        │
│   └────┬────┘       └────┬─────┘        └────┬────┘        │
│        │                 │                   │              │
│        │                 ▼                   │              │
│        │           ┌───────────┐             │              │
│        │           │  /api/mcp │             │              │
│        │           └─────┬─────┘             │              │
│        │                 │                   │              │
│        │                 ▼                   ▼              │
│        │         ┌────────────────────────────┐             │
│        │         │   Lambda MCP Server        │             │
│        │         │   (Function URL)           │             │
│        │         └────────────────────────────┘             │
│        │                      │                             │
│        ▼                      ▼                             │
│   ┌────────────────────────────────────────────┐           │
│   │           Shared Data Layer                 │           │
│   │  S3 Transcripts  │  DynamoDB  │  S3 Vectors │           │
│   └────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

## When to Use Each Implementation

| Use Case | Implementation | Why |
|----------|---------------|-----|
| Claude Desktop | Stdio Server | Direct communication via stdin/stdout, uses local AWS credentials |
| Claude Code | Stdio Server | Same as Desktop, runs as local process |
| Web integrations | Lambda Handler | HTTP-based, API key auth, deployed to AWS |
| Third-party apps | Lambda Handler | REST API endpoint with proper auth |
| Debugging/testing | Stdio Server | Easier to test locally with logs |

## Available Tools

### Transcript Tools

| Tool | Description |
|------|-------------|
| `list_transcripts` | List recent meetings with metadata (title, date, speakers, duration). Supports filtering by date range or speaker name. |
| `search_transcripts` | Keyword search in transcript content, summary, and notes. |
| `semantic_search` | **NEW** Vector/semantic search using AI embeddings via Keep It Krispy API. Finds conceptually similar content even with different wording. |
| `get_transcripts` | Fetch full transcript content by S3 key. Includes summary, notes, action items. |
| `update_speakers` | Correct speaker names (e.g., "Speaker 2" to "John Smith"). Persists for future fetches. |

### Health & Diagnostics

| Tool | Description |
|------|-------------|
| `test_connection` | **NEW** Health check for all MCP dependencies (S3, DynamoDB, API). Returns latency metrics and status. |

### Knowledge Graph Tools

| Tool | Description |
|------|-------------|
| `list_speakers` | List speaker entities from your knowledge graph with metadata and aliases. |
| `list_companies` | List company entities from your knowledge graph. |
| `get_entity_relationships` | Get relationships between entities (who works where, who mentioned what). |

### LinkedIn Tools

| Tool | Description |
|------|-------------|
| `list_linkedin_connections` | List your imported LinkedIn connections. Can search by name. |
| `match_linkedin_connection` | Match a speaker name to a LinkedIn connection. Returns confidence score and match reason. |
| `get_speaker_context` | Comprehensive speaker info: enriched profile, LinkedIn match, meeting history, knowledge graph entity. |

## Stdio Server Setup (Claude Desktop)

### Prerequisites

- Node.js 20+
- AWS credentials configured (profile: `krisp-buddy`)
- User ID from Keep It Krispy dashboard

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KRISP_USER_ID` | Yes | Your user ID from the Keep It Krispy dashboard settings |
| `AWS_PROFILE` | Yes* | AWS credentials profile (typically `krisp-buddy`) |
| `AWS_REGION` | Yes | AWS region (`us-east-1`) |
| `KRISP_S3_BUCKET` | Yes | S3 bucket for transcripts |
| `DYNAMODB_TABLE` | Yes | DynamoDB table for metadata |
| `VECTOR_BUCKET` | Yes | S3 bucket for vector embeddings |
| `VECTOR_INDEX` | Yes | Vector index name for semantic search |
| `KRISP_API_KEY` | No | API key for `semantic_search` tool (get from dashboard settings) |

*Or use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` directly.

### Authentication

The stdio server uses `KRISP_USER_ID` environment variable for authentication. This is set in your Claude Desktop config and identifies which user's data to access.

Get your user ID from: `https://app.krispy.alpha-pm.dev/settings` (API Keys section)

### Debug Logs

Logs are written to stderr and appear in:
```
~/Library/Logs/Claude/mcp-server-krisp.log
```

View logs:
```bash
tail -f ~/Library/Logs/Claude/mcp-server-krisp.log
```

## Amplify Proxy Setup (Web Dashboard)

The Amplify proxy provides session-based authentication for web clients, eliminating the need for API key management.

### Endpoint

```
https://app.krispy.alpha-pm.dev/api/mcp
```

### How It Works

1. User authenticates via NextAuth (Google OAuth)
2. Proxy looks up user's API key from DynamoDB
3. Proxies request to Lambda MCP endpoint with API key
4. Returns response to client

### Example Request (from web app)

```javascript
const response = await fetch('/api/mcp', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: 'list_transcripts',
      arguments: { limit: 5 }
    },
    id: 1
  })
});
```

### Health Check

```bash
curl https://app.krispy.alpha-pm.dev/api/mcp
# Returns: { "proxy": "healthy", "lambda": { "status": "healthy", ... } }
```

## Lambda Handler Setup (Remote Access)

### Endpoint

```
https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/
```

### Authentication

The Lambda handler accepts API keys via:
- `X-API-Key` header (preferred)
- `Authorization: Bearer <key>` header

Generate an API key from the dashboard: `https://app.krispy.alpha-pm.dev/settings`

### Endpoints

| Path | Method | Description |
|------|--------|-------------|
| `/` or `/mcp/` | POST | MCP JSON-RPC endpoint |
| `/health` | GET | Health check |
| `/auth` | GET | Verify API key validity |

### Example Request

```bash
# List transcripts
curl -X POST https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/ \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "list_transcripts",
      "arguments": {"limit": 5}
    },
    "id": 1
  }'
```

### Verify Authentication

```bash
curl https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/auth \
  -H "X-API-Key: your-api-key"
```

Response:
```json
{
  "authenticated": true,
  "user_id": "abc12345...",
  "auth_source": "api_key",
  "email": "yo***@example.com"
}
```

## Tool Usage Examples

### List Recent Meetings

```json
{
  "name": "list_transcripts",
  "arguments": {
    "limit": 10
  }
}
```

### Search for Discussions About a Topic

```json
{
  "name": "search_transcripts",
  "arguments": {
    "query": "Q4 budget planning and resource allocation"
  }
}
```

### Get Speaker Context Before a Meeting

```json
{
  "name": "get_speaker_context",
  "arguments": {
    "speaker_name": "Sarah Chen"
  }
}
```

Returns:
- Profile: role, company, AI-generated summary
- LinkedIn match: full name, position, company, confidence
- Knowledge graph entity: canonical name, aliases
- Meeting count with this speaker

### Match Speaker to LinkedIn Connection

```json
{
  "name": "match_linkedin_connection",
  "arguments": {
    "speaker_name": "J. Smith",
    "company_hint": "Acme Corp"
  }
}
```

### Correct Speaker Names

```json
{
  "name": "update_speakers",
  "arguments": {
    "meeting_id": "abc123",
    "speaker_mappings": {
      "Speaker 2": {
        "name": "John Smith",
        "linkedin": "https://linkedin.com/in/johnsmith"
      },
      "guy farber": {
        "name": "Guy Farber"
      }
    }
  }
}
```

## Development

### Build Commands

```bash
# Install dependencies
npm install

# Build stdio server (for Claude Desktop)
npm run build:stdio

# Build Lambda handler
npm run build

# Run local dev server (Express-based)
npm run local
```

### Project Structure

```
src/
  stdio-server.ts    # Claude Desktop MCP server
  lambda-handler.ts  # AWS Lambda MCP server
  auth.ts            # Authentication (API key + env var)
  s3-client.ts       # S3 transcript operations
  dynamo-client.ts   # DynamoDB operations (metadata, speakers, LinkedIn)
  vectors-client.ts  # S3 Vectors semantic search
```

### Testing Locally

```bash
# Test stdio server directly
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
  KRISP_USER_ID=your-user-id \
  AWS_PROFILE=krisp-buddy \
  node dist/stdio-server.cjs
```

## Security Notes

- All data is isolated by user ID (multi-tenant)
- Transcripts marked as private are not returned via MCP
- API keys are stored as SHA256 hashes
- Lambda endpoint uses HTTPS only
- CORS is configured for web access

## Troubleshooting

### "Authentication required" Error

- **Stdio**: Ensure `KRISP_USER_ID` is set in your Claude Desktop config
- **Lambda**: Check your API key is valid and not revoked

### No Transcripts Returned

- Verify your user ID owns the transcripts
- Check date range filters
- View debug logs: `~/Library/Logs/Claude/mcp-server-krisp.log`

### AWS Credential Issues

- Ensure `AWS_PROFILE` is set correctly
- Run `aws sts get-caller-identity --profile krisp-buddy` to verify credentials
- Check the profile exists in `~/.aws/credentials`

### Claude Desktop Not Finding Server

- Verify the path in `claude_desktop_config.json` is absolute
- Ensure `dist/stdio-server.cjs` exists (run `npm run build:stdio`)
- Restart Claude Desktop after config changes

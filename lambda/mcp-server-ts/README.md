# Keep It Krispy MCP Server

MCP (Model Context Protocol) server that gives Claude access to your Krisp meeting transcripts, speakers, companies, and LinkedIn connections.

## What is MCP?

MCP (Model Context Protocol) is an open protocol that allows AI assistants like Claude to securely access external data sources and tools. This server implements MCP to give Claude access to your meeting transcripts and related data.

**Key concepts:**
- **Tools**: Functions Claude can call (e.g., `list_transcripts`, `semantic_search`)
- **Transport**: How Claude communicates with the server (stdio for local, HTTP for remote)
- **Authentication**: How the server verifies who you are (user ID or API key)

## Server Implementations

| Implementation | Transport | Auth Method | Use Case |
|----------------|-----------|-------------|----------|
| **Stdio Server** | stdin/stdout | `KRISP_USER_ID` env var | Claude Desktop, Claude Code |
| **Lambda Handler** | HTTP JSON-RPC | API key header | Web apps, third-party integrations |
| **Amplify Proxy** | HTTP (proxied) | Session cookie | Web dashboard |

## Quick Start (Claude Desktop)

1. **Build the server:**
   ```bash
   cd lambda/mcp-server-ts
   npm install
   npm run build:stdio
   ```

2. **Add to Claude Desktop config** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
   ```json
   {
     "mcpServers": {
       "krisp": {
         "command": "node",
         "args": ["/path/to/krisp-buddy/lambda/mcp-server-ts/dist/stdio-server.cjs"],
         "env": {
           "KRISP_USER_ID": "your-user-id",
           "KRISP_API_KEY": "your-api-key",
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

   Get your user ID and API key from: https://app.krispy.alpha-pm.dev/settings

3. **Restart Claude Desktop**

4. **Try it:**
   - "List my recent meetings"
   - "Search my transcripts for budget discussions"
   - "Who is Sarah Chen? Give me context from our meetings"

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        MCP Clients                               │
├─────────────────────────────────────────────────────────────────┤
│   Claude Desktop          Claude Code           Web Dashboard    │
│         │                      │                      │          │
│         ▼                      ▼                      ▼          │
│    ┌─────────┐           ┌─────────┐           ┌──────────┐     │
│    │  Stdio  │           │  Stdio  │           │ Amplify  │     │
│    │ Server  │           │ Server  │           │  Proxy   │     │
│    └────┬────┘           └────┬────┘           └────┬─────┘     │
│         │                     │                     │            │
│         │    Uses local AWS credentials            │            │
│         │    and KRISP_USER_ID env var             ▼            │
│         │                            ┌────────────────────┐     │
│         │                            │  Lambda MCP Server │     │
│         │                            │   (API key auth)   │     │
│         │                            └─────────┬──────────┘     │
│         │                                      │                 │
│         ▼                                      ▼                 │
│    ┌────────────────────────────────────────────────────────┐   │
│    │                    Shared Data Layer                    │   │
│    ├────────────────┬─────────────────┬────────────────────┤   │
│    │ S3 Transcripts │    DynamoDB     │   Keep It Krispy   │   │
│    │  (raw JSON)    │ (metadata, idx) │       API          │   │
│    └────────────────┴─────────────────┴────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Available Tools

### Transcript Tools

| Tool | Description | Auth Required |
|------|-------------|---------------|
| `list_transcripts` | List recent meetings with metadata. Filter by date range or speaker name. | `KRISP_USER_ID` |
| `semantic_search` | AI-powered search using embeddings. Finds conceptually similar content. **Recommended for search.** | `KRISP_API_KEY` |
| `search_transcripts` | Local vector search (requires S3 Vectors setup). Falls back to suggesting `semantic_search`. | `KRISP_USER_ID` |
| `get_transcripts` | Fetch full transcript content by S3 key. Use `summary_only=true` for multiple transcripts. | `KRISP_USER_ID` |
| `update_speakers` | Correct speaker names (e.g., "Speaker 2" → "John Smith"). | `KRISP_USER_ID` |

### Knowledge Graph Tools

| Tool | Description |
|------|-------------|
| `list_speakers` | List speaker entities with metadata and aliases |
| `list_companies` | List company entities from your knowledge graph |
| `get_entity_relationships` | Get relationships between entities (works_at, mentioned, etc.) |

### LinkedIn Tools

| Tool | Description |
|------|-------------|
| `list_linkedin_connections` | List your imported LinkedIn connections |
| `match_linkedin_connection` | Match a speaker name to a LinkedIn connection |
| `get_speaker_context` | Comprehensive speaker info: profile, LinkedIn, meeting history |

## Example Workflows

### 1. Prepare for a meeting with someone

```
User: "I have a meeting with Caroline Cronin tomorrow. What should I know?"

Claude will:
1. Call list_transcripts with speaker="Caroline" to find past meetings
2. Call get_transcripts with summary_only=true to get meeting summaries
3. Call get_speaker_context for Caroline's profile and LinkedIn info
4. Synthesize a briefing with past discussion topics and action items
```

### 2. Search for a topic across all meetings

```
User: "Find discussions about the Q4 budget"

Claude will:
1. Call semantic_search with query="Q4 budget" (if KRISP_API_KEY is set)
   - Returns meetings with relevance scores and matching snippets
2. Or call search_transcripts (falls back to suggesting semantic_search)
3. Optionally call get_transcripts to dive deeper into specific meetings
```

### 3. Correct speaker names after a meeting

```
User: "In my last meeting, Speaker 2 was actually John Smith from Acme Corp"

Claude will:
1. Call list_transcripts to find the most recent meeting
2. Call update_speakers with meeting_id and speaker_mappings:
   {"Speaker 2": {"name": "John Smith"}}
3. Future get_transcripts calls will show "John Smith" instead of "Speaker 2"
```

### 4. Get full meeting details

```
User: "Show me the full transcript from my meeting yesterday"

Claude will:
1. Call list_transcripts with limit=5 to find recent meetings
2. Call get_transcripts with the specific S3 key
   - Returns: title, summary, notes, action_items, speakers, transcript
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `KRISP_USER_ID` | Yes | Your user ID (get from dashboard settings) |
| `KRISP_API_KEY` | Recommended | Enables `semantic_search` tool |
| `AWS_PROFILE` | Yes* | AWS credentials profile |
| `AWS_REGION` | Yes | AWS region (`us-east-1`) |
| `KRISP_S3_BUCKET` | Yes | S3 bucket for transcripts |
| `DYNAMODB_TABLE` | Yes | DynamoDB table for metadata |
| `VECTOR_BUCKET` | Yes | S3 bucket for vectors (may not be set up) |
| `VECTOR_INDEX` | Yes | Vector index name |

*Or use `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` directly.

## Known Limitations

1. **`search_transcripts` may return 0 results** - This tool uses S3 Vectors which may not be configured. Use `semantic_search` instead (requires `KRISP_API_KEY`).

2. **`get_transcripts` can be large** - Fetching multiple full transcripts may exceed token limits. Use `summary_only=true` when fetching multiple transcripts.

3. **Speaker filter is case-insensitive partial match** - `speaker="John"` will match "John Smith", "john doe", etc.

4. **Private transcripts are hidden** - Transcripts marked as private in the dashboard are not accessible via MCP.

## Debugging

### View MCP logs (Claude Desktop)

```bash
tail -f ~/Library/Logs/Claude/mcp-server-krisp.log
```

### Test the server directly

```bash
# List available tools
echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | \
  KRISP_USER_ID=your-user-id \
  AWS_PROFILE=krisp-buddy \
  node dist/stdio-server.cjs

# Call a tool
echo '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_transcripts","arguments":{"limit":3}},"id":2}' | \
  KRISP_USER_ID=your-user-id \
  AWS_PROFILE=krisp-buddy \
  node dist/stdio-server.cjs
```

### Common Issues

| Issue | Solution |
|-------|----------|
| "Authentication required" | Set `KRISP_USER_ID` in your config |
| `semantic_search` not available | Set `KRISP_API_KEY` in your config |
| `search_transcripts` returns 0 | Use `semantic_search` instead |
| "Access denied" on transcript | You don't own that transcript |
| Server not found in Claude | Verify path is absolute, restart Claude |

## Lambda API (Remote Access)

**Endpoint:** `https://eneiq5vwovjqz7ahuwvu3ziwqi0bpttn.lambda-url.us-east-1.on.aws/`

**Authentication:** API key via `X-API-Key` header

```bash
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

## Development

```bash
npm install           # Install dependencies
npm run build:stdio   # Build stdio server (Claude Desktop)
npm run build         # Build Lambda handler
npm run local         # Run local dev server
```

### Project Structure

```
src/
  stdio-server.ts      # Claude Desktop/Code MCP server
  server.ts            # Shared MCP server logic
  lambda-handler.ts    # AWS Lambda MCP server
  auth.ts              # Authentication (API key + env var)
  s3-client.ts         # S3 transcript operations
  dynamo-client.ts     # DynamoDB operations
  vectors-client.ts    # S3 Vectors semantic search
  krispy-api-client.ts # Keep It Krispy API client
```

## Security

- **Multi-tenant isolation**: All queries are filtered by `user_id`
- **Private transcripts**: Not accessible via MCP
- **API keys**: Stored as SHA256 hashes
- **HTTPS only**: Lambda endpoint requires TLS
- **No credential exposure**: Stdio server uses local AWS profile

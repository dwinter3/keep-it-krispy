# Keep It Krispy

**AI-Powered Meeting Memory Platform** — Turn your meeting transcripts into a living knowledge graph that connects people, companies, topics, and opportunities.

🌐 **Website:** [krispy.alpha-pm.dev](https://krispy.alpha-pm.dev)
📊 **Dashboard:** [app.krispy.alpha-pm.dev](https://app.krispy.alpha-pm.dev)

## Quick Start

1. **Sign up:** [app.krispy.alpha-pm.dev](https://app.krispy.alpha-pm.dev)
2. **Install MCP server:**
   ```bash
   curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash
   ```
3. **Configure Krisp webhook** with your API key from the dashboard

---

## What It Does

Every meeting is automatically captured, enriched, and made searchable by Claude:

- **"What was my last meeting about?"** — Instant recall of any conversation
- **"What did Ken commit to?"** — Extract action items and commitments
- **"Find meetings where we discussed budget"** — Semantic search across all calls
- **"Who is Babak Hosseinzadeh?"** — AI-enriched speaker profiles with LinkedIn
- **"What companies have I talked to this month?"** — Knowledge graph relationships

The platform runs as an MCP server + web dashboard, giving Claude native access to your meeting history.

---

## How It Works

```
Krisp App → Keep It Krispy Cloud → MCP Server → Claude
   │                  │                           │
   │   [webhook]      │                           │
   └──────────────────┤                           │
                      ├── Transcript Storage      │
                      ├── Semantic Search         │
                      ├── Knowledge Graph         │
                      └── AI Enrichment ──────────┘
```

Your transcripts are securely stored and indexed. The MCP server runs locally and connects Claude to your meeting data.

---

## MCP Tools

The MCP server provides seven tools to Claude:

| Tool | Description |
|------|-------------|
| `list_transcripts` | List recent meetings with metadata. Filter by date or speaker. |
| `search_transcripts` | Semantic search — find "budget concerns" even if you said "cost overruns" |
| `get_transcripts` | Fetch full transcript content (summary, notes, action items, text) |
| `update_speakers` | Correct speaker names — map "Speaker 2" to real names with LinkedIn |
| `list_speakers` | View your knowledge graph speakers with metadata |
| `list_companies` | View companies mentioned in your meetings |
| `get_entity_relationships` | Explore knowledge graph connections between entities |

All queries are scoped to your user ID for multi-tenant isolation.

---

## Web Dashboard

A companion web dashboard is available at **[app.krispy.alpha-pm.dev](https://app.krispy.alpha-pm.dev)**:

- **Transcripts Browser** (`/transcripts`) — Browse all your meetings with pagination and search
- **Speakers Directory** (`/speakers`) — See everyone you've met with, ranked by meeting frequency
- **Speaker Profiles** — View meeting history, AI-generated bios, and topic analysis for each person

The dashboard runs on AWS Amplify and reads from the same DynamoDB/S3 backend as the MCP server.

---

## Installation

### Prerequisites
- [Krisp.ai](https://krisp.ai) desktop app
- Node.js 18+
- Claude Desktop or Claude Code

### Step 1: Create Account

Sign in at [app.krispy.alpha-pm.dev](https://app.krispy.alpha-pm.dev) to get your:
- **User ID** — for MCP authentication
- **API Key** — for Krisp webhook authentication
- **Webhook URL** — where Krisp sends transcripts

### Step 2: Install MCP Server

```bash
curl -fsSL https://krispy.alpha-pm.dev/install.sh | bash
```

The installer will:
1. Clone the repository
2. Build the MCP server
3. Ask for your User ID
4. Configure Claude Desktop and/or Claude Code

### Step 3: Configure Krisp Webhook

1. Open Krisp → Settings → Integrations → Webhooks
2. **Webhook URL:** Copy from your dashboard settings
3. **Headers:** Add `X-API-Key` with your API key
4. Select "Transcript created" as trigger
5. Save

---

## Documentation

- **[Installation Guide](https://krispy.alpha-pm.dev/install.html)** — Full setup walkthrough
- **[MCP Setup](https://krispy.alpha-pm.dev/mcp.html)** — Claude Desktop, Code, and other clients
- **[Examples](https://krispy.alpha-pm.dev/examples.html)** — Real-world usage demos

---

## Project Structure

```
├── infra/                     # AWS CDK infrastructure
│   ├── lib/infra-stack.ts     # Main infrastructure stack
│   └── bin/infra.ts           # CDK app entry point
├── .github/workflows/         # CI/CD
│   ├── cdk-deploy.yml         # Auto-deploy on push
│   └── cdk-drift-detection.yml
├── lambda/
│   ├── mcp-server-ts/         # MCP server for Claude (TypeScript)
│   ├── processor/             # Transcript processor (Python)
│   ├── morning-briefing/      # Daily briefing Lambda (Python)
│   └── speaker-enrichment/    # Bio enrichment Lambda (Python)
├── website/                   # Static website (krispy.alpha-pm.dev)
├── scripts/                   # Maintenance and migration scripts
└── src/                       # Next.js web dashboard
    ├── app/api/               # API routes
    ├── app/transcripts/       # Transcript pages
    ├── app/speakers/          # Speaker pages with AI enrichment
    ├── app/companies/         # Company pages
    └── lib/parsers/           # AI transcript parser
```

---

## Pricing

Keep It Krispy is **free during beta**. Sign up now to lock in early adopter pricing.

---

## What is Krisp.ai?

[Krisp.ai](https://krisp.ai) is a desktop app that provides real-time transcription for any meeting — Zoom, Teams, Meet, phone calls, anything with audio.

**Note:** Webhooks require Krisp Pro or Business. Webhooks are the key — they automatically send transcripts to Keep It Krispy the moment a call ends.

---

## License

MIT — do whatever you want with it.

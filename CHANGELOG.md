# Changelog

All notable changes to Keep It Krispy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.4.0] - 2026-01-20

### Added

#### Infrastructure as Code
- **AWS CDK Migration** - Full infrastructure now managed via CDK in `infra/` directory
- **GitHub Actions CI/CD** - Auto-deploy on push to main, daily drift detection
- **OIDC Authentication** - Secure GitHub Actions IAM role without static credentials

#### AI Transcript Parser
- **Multi-Format Support** - Automatically parse Zoom, Teams, Slack, podcast, and custom transcript formats
- **AI Fallback** - When rule-based parsing fails, Bedrock Nova Lite intelligently extracts structure
- **Confidence Scoring** - Parser reports confidence level for each transcript interpretation

#### Knowledge Graph
- **Entity System** - Universal entity store for speakers, companies, topics, documents
- **Relationships** - Graph edges connecting entities (works_at, participant, mentioned)
- **MCP Tools** - New `list_speakers`, `list_companies`, `get_entity_relationships` tools

#### Multi-Tenant Authentication
- **User Isolation** - All queries scoped by `user_id` for data privacy
- **KRISP_USER_ID** - Environment variable for MCP server authentication
- **API Key Support** - Generate API keys from dashboard for programmatic access

#### Scheduled Jobs
- **Morning Briefing Lambda** - Daily briefings generated at 7am UTC
- **Speaker Enrichment Lambda** - Nightly bio enrichment at 2am UTC

### Changed
- Speaker corrections now create entities automatically in knowledge graph
- Transcript uploads support AI parsing via `useAI` option

### Fixed
- Speaker name edits now persist correctly
- Double-encoded speaker URLs handled properly

## [1.3.0] - 2026-01-18

### Added
- **Speaker Corrections on Website** - Transcript list and detail views now display corrected speaker names with visual indicators
- **Dynamic Speakers Directory** - Speakers page fetches real data from DynamoDB instead of hardcoded mock data
- **Speakers API Endpoint** - New `/api/speakers` endpoint aggregates speaker statistics across all transcripts
- **LinkedIn Links in Directory** - Speaker cards display clickable LinkedIn icons when profile URLs are available
- **Speaker Statistics** - Meeting count, total duration, and "last seen" date for each speaker
- **Speaker Profile Pages** - Individual speaker pages at `/speakers/[name]` with full meeting history
- **Editable Speaker Profiles** - Add bio, role, company, and LinkedIn URL for any speaker
- **Clickable Speaker Names** - Speaker names link to profile pages throughout the app
- **AI-Powered Speaker Insights** - Generate professional summaries from meeting transcripts using Bedrock Claude
- **Topic Discovery** - Automatically extract key topics from speaker conversations
- **Cached Enrichment** - AI insights cached for 7 days with manual refresh option
- **Topics Browser** - New `/topics` page showing all discovered topics with speaker counts
- **Topic Detail Pages** - Click any topic to see all speakers who discuss it
- **Clickable Topic Tags** - Topic tags throughout app link to topic detail pages
- **Topics in Navigation** - Topics added to main navigation menu

## [1.2.0] - 2025-01-14

### Added
- **Speaker Correction Tool** - New MCP tool `update_speakers` to map unknown speakers (e.g., "Speaker 2") to real names
- **LinkedIn Integration** - Optionally store LinkedIn URLs when correcting speaker names
- **Auto-Apply Corrections** - Speaker corrections automatically applied when fetching transcripts
- **Transcript Text Replacement** - Corrected names replace original names throughout transcript text
- **Optional Admin Dashboard** - Web UI for browsing transcripts, semantic search, and speaker management
- **Docker Deployment** - Admin dashboard deploys via AWS App Runner with automatic SSL
- **Favicon** - Added site favicon (brain icon) in all standard sizes
- **Mobile Responsive** - Full mobile-friendly design for all website pages

### Changed
- Install script now prompts for optional admin dashboard deployment
- `get_transcripts` MCP tool now returns `speaker_corrections` field when available

## [1.1.0] - 2025-01-13

### Added
- **Webhook Authentication** - API key validation for webhook security
- **Instant Indexing** - Transcripts indexed to DynamoDB immediately on webhook receipt
- **Auto MCP Configuration** - Installer auto-configures Claude Desktop and Claude Code
- **Debug Logging** - Comprehensive logging in MCP server for troubleshooting

### Fixed
- DynamoDB `listRecent()` now uses date GSI instead of arbitrary scan results

## [1.0.0] - 2025-01-12

### Added
- Initial release
- **Webhook Lambda** - Receives Krisp webhooks and stores to S3
- **Processor Lambda** - Indexes transcripts and generates embeddings
- **DynamoDB Index** - Fast metadata queries with date and speaker GSIs
- **S3 Vectors** - Semantic search using Bedrock Titan embeddings
- **MCP Server** - Three tools: `list_transcripts`, `search_transcripts`, `get_transcripts`
- **One-Line Installer** - `curl | bash` deployment to user's AWS account
- **Static Website** - Documentation at krispy.alpha-pm.dev

[Unreleased]: https://github.com/dwinter3/keep-it-krispy/compare/v1.4.0...HEAD
[1.4.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dwinter3/keep-it-krispy/releases/tag/v1.0.0

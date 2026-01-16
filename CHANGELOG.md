# Changelog

All notable changes to Keep It Krispy will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

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

[Unreleased]: https://github.com/dwinter3/keep-it-krispy/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dwinter3/keep-it-krispy/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dwinter3/keep-it-krispy/releases/tag/v1.0.0

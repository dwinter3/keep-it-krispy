/**
 * Stdio MCP server for Claude Desktop.
 * This runs as a local process that Claude Desktop communicates with via stdin/stdout.
 *
 * Enhanced with:
 * - DynamoDB for fast transcript listing
 * - S3 Vectors for semantic search
 * - Multi-tenant user isolation via KRISP_USER_ID
 * - Knowledge graph entity tools
 *
 * Debug logs go to stderr and appear in ~/Library/Logs/Claude/mcp-server-krisp.log
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { S3TranscriptClient } from './s3-client.js';
import { DynamoTranscriptClient } from './dynamo-client.js';
import { VectorsClient } from './vectors-client.js';
import { KrispyApiClient } from './krispy-api-client.js';
import { getUserContext, debugAuthContext, type UserContext } from './auth.js';

// Debug logging to stderr (shows in Claude Desktop's mcp-server-krisp.log)
function debug(message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  const logLine = data !== undefined
    ? `[KRISP DEBUG ${timestamp}] ${message}: ${JSON.stringify(data)}`
    : `[KRISP DEBUG ${timestamp}] ${message}`;
  console.error(logLine);
}

debug('Server module loading', {
  AWS_REGION: process.env.AWS_REGION,
  KRISP_S3_BUCKET: process.env.KRISP_S3_BUCKET,
  DYNAMODB_TABLE: process.env.DYNAMODB_TABLE,
  VECTOR_BUCKET: process.env.VECTOR_BUCKET,
  VECTOR_INDEX: process.env.VECTOR_INDEX,
  AWS_PROFILE: process.env.AWS_PROFILE,
  KRISP_USER_ID: process.env.KRISP_USER_ID ? '(set)' : '(not set)',
  KRISP_API_KEY: process.env.KRISP_API_KEY ? '(set)' : '(not set)',
  NODE_VERSION: process.version,
});

let s3Client: S3TranscriptClient;
let dynamoClient: DynamoTranscriptClient;
let vectorsClient: VectorsClient;
let apiClient: KrispyApiClient | null = null;

try {
  debug('Initializing S3 client...');
  s3Client = new S3TranscriptClient();
  debug('S3 client initialized');

  debug('Initializing DynamoDB client...');
  dynamoClient = new DynamoTranscriptClient();
  debug('DynamoDB client initialized');

  debug('Initializing Vectors client...');
  vectorsClient = new VectorsClient();
  debug('Vectors client initialized');

  // Initialize API client if API key is provided (optional, enables API-based semantic search)
  if (process.env.KRISP_API_KEY) {
    debug('Initializing API client...');
    apiClient = new KrispyApiClient(process.env.KRISP_API_KEY);
    debug('API client initialized');
  } else {
    debug('No KRISP_API_KEY set, API-based semantic search will not be available');
  }
} catch (error) {
  debug('FATAL: Failed to initialize clients', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
}

const server = new Server(
  {
    name: 'Keep It Krispy',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  debug('tools/list called');
  return {
    tools: [
      {
        name: 'list_transcripts',
        description: 'List your recent Krisp meeting transcripts. Returns metadata including title, date, duration, speakers, and S3 key. Fast query (~50ms). Only shows transcripts you own or have been shared with you.',
        inputSchema: {
          type: 'object',
          properties: {
            start_date: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to recent transcripts.' },
            end_date: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
            speaker: { type: 'string', description: 'Filter by speaker name (exact match, case-insensitive)' },
            limit: { type: 'number', description: 'Maximum number of transcripts to return (default: 20)' },
          },
        },
      },
      {
        name: 'search_transcripts',
        description: 'Semantic search across your meeting transcripts using AI embeddings. Finds conceptually similar content even if exact words differ. Returns ranked results with relevance scores and text snippets. Only searches transcripts you own.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query (e.g., "discussion about project timeline")' },
            meeting_id: { type: 'string', description: 'Optional: limit search to a specific meeting ID' },
            limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'semantic_search',
        description: 'API-based semantic search across your meeting transcripts using AI embeddings. Similar to search_transcripts but uses the Keep It Krispy API for richer results including topic and speaker filtering. Requires KRISP_API_KEY to be set.',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Natural language search query (e.g., "discussion about project timeline")' },
            limit: { type: 'number', description: 'Maximum results to return (default: 10)' },
            speaker: { type: 'string', description: 'Filter by speaker name' },
            from: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
            to: { type: 'string', description: 'End date (YYYY-MM-DD)' },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_transcripts',
        description: 'Fetch transcript content by S3 keys. Use summary_only=true to get metadata without full transcript text (recommended for multiple transcripts). Speaker corrections are automatically applied.',
        inputSchema: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'S3 keys of transcripts to fetch',
            },
            summary_only: {
              type: 'boolean',
              description: 'If true, returns only title, summary, notes, action_items, and speakers (no full transcript text). Recommended when fetching multiple transcripts to avoid large responses.',
            },
          },
          required: ['keys'],
        },
      },
      {
        name: 'update_speakers',
        description: 'Correct or identify speakers in a meeting transcript you own. Map generic names like "Speaker 2" to real names, or correct misspelled names. Optionally include LinkedIn URLs for reference. Corrections are stored and automatically applied when fetching transcripts.',
        inputSchema: {
          type: 'object',
          properties: {
            meeting_id: {
              type: 'string',
              description: 'The meeting ID to update speaker information for',
            },
            speaker_mappings: {
              type: 'object',
              description: 'Object mapping original speaker names to corrected info. Keys are original names (e.g., "Speaker 2", "guy farber"), values are objects with "name" (required) and optional "linkedin" URL.',
              additionalProperties: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Corrected speaker name' },
                  linkedin: { type: 'string', description: 'LinkedIn profile URL (optional)' },
                },
                required: ['name'],
              },
            },
          },
          required: ['meeting_id', 'speaker_mappings'],
        },
      },
      {
        name: 'list_speakers',
        description: 'List speakers from your knowledge graph. Returns speaker entities with metadata like names, LinkedIn URLs, and company associations.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of speakers to return (default: 50)' },
            company: { type: 'string', description: 'Filter by company name' },
            verified_only: { type: 'boolean', description: 'Only return verified speakers' },
          },
        },
      },
      {
        name: 'list_companies',
        description: 'List companies from your knowledge graph. Returns company entities with metadata.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum number of companies to return (default: 50)' },
            type: { type: 'string', description: 'Filter by company type (e.g., "customer", "partner", "vendor")' },
          },
        },
      },
      {
        name: 'get_entity_relationships',
        description: 'Get relationships for an entity in your knowledge graph. Shows connections between speakers, companies, topics, and documents.',
        inputSchema: {
          type: 'object',
          properties: {
            entity_id: { type: 'string', description: 'The entity ID to get relationships for' },
            direction: {
              type: 'string',
              enum: ['from', 'to', 'both'],
              description: 'Direction of relationships: "from" (outgoing), "to" (incoming), or "both" (default)',
            },
            rel_type: { type: 'string', description: 'Filter by relationship type (e.g., "works_at", "participant", "mentioned")' },
          },
          required: ['entity_id'],
        },
      },
      {
        name: 'list_linkedin_connections',
        description: 'List LinkedIn connections imported by the user. These are 1st-degree connections that can be matched to meeting speakers.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximum connections to return (default: 50)' },
            search: { type: 'string', description: 'Search by name (partial match)' },
          },
        },
      },
      {
        name: 'match_linkedin_connection',
        description: 'Find a LinkedIn 1st-degree connection that matches a speaker name. Useful for identifying meeting attendees.',
        inputSchema: {
          type: 'object',
          properties: {
            speaker_name: { type: 'string', description: 'Speaker name to match against LinkedIn connections' },
            company_hint: { type: 'string', description: 'Optional company name to improve matching accuracy' },
          },
          required: ['speaker_name'],
        },
      },
      {
        name: 'get_speaker_context',
        description: 'Get comprehensive context about a speaker including their enriched profile, LinkedIn match, and meeting history.',
        inputSchema: {
          type: 'object',
          properties: {
            speaker_name: { type: 'string', description: 'Name of the speaker to get context for' },
          },
          required: ['speaker_name'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = Date.now();

  debug(`tools/call: ${name}`, { args });

  try {
    // Get user context for all operations
    const userContext = await getUserContext();
    debug('User context', { auth: debugAuthContext(userContext) });

    // Require authentication for all tools
    if (!userContext) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Authentication required',
            message: 'Set KRISP_USER_ID environment variable to your user ID.',
            hint: 'Get your user ID from the Keep It Krispy dashboard settings.',
          }, null, 2),
        }],
        isError: true,
      };
    }

    const userId = userContext.userId;

    switch (name) {
      case 'list_transcripts': {
        const speaker = args?.speaker as string | undefined;
        const limit = (args?.limit as number) || 20;

        let transcripts;

        if (speaker) {
          debug('list_transcripts: using speaker GSI', { speaker, limit, userId });
          transcripts = await dynamoClient.listBySpeaker(userId, speaker, limit);
        } else if (args?.start_date || args?.end_date) {
          const endDate = args?.end_date as string || new Date().toISOString().slice(0, 10);
          const startDate = args?.start_date as string ||
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          debug('list_transcripts: using date range', { startDate, endDate, limit, userId });
          transcripts = await dynamoClient.listByDateRange(userId, startDate, endDate, limit);
        } else {
          debug('list_transcripts: getting recent', { limit, userId });
          transcripts = await dynamoClient.listRecent(userId, limit);
        }

        debug(`list_transcripts: found ${transcripts.length} transcripts in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: transcripts.length,
              transcripts: transcripts.map(t => ({
                key: t.s3_key,
                title: t.title,
                date: t.date,
                timestamp: t.timestamp,
                meeting_id: t.meeting_id,
                duration: t.duration,
                speakers: t.speakers || [],
              })),
            }, null, 2),
          }],
        };
      }

      case 'search_transcripts': {
        const query = args?.query as string;
        const meetingIdFilter = args?.meeting_id as string | undefined;
        const limit = (args?.limit as number) || 10;

        debug('search_transcripts: starting semantic search', { query, meetingIdFilter, limit, userId });

        // Get user's transcripts to create an allowlist for post-filtering
        const userTranscripts = await dynamoClient.listRecent(userId, 100);
        const allowedMeetingIds = new Set(userTranscripts.map(t => t.meeting_id));

        // Use semantic search with S3 Vectors, filtering by user
        const vectorResults = await vectorsClient.search(
          query,
          limit * 3,
          meetingIdFilter,
          userId,
          allowedMeetingIds
        );
        debug(`search_transcripts: got ${vectorResults.length} vector results in ${Date.now() - startTime}ms`);

        // Check if vectors are working - if user has transcripts but no vector results,
        // suggest using semantic_search tool instead
        if (vectorResults.length === 0 && userTranscripts.length > 0) {
          debug('search_transcripts: no vector results despite having transcripts - vectors may not be indexed');
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query,
                search_type: 'semantic',
                count: 0,
                results: [],
                note: 'No results found. Vector search may not be available for your transcripts.',
                suggestion: 'Try using the semantic_search tool instead, which uses the Keep It Krispy API and requires KRISP_API_KEY to be set.',
              }, null, 2),
            }],
          };
        }

        // Group by meeting to deduplicate
        const grouped = vectorsClient.groupByMeeting(vectorResults);

        // Convert to array and sort by top score
        const meetings = Array.from(grouped.values())
          .sort((a, b) => b.topScore - a.topScore)
          .slice(0, limit);

        // Format results
        const results = meetings.map(m => ({
          key: m.s3Key,
          meeting_id: m.meetingId,
          relevance_score: Math.round(m.topScore * 100) / 100,
          matching_chunks: m.chunks.length,
          snippets: m.chunks.slice(0, 3).map(c => ({
            text: c.metadata.text,
            score: Math.round(c.score * 100) / 100,
          })),
        }));

        debug(`search_transcripts: returning ${results.length} meetings in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              search_type: 'semantic',
              count: results.length,
              results,
            }, null, 2),
          }],
        };
      }

      case 'semantic_search': {
        // API-based semantic search (requires KRISP_API_KEY)
        if (!apiClient) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Semantic search via API requires KRISP_API_KEY environment variable.',
                hint: 'Add KRISP_API_KEY to your Claude Desktop config env section.',
                alternative: 'Use search_transcripts tool instead - it uses local S3 Vectors and works without an API key.',
              }, null, 2),
            }],
            isError: true,
          };
        }

        const query = args?.query as string;
        const limit = (args?.limit as number) || 10;
        const speaker = args?.speaker as string | undefined;
        const from = args?.from as string | undefined;
        const to = args?.to as string | undefined;

        debug('semantic_search: calling API', { query, limit, speaker, from, to });

        try {
          const searchResponse = await apiClient.search(query, { limit, speaker, from, to });

          debug(`semantic_search: got ${searchResponse.count} results in ${Date.now() - startTime}ms`);

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                query: searchResponse.query,
                searchType: searchResponse.searchType,
                filters: searchResponse.filters,
                count: searchResponse.count,
                results: searchResponse.results.map(r => ({
                  meetingId: r.meetingId,
                  s3Key: r.s3Key,
                  title: r.title,
                  date: r.date,
                  speakers: r.speakers,
                  duration: r.duration,
                  topic: r.topic,
                  relevanceScore: r.relevanceScore,
                  matchingChunks: r.matchingChunks,
                  snippets: r.snippets,
                  type: r.type,
                  format: r.format,
                  documentId: r.documentId,
                })),
              }, null, 2),
            }],
          };
        } catch (error) {
          debug('semantic_search: API error', { error: error instanceof Error ? error.message : String(error) });
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Semantic search API failed',
                hint: 'Check that your KRISP_API_KEY is valid.',
              }, null, 2),
            }],
            isError: true,
          };
        }
      }

      case 'get_transcripts': {
        const keys = args?.keys as string[];
        const summaryOnly = args?.summary_only as boolean || false;
        debug('get_transcripts: fetching from S3', { keys, summaryOnly, userId });

        const transcripts = await s3Client.getTranscripts(keys);
        debug(`get_transcripts: fetched ${transcripts.length} transcripts in ${Date.now() - startTime}ms`);

        // Apply speaker corrections from DynamoDB and check access
        const transcriptsWithCorrections = await Promise.all(
          transcripts.map(async (t) => {
            if (t.error) {
              return { key: t.key, error: t.error };
            }

            // Extract meeting_id from key (format: meetings/YYYY/MM/YYYYMMDD_HHMMSS_title_meetingId.json)
            const keyParts = t.key.split('_');
            const meetingId = keyParts[keyParts.length - 1]?.replace('.json', '');

            // Check user access and privacy
            if (meetingId) {
              const { record, accessDenied } = await dynamoClient.getByMeetingIdForUser(meetingId, userId);

              if (accessDenied) {
                debug(`get_transcripts: access denied for ${meetingId}`);
                return {
                  key: t.key,
                  error: 'Access denied: you do not own this transcript',
                  access_denied: true,
                };
              }

              if (record?.isPrivate) {
                debug(`get_transcripts: skipping private transcript ${meetingId}`);
                return {
                  key: t.key,
                  error: 'This transcript is marked as private and cannot be accessed via MCP',
                  is_private: true,
                };
              }
            }

            let correctedSpeakers = t.speakers;
            let speakerCorrections: Record<string, { name: string; linkedin?: string }> | null = null;

            if (meetingId) {
              speakerCorrections = await dynamoClient.getSpeakerCorrections(meetingId);
              if (speakerCorrections) {
                correctedSpeakers = t.speakers.map(speaker => {
                  const correction = speakerCorrections![speaker.toLowerCase()];
                  return correction ? correction.name : speaker;
                });
              }
            }

            // Also apply corrections to transcript text if available
            let correctedTranscript = t.transcript;
            if (speakerCorrections && t.transcript) {
              for (const [original, correction] of Object.entries(speakerCorrections)) {
                // Case-insensitive replace in transcript
                const regex = new RegExp(original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
                correctedTranscript = correctedTranscript.replace(regex, correction.name);
              }
            }

            // Return with or without full transcript based on summaryOnly flag
            const result: Record<string, unknown> = {
              key: t.key,
              title: t.title,
              summary: t.summary,
              notes: t.notes,
              action_items: t.actionItems,
              speakers: correctedSpeakers,
              speaker_corrections: speakerCorrections,
            };

            // Only include full transcript if not summary_only
            if (!summaryOnly) {
              result.transcript = correctedTranscript;
            }

            return result;
          })
        );

        debug(`get_transcripts: applied corrections (summaryOnly=${summaryOnly}) in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: transcriptsWithCorrections.length,
              transcripts: transcriptsWithCorrections,
            }, null, 2),
          }],
        };
      }

      case 'update_speakers': {
        const meetingId = args?.meeting_id as string;
        const mappings = args?.speaker_mappings as Record<string, { name: string; linkedin?: string }>;

        debug('update_speakers: updating speaker mappings', { meetingId, mappings, userId });

        const { record: updated, accessDenied, notFound } = await dynamoClient.updateSpeakers(
          meetingId,
          userId,
          mappings
        );

        if (accessDenied) {
          debug(`update_speakers: access denied for ${meetingId}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Access denied: you do not own this transcript',
                meeting_id: meetingId,
              }, null, 2),
            }],
            isError: true,
          };
        }

        if (notFound) {
          debug(`update_speakers: meeting not found: ${meetingId}`);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: `Meeting not found: ${meetingId}`,
                meeting_id: meetingId,
              }, null, 2),
            }],
            isError: true,
          };
        }

        debug(`update_speakers: updated successfully in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              meeting_id: meetingId,
              speaker_corrections: updated?.speaker_corrections,
              message: 'Speaker corrections saved. They will be applied when fetching this transcript. Speaker entities have been created/updated in your knowledge graph.',
            }, null, 2),
          }],
        };
      }

      case 'list_speakers': {
        const limit = (args?.limit as number) || 50;
        const company = args?.company as string | undefined;
        const verifiedOnly = args?.verified_only as boolean | undefined;

        debug('list_speakers: querying entities', { limit, company, verifiedOnly, userId });

        const speakers = await dynamoClient.listSpeakers(userId, { limit, company, verifiedOnly });

        debug(`list_speakers: found ${speakers.length} speakers in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: speakers.length,
              speakers: speakers.map(s => ({
                entity_id: s.entity_id,
                name: s.canonical_name,
                display_name: (s.metadata as { display_name?: string })?.display_name,
                linkedin: (s.metadata as { linkedin?: string })?.linkedin,
                company: (s.metadata as { company?: string })?.company,
                verified: (s.metadata as { verified?: boolean })?.verified,
                aliases: s.aliases,
                created_at: s.created_at,
              })),
            }, null, 2),
          }],
        };
      }

      case 'list_companies': {
        const limit = (args?.limit as number) || 50;
        const type = args?.type as string | undefined;

        debug('list_companies: querying entities', { limit, type, userId });

        const companies = await dynamoClient.listCompanies(userId, { limit, type });

        debug(`list_companies: found ${companies.length} companies in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              count: companies.length,
              companies: companies.map(c => ({
                entity_id: c.entity_id,
                name: c.canonical_name,
                display_name: (c.metadata as { display_name?: string })?.display_name,
                type: (c.metadata as { company_type?: string })?.company_type,
                website: (c.metadata as { website?: string })?.website,
                aliases: c.aliases,
                created_at: c.created_at,
              })),
            }, null, 2),
          }],
        };
      }

      case 'get_entity_relationships': {
        const entityId = args?.entity_id as string;
        const direction = (args?.direction as 'from' | 'to' | 'both') || 'both';
        const relType = args?.rel_type as string | undefined;

        debug('get_entity_relationships: querying relationships', { entityId, direction, relType, userId });

        // First verify the entity belongs to the user
        const entity = await dynamoClient.getEntity(entityId);
        if (!entity || entity.user_id !== userId) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                error: 'Entity not found or access denied',
                entity_id: entityId,
              }, null, 2),
            }],
            isError: true,
          };
        }

        const relationships = await dynamoClient.getEntityRelationships(userId, entityId, {
          direction,
          relType,
        });

        // Enrich relationships with entity details
        const enrichedRelationships = await Promise.all(
          relationships.map(async (r) => {
            const fromEntity = r.from_entity_id === entityId
              ? entity
              : await dynamoClient.getEntity(r.from_entity_id);
            const toEntity = r.to_entity_id === entityId
              ? entity
              : await dynamoClient.getEntity(r.to_entity_id);

            return {
              relationship_id: r.relationship_id,
              rel_type: r.rel_type,
              from_entity: fromEntity ? {
                entity_id: fromEntity.entity_id,
                name: fromEntity.canonical_name,
                type: fromEntity.entity_type,
              } : { entity_id: r.from_entity_id },
              to_entity: toEntity ? {
                entity_id: toEntity.entity_id,
                name: toEntity.canonical_name,
                type: toEntity.entity_type,
              } : { entity_id: r.to_entity_id },
              metadata: r.metadata,
              created_at: r.created_at,
            };
          })
        );

        debug(`get_entity_relationships: found ${relationships.length} relationships in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              entity_id: entityId,
              entity_name: entity.canonical_name,
              entity_type: entity.entity_type,
              count: enrichedRelationships.length,
              relationships: enrichedRelationships,
            }, null, 2),
          }],
        };
      }

      case 'list_linkedin_connections': {
        const limit = (args?.limit as number) || 50;
        const search = args?.search as string | undefined;

        debug('list_linkedin_connections: querying', { limit, search, userId });

        const stats = await dynamoClient.getLinkedInStats(userId);
        const connections = await dynamoClient.listLinkedInConnections(userId, { limit, search });

        debug(`list_linkedin_connections: found ${connections.length} connections in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              stats: {
                totalConnections: stats.totalConnections,
                lastImportAt: stats.lastImportAt,
                importSource: stats.importSource,
              },
              count: connections.length,
              connections: connections.map(c => ({
                fullName: c.fullName,
                company: c.company,
                position: c.position,
                email: c.email,
                connectedOn: c.connectedOn,
              })),
            }, null, 2),
          }],
        };
      }

      case 'match_linkedin_connection': {
        const speakerName = args?.speaker_name as string;
        const companyHint = args?.company_hint as string | undefined;

        debug('match_linkedin_connection: searching', { speakerName, companyHint, userId });

        const match = await dynamoClient.matchLinkedInConnection(
          userId,
          speakerName,
          companyHint ? { companies: [companyHint] } : undefined
        );

        debug(`match_linkedin_connection: ${match ? 'found match' : 'no match'} in ${Date.now() - startTime}ms`);

        if (!match) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                found: false,
                speakerName,
                message: 'No matching LinkedIn connection found. The speaker may not be a 1st-degree connection.',
              }, null, 2),
            }],
          };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: true,
              speakerName,
              match: {
                fullName: match.fullName,
                company: match.company,
                position: match.position,
                email: match.email,
                connectedOn: match.connectedOn,
                confidence: match.confidence,
                matchReason: match.matchReason,
              },
            }, null, 2),
          }],
        };
      }

      case 'get_speaker_context': {
        const speakerName = args?.speaker_name as string;

        debug('get_speaker_context: getting context', { speakerName, userId });

        const context = await dynamoClient.getSpeakerContext(userId, speakerName);

        debug(`get_speaker_context: completed in ${Date.now() - startTime}ms`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              speakerName,
              profile: context.profile ? {
                displayName: context.profile.displayName,
                role: context.profile.role,
                company: context.profile.company,
                linkedin: context.profile.linkedin,
                aiSummary: context.profile.aiSummary,
                topics: context.profile.topics,
                enrichedAt: context.profile.enrichedAt,
                confidence: context.profile.enrichedConfidence,
              } : null,
              linkedInMatch: context.linkedInMatch ? {
                fullName: context.linkedInMatch.fullName,
                company: context.linkedInMatch.company,
                position: context.linkedInMatch.position,
                confidence: context.linkedInMatch.confidence,
                matchReason: context.linkedInMatch.matchReason,
              } : null,
              entity: context.entity ? {
                entityId: context.entity.entity_id,
                canonicalName: context.entity.canonical_name,
                aliases: context.entity.aliases,
              } : null,
              transcriptCount: context.transcriptCount,
            }, null, 2),
          }],
        };
      }

      default:
        debug(`Unknown tool called: ${name}`);
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    debug(`ERROR in ${name}`, {
      error: errorMessage,
      stack: errorStack,
      duration_ms: Date.now() - startTime,
    });

    // Return error as tool result instead of throwing
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: errorMessage,
          tool: name,
          args,
        }, null, 2),
      }],
      isError: true,
    };
  }
});

async function main() {
  debug('Starting server...');

  const transport = new StdioServerTransport();

  // Handle transport errors
  transport.onerror = (error) => {
    debug('Transport error', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  };

  transport.onclose = () => {
    debug('Transport closed');
  };

  debug('Connecting to transport...');
  await server.connect(transport);
  debug('Server connected and ready');
}

main().catch((error) => {
  debug('FATAL: main() failed', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  debug('UNCAUGHT EXCEPTION', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  debug('UNHANDLED REJECTION', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
  });
});

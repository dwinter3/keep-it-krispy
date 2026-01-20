/**
 * Keep It Krispy MCP Server
 *
 * Exposes Krisp meeting transcripts to Claude Desktop.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { S3TranscriptClient } from './s3-client.js';
import { DynamoTranscriptClient } from './dynamo-client.js';

export function createServer(userId?: string): McpServer {
  const s3Client = new S3TranscriptClient();
  const dynamoClient = new DynamoTranscriptClient();

  // Use provided userId or a default for testing
  const currentUserId = userId || process.env.USER_ID || 'default-user';

  const server = new McpServer({
    name: 'Keep It Krispy',
    version: '1.0.0',
  }, {
    capabilities: {
      tools: {},
    },
  });

  // Tool: list_transcripts
  server.tool(
    'list_transcripts',
    'List recent Krisp meeting transcripts. Returns metadata including title, date, and S3 key for each transcript.',
    {
      start_date: z.string().optional().describe('Start date (YYYY-MM-DD). Defaults to 30 days ago.'),
      end_date: z.string().optional().describe('End date (YYYY-MM-DD). Defaults to today.'),
      limit: z.number().optional().default(20).describe('Maximum number of transcripts to return (default: 20)'),
    },
    async ({ start_date, end_date, limit }) => {
      const startDate = start_date ? new Date(start_date) : undefined;
      const endDate = end_date ? new Date(end_date) : undefined;

      const transcripts = await s3Client.listTranscripts(startDate, endDate, limit || 20);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: transcripts.length,
            transcripts: transcripts.map(t => ({
              key: t.key,
              title: t.title,
              date: t.dateStr,
              meeting_id: t.meetingId,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // Tool: search_transcripts
  server.tool(
    'search_transcripts',
    'Search meeting transcripts by keyword in content, summary, or notes. Optionally filter by speaker name.',
    {
      query: z.string().describe('Search query to find in transcripts'),
      speaker: z.string().optional().describe('Filter by speaker name (partial match)'),
      limit: z.number().optional().default(10).describe('Maximum results to return (default: 10)'),
    },
    async ({ query, speaker, limit }) => {
      const results = await s3Client.search(query, speaker, limit || 10);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            query,
            speaker: speaker || null,
            count: results.length,
            results: results.map(r => ({
              key: r.key,
              title: r.title,
              date: r.dateStr,
              speakers: r.speakers,
              snippet: r.snippet,
              summary: r.summary,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // Tool: get_transcripts
  server.tool(
    'get_transcripts',
    'Fetch full content of one or more transcripts by their S3 keys. Use keys from list_transcripts or search_transcripts.',
    {
      keys: z.array(z.string()).describe('S3 keys of transcripts to fetch'),
    },
    async ({ keys }) => {
      const transcripts = await s3Client.getTranscripts(keys);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: transcripts.length,
            transcripts: transcripts.map(t => t.error ? {
              key: t.key,
              error: t.error,
            } : {
              key: t.key,
              title: t.title,
              summary: t.summary,
              notes: t.notes,
              transcript: t.transcript,
              action_items: t.actionItems,
              speakers: t.speakers,
            }),
          }, null, 2),
        }],
      };
    }
  );

  // Tool: list_linkedin_connections
  server.tool(
    'list_linkedin_connections',
    'List LinkedIn connections imported by the user. These are 1st-degree connections that can be matched to meeting speakers.',
    {
      limit: z.number().optional().default(50).describe('Maximum connections to return (default: 50)'),
      search: z.string().optional().describe('Search by name (partial match)'),
    },
    async ({ limit, search }) => {
      const stats = await dynamoClient.getLinkedInStats(currentUserId);
      const connections = await dynamoClient.listLinkedInConnections(currentUserId, {
        limit: limit || 50,
        search,
      });

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
  );

  // Tool: match_linkedin_connection
  server.tool(
    'match_linkedin_connection',
    'Find a LinkedIn 1st-degree connection that matches a speaker name. Useful for identifying meeting attendees.',
    {
      speaker_name: z.string().describe('Speaker name to match against LinkedIn connections'),
      company_hint: z.string().optional().describe('Optional company name to improve matching accuracy'),
    },
    async ({ speaker_name, company_hint }) => {
      const match = await dynamoClient.matchLinkedInConnection(
        currentUserId,
        speaker_name,
        company_hint ? { companies: [company_hint] } : undefined
      );

      if (!match) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: false,
              speakerName: speaker_name,
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
            speakerName: speaker_name,
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
  );

  // Tool: get_speaker_context
  server.tool(
    'get_speaker_context',
    'Get comprehensive context about a speaker including their enriched profile, LinkedIn match, and meeting history.',
    {
      speaker_name: z.string().describe('Name of the speaker to get context for'),
    },
    async ({ speaker_name }) => {
      const context = await dynamoClient.getSpeakerContext(currentUserId, speaker_name);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            speakerName: speaker_name,
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
  );

  // Tool: list_speakers
  server.tool(
    'list_speakers',
    'List known speakers from meetings. Returns speaker entities with their metadata.',
    {
      limit: z.number().optional().default(50).describe('Maximum speakers to return (default: 50)'),
      company: z.string().optional().describe('Filter by company name'),
    },
    async ({ limit, company }) => {
      const speakers = await dynamoClient.listSpeakers(currentUserId, {
        limit: limit || 50,
        company,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: speakers.length,
            speakers: speakers.map(s => ({
              entityId: s.entity_id,
              name: s.canonical_name,
              aliases: s.aliases,
              metadata: s.metadata,
              createdAt: s.created_at,
              updatedAt: s.updated_at,
            })),
          }, null, 2),
        }],
      };
    }
  );

  // Tool: list_companies
  server.tool(
    'list_companies',
    'List known companies from meetings. Returns company entities with their metadata.',
    {
      limit: z.number().optional().default(50).describe('Maximum companies to return (default: 50)'),
    },
    async ({ limit }) => {
      const companies = await dynamoClient.listCompanies(currentUserId, {
        limit: limit || 50,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            count: companies.length,
            companies: companies.map(c => ({
              entityId: c.entity_id,
              name: c.canonical_name,
              aliases: c.aliases,
              metadata: c.metadata,
              createdAt: c.created_at,
              updatedAt: c.updated_at,
            })),
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

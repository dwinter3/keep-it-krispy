/**
 * Keep It Krispy MCP Server
 *
 * Exposes Krisp meeting transcripts to Claude Desktop via the KIK SaaS API.
 * All operations go through the API for proper authentication and tenant isolation.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { KrispyApiClient } from './krispy-api-client.js';

export function createServer(apiKey?: string): McpServer {
  // API key is required - all operations go through the API
  const currentApiKey = apiKey || process.env.KRISP_API_KEY;

  if (!currentApiKey) {
    throw new Error(
      'KRISP_API_KEY is required. Get your API key from https://app.krispy.alpha-pm.dev/settings'
    );
  }

  const apiClient = new KrispyApiClient(currentApiKey);

  const server = new McpServer(
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

  // Tool: list_transcripts
  server.tool(
    'list_transcripts',
    'List your recent Krisp meeting transcripts. Returns metadata including title, date, duration, speakers, and S3 key. Fast query (~50ms). Only shows transcripts you own or have been shared with you.',
    {
      start_date: z.string().optional().describe('Start date (YYYY-MM-DD). Defaults to recent transcripts.'),
      end_date: z.string().optional().describe('End date (YYYY-MM-DD). Defaults to today.'),
      limit: z.number().optional().default(20).describe('Maximum number of transcripts to return (default: 20)'),
      speaker: z.string().optional().describe('Filter by speaker name (exact match, case-insensitive)'),
    },
    async ({ start_date, end_date, limit, speaker }) => {
      try {
        const response = await apiClient.listTranscripts({
          limit: limit || 20,
          startDate: start_date,
          endDate: end_date,
          speaker,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to list transcripts',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Tool: search_transcripts (semantic search via API)
  server.tool(
    'search_transcripts',
    'Semantic search across your meeting transcripts using AI embeddings. Finds conceptually similar content even if exact words differ. Returns ranked results with relevance scores and text snippets. Only searches transcripts you own.',
    {
      query: z.string().describe('Natural language search query (e.g., "discussion about project timeline")'),
      limit: z.number().optional().default(10).describe('Maximum results to return (default: 10)'),
      speaker: z.string().optional().describe('Filter by speaker name'),
      from: z.string().optional().describe('Start date (YYYY-MM-DD)'),
      to: z.string().optional().describe('End date (YYYY-MM-DD)'),
    },
    async ({ query, limit, speaker, from, to }) => {
      try {
        const searchResponse = await apiClient.search(query, {
          limit: limit || 10,
          speaker,
          from,
          to,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  query: searchResponse.query,
                  searchType: searchResponse.searchType,
                  filters: searchResponse.filters,
                  count: searchResponse.count,
                  results: searchResponse.results.map((r) => ({
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
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        console.error('[MCP] Search error:', error);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Search failed',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Tool: get_transcripts
  server.tool(
    'get_transcripts',
    'Fetch transcript content by meeting IDs. Use summary_only=true to get metadata without full transcript text (recommended for multiple transcripts). Speaker corrections are automatically applied.',
    {
      meeting_ids: z.array(z.string()).describe('Meeting IDs of transcripts to fetch (from list_transcripts)'),
      summary_only: z
        .boolean()
        .optional()
        .describe(
          'If true, returns only title, summary, notes, action_items, and speakers (no full transcript text). Recommended when fetching multiple transcripts to avoid large responses.'
        ),
    },
    async ({ meeting_ids, summary_only }) => {
      try {
        const transcripts = await apiClient.getTranscripts(meeting_ids, { summaryOnly: summary_only });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  count: transcripts.length,
                  transcripts,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to fetch transcripts',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Tool: update_speakers
  server.tool(
    'update_speakers',
    'Correct or identify speakers in a meeting transcript you own. Map generic names like "Speaker 2" to real names, or correct misspelled names. Optionally include LinkedIn URLs for reference. Corrections are stored and automatically applied when fetching transcripts.',
    {
      meeting_id: z.string().describe('The meeting ID to update speaker information for'),
      speaker_mappings: z
        .record(
          z.string(),
          z.object({
            name: z.string().describe('Corrected speaker name'),
            linkedin: z.string().optional().describe('LinkedIn profile URL (optional)'),
          })
        )
        .describe(
          'Object mapping original speaker names to corrected info. Keys are original names (e.g., "Speaker 2", "guy farber"), values are objects with "name" (required) and optional "linkedin" URL.'
        ),
    },
    async ({ meeting_id, speaker_mappings }) => {
      try {
        const result = await apiClient.updateSpeakers(
          meeting_id,
          speaker_mappings as Record<string, { name: string; linkedin?: string }>
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: result.success,
                  meetingId: meeting_id,
                  speakerCorrections: result.speakerCorrections,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to update speakers',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Tool: list_speakers
  server.tool(
    'list_speakers',
    'List speakers from your knowledge graph. Returns speaker entities with metadata like names, LinkedIn URLs, and company associations.',
    {
      limit: z.number().optional().default(50).describe('Maximum number of speakers to return (default: 50)'),
      company: z.string().optional().describe('Filter by company name'),
      verified_only: z.boolean().optional().describe('Only return verified speakers'),
    },
    async ({ limit, company, verified_only }) => {
      try {
        const response = await apiClient.listSpeakers({
          limit: limit || 50,
          company,
          verifiedOnly: verified_only,
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to list speakers',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Tool: list_companies
  server.tool(
    'list_companies',
    'List companies from your knowledge graph. Returns company entities with metadata.',
    {
      limit: z.number().optional().default(50).describe('Maximum number of companies to return (default: 50)'),
      type: z.string().optional().describe('Filter by company type (e.g., "customer", "partner", "vendor")'),
    },
    async ({ limit, type }) => {
      try {
        const response = await apiClient.listCompanies({ limit: limit || 50, type });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to list companies',
                },
                null,
                2
              ),
            },
          ],
        };
      }
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
      try {
        const response = await apiClient.listLinkedInConnections({ limit: limit || 50, search });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to list LinkedIn connections',
                },
                null,
                2
              ),
            },
          ],
        };
      }
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
      try {
        const response = await apiClient.matchLinkedInConnection(speaker_name, company_hint);

        if (!response.match) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    found: false,
                    speakerName: speaker_name,
                    message: 'No matching LinkedIn connection found. The speaker may not be a 1st-degree connection.',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  found: true,
                  speakerName: speaker_name,
                  match: response.match,
                  confidence: response.confidence,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to match LinkedIn connection',
                },
                null,
                2
              ),
            },
          ],
        };
      }
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
      try {
        const context = await apiClient.getSpeakerContext(speaker_name);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  speakerName: speaker_name,
                  ...context,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: error instanceof Error ? error.message : 'Failed to get speaker context',
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  return server;
}

/**
 * Keep It Krispy MCP Server
 *
 * Exposes Krisp meeting transcripts to Claude Desktop.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { S3TranscriptClient } from './s3-client.js';

export function createServer(): McpServer {
  const client = new S3TranscriptClient();

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

      const transcripts = await client.listTranscripts(startDate, endDate, limit || 20);

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
      const results = await client.search(query, speaker, limit || 10);

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
      const transcripts = await client.getTranscripts(keys);

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

  return server;
}

/**
 * Stdio MCP server for Claude Desktop.
 * This runs as a local process that Claude Desktop communicates with via stdin/stdout.
 *
 * Enhanced with:
 * - DynamoDB for fast transcript listing
 * - S3 Vectors for semantic search
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

const s3Client = new S3TranscriptClient();
const dynamoClient = new DynamoTranscriptClient();
const vectorsClient = new VectorsClient();

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
  return {
    tools: [
      {
        name: 'list_transcripts',
        description: 'List recent Krisp meeting transcripts from DynamoDB index. Returns metadata including title, date, duration, speakers, and S3 key. Fast query (~50ms).',
        inputSchema: {
          type: 'object',
          properties: {
            start_date: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.' },
            end_date: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
            speaker: { type: 'string', description: 'Filter by speaker name (exact match, case-insensitive)' },
            limit: { type: 'number', description: 'Maximum number of transcripts to return (default: 20)' },
          },
        },
      },
      {
        name: 'search_transcripts',
        description: 'Semantic search across meeting transcripts using AI embeddings. Finds conceptually similar content even if exact words differ. Returns ranked results with relevance scores and text snippets.',
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
        name: 'get_transcripts',
        description: 'Fetch full content of one or more transcripts by their S3 keys. Use keys from list_transcripts or search_transcripts.',
        inputSchema: {
          type: 'object',
          properties: {
            keys: {
              type: 'array',
              items: { type: 'string' },
              description: 'S3 keys of transcripts to fetch',
            },
          },
          required: ['keys'],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case 'list_transcripts': {
      const speaker = args?.speaker as string | undefined;
      const limit = (args?.limit as number) || 20;

      let transcripts;

      if (speaker) {
        // Use speaker GSI
        transcripts = await dynamoClient.listBySpeaker(speaker, limit);
      } else if (args?.start_date || args?.end_date) {
        // Use date range query
        const endDate = args?.end_date as string || new Date().toISOString().slice(0, 10);
        const startDate = args?.start_date as string ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        transcripts = await dynamoClient.listByDateRange(startDate, endDate, limit);
      } else {
        // Get recent transcripts
        transcripts = await dynamoClient.listRecent(limit);
      }

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

      // Use semantic search with S3 Vectors
      const vectorResults = await vectorsClient.search(query, limit * 2, meetingIdFilter);

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

    case 'get_transcripts': {
      const keys = args?.keys as string[];
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

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);

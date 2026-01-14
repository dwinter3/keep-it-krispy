/**
 * Stdio MCP server for Claude Desktop.
 * This runs as a local process that Claude Desktop communicates with via stdin/stdout.
 *
 * Enhanced with:
 * - DynamoDB for fast transcript listing
 * - S3 Vectors for semantic search
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
  NODE_VERSION: process.version,
});

let s3Client: S3TranscriptClient;
let dynamoClient: DynamoTranscriptClient;
let vectorsClient: VectorsClient;

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
  const startTime = Date.now();

  debug(`tools/call: ${name}`, { args });

  try {
    switch (name) {
      case 'list_transcripts': {
        const speaker = args?.speaker as string | undefined;
        const limit = (args?.limit as number) || 20;

        let transcripts;

        if (speaker) {
          debug('list_transcripts: using speaker GSI', { speaker, limit });
          transcripts = await dynamoClient.listBySpeaker(speaker, limit);
        } else if (args?.start_date || args?.end_date) {
          const endDate = args?.end_date as string || new Date().toISOString().slice(0, 10);
          const startDate = args?.start_date as string ||
            new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          debug('list_transcripts: using date range', { startDate, endDate, limit });
          transcripts = await dynamoClient.listByDateRange(startDate, endDate, limit);
        } else {
          debug('list_transcripts: getting recent', { limit });
          transcripts = await dynamoClient.listRecent(limit);
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

        debug('search_transcripts: starting semantic search', { query, meetingIdFilter, limit });

        // Use semantic search with S3 Vectors
        const vectorResults = await vectorsClient.search(query, limit * 2, meetingIdFilter);
        debug(`search_transcripts: got ${vectorResults.length} vector results in ${Date.now() - startTime}ms`);

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

      case 'get_transcripts': {
        const keys = args?.keys as string[];
        debug('get_transcripts: fetching from S3', { keys });

        const transcripts = await s3Client.getTranscripts(keys);
        debug(`get_transcripts: fetched ${transcripts.length} transcripts in ${Date.now() - startTime}ms`);

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

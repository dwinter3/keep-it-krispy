/**
 * Local server for testing MCP endpoints.
 */

import express, { Request, Response } from 'express';
import { S3TranscriptClient } from './s3-client.js';

const app = express();
app.use(express.json());

const s3Client = new S3TranscriptClient();

const SERVER_INFO = {
  name: 'Keep It Krispy',
  version: '1.0.0',
};

const CAPABILITIES = {
  tools: {},
};

const TOOLS = [
  {
    name: 'list_transcripts',
    description: 'List recent Krisp meeting transcripts.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD)' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD)' },
        limit: { type: 'number', description: 'Max transcripts to return' },
      },
    },
  },
  {
    name: 'search_transcripts',
    description: 'Search transcripts by keyword or speaker.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        speaker: { type: 'string', description: 'Filter by speaker' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_transcripts',
    description: 'Fetch full transcript content by S3 keys.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'array', items: { type: 'string' }, description: 'S3 keys' },
      },
      required: ['keys'],
    },
  },
];

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params?: Record<string, unknown>;
  id: number | string | null;
}

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'healthy', service: 'krisp-mcp', version: '1.0.0' });
});

app.post(['/', '/mcp', '/mcp/'], async (req: Request, res: Response) => {
  const request = req.body as JsonRpcRequest;
  const { method, params, id } = request;

  console.log('MCP Request:', method, params);

  try {
    let result: unknown;

    switch (method) {
      case 'initialize':
        result = {
          protocolVersion: '2024-11-05',
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
        };
        break;

      case 'notifications/initialized':
        result = null;
        break;

      case 'tools/list':
        result = { tools: TOOLS };
        break;

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        switch (toolName) {
          case 'list_transcripts': {
            const startDate = toolArgs.start_date ? new Date(toolArgs.start_date as string) : undefined;
            const endDate = toolArgs.end_date ? new Date(toolArgs.end_date as string) : undefined;
            const limit = (toolArgs.limit as number) || 20;
            const transcripts = await s3Client.listTranscripts(startDate, endDate, limit);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({ count: transcripts.length, transcripts }, null, 2),
              }],
            };
            break;
          }

          case 'search_transcripts': {
            const query = toolArgs.query as string;
            const speaker = toolArgs.speaker as string | undefined;
            const limit = (toolArgs.limit as number) || 10;
            const results = await s3Client.search(query, speaker, limit);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({ query, count: results.length, results }, null, 2),
              }],
            };
            break;
          }

          case 'get_transcripts': {
            const keys = toolArgs.keys as string[];
            const transcripts = await s3Client.getTranscripts(keys);
            result = {
              content: [{
                type: 'text',
                text: JSON.stringify({ count: transcripts.length, transcripts }, null, 2),
              }],
            };
            break;
          }

          default:
            res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Unknown tool: ${toolName}` }, id });
            return;
        }
        break;
      }

      default:
        res.json({ jsonrpc: '2.0', error: { code: -32601, message: `Method not found: ${method}` }, id });
        return;
    }

    res.json({ jsonrpc: '2.0', result, id });
  } catch (error) {
    console.error('Error:', error);
    res.json({ jsonrpc: '2.0', error: { code: -32603, message: String(error) }, id });
  }
});

const PORT = parseInt(process.env.PORT || '8080');
app.listen(PORT, () => {
  console.log(`Local MCP server running on http://localhost:${PORT}`);
});

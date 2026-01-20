/**
 * Lambda handler for Keep It Krispy MCP Server.
 *
 * Implements MCP protocol directly with Lambda response streaming.
 * Supports API key authentication via X-API-Key header.
 */

import 'aws-lambda'; // Import for awslambda global types
import { S3TranscriptClient } from './s3-client.js';
import { DynamoTranscriptClient } from './dynamo-client.js';
import { getUserContext, UserContext, debugAuthContext } from './auth.js';

interface FunctionUrlEvent {
  version: string;
  routeKey: string;
  rawPath: string;
  rawQueryString: string;
  headers: Record<string, string>;
  body?: string;
  isBase64Encoded: boolean;
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
}

// Use awslambda.HttpResponseStream from @types/aws-lambda
type ResponseStream = awslambda.HttpResponseStream;

interface JsonRpcRequest {
  jsonrpc: string;
  method: string;
  params?: Record<string, unknown>;
  id: number | string | null;
}

interface JsonRpcResponse {
  jsonrpc: string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
  id: number | string | null;
}

// Initialize clients outside handler for reuse
const s3Client = new S3TranscriptClient();
const dynamoClient = new DynamoTranscriptClient();

/**
 * Extract API key from request headers.
 * Supports both 'X-API-Key' and 'x-api-key' (case-insensitive).
 */
function extractApiKey(headers: Record<string, string>): string | undefined {
  // Headers are typically lowercased by API Gateway/Lambda
  return headers['x-api-key'] || headers['X-API-Key'] || headers['authorization']?.replace(/^Bearer\s+/i, '');
}

/**
 * Create a 401 Unauthorized response.
 */
function createUnauthorizedResponse(
  responseStream: ResponseStream,
  corsHeaders: Record<string, string>,
  message: string = 'Authentication required. Provide API key via X-API-Key header or set KRISP_USER_ID environment variable.'
): void {
  const httpStream = awslambda.HttpResponseStream.from(responseStream, {
    statusCode: 401,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'WWW-Authenticate': 'Bearer realm="krisp-mcp"',
    },
  });
  httpStream.write(JSON.stringify({
    error: 'Unauthorized',
    message,
  }));
  httpStream.end();
}

// MCP Server implementation
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
    description: 'List recent Krisp meeting transcripts. Returns metadata including title, date, and S3 key for each transcript.',
    inputSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'Start date (YYYY-MM-DD). Defaults to 30 days ago.' },
        end_date: { type: 'string', description: 'End date (YYYY-MM-DD). Defaults to today.' },
        limit: { type: 'number', description: 'Maximum number of transcripts to return (default: 20)' },
      },
    },
  },
  {
    name: 'search_transcripts',
    description: 'Search meeting transcripts by keyword in content, summary, or notes. Optionally filter by speaker name.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query to find in transcripts' },
        speaker: { type: 'string', description: 'Filter by speaker name (partial match)' },
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
  {
    name: 'list_speakers',
    description: 'List known speakers from meetings. Returns speaker entities with their metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum speakers to return (default: 50)' },
        company: { type: 'string', description: 'Filter by company name' },
      },
    },
  },
  {
    name: 'list_companies',
    description: 'List known companies from meetings. Returns company entities with their metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum companies to return (default: 50)' },
      },
    },
  },
];

async function handleMcpRequest(request: JsonRpcRequest, userContext: UserContext): Promise<JsonRpcResponse> {
  const { method, params, id } = request;
  // User ID for multi-tenant data isolation
  // TODO: Pass userId to S3TranscriptClient methods when user-scoped queries are implemented
  const userId = userContext.userId;

  // Log tool calls with user context for audit trail
  if (method === 'tools/call') {
    console.log(`[MCP] Tool call: ${params?.name} by user ${userId.substring(0, 8)}...`);
  }

  try {
    switch (method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          result: {
            protocolVersion: '2024-11-05',
            capabilities: CAPABILITIES,
            serverInfo: SERVER_INFO,
          },
          id,
        };

      case 'notifications/initialized':
        // No response needed for notifications
        return { jsonrpc: '2.0', result: null, id };

      case 'tools/list':
        return {
          jsonrpc: '2.0',
          result: { tools: TOOLS },
          id,
        };

      case 'tools/call': {
        const toolName = params?.name as string;
        const toolArgs = (params?.arguments || {}) as Record<string, unknown>;

        switch (toolName) {
          case 'list_transcripts': {
            const startDate = toolArgs.start_date ? new Date(toolArgs.start_date as string) : undefined;
            const endDate = toolArgs.end_date ? new Date(toolArgs.end_date as string) : undefined;
            const limit = (toolArgs.limit as number) || 20;

            const transcripts = await s3Client.listTranscripts(startDate, endDate, limit);

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'search_transcripts': {
            const query = toolArgs.query as string;
            const speaker = toolArgs.speaker as string | undefined;
            const limit = (toolArgs.limit as number) || 10;

            const results = await s3Client.search(query, speaker, limit);

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'get_transcripts': {
            const keys = toolArgs.keys as string[];
            const transcripts = await s3Client.getTranscripts(keys);

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'list_linkedin_connections': {
            const limit = (toolArgs.limit as number) || 50;
            const search = toolArgs.search as string | undefined;

            const stats = await dynamoClient.getLinkedInStats(userId);
            const connections = await dynamoClient.listLinkedInConnections(userId, { limit, search });

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'match_linkedin_connection': {
            const speakerName = toolArgs.speaker_name as string;
            const companyHint = toolArgs.company_hint as string | undefined;

            const match = await dynamoClient.matchLinkedInConnection(
              userId,
              speakerName,
              companyHint ? { companies: [companyHint] } : undefined
            );

            if (!match) {
              return {
                jsonrpc: '2.0',
                result: {
                  content: [{
                    type: 'text',
                    text: JSON.stringify({
                      found: false,
                      speakerName,
                      message: 'No matching LinkedIn connection found. The speaker may not be a 1st-degree connection.',
                    }, null, 2),
                  }],
                },
                id,
              };
            }

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'get_speaker_context': {
            const speakerName = toolArgs.speaker_name as string;
            const context = await dynamoClient.getSpeakerContext(userId, speakerName);

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'list_speakers': {
            const limit = (toolArgs.limit as number) || 50;
            const company = toolArgs.company as string | undefined;

            const speakers = await dynamoClient.listSpeakers(userId, { limit, company });

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          case 'list_companies': {
            const limit = (toolArgs.limit as number) || 50;

            const companies = await dynamoClient.listCompanies(userId, { limit });

            return {
              jsonrpc: '2.0',
              result: {
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
              },
              id,
            };
          }

          default:
            return {
              jsonrpc: '2.0',
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
              id,
            };
        }
      }

      default:
        return {
          jsonrpc: '2.0',
          error: { code: -32601, message: `Method not found: ${method}` },
          id,
        };
    }
  } catch (error) {
    console.error('Error handling MCP request:', error);
    const errorMessage = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);
    return {
      jsonrpc: '2.0',
      error: { code: -32603, message: errorMessage },
      id,
    };
  }
}

export const handler = awslambda.streamifyResponse(
  async (event: FunctionUrlEvent, responseStream: ResponseStream): Promise<void> => {
    const path = event.rawPath;
    const method = event.requestContext.http.method;

    // Log all requests for debugging
    console.log('Request:', JSON.stringify({
      path,
      method,
      headers: event.headers,
      bodyPreview: event.body?.substring(0, 500),
    }));

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization',
    };

    // Health check
    if (path === '/health' && method === 'GET') {
      const httpStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      httpStream.write(JSON.stringify({
        status: 'healthy',
        service: 'krisp-mcp',
        version: '1.0.0',
      }));
      httpStream.end();
      return;
    }

    // CORS preflight
    if (method === 'OPTIONS') {
      const httpStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      httpStream.write('{}');
      httpStream.end();
      return;
    }

    // Auth verification endpoint - allows clients to verify their API key
    if (path === '/auth' && method === 'GET') {
      const apiKey = extractApiKey(event.headers);
      const userContext = await getUserContext(apiKey);

      if (!userContext) {
        createUnauthorizedResponse(responseStream, corsHeaders);
        return;
      }

      const httpStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
      httpStream.write(JSON.stringify({
        authenticated: true,
        user_id: userContext.userId.substring(0, 8) + '...', // Partial ID for privacy
        auth_source: userContext.source,
        email: userContext.email ? userContext.email.replace(/(.{2}).*(@.*)/, '$1***$2') : undefined,
      }));
      httpStream.end();
      return;
    }

    // MCP endpoint - accept at root or /mcp
    if ((path === '/' || path === '/mcp' || path === '/mcp/') && method === 'POST') {
      // Authenticate the request
      const apiKey = extractApiKey(event.headers);
      const userContext = await getUserContext(apiKey);

      if (!userContext) {
        console.log('[AUTH] Authentication failed - no valid API key or KRISP_USER_ID');
        createUnauthorizedResponse(responseStream, corsHeaders);
        return;
      }

      console.log(`[AUTH] ${debugAuthContext(userContext)}`);

      try {
        const body = event.body
          ? (event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString() : event.body)
          : '{}';

        const request = JSON.parse(body) as JsonRpcRequest;
        const response = await handleMcpRequest(request, userContext);

        const httpStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        httpStream.write(JSON.stringify(response));
        httpStream.end();
      } catch (error) {
        console.error('Error:', error);
        const httpStream = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
        httpStream.write(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32700, message: 'Parse error' },
          id: null,
        }));
        httpStream.end();
      }
      return;
    }

    // 404
    const httpStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
    httpStream.write(JSON.stringify({ error: 'Not found' }));
    httpStream.end();
  }
);

/**
 * Lambda handler for Keep It Krispy MCP Server.
 *
 * Uses Express with Lambda Web Adapter for reliable serverless deployment.
 */

import express, { Request, Response } from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';

const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    service: 'krisp-mcp',
    version: '1.0.0',
  });
});

// MCP endpoint - handles all MCP protocol requests
app.post('/mcp', async (req: Request, res: Response) => {
  try {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // Stateless mode for Lambda
    });

    await server.connect(transport);

    // Handle the MCP request
    await transport.handleRequest(req, res, req.body);

    // Cleanup on connection close
    req.on('close', () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error('MCP error:', error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
        },
        id: null,
      });
    }
  }
});

// Handle GET/DELETE for session management (if needed)
app.get('/mcp', async (req: Request, res: Response) => {
  res.status(405).json({
    jsonrpc: '2.0',
    error: {
      code: -32601,
      message: 'Method not allowed. Use POST for MCP requests.',
    },
    id: null,
  });
});

// 404 for other routes
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
const PORT = parseInt(process.env.AWS_LWA_PORT || process.env.PORT || '8080');
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP server running on port ${PORT}`);
});

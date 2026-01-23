/**
 * Stdio MCP server for Claude Desktop.
 * This runs as a local process that Claude Desktop communicates with via stdin/stdout.
 *
 * All operations go through the Keep It Krispy SaaS API for proper authentication
 * and tenant isolation. Requires KRISP_API_KEY environment variable.
 *
 * Debug logs go to stderr and appear in ~/Library/Logs/Claude/mcp-server-krisp.log
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

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
  VECTOR_BUCKET: process.env.VECTOR_BUCKET,
  VECTOR_INDEX: process.env.VECTOR_INDEX,
  AWS_PROFILE: process.env.AWS_PROFILE,
  KRISP_USER_ID: process.env.KRISP_USER_ID ? '(set)' : '(not set)',
  KRISP_API_KEY: process.env.KRISP_API_KEY ? '(set)' : '(not set)',
  NODE_VERSION: process.version,
});

async function main() {
  debug('Starting server...');

  try {
    // Create server - requires KRISP_API_KEY
    const server = createServer();
    debug('Server created');

    // Create stdio transport
    const transport = new StdioServerTransport();
    debug('Connecting to transport...');

    // Connect server to transport
    await server.connect(transport);
    debug('Server connected and ready');
  } catch (error) {
    debug('FATAL: Failed to start server', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    process.exit(1);
  }
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

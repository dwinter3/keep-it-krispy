/**
 * MCP App Registration Module
 *
 * Registers interactive MCP App tools and their UI resources with the MCP server.
 * Each app tool provides a visual interface alongside the data returned to Claude.
 *
 * Tools registered here complement (not replace) the existing programmatic tools
 * in server.ts. The app tools are best for visual exploration, while the standard
 * tools are best for programmatic data access.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool, registerAppResource, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { z } from 'zod';
import { KrispyApiClient } from '../krispy-api-client.js';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve the directory containing built app HTML files.
 *
 * In CJS bundled mode (dist/stdio-server.cjs), __dirname points to dist/,
 * so HTML files are at dist/apps/*.html.
 *
 * In ESM dev mode, resolve relative to this source file's location.
 */
function getDistAppsDir(): string {
  if (typeof __dirname !== 'undefined') {
    return path.join(__dirname, 'apps');
  }
  const currentFilePath = new URL(import.meta.url).pathname;
  return path.join(path.dirname(currentFilePath), '..', '..', 'dist', 'apps');
}

/**
 * Load a built HTML file for an MCP App.
 *
 * Each app is built into its own subdirectory: apps/{appName}/{appName}.html
 */
function loadAppHtml(appName: string): string {
  return fs.readFileSync(path.join(getDistAppsDir(), appName, `${appName}.html`), 'utf-8');
}

/**
 * Register all interactive MCP App tools and their UI resources.
 *
 * @param server - The MCP server instance
 * @param apiClient - The authenticated Krispy API client
 */
export function registerApps(server: McpServer, apiClient: KrispyApiClient): void {
  // ─── Meeting Dashboard ───────────────────────────────────────────────

  const meetingDashboardUri = 'ui://meeting-dashboard/meeting-dashboard.html';

  registerAppTool(
    server,
    'meeting_dashboard',
    {
      description:
        'Opens an interactive visual dashboard for browsing your meetings with stats, filters, and multi-select. Use this when the user wants to visually explore or browse their meetings. For programmatic data access, prefer list_transcripts instead.',
      _meta: {
        ui: { resourceUri: meetingDashboardUri },
      },
    },
    async () => {
      try {
        const data = await apiClient.listTranscripts({ limit: 20 });
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data) }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to load meeting dashboard data',
              }),
            },
          ],
        };
      }
    }
  );

  registerAppResource(
    server,
    meetingDashboardUri,
    meetingDashboardUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: meetingDashboardUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadAppHtml('meeting-dashboard'),
        },
      ],
    })
  );

  // ─── Transcript Viewer ───────────────────────────────────────────────

  const transcriptViewerUri = 'ui://transcript-viewer/transcript-viewer.html';

  registerAppTool(
    server,
    'transcript_viewer',
    {
      description:
        'Opens an interactive transcript reader with speaker-colored chat bubbles, talk-time visualization, and searchable text. Use when the user wants to read or explore a specific transcript visually. For extracting specific data, prefer get_transcripts instead.',
      inputSchema: {
        meeting_id: z.string().describe('Meeting ID to display'),
      },
      _meta: {
        ui: { resourceUri: transcriptViewerUri },
      },
    },
    async ({ meeting_id }) => {
      try {
        const transcripts = await apiClient.getTranscripts([meeting_id], { summaryOnly: true });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                meeting_id,
                transcript: transcripts[0] || null,
              }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to load transcript data',
                meeting_id,
              }),
            },
          ],
        };
      }
    }
  );

  registerAppResource(
    server,
    transcriptViewerUri,
    transcriptViewerUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: transcriptViewerUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadAppHtml('transcript-viewer'),
        },
      ],
    })
  );

  // ─── Speaker Profile ─────────────────────────────────────────────────

  const speakerProfileUri = 'ui://speaker-profile/speaker-profile.html';

  registerAppTool(
    server,
    'speaker_profile',
    {
      description:
        'Opens an interactive speaker profile with meeting history, LinkedIn info, and enriched bio. Use when the user wants to visually explore a speaker\'s profile. For speaker data access, prefer get_speaker_context instead.',
      inputSchema: {
        speaker_name: z.string().describe('Speaker name to view'),
      },
      _meta: {
        ui: { resourceUri: speakerProfileUri },
      },
    },
    async ({ speaker_name }) => {
      try {
        const context = await apiClient.getSpeakerContext(speaker_name);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(context),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to load speaker profile data',
                speaker_name,
              }),
            },
          ],
        };
      }
    }
  );

  registerAppResource(
    server,
    speakerProfileUri,
    speakerProfileUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: speakerProfileUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadAppHtml('speaker-profile'),
        },
      ],
    })
  );

  // ─── Search Explorer ──────────────────────────────────────────────────

  const searchExplorerUri = 'ui://search-explorer/search-explorer.html';

  registerAppTool(
    server,
    'search_explorer',
    {
      description:
        'Opens an interactive semantic search interface with real-time results, relevance scoring, and multi-select. Use when the user wants to visually explore search results. For programmatic search, prefer search_transcripts instead.',
      inputSchema: {
        query: z.string().optional().describe('Initial search query (optional)'),
      },
      _meta: {
        ui: { resourceUri: searchExplorerUri },
      },
    },
    async ({ query }) => {
      try {
        if (query) {
          const results = await apiClient.search(query, { limit: 10 });
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(results),
              },
            ],
          };
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ initial_query: null }),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                error: error instanceof Error ? error.message : 'Failed to execute search',
                query,
              }),
            },
          ],
        };
      }
    }
  );

  registerAppResource(
    server,
    searchExplorerUri,
    searchExplorerUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async () => ({
      contents: [
        {
          uri: searchExplorerUri,
          mimeType: RESOURCE_MIME_TYPE,
          text: loadAppHtml('search-explorer'),
        },
      ],
    })
  );

  console.error('[MCP] Registered 4 MCP App tools and 4 UI resources');
}

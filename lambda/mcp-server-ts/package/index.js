"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/lambda-handler.ts
var lambda_handler_exports = {};
__export(lambda_handler_exports, {
  handler: () => handler
});
module.exports = __toCommonJS(lambda_handler_exports);

// src/s3-client.ts
var import_client_s3 = require("@aws-sdk/client-s3");
var BUCKET_NAME = process.env.KRISP_S3_BUCKET || "krisp-transcripts-754639201213";
var AWS_REGION = process.env.AWS_REGION || "us-east-1";
var KEY_PATTERN = /^(\d{8})_(\d{6})_(.+)_([^_]+)\.json$/;
var S3TranscriptClient = class {
  s3;
  bucket;
  constructor() {
    this.s3 = new import_client_s3.S3Client({ region: AWS_REGION });
    this.bucket = BUCKET_NAME;
  }
  async listTranscripts(startDate, endDate, limit = 20) {
    const end = endDate || /* @__PURE__ */ new Date();
    const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1e3);
    const prefixes = this.generateDatePrefixes(start, end);
    const allObjects = [];
    for (const prefix of prefixes) {
      let continuationToken;
      do {
        const command = new import_client_s3.ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken
        });
        const response = await this.s3.send(command);
        for (const obj of response.Contents || []) {
          if (obj.Key?.endsWith(".json")) {
            const metadata = this.parseKeyMetadata(obj.Key, obj);
            if (metadata && metadata.date >= start && metadata.date <= end) {
              allObjects.push(metadata);
            }
          }
        }
        continuationToken = response.NextContinuationToken;
      } while (continuationToken);
    }
    allObjects.sort((a, b) => b.date.getTime() - a.date.getTime());
    return allObjects.slice(0, limit);
  }
  async getTranscript(key) {
    const command = new import_client_s3.GetObjectCommand({
      Bucket: this.bucket,
      Key: key
    });
    const response = await this.s3.send(command);
    const bodyString = await response.Body?.transformToString();
    return JSON.parse(bodyString || "{}");
  }
  async getTranscripts(keys) {
    const results = [];
    for (const key of keys) {
      try {
        const content = await this.getTranscript(key);
        const raw = content.raw_payload || {};
        results.push({
          key,
          title: raw.title || "Untitled",
          summary: raw.summary || "",
          notes: raw.notes || "",
          transcript: raw.transcript || "",
          actionItems: raw.action_items || [],
          speakers: (raw.speakers || []).map((s) => s.name || ""),
          receivedAt: content.received_at || "",
          eventType: content.event_type || "",
          error: null
        });
      } catch (e) {
        results.push({
          key,
          title: "",
          summary: "",
          notes: "",
          transcript: "",
          actionItems: [],
          speakers: [],
          receivedAt: "",
          eventType: "",
          error: String(e)
        });
      }
    }
    return results;
  }
  async search(query, speaker, limit = 10) {
    const recent = await this.listTranscripts(
      new Date(Date.now() - 90 * 24 * 60 * 60 * 1e3),
      /* @__PURE__ */ new Date(),
      200
    );
    const results = [];
    const queryLower = query.toLowerCase();
    for (const meta of recent) {
      try {
        const content = await this.getTranscript(meta.key);
        const raw = content.raw_payload || {};
        if (speaker) {
          const speakers = raw.speakers || [];
          const speakerNames = speakers.map((s) => (s.name || "").toLowerCase());
          if (!speakerNames.some((name) => name.includes(speaker.toLowerCase()))) {
            continue;
          }
        }
        const searchable = [
          raw.transcript || "",
          raw.summary || "",
          raw.notes || "",
          raw.title || ""
        ].join(" ").toLowerCase();
        if (searchable.includes(queryLower)) {
          const snippet = this.extractSnippet(searchable, queryLower);
          results.push({
            ...meta,
            snippet,
            summary: (raw.summary || "").slice(0, 300),
            speakers: (raw.speakers || []).map((s) => s.name || "")
          });
        }
        if (results.length >= limit) {
          break;
        }
      } catch {
        continue;
      }
    }
    return results;
  }
  parseKeyMetadata(key, obj) {
    const parts = key.split("/");
    if (parts.length < 2) return null;
    const filename = parts[parts.length - 1];
    const match = filename.match(KEY_PATTERN);
    let date;
    let title;
    let meetingId;
    if (match) {
      const [, dateStr, timeStr, rawTitle, id] = match;
      date = new Date(
        parseInt(dateStr.slice(0, 4)),
        parseInt(dateStr.slice(4, 6)) - 1,
        parseInt(dateStr.slice(6, 8)),
        parseInt(timeStr.slice(0, 2)),
        parseInt(timeStr.slice(2, 4)),
        parseInt(timeStr.slice(4, 6))
      );
      title = rawTitle.replace(/_/g, " ");
      meetingId = id;
    } else {
      date = obj.LastModified || /* @__PURE__ */ new Date();
      title = filename.replace(".json", "");
      meetingId = "";
    }
    return {
      key,
      title,
      meetingId,
      date,
      dateStr: date.toISOString().slice(0, 16).replace("T", " "),
      size: obj.Size || 0
    };
  }
  generateDatePrefixes(start, end) {
    const prefixes = /* @__PURE__ */ new Set();
    const current = new Date(start);
    while (current <= end) {
      const year = current.getFullYear();
      const month = String(current.getMonth() + 1).padStart(2, "0");
      prefixes.add(`meetings/${year}/${month}/`);
      current.setMonth(current.getMonth() + 1);
      current.setDate(1);
    }
    return Array.from(prefixes).sort();
  }
  extractSnippet(text, query, context = 100) {
    const idx = text.indexOf(query);
    if (idx === -1) {
      return text.length > 200 ? text.slice(0, 200) + "..." : text;
    }
    const start = Math.max(0, idx - context);
    const end = Math.min(text.length, idx + query.length + context);
    let snippet = text.slice(start, end);
    if (start > 0) snippet = "..." + snippet;
    if (end < text.length) snippet = snippet + "...";
    return snippet;
  }
};

// src/lambda-handler.ts
var s3Client = new S3TranscriptClient();
var SERVER_INFO = {
  name: "Keep It Krispy",
  version: "1.0.0"
};
var CAPABILITIES = {
  tools: {}
};
var TOOLS = [
  {
    name: "list_transcripts",
    description: "List recent Krisp meeting transcripts. Returns metadata including title, date, and S3 key for each transcript.",
    inputSchema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Start date (YYYY-MM-DD). Defaults to 30 days ago." },
        end_date: { type: "string", description: "End date (YYYY-MM-DD). Defaults to today." },
        limit: { type: "number", description: "Maximum number of transcripts to return (default: 20)" }
      }
    }
  },
  {
    name: "search_transcripts",
    description: "Search meeting transcripts by keyword in content, summary, or notes. Optionally filter by speaker name.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query to find in transcripts" },
        speaker: { type: "string", description: "Filter by speaker name (partial match)" },
        limit: { type: "number", description: "Maximum results to return (default: 10)" }
      },
      required: ["query"]
    }
  },
  {
    name: "get_transcripts",
    description: "Fetch full content of one or more transcripts by their S3 keys. Use keys from list_transcripts or search_transcripts.",
    inputSchema: {
      type: "object",
      properties: {
        keys: {
          type: "array",
          items: { type: "string" },
          description: "S3 keys of transcripts to fetch"
        }
      },
      required: ["keys"]
    }
  }
];
async function handleMcpRequest(request) {
  const { method, params, id } = request;
  try {
    switch (method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          result: {
            protocolVersion: "2024-11-05",
            capabilities: CAPABILITIES,
            serverInfo: SERVER_INFO
          },
          id
        };
      case "notifications/initialized":
        return { jsonrpc: "2.0", result: null, id };
      case "tools/list":
        return {
          jsonrpc: "2.0",
          result: { tools: TOOLS },
          id
        };
      case "tools/call": {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};
        switch (toolName) {
          case "list_transcripts": {
            const startDate = toolArgs.start_date ? new Date(toolArgs.start_date) : void 0;
            const endDate = toolArgs.end_date ? new Date(toolArgs.end_date) : void 0;
            const limit = toolArgs.limit || 20;
            const transcripts = await s3Client.listTranscripts(startDate, endDate, limit);
            return {
              jsonrpc: "2.0",
              result: {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    count: transcripts.length,
                    transcripts: transcripts.map((t) => ({
                      key: t.key,
                      title: t.title,
                      date: t.dateStr,
                      meeting_id: t.meetingId
                    }))
                  }, null, 2)
                }]
              },
              id
            };
          }
          case "search_transcripts": {
            const query = toolArgs.query;
            const speaker = toolArgs.speaker;
            const limit = toolArgs.limit || 10;
            const results = await s3Client.search(query, speaker, limit);
            return {
              jsonrpc: "2.0",
              result: {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    query,
                    speaker: speaker || null,
                    count: results.length,
                    results: results.map((r) => ({
                      key: r.key,
                      title: r.title,
                      date: r.dateStr,
                      speakers: r.speakers,
                      snippet: r.snippet,
                      summary: r.summary
                    }))
                  }, null, 2)
                }]
              },
              id
            };
          }
          case "get_transcripts": {
            const keys = toolArgs.keys;
            const transcripts = await s3Client.getTranscripts(keys);
            return {
              jsonrpc: "2.0",
              result: {
                content: [{
                  type: "text",
                  text: JSON.stringify({
                    count: transcripts.length,
                    transcripts: transcripts.map((t) => t.error ? {
                      key: t.key,
                      error: t.error
                    } : {
                      key: t.key,
                      title: t.title,
                      summary: t.summary,
                      notes: t.notes,
                      transcript: t.transcript,
                      action_items: t.actionItems,
                      speakers: t.speakers
                    })
                  }, null, 2)
                }]
              },
              id
            };
          }
          default:
            return {
              jsonrpc: "2.0",
              error: { code: -32601, message: `Unknown tool: ${toolName}` },
              id
            };
        }
      }
      default:
        return {
          jsonrpc: "2.0",
          error: { code: -32601, message: `Method not found: ${method}` },
          id
        };
    }
  } catch (error) {
    console.error("Error handling MCP request:", error);
    const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {
      jsonrpc: "2.0",
      error: { code: -32603, message: errorMessage },
      id
    };
  }
}
var handler = awslambda.streamifyResponse(
  async (event, responseStream) => {
    const path = event.rawPath;
    const method = event.requestContext.http.method;
    console.log("Request:", JSON.stringify({
      path,
      method,
      headers: event.headers,
      bodyPreview: event.body?.substring(0, 500)
    }));
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    };
    if (path === "/health" && method === "GET") {
      const httpStream2 = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
      httpStream2.write(JSON.stringify({
        status: "healthy",
        service: "krisp-mcp",
        version: "1.0.0"
      }));
      httpStream2.end();
      return;
    }
    if (method === "OPTIONS") {
      const httpStream2 = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
      httpStream2.write("{}");
      httpStream2.end();
      return;
    }
    if ((path === "/" || path === "/mcp" || path === "/mcp/") && method === "POST") {
      try {
        const body = event.body ? event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body : "{}";
        const request = JSON.parse(body);
        const response = await handleMcpRequest(request);
        const httpStream2 = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
        httpStream2.write(JSON.stringify(response));
        httpStream2.end();
      } catch (error) {
        console.error("Error:", error);
        const httpStream2 = awslambda.HttpResponseStream.from(responseStream, {
          statusCode: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        });
        httpStream2.write(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null
        }));
        httpStream2.end();
      }
      return;
    }
    const httpStream = awslambda.HttpResponseStream.from(responseStream, {
      statusCode: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
    httpStream.write(JSON.stringify({ error: "Not found" }));
    httpStream.end();
  }
);
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  handler
});

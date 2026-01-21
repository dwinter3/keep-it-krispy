/**
 * Keep It Krispy API Client
 *
 * Calls the Keep It Krispy API for authenticated operations.
 * This ensures proper authentication and user isolation.
 */

const API_BASE_URL = process.env.KRISPY_API_URL || 'https://app.krispy.alpha-pm.dev';

export interface SearchResult {
  meetingId: string;
  s3Key: string;
  title: string;
  date: string;
  speakers: string[];
  duration: number;
  topic?: string;
  relevanceScore: number;
  matchingChunks: number;
  snippets: string[];
  type: 'transcript' | 'document';
  format?: string;
  documentId?: string;
}

export interface SearchResponse {
  query: string;
  searchType: string;
  filters: {
    speaker: string | null;
    from: string | null;
    to: string | null;
  };
  count: number;
  results: SearchResult[];
}

export class KrispyApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = API_BASE_URL;
  }

  /**
   * Semantic search across transcripts and documents.
   */
  async search(
    query: string,
    options: {
      limit?: number;
      speaker?: string;
      from?: string;
      to?: string;
    } = {}
  ): Promise<SearchResponse> {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit || 10),
    });

    if (options.speaker) params.set('speaker', options.speaker);
    if (options.from) params.set('from', options.from);
    if (options.to) params.set('to', options.to);

    const url = `${this.baseUrl}/api/search?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Search API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * List recent transcripts.
   */
  async listTranscripts(options: {
    limit?: number;
    cursor?: string;
  } = {}): Promise<unknown> {
    const params = new URLSearchParams({
      limit: String(options.limit || 20),
    });

    if (options.cursor) params.set('cursor', options.cursor);

    const url = `${this.baseUrl}/api/transcripts?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Transcripts API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get a specific transcript by ID.
   */
  async getTranscript(meetingId: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/transcripts/${encodeURIComponent(meetingId)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Transcript API error: ${response.status} - ${error}`);
    }

    return response.json();
  }
}

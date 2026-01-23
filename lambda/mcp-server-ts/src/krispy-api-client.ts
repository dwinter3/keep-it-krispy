/**
 * Keep It Krispy API Client
 *
 * Calls the Keep It Krispy API for authenticated operations.
 * This ensures proper authentication and user isolation.
 *
 * All MCP tools should use this client rather than direct AWS access.
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

export interface TranscriptSummary {
  key: string;
  meetingId: string;
  title: string;
  date: string;
  timestamp: string;
  duration: number;
  speakers: string[];
  topic?: string;
  isPrivate?: boolean;
}

export interface TranscriptListResponse {
  transcripts: TranscriptSummary[];
  nextCursor: string | null;
}

export interface SpeakerStats {
  name: string;
  canonicalName: string;
  meetingCount: number;
  totalDuration: number;
  lastSeen: string;
  linkedin?: string;
}

export interface SpeakersListResponse {
  speakers: SpeakerStats[];
}

export interface SpeakerContext {
  name: string;
  contextKeywords: string[];
  companies: string[];
  topics: string[];
  roleHints: string[];
  transcriptCount: number;
  recentMeetingTitles: string[];
}

export interface Company {
  id: string;
  name: string;
  type?: string;
  description?: string;
  meetingCount?: number;
}

export interface CompaniesListResponse {
  companies: Company[];
}

export interface LinkedInConnection {
  name: string;
  company?: string;
  title?: string;
  linkedinUrl?: string;
}

export interface LinkedInMatchResponse {
  match: LinkedInConnection | null;
  confidence: number;
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

  /**
   * List all speakers from transcripts.
   */
  async listSpeakers(): Promise<SpeakersListResponse> {
    const url = `${this.baseUrl}/api/speakers`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Speakers API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Get context for a specific speaker.
   */
  async getSpeakerContext(speakerName: string): Promise<SpeakerContext> {
    const url = `${this.baseUrl}/api/speakers/${encodeURIComponent(speakerName)}/context`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Speaker context API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * List all companies.
   */
  async listCompanies(options: { limit?: number; type?: string } = {}): Promise<CompaniesListResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.type) params.set('type', options.type);

    const url = `${this.baseUrl}/api/companies${params.toString() ? '?' + params.toString() : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Companies API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * List LinkedIn connections.
   */
  async listLinkedInConnections(options: { limit?: number; search?: string } = {}): Promise<{ connections: LinkedInConnection[] }> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.search) params.set('search', options.search);

    const url = `${this.baseUrl}/api/linkedin${params.toString() ? '?' + params.toString() : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Match a speaker name to a LinkedIn connection.
   */
  async matchLinkedInConnection(
    speakerName: string,
    companyHint?: string
  ): Promise<LinkedInMatchResponse> {
    const params = new URLSearchParams({ speaker: speakerName });
    if (companyHint) params.set('company', companyHint);

    const url = `${this.baseUrl}/api/linkedin/match?${params.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LinkedIn match API error: ${response.status} - ${error}`);
    }

    return response.json();
  }

  /**
   * Update speaker corrections for a transcript.
   */
  async updateSpeakers(
    meetingId: string,
    speakerMappings: Record<string, { name: string; linkedin?: string }>
  ): Promise<{ success: boolean; speakerCorrections: Record<string, unknown> }> {
    const url = `${this.baseUrl}/api/transcripts`;

    // Apply each correction
    for (const [originalName, correction] of Object.entries(speakerMappings)) {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          meetingId,
          speakerCorrection: {
            originalName,
            correctedName: correction.name,
          },
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Speaker update API error: ${response.status} - ${error}`);
      }
    }

    return { success: true, speakerCorrections: speakerMappings };
  }
}

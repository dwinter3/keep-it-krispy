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

export interface TranscriptContent {
  key: string;
  meetingId: string;
  title: string;
  date: string;
  duration: number;
  speakers: string[];
  summary?: string;
  notes?: string;
  actionItems?: string[];
  transcript?: string;
  topic?: string;
  error?: string;
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

export interface EntityRelationship {
  relationshipId: string;
  fromEntity: string;
  toEntity: string;
  relType: string;
  metadata?: Record<string, unknown>;
}

export interface RelationshipsResponse {
  entityId: string;
  relationships: EntityRelationship[];
}

export class KrispyApiClient {
  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.baseUrl = API_BASE_URL;
  }

  private async fetch<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'x-api-key': this.apiKey,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    return response.json();
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

    return this.fetch<SearchResponse>(`/api/search?${params.toString()}`);
  }

  /**
   * List recent transcripts.
   */
  async listTranscripts(options: {
    limit?: number;
    cursor?: string;
    startDate?: string;
    endDate?: string;
    speaker?: string;
  } = {}): Promise<TranscriptListResponse> {
    const params = new URLSearchParams({
      limit: String(options.limit || 20),
    });

    if (options.cursor) params.set('cursor', options.cursor);
    if (options.startDate) params.set('startDate', options.startDate);
    if (options.endDate) params.set('endDate', options.endDate);
    if (options.speaker) params.set('speaker', options.speaker);

    return this.fetch<TranscriptListResponse>(`/api/transcripts?${params.toString()}`);
  }

  /**
   * Get a specific transcript by ID.
   */
  async getTranscript(meetingId: string): Promise<TranscriptContent> {
    return this.fetch<TranscriptContent>(`/api/transcripts/${encodeURIComponent(meetingId)}`);
  }

  /**
   * Get multiple transcripts by meeting IDs.
   */
  async getTranscripts(
    meetingIds: string[],
    options: { summaryOnly?: boolean } = {}
  ): Promise<TranscriptContent[]> {
    const results: TranscriptContent[] = [];

    for (const meetingId of meetingIds) {
      try {
        const params = options.summaryOnly ? '?summaryOnly=true' : '';
        const transcript = await this.fetch<TranscriptContent>(
          `/api/transcripts/${encodeURIComponent(meetingId)}${params}`
        );
        results.push(transcript);
      } catch (error) {
        results.push({
          key: meetingId,
          meetingId: meetingId,
          title: 'Error',
          date: '',
          duration: 0,
          speakers: [],
          error: error instanceof Error ? error.message : 'Failed to fetch transcript',
        });
      }
    }

    return results;
  }

  /**
   * List all speakers from transcripts.
   */
  async listSpeakers(options: {
    limit?: number;
    company?: string;
    verifiedOnly?: boolean;
  } = {}): Promise<SpeakersListResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.company) params.set('company', options.company);
    if (options.verifiedOnly) params.set('verified', 'true');

    const queryString = params.toString();
    return this.fetch<SpeakersListResponse>(`/api/speakers${queryString ? '?' + queryString : ''}`);
  }

  /**
   * Get context for a specific speaker.
   */
  async getSpeakerContext(speakerName: string): Promise<SpeakerContext> {
    return this.fetch<SpeakerContext>(`/api/speakers/${encodeURIComponent(speakerName)}/context`);
  }

  /**
   * List all companies.
   */
  async listCompanies(options: { limit?: number; type?: string } = {}): Promise<CompaniesListResponse> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.type) params.set('type', options.type);

    const queryString = params.toString();
    return this.fetch<CompaniesListResponse>(`/api/companies${queryString ? '?' + queryString : ''}`);
  }

  /**
   * Get relationships for an entity.
   */
  async getEntityRelationships(
    entityId: string,
    options: { relType?: string; direction?: 'from' | 'to' | 'both' } = {}
  ): Promise<RelationshipsResponse> {
    const params = new URLSearchParams();
    if (options.relType) params.set('type', options.relType);
    if (options.direction) params.set('direction', options.direction);

    const queryString = params.toString();
    return this.fetch<RelationshipsResponse>(
      `/api/entities/${encodeURIComponent(entityId)}/relationships${queryString ? '?' + queryString : ''}`
    );
  }

  /**
   * List LinkedIn connections.
   */
  async listLinkedInConnections(
    options: { limit?: number; search?: string } = {}
  ): Promise<{ connections: LinkedInConnection[] }> {
    const params = new URLSearchParams();
    if (options.limit) params.set('limit', String(options.limit));
    if (options.search) params.set('search', options.search);

    const queryString = params.toString();
    return this.fetch<{ connections: LinkedInConnection[] }>(
      `/api/linkedin${queryString ? '?' + queryString : ''}`
    );
  }

  /**
   * Match a speaker name to a LinkedIn connection.
   */
  async matchLinkedInConnection(
    speakerName: string,
    companyHint?: string
  ): Promise<LinkedInMatchResponse> {
    const params = new URLSearchParams({ name: speakerName });
    if (companyHint) params.set('context', companyHint);

    return this.fetch<LinkedInMatchResponse>(`/api/linkedin/match?${params.toString()}`);
  }

  /**
   * Update speaker corrections for a transcript.
   */
  async updateSpeakers(
    meetingId: string,
    speakerMappings: Record<string, { name: string; linkedin?: string }>
  ): Promise<{ success: boolean; speakerCorrections: Record<string, unknown> }> {
    // Apply each correction
    for (const [originalName, correction] of Object.entries(speakerMappings)) {
      await this.fetch('/api/transcripts', {
        method: 'PATCH',
        body: JSON.stringify({
          meetingId,
          speakerCorrection: {
            originalName,
            correctedName: correction.name,
          },
        }),
      });
    }

    return { success: true, speakerCorrections: speakerMappings };
  }
}

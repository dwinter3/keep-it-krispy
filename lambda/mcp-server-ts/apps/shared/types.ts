// From list_transcripts tool response
export interface TranscriptMeta {
  meeting_id: string;
  title: string;
  date: string;
  timestamp?: string;
  duration: number; // seconds
  speakers: string[];
  topic?: string;
  summary?: string;
  notes?: string;
  action_items?: string[];
  s3_key?: string;
  privacy_level?: string;
}

// From get_transcripts tool (full content)
export interface TranscriptContent extends TranscriptMeta {
  transcript?: string;
  speaker_corrections?: Record<string, string>;
}

// From search_transcripts tool
export interface SearchResult {
  meetingId: string;
  s3Key?: string;
  title: string;
  date: string;
  speakers: string[];
  duration: number;
  topic?: string;
  relevanceScore: number;
  matchingChunks: number;
  snippets: string[];
  type?: string;
  format?: string;
  documentId?: string;
}

export interface SearchResponse {
  query: string;
  searchType: string;
  filters: Record<string, unknown>;
  count: number;
  results: SearchResult[];
}

// From get_speaker_context tool
export interface SpeakerContext {
  speakerName: string;
  enrichedProfile?: {
    name: string;
    role?: string;
    company?: string;
    linkedin?: string;
    summary?: string;
    topics?: string[];
  };
  linkedinMatch?: {
    name: string;
    position?: string;
    company?: string;
    email?: string;
    confidence: number;
  };
  entityInfo?: Record<string, unknown>;
  transcriptCount?: number;
  totalDuration?: number;
  lastSeen?: string;
}

// From list_speakers tool
export interface SpeakerEntity {
  name: string;
  company?: string;
  role?: string;
  meetingCount?: number;
  verified?: boolean;
}

// From list_companies tool
export interface CompanyEntity {
  name: string;
  type?: string;
  meetingCount?: number;
}

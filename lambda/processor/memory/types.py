"""
Memory Provider Abstraction Types

Type definitions for vector storage and semantic search operations.
Mirrors the TypeScript types in /src/lib/memory/types.ts for consistency.
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any, Literal


# Supported provider types
ProviderType = Literal["s3-vectors", "ruvector", "dual", "ab-router", "mock"]


@dataclass
class VectorMetadata:
    """Metadata attached to each vector."""

    meeting_id: str
    s3_key: str
    chunk_index: int
    speaker: Optional[str] = None
    text: Optional[str] = None
    user_id: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, str]:
        """Convert to dict for storage (string values only)."""
        result = {
            "meeting_id": self.meeting_id,
            "s3_key": self.s3_key,
            "chunk_index": str(self.chunk_index),
            "speaker": self.speaker or "unknown",
            "text": (self.text or "")[:500],  # Truncate for storage
        }
        if self.user_id:
            result["user_id"] = self.user_id
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, str]) -> "VectorMetadata":
        """Create from dict (storage format)."""
        return cls(
            meeting_id=data.get("meeting_id", ""),
            s3_key=data.get("s3_key", ""),
            chunk_index=int(data.get("chunk_index", "0")),
            speaker=data.get("speaker"),
            text=data.get("text"),
            user_id=data.get("user_id"),
        )


@dataclass
class VectorDocument:
    """Vector with metadata for storage."""

    id: str
    vector: List[float]
    metadata: VectorMetadata


@dataclass
class SearchFilter:
    """Filter criteria for search."""

    meeting_id: Optional[str] = None
    user_id: Optional[str] = None
    speaker: Optional[str] = None
    date_from: Optional[str] = None
    date_to: Optional[str] = None


@dataclass
class SearchOptions:
    """Search query options."""

    top_k: int = 10
    filter: Optional[SearchFilter] = None
    include_metadata: bool = True
    include_vector: bool = False
    min_score: Optional[float] = None


@dataclass
class SearchResult:
    """Single search result."""

    id: str
    score: float
    metadata: VectorMetadata
    vector: Optional[List[float]] = None


@dataclass
class MeetingSearchResult:
    """Grouped search results by meeting."""

    meeting_id: str
    s3_key: str
    score: float
    matching_chunks: int
    snippets: List[str]


@dataclass
class BatchResult:
    """Batch operation result."""

    successful: int
    failed: int
    errors: Optional[List[Dict[str, str]]] = None


@dataclass
class HealthStatus:
    """Provider health status."""

    healthy: bool
    provider: str
    latency_ms: Optional[float] = None
    error: Optional[str] = None


@dataclass
class ProviderCapabilities:
    """Memory provider capabilities."""

    max_vector_dimensions: int
    max_batch_size: int
    supports_filtering: bool
    supports_metadata: bool
    supports_deletion: bool
    supports_update: bool


@dataclass
class ProviderConfig:
    """Provider configuration options."""

    # S3 Vectors specific
    bucket: Optional[str] = None
    index_name: Optional[str] = None

    # Bedrock/Titan specific
    embedding_model: Optional[str] = None
    embedding_dimensions: Optional[int] = None

    # Common
    region: Optional[str] = None
    max_batch_size: Optional[int] = None

    # RuVector specific
    endpoint: Optional[str] = None
    collection: Optional[str] = None

    # Dual-write specific
    primary_provider: Optional[ProviderType] = None
    secondary_provider: Optional[ProviderType] = None

    # A/B testing specific
    ab_percentage: Optional[int] = None
    ab_enable_shadow: Optional[bool] = None
    ab_enable_metrics: Optional[bool] = None


@dataclass
class EmbeddingConfig:
    """Configuration for embedding generation."""

    model: str
    dimensions: int
    normalize: bool = True

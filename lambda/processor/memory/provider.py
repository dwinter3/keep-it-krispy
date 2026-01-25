"""
Abstract Memory Provider Interface

All memory backends must implement this interface.
This allows swapping between S3 Vectors, RuVector, Pinecone, etc.
"""

from abc import ABC, abstractmethod
from typing import List, Optional

from .types import (
    VectorDocument,
    VectorMetadata,
    SearchOptions,
    SearchResult,
    MeetingSearchResult,
    BatchResult,
    HealthStatus,
    ProviderCapabilities,
    ProviderConfig,
)
from .embedding_provider import EmbeddingProvider


class MemoryProvider(ABC):
    """Abstract base class for memory providers."""

    def __init__(
        self, config: ProviderConfig, embedding_provider: Optional[EmbeddingProvider] = None
    ):
        self.config = config
        self._embedding_provider = embedding_provider

    @property
    @abstractmethod
    def name(self) -> str:
        """Get provider name for logging/debugging."""
        pass

    @property
    @abstractmethod
    def capabilities(self) -> ProviderCapabilities:
        """Get provider capabilities."""
        pass

    @property
    def embedding_provider(self) -> Optional[EmbeddingProvider]:
        """Get the embedding provider if available."""
        return self._embedding_provider

    # ============================================
    # EMBEDDING OPERATIONS
    # ============================================

    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Uses the configured embedding provider.
        """
        if not self._embedding_provider:
            raise RuntimeError(
                f"{self.name} has no embedding provider configured. "
                "Set EMBEDDING_PROVIDER=bedrock or pass one to constructor."
            )
        return self._embedding_provider.generate_embedding(text)

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.

        Uses the configured embedding provider.
        """
        if not self._embedding_provider:
            raise RuntimeError(
                f"{self.name} has no embedding provider configured. "
                "Set EMBEDDING_PROVIDER=bedrock or pass one to constructor."
            )
        return self._embedding_provider.generate_embeddings(texts)

    # ============================================
    # VECTOR STORAGE OPERATIONS
    # ============================================

    @abstractmethod
    def store(self, document: VectorDocument) -> None:
        """Store a single vector with metadata."""
        pass

    @abstractmethod
    def store_batch(self, documents: List[VectorDocument]) -> BatchResult:
        """Store multiple vectors in a batch."""
        pass

    @abstractmethod
    def delete(self, id: str) -> None:
        """Delete a single vector by ID."""
        pass

    @abstractmethod
    def delete_batch(self, ids: List[str]) -> BatchResult:
        """Delete multiple vectors by IDs."""
        pass

    @abstractmethod
    def delete_by_meeting_id(self, meeting_id: str) -> BatchResult:
        """Delete all vectors for a meeting."""
        pass

    @abstractmethod
    def update_metadata(self, id: str, metadata: VectorMetadata) -> None:
        """Update vector metadata (without changing the vector)."""
        pass

    # ============================================
    # SEARCH OPERATIONS
    # ============================================

    @abstractmethod
    def search(
        self, embedding: List[float], options: Optional[SearchOptions] = None
    ) -> List[SearchResult]:
        """Search for similar vectors by embedding."""
        pass

    def search_by_text(
        self, query: str, options: Optional[SearchOptions] = None
    ) -> List[SearchResult]:
        """
        Search by text query (generates embedding internally).

        Args:
            query: Text query to search for
            options: Search options

        Returns:
            List of search results
        """
        embedding = self.generate_embedding(query)
        return self.search(embedding, options)

    def search_by_meeting(
        self, query: str, options: Optional[SearchOptions] = None
    ) -> List[MeetingSearchResult]:
        """
        Search and group results by meeting.

        Args:
            query: Text query to search for
            options: Search options

        Returns:
            List of meeting-grouped results
        """
        results = self.search_by_text(query, options)
        return self._group_by_meeting(results)

    def _group_by_meeting(self, results: List[SearchResult]) -> List[MeetingSearchResult]:
        """Group search results by meeting ID."""
        meeting_map: dict = {}

        for result in results:
            meeting_id = result.metadata.meeting_id
            if not meeting_id:
                continue

            if meeting_id in meeting_map:
                meeting_map[meeting_id]["scores"].append(result.score)
                if result.metadata.text:
                    meeting_map[meeting_id]["snippets"].append(result.metadata.text)
            else:
                meeting_map[meeting_id] = {
                    "meeting_id": meeting_id,
                    "s3_key": result.metadata.s3_key,
                    "scores": [result.score],
                    "snippets": [result.metadata.text] if result.metadata.text else [],
                }

        # Convert to MeetingSearchResult objects
        meeting_results = []
        for data in meeting_map.values():
            meeting_results.append(
                MeetingSearchResult(
                    meeting_id=data["meeting_id"],
                    s3_key=data["s3_key"],
                    score=max(data["scores"]),
                    matching_chunks=len(data["scores"]),
                    snippets=data["snippets"][:3],  # Top 3 snippets
                )
            )

        # Sort by score descending
        meeting_results.sort(key=lambda x: x.score, reverse=True)
        return meeting_results

    # ============================================
    # UTILITY OPERATIONS
    # ============================================

    @abstractmethod
    def health_check(self) -> HealthStatus:
        """Check provider health."""
        pass

    @abstractmethod
    def get_vector_count(self) -> int:
        """Get vector count (if supported)."""
        pass

    def chunk_text(self, text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
        """Chunk text into smaller pieces for embedding."""
        words = text.split()
        chunks: List[str] = []

        for i in range(0, len(words), chunk_size - overlap):
            chunk = " ".join(words[i : i + chunk_size])
            if chunk.strip():
                chunks.append(chunk)

        return chunks

    def process_transcript(
        self,
        meeting_id: str,
        s3_key: str,
        content: str,
        speakers: Optional[List[str]] = None,
        user_id: Optional[str] = None,
    ) -> BatchResult:
        """
        Process a transcript into vectors.

        Args:
            meeting_id: Meeting identifier
            s3_key: S3 key for the transcript
            content: Transcript text content
            speakers: List of speaker names
            user_id: User ID for multi-tenant filtering

        Returns:
            BatchResult with success/failure counts
        """
        # Chunk the content
        chunks = self.chunk_text(content)

        if not chunks:
            return BatchResult(successful=0, failed=0)

        # Filter to real speaker names
        real_speakers = [
            s
            for s in (speakers or [])
            if s and not s.lower().startswith("speaker ") and s.lower() not in ("unknown", "guest")
        ]

        # Prepare speaker context
        speaker_context = ""
        if real_speakers:
            speaker_context = f"Meeting participants: {', '.join(real_speakers)}. "

        # Generate embeddings and create documents
        documents: List[VectorDocument] = []
        primary_speaker = real_speakers[0] if real_speakers else "unknown"

        for i, chunk in enumerate(chunks):
            text_with_context = speaker_context + chunk
            embedding = self.generate_embedding(text_with_context)

            documents.append(
                VectorDocument(
                    id=f"{meeting_id}_chunk_{i:04d}",
                    vector=embedding,
                    metadata=VectorMetadata(
                        meeting_id=meeting_id,
                        s3_key=s3_key,
                        chunk_index=i,
                        speaker=primary_speaker,
                        text=chunk[:500],
                        user_id=user_id,
                    ),
                )
            )

        # Store in batches
        return self.store_batch(documents)

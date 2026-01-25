"""
RuVector Memory Provider

Implementation using RuVector HTTP API for vector storage and search.
RuVector is a high-performance vector database with built-in ONNX embeddings.
"""

import os
import time
import json
from typing import List, Optional, Any
import urllib.request
import urllib.parse
import urllib.error

from .types import (
    VectorDocument,
    VectorMetadata,
    SearchOptions,
    SearchFilter,
    SearchResult,
    BatchResult,
    HealthStatus,
    ProviderCapabilities,
    ProviderConfig,
)
from .provider import MemoryProvider
from .embedding_provider import EmbeddingProvider


# Default configuration
DEFAULT_ENDPOINT = "http://localhost:8080"
DEFAULT_COLLECTION = "transcript-chunks"
DEFAULT_DIMENSIONS = 384  # all-MiniLM-L6-v2 dimensions


class RuVectorEmbeddingProvider(EmbeddingProvider):
    """
    RuVector embedding provider using built-in ONNX models.

    Uses RuVector's /embed endpoint for embedding generation.
    Default model: all-MiniLM-L6-v2 (384 dimensions)
    """

    def __init__(
        self,
        endpoint: Optional[str] = None,
        model: Optional[str] = None,
    ):
        """
        Initialize RuVector embedding provider.

        Args:
            endpoint: RuVector server endpoint
            model: Model name (default: all-MiniLM-L6-v2)
        """
        self._endpoint = endpoint or os.environ.get("RUVECTOR_ENDPOINT", DEFAULT_ENDPOINT)
        self._model = model or os.environ.get("RUVECTOR_MODEL", "all-MiniLM-L6-v2")
        self._dimensions = DEFAULT_DIMENSIONS

    @property
    def name(self) -> str:
        return "ruvector"

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def generate_embedding(self, text: str) -> List[float]:
        """Generate embedding using RuVector's embed endpoint."""
        url = f"{self._endpoint}/embed"

        data = json.dumps({"text": text, "model": self._model}).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=30) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result["embedding"]

        except urllib.error.URLError as e:
            raise RuntimeError(f"RuVector embedding error: {e}")

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using RuVector's batch endpoint."""
        url = f"{self._endpoint}/embed/batch"

        data = json.dumps({"texts": texts, "model": self._model}).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
                return result["embeddings"]

        except urllib.error.URLError:
            # Fallback to sequential if batch not available
            return [self.generate_embedding(text) for text in texts]


class RuVectorProvider(MemoryProvider):
    """RuVector memory provider implementation."""

    def __init__(
        self,
        config: ProviderConfig,
        embedding_provider: Optional[EmbeddingProvider] = None,
    ):
        """
        Initialize RuVector provider.

        Args:
            config: Provider configuration
            embedding_provider: Embedding provider (uses RuVector's if not provided)
        """
        super().__init__(config, embedding_provider)

        self._endpoint = config.endpoint or os.environ.get(
            "RUVECTOR_ENDPOINT", DEFAULT_ENDPOINT
        )
        self._collection = config.collection or os.environ.get(
            "RUVECTOR_COLLECTION", DEFAULT_COLLECTION
        )
        self._max_batch_size = config.max_batch_size or 100

    @property
    def name(self) -> str:
        return "ruvector"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_vector_dimensions=4096,
            max_batch_size=self._max_batch_size,
            supports_filtering=True,
            supports_metadata=True,
            supports_deletion=True,
            supports_update=True,
        )

    def _request(
        self,
        method: str,
        path: str,
        data: Optional[dict] = None,
        timeout: int = 30,
    ) -> Any:
        """Make HTTP request to RuVector server."""
        url = f"{self._endpoint}{path}"

        body = None
        if data is not None:
            body = json.dumps(data).encode("utf-8")

        req = urllib.request.Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"} if body else {},
            method=method,
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                if response.status == 204:
                    return None
                return json.loads(response.read().decode("utf-8"))

        except urllib.error.HTTPError as e:
            error_body = e.read().decode("utf-8") if e.fp else str(e)
            raise RuntimeError(f"RuVector HTTP error {e.code}: {error_body}")

        except urllib.error.URLError as e:
            raise RuntimeError(f"RuVector connection error: {e}")

    def _build_filter(self, search_filter: Optional[SearchFilter]) -> Optional[dict]:
        """Build RuVector filter from SearchFilter."""
        if not search_filter:
            return None

        filters = []
        if search_filter.meeting_id:
            filters.append({"field": "meeting_id", "value": search_filter.meeting_id})
        if search_filter.user_id:
            filters.append({"field": "user_id", "value": search_filter.user_id})
        if search_filter.speaker:
            filters.append({"field": "speaker", "value": search_filter.speaker})

        if not filters:
            return None

        return {"and": filters} if len(filters) > 1 else filters[0]

    # ============================================
    # VECTOR STORAGE OPERATIONS
    # ============================================

    def store(self, document: VectorDocument) -> None:
        """Store a single vector with metadata."""
        self._request(
            "POST",
            f"/collections/{self._collection}/vectors",
            data={
                "id": document.id,
                "vector": document.vector,
                "metadata": document.metadata.to_dict(),
            },
        )

    def store_batch(self, documents: List[VectorDocument]) -> BatchResult:
        """Store multiple vectors in a batch."""
        batch_size = self._max_batch_size
        successful = 0
        failed = 0
        errors: List[dict] = []

        for i in range(0, len(documents), batch_size):
            batch = documents[i : i + batch_size]

            try:
                vectors = [
                    {
                        "id": doc.id,
                        "vector": doc.vector,
                        "metadata": doc.metadata.to_dict(),
                    }
                    for doc in batch
                ]

                self._request(
                    "POST",
                    f"/collections/{self._collection}/vectors/batch",
                    data={"vectors": vectors},
                )
                successful += len(batch)

            except Exception as e:
                failed += len(batch)
                for doc in batch:
                    errors.append({"id": doc.id, "error": str(e)})

        return BatchResult(
            successful=successful,
            failed=failed,
            errors=errors if errors else None,
        )

    def delete(self, id: str) -> None:
        """Delete a single vector by ID."""
        self._request("DELETE", f"/collections/{self._collection}/vectors/{id}")

    def delete_batch(self, ids: List[str]) -> BatchResult:
        """Delete multiple vectors by IDs."""
        try:
            self._request(
                "POST",
                f"/collections/{self._collection}/vectors/delete",
                data={"ids": ids},
            )
            return BatchResult(successful=len(ids), failed=0)

        except Exception as e:
            return BatchResult(
                successful=0,
                failed=len(ids),
                errors=[{"id": id, "error": str(e)} for id in ids],
            )

    def delete_by_meeting_id(self, meeting_id: str) -> BatchResult:
        """Delete all vectors for a meeting."""
        try:
            result = self._request(
                "POST",
                f"/collections/{self._collection}/vectors/delete-by-filter",
                data={"filter": {"field": "meeting_id", "value": meeting_id}},
            )
            return BatchResult(successful=result.get("deleted", 0), failed=0)

        except Exception as e:
            return BatchResult(
                successful=0,
                failed=1,
                errors=[{"id": meeting_id, "error": str(e)}],
            )

    def update_metadata(self, id: str, metadata: VectorMetadata) -> None:
        """Update vector metadata."""
        self._request(
            "PATCH",
            f"/collections/{self._collection}/vectors/{id}",
            data={"metadata": metadata.to_dict()},
        )

    # ============================================
    # SEARCH OPERATIONS
    # ============================================

    def search(
        self, embedding: List[float], options: Optional[SearchOptions] = None
    ) -> List[SearchResult]:
        """Search for similar vectors by embedding."""
        opts = options or SearchOptions()

        query_data: dict = {
            "vector": embedding,
            "top_k": opts.top_k or 10,
            "include_metadata": opts.include_metadata,
        }

        if opts.filter:
            filter_obj = self._build_filter(opts.filter)
            if filter_obj:
                query_data["filter"] = filter_obj

        if opts.include_vector:
            query_data["include_vectors"] = True

        result = self._request(
            "POST",
            f"/collections/{self._collection}/query",
            data=query_data,
        )

        results = []
        for item in result.get("results", []):
            score = item.get("score", 0.0)

            # Apply min_score filter
            if opts.min_score is not None and score < opts.min_score:
                continue

            results.append(
                SearchResult(
                    id=item["id"],
                    score=score,
                    metadata=VectorMetadata.from_dict(item.get("metadata", {})),
                    vector=item.get("vector"),
                )
            )

        return results

    # ============================================
    # UTILITY OPERATIONS
    # ============================================

    def health_check(self) -> HealthStatus:
        """Check provider health."""
        start = time.time()

        try:
            self._request("GET", "/health")

            return HealthStatus(
                healthy=True,
                provider=self.name,
                latency_ms=(time.time() - start) * 1000,
            )

        except Exception as e:
            return HealthStatus(
                healthy=False,
                provider=self.name,
                latency_ms=(time.time() - start) * 1000,
                error=str(e),
            )

    def get_vector_count(self) -> int:
        """Get vector count in collection."""
        result = self._request("GET", f"/collections/{self._collection}/stats")
        return result.get("vector_count", 0)


def create_ruvector_provider(
    config: Optional[ProviderConfig] = None,
    embedding_provider: Optional[EmbeddingProvider] = None,
) -> RuVectorProvider:
    """
    Factory function to create RuVector provider.

    Args:
        config: Optional configuration override
        embedding_provider: Optional embedding provider (uses RuVector's if not provided)

    Returns:
        Configured RuVectorProvider instance
    """
    provider_config = config or ProviderConfig(
        endpoint=os.environ.get("RUVECTOR_ENDPOINT", DEFAULT_ENDPOINT),
        collection=os.environ.get("RUVECTOR_COLLECTION", DEFAULT_COLLECTION),
    )

    # Use RuVector's built-in embeddings if no provider specified
    if embedding_provider is None:
        embedding_provider = RuVectorEmbeddingProvider(
            endpoint=provider_config.endpoint,
        )

    return RuVectorProvider(
        config=provider_config,
        embedding_provider=embedding_provider,
    )

"""
S3 Vectors Memory Provider

Implementation using AWS S3 Vectors for vector storage.
Requires an embedding provider (e.g., BedrockEmbeddingProvider).
"""

import os
import time
from typing import List, Optional

import boto3

from .types import (
    VectorDocument,
    VectorMetadata,
    SearchOptions,
    SearchResult,
    BatchResult,
    HealthStatus,
    ProviderCapabilities,
    ProviderConfig,
)
from .provider import MemoryProvider
from .embedding_provider import EmbeddingProvider


# Default configuration
DEFAULT_BUCKET = "krisp-vectors"
DEFAULT_INDEX = "transcript-chunks"


class S3VectorsProvider(MemoryProvider):
    """S3 Vectors memory provider implementation."""

    def __init__(
        self,
        config: ProviderConfig,
        embedding_provider: Optional[EmbeddingProvider] = None,
        client: Optional[boto3.client] = None,
    ):
        """
        Initialize S3 Vectors provider.

        Args:
            config: Provider configuration
            embedding_provider: Embedding provider for text-to-vector conversion
            client: Pre-initialized S3 Vectors client (optional)
        """
        super().__init__(config, embedding_provider)

        self._bucket = config.bucket or os.environ.get("VECTOR_BUCKET", DEFAULT_BUCKET)
        self._index_name = config.index_name or os.environ.get("VECTOR_INDEX", DEFAULT_INDEX)
        self._region = config.region or os.environ.get("AWS_REGION", "us-east-1")
        self._max_batch_size = config.max_batch_size or 100

        if client:
            self._client = client
        else:
            self._client = boto3.client("s3vectors", region_name=self._region)

    @property
    def name(self) -> str:
        return "s3-vectors"

    @property
    def capabilities(self) -> ProviderCapabilities:
        return ProviderCapabilities(
            max_vector_dimensions=2048,
            max_batch_size=self._max_batch_size,
            supports_filtering=True,  # S3 Vectors supports filtering
            supports_metadata=True,
            supports_deletion=True,
            supports_update=False,  # Must delete and re-add
        )

    # ============================================
    # VECTOR STORAGE OPERATIONS
    # ============================================

    def store(self, document: VectorDocument) -> None:
        """Store a single vector with metadata."""
        self.store_batch([document])

    def store_batch(self, documents: List[VectorDocument]) -> BatchResult:
        """Store multiple vectors in a batch."""
        batch_size = self._max_batch_size
        successful = 0
        failed = 0
        errors: List[dict] = []

        # Process in batches
        for i in range(0, len(documents), batch_size):
            batch = documents[i : i + batch_size]

            try:
                formatted_vectors = []
                for doc in batch:
                    formatted = {
                        "key": doc.id,
                        "data": {"float32": doc.vector},
                        "metadata": doc.metadata.to_dict(),
                    }
                    formatted_vectors.append(formatted)

                self._client.put_vectors(
                    vectorBucketName=self._bucket,
                    indexName=self._index_name,
                    vectors=formatted_vectors,
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
        self.delete_batch([id])

    def delete_batch(self, ids: List[str]) -> BatchResult:
        """Delete multiple vectors by IDs."""
        try:
            self._client.delete_vectors(
                vectorBucketName=self._bucket,
                indexName=self._index_name,
                keys=ids,
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
            # List vectors with meeting_id filter
            response = self._client.list_vectors(
                vectorBucketName=self._bucket,
                indexName=self._index_name,
                filter={"meeting_id": {"$eq": meeting_id}},
            )

            keys_to_delete = [v["key"] for v in response.get("vectors", [])]

            if not keys_to_delete:
                return BatchResult(successful=0, failed=0)

            return self.delete_batch(keys_to_delete)

        except Exception as e:
            return BatchResult(
                successful=0,
                failed=1,
                errors=[{"id": meeting_id, "error": str(e)}],
            )

    def update_metadata(self, id: str, metadata: VectorMetadata) -> None:
        """Update vector metadata (not supported - must delete and re-add)."""
        raise NotImplementedError(
            "S3 Vectors does not support metadata updates. Delete and re-store instead."
        )

    # ============================================
    # SEARCH OPERATIONS
    # ============================================

    def search(
        self, embedding: List[float], options: Optional[SearchOptions] = None
    ) -> List[SearchResult]:
        """Search for similar vectors by embedding."""
        opts = options or SearchOptions()
        top_k = opts.top_k or 10

        try:
            params = {
                "vectorBucketName": self._bucket,
                "indexName": self._index_name,
                "queryVector": {"float32": embedding},
                "topK": top_k,
            }

            # Add filter if provided
            if opts.filter:
                filter_dict = {}
                if opts.filter.meeting_id:
                    filter_dict["meeting_id"] = {"$eq": opts.filter.meeting_id}
                if opts.filter.user_id:
                    filter_dict["user_id"] = {"$eq": opts.filter.user_id}
                if opts.filter.speaker:
                    filter_dict["speaker"] = {"$eq": opts.filter.speaker}
                if filter_dict:
                    params["filter"] = filter_dict

            response = self._client.query_vectors(**params)

            results = []
            for i, item in enumerate(response.get("vectors", [])):
                # S3 Vectors returns score in response
                score = item.get("score", 1 - i * 0.05)  # Fallback to position-based

                results.append(
                    SearchResult(
                        id=item["key"],
                        score=score,
                        metadata=VectorMetadata.from_dict(item.get("metadata", {})),
                        vector=None,  # S3 Vectors doesn't return vectors in query
                    )
                )

            # Apply min_score filter if provided
            if opts.min_score is not None:
                results = [r for r in results if r.score >= opts.min_score]

            return results

        except Exception as e:
            print(f"S3 Vectors search error: {e}")
            raise

    # ============================================
    # UTILITY OPERATIONS
    # ============================================

    def health_check(self) -> HealthStatus:
        """Check provider health by attempting a query."""
        start = time.time()

        try:
            # Try a simple query with dummy embedding
            dimensions = 1024  # Default Titan dimensions
            if self._embedding_provider:
                dimensions = self._embedding_provider.dimensions

            dummy_embedding = [0.0] * dimensions
            dummy_embedding[0] = 1.0  # Non-zero for normalization

            self.search(dummy_embedding, SearchOptions(top_k=1))

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
        """Get vector count (not directly supported by S3 Vectors)."""
        raise NotImplementedError(
            "S3 Vectors does not support vector count. Track in DynamoDB instead."
        )


def create_s3_vectors_provider(
    config: Optional[ProviderConfig] = None,
    embedding_provider: Optional[EmbeddingProvider] = None,
) -> S3VectorsProvider:
    """
    Factory function to create S3 Vectors provider.

    Args:
        config: Optional configuration override
        embedding_provider: Optional embedding provider

    Returns:
        Configured S3VectorsProvider instance
    """
    provider_config = config or ProviderConfig(
        bucket=os.environ.get("VECTOR_BUCKET", DEFAULT_BUCKET),
        index_name=os.environ.get("VECTOR_INDEX", DEFAULT_INDEX),
        region=os.environ.get("AWS_REGION", "us-east-1"),
    )

    return S3VectorsProvider(
        config=provider_config,
        embedding_provider=embedding_provider,
    )

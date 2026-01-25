"""
Dual-Write Memory Provider

Writes to both primary and secondary backends for zero-downtime migration.
Reads from primary only. Secondary failures are logged but don't block.

Usage:
    Set MEMORY_PROVIDER=dual
    Set PRIMARY_PROVIDER=s3-vectors
    Set SECONDARY_PROVIDER=ruvector
"""

import os
import time
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed

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


class DualProvider(MemoryProvider):
    """
    Dual-write memory provider.

    Writes to both primary and secondary backends.
    Reads from primary only.
    Secondary failures are logged but don't block operations.
    """

    def __init__(
        self,
        config: ProviderConfig,
        primary: MemoryProvider,
        secondary: MemoryProvider,
        embedding_provider: Optional[EmbeddingProvider] = None,
    ):
        """
        Initialize dual provider.

        Args:
            config: Provider configuration
            primary: Primary memory provider (reads and writes)
            secondary: Secondary memory provider (writes only)
            embedding_provider: Embedding provider override
        """
        super().__init__(
            config, embedding_provider or primary.embedding_provider
        )
        self._primary = primary
        self._secondary = secondary
        self._executor = ThreadPoolExecutor(max_workers=2)

    @property
    def name(self) -> str:
        return f"dual({self._primary.name}+{self._secondary.name})"

    @property
    def capabilities(self) -> ProviderCapabilities:
        # Return primary's capabilities
        return self._primary.capabilities

    @property
    def primary(self) -> MemoryProvider:
        """Get primary provider."""
        return self._primary

    @property
    def secondary(self) -> MemoryProvider:
        """Get secondary provider."""
        return self._secondary

    def _write_to_secondary(self, operation: str, func, *args, **kwargs):
        """
        Execute write operation on secondary in background.

        Logs errors but doesn't raise - secondary failures are non-blocking.
        """
        try:
            result = func(*args, **kwargs)
            print(f"Dual: Secondary {operation} succeeded")
            return result
        except Exception as e:
            print(f"Dual: Secondary {operation} failed (non-blocking): {e}")
            return None

    # ============================================
    # VECTOR STORAGE OPERATIONS
    # ============================================

    def store(self, document: VectorDocument) -> None:
        """Store to both backends."""
        # Primary is blocking
        self._primary.store(document)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "store",
            self._secondary.store,
            document,
        )

    def store_batch(self, documents: List[VectorDocument]) -> BatchResult:
        """Store batch to both backends."""
        # Primary is blocking
        primary_result = self._primary.store_batch(documents)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "store_batch",
            self._secondary.store_batch,
            documents,
        )

        return primary_result

    def delete(self, id: str) -> None:
        """Delete from both backends."""
        # Primary is blocking
        self._primary.delete(id)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "delete",
            self._secondary.delete,
            id,
        )

    def delete_batch(self, ids: List[str]) -> BatchResult:
        """Delete batch from both backends."""
        # Primary is blocking
        primary_result = self._primary.delete_batch(ids)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "delete_batch",
            self._secondary.delete_batch,
            ids,
        )

        return primary_result

    def delete_by_meeting_id(self, meeting_id: str) -> BatchResult:
        """Delete by meeting ID from both backends."""
        # Primary is blocking
        primary_result = self._primary.delete_by_meeting_id(meeting_id)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "delete_by_meeting_id",
            self._secondary.delete_by_meeting_id,
            meeting_id,
        )

        return primary_result

    def update_metadata(self, id: str, metadata: VectorMetadata) -> None:
        """Update metadata on both backends."""
        # Primary is blocking
        self._primary.update_metadata(id, metadata)

        # Secondary is non-blocking
        self._executor.submit(
            self._write_to_secondary,
            "update_metadata",
            self._secondary.update_metadata,
            id,
            metadata,
        )

    # ============================================
    # SEARCH OPERATIONS
    # ============================================

    def search(
        self, embedding: List[float], options: Optional[SearchOptions] = None
    ) -> List[SearchResult]:
        """Search from primary only."""
        return self._primary.search(embedding, options)

    # ============================================
    # UTILITY OPERATIONS
    # ============================================

    def health_check(self) -> HealthStatus:
        """Check health of both backends."""
        start = time.time()

        primary_health = self._primary.health_check()
        secondary_health = self._secondary.health_check()

        # Report combined health
        both_healthy = primary_health.healthy and secondary_health.healthy

        errors = []
        if not primary_health.healthy:
            errors.append(f"primary: {primary_health.error}")
        if not secondary_health.healthy:
            errors.append(f"secondary: {secondary_health.error}")

        return HealthStatus(
            healthy=both_healthy,
            provider=self.name,
            latency_ms=(time.time() - start) * 1000,
            error="; ".join(errors) if errors else None,
        )

    def get_vector_count(self) -> int:
        """Get vector count from primary."""
        return self._primary.get_vector_count()

    def close(self):
        """Shutdown executor."""
        self._executor.shutdown(wait=True)


def create_dual_provider(
    config: Optional[ProviderConfig] = None,
    primary: Optional[MemoryProvider] = None,
    secondary: Optional[MemoryProvider] = None,
) -> DualProvider:
    """
    Factory function to create dual provider.

    Args:
        config: Optional configuration override
        primary: Optional primary provider
        secondary: Optional secondary provider

    Returns:
        Configured DualProvider instance
    """
    provider_config = config or ProviderConfig()

    # Create primary provider if not provided
    if primary is None:
        primary_type = provider_config.primary_provider or os.environ.get(
            "PRIMARY_PROVIDER", "s3-vectors"
        )

        if primary_type == "s3-vectors":
            from .s3_vectors_provider import create_s3_vectors_provider
            from .bedrock_embeddings import BedrockEmbeddingProvider

            primary = create_s3_vectors_provider(
                config=provider_config,
                embedding_provider=BedrockEmbeddingProvider(),
            )
        elif primary_type == "ruvector":
            from .ruvector_provider import create_ruvector_provider

            primary = create_ruvector_provider(config=provider_config)
        else:
            raise ValueError(f"Unknown primary provider: {primary_type}")

    # Create secondary provider if not provided
    if secondary is None:
        secondary_type = provider_config.secondary_provider or os.environ.get(
            "SECONDARY_PROVIDER", "ruvector"
        )

        if secondary_type == "s3-vectors":
            from .s3_vectors_provider import create_s3_vectors_provider
            from .bedrock_embeddings import BedrockEmbeddingProvider

            secondary = create_s3_vectors_provider(
                config=provider_config,
                embedding_provider=BedrockEmbeddingProvider(),
            )
        elif secondary_type == "ruvector":
            from .ruvector_provider import create_ruvector_provider

            secondary = create_ruvector_provider(config=provider_config)
        else:
            raise ValueError(f"Unknown secondary provider: {secondary_type}")

    return DualProvider(
        config=provider_config,
        primary=primary,
        secondary=secondary,
    )

"""
Memory Provider Abstraction Package

This package provides a backend-agnostic interface for vector storage
and semantic search, allowing easy swapping between S3 Vectors, RuVector,
and other vector databases.

Usage:
    from memory import get_memory_provider

    provider = get_memory_provider()
    await provider.store(document)
    results = await provider.search(embedding)
"""

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
    ProviderType,
)
from .embedding_provider import EmbeddingProvider
from .bedrock_embeddings import BedrockEmbeddingProvider
from .provider import MemoryProvider
from .s3_vectors_provider import S3VectorsProvider
from .ruvector_provider import RuVectorProvider, RuVectorEmbeddingProvider
from .dual_provider import DualProvider
from .factory import (
    get_memory_provider,
    create_memory_provider,
    reset_memory_provider,
    set_memory_provider,
    get_provider_type,
    create_embedding_provider,
)

__all__ = [
    # Types
    "VectorDocument",
    "VectorMetadata",
    "SearchOptions",
    "SearchFilter",
    "SearchResult",
    "BatchResult",
    "HealthStatus",
    "ProviderCapabilities",
    "ProviderConfig",
    "ProviderType",
    # Embedding Providers
    "EmbeddingProvider",
    "BedrockEmbeddingProvider",
    "RuVectorEmbeddingProvider",
    # Memory Providers
    "MemoryProvider",
    "S3VectorsProvider",
    "RuVectorProvider",
    "DualProvider",
    # Factory
    "get_memory_provider",
    "create_memory_provider",
    "reset_memory_provider",
    "set_memory_provider",
    "get_provider_type",
    "create_embedding_provider",
]

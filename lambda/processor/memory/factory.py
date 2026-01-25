"""
Memory Provider Factory

Central entry point for memory/vector operations.
Allows easy swapping between different backends.

Usage:
    from memory import get_memory_provider

    provider = get_memory_provider()
    results = provider.search_by_text('quarterly review')
"""

import os
from typing import Optional

from .types import ProviderType, ProviderConfig
from .provider import MemoryProvider
from .embedding_provider import EmbeddingProvider
from .bedrock_embeddings import BedrockEmbeddingProvider
from .s3_vectors_provider import S3VectorsProvider, create_s3_vectors_provider


# Singleton instance
_memory_provider_instance: Optional[MemoryProvider] = None


def get_provider_type() -> ProviderType:
    """Get the memory provider type from environment."""
    provider_type = os.environ.get("MEMORY_PROVIDER", "s3-vectors")
    valid_types = ("s3-vectors", "ruvector", "dual", "ab-router", "mock")

    if provider_type not in valid_types:
        raise ValueError(
            f"Invalid MEMORY_PROVIDER: {provider_type}. Must be one of: {valid_types}"
        )

    return provider_type  # type: ignore


def get_embedding_provider_type() -> str:
    """Get the embedding provider type from environment."""
    return os.environ.get("EMBEDDING_PROVIDER", "bedrock")


def create_embedding_provider(provider_type: Optional[str] = None) -> EmbeddingProvider:
    """
    Create an embedding provider based on type.

    Args:
        provider_type: Provider type (bedrock, ruvector). Default from environment.

    Returns:
        Configured EmbeddingProvider instance
    """
    embedding_type = provider_type or get_embedding_provider_type()

    if embedding_type == "bedrock":
        return BedrockEmbeddingProvider()

    elif embedding_type == "ruvector":
        # Import here to avoid circular dependencies
        from .ruvector_provider import RuVectorEmbeddingProvider

        return RuVectorEmbeddingProvider()

    else:
        raise ValueError(
            f"Unknown embedding provider type: {embedding_type}. "
            "Set EMBEDDING_PROVIDER=bedrock or EMBEDDING_PROVIDER=ruvector"
        )


def create_memory_provider(
    provider_type: Optional[ProviderType] = None,
    config: Optional[ProviderConfig] = None,
) -> MemoryProvider:
    """
    Create a memory provider based on type.

    Args:
        provider_type: Provider type (s3-vectors, ruvector, dual, ab-router).
                       Default from environment.
        config: Optional provider configuration

    Returns:
        Configured MemoryProvider instance
    """
    memory_type = provider_type or get_provider_type()
    provider_config = config or ProviderConfig()

    if memory_type == "s3-vectors":
        # Create with Bedrock embedding provider
        embedding_provider = create_embedding_provider("bedrock")
        return create_s3_vectors_provider(
            config=provider_config,
            embedding_provider=embedding_provider,
        )

    elif memory_type == "ruvector":
        # Import here to avoid circular dependencies
        from .ruvector_provider import create_ruvector_provider

        # RuVector can use either Bedrock or its own ONNX embeddings
        embedding_type = get_embedding_provider_type()
        embedding_provider = create_embedding_provider(embedding_type)
        return create_ruvector_provider(
            config=provider_config,
            embedding_provider=embedding_provider,
        )

    elif memory_type == "dual":
        # Import here to avoid circular dependencies
        from .dual_provider import create_dual_provider

        # Dual provider writes to both primary and secondary
        return create_dual_provider(config=provider_config)

    elif memory_type == "ab-router":
        # A/B testing router not yet implemented in Python
        raise NotImplementedError(
            "A/B router not yet implemented in Python. "
            "Use TypeScript for A/B testing."
        )

    elif memory_type == "mock":
        raise NotImplementedError(
            "Mock provider not yet implemented. "
            "Set MEMORY_PROVIDER=s3-vectors for testing."
        )

    else:
        raise ValueError(f"Unknown memory provider type: {memory_type}")


def get_memory_provider() -> MemoryProvider:
    """
    Get the singleton memory provider instance.

    Creates one if it doesn't exist.

    Returns:
        Configured MemoryProvider instance
    """
    global _memory_provider_instance

    if _memory_provider_instance is None:
        _memory_provider_instance = create_memory_provider()

    return _memory_provider_instance


def reset_memory_provider() -> None:
    """Reset the singleton (useful for testing)."""
    global _memory_provider_instance
    _memory_provider_instance = None


def set_memory_provider(provider: MemoryProvider) -> None:
    """Set a custom provider instance (useful for testing)."""
    global _memory_provider_instance
    _memory_provider_instance = provider

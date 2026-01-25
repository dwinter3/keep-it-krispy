"""
Abstract Embedding Provider Interface

Defines the interface for embedding generation backends.
Implementations: BedrockEmbeddingProvider, RuVectorEmbeddingProvider
"""

from abc import ABC, abstractmethod
from typing import List


class EmbeddingProvider(ABC):
    """Abstract base class for embedding providers."""

    @property
    @abstractmethod
    def name(self) -> str:
        """Get provider name for logging/debugging."""
        pass

    @property
    @abstractmethod
    def dimensions(self) -> int:
        """Get embedding dimensions."""
        pass

    @abstractmethod
    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.

        Args:
            text: Text to embed

        Returns:
            List of floats representing the embedding vector
        """
        pass

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.

        Default implementation calls generate_embedding sequentially.
        Override for batch API support.

        Args:
            texts: List of texts to embed

        Returns:
            List of embedding vectors
        """
        embeddings = []
        for text in texts:
            embeddings.append(self.generate_embedding(text))
        return embeddings

    @staticmethod
    def chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> List[str]:
        """
        Split text into overlapping chunks for embedding.

        Args:
            text: Full text to chunk
            chunk_size: Target words per chunk
            overlap: Words to overlap between chunks

        Returns:
            List of text chunks
        """
        words = text.split()

        if len(words) <= chunk_size:
            return [text] if text.strip() else []

        chunks = []
        start = 0

        while start < len(words):
            end = start + chunk_size
            chunk_words = words[start:end]
            chunk = " ".join(chunk_words)
            chunks.append(chunk)

            # Move start forward, accounting for overlap
            start = end - overlap
            if start >= len(words):
                break

        return chunks

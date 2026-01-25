"""
Bedrock Titan Embedding Provider

Uses AWS Bedrock Titan Text Embeddings V2 model for generating
1024-dimensional text embeddings.
"""

import json
import os
from typing import List, Optional

import boto3

from .embedding_provider import EmbeddingProvider


# Default configuration
DEFAULT_MODEL_ID = "amazon.titan-embed-text-v2:0"
DEFAULT_DIMENSIONS = 1024
MAX_TOKENS = 8192  # ~6000 words


class BedrockEmbeddingProvider(EmbeddingProvider):
    """Bedrock Titan embedding provider implementation."""

    def __init__(
        self,
        model_id: Optional[str] = None,
        embedding_dimensions: Optional[int] = None,
        region: Optional[str] = None,
        client: Optional[boto3.client] = None,
    ):
        """
        Initialize Bedrock embedding provider.

        Args:
            model_id: Bedrock model ID (default: amazon.titan-embed-text-v2:0)
            embedding_dimensions: Embedding dimensions (default: 1024)
            region: AWS region (default: from environment)
            client: Pre-initialized Bedrock client (optional)
        """
        self._model_id = model_id or os.environ.get(
            "EMBEDDING_MODEL_ID", DEFAULT_MODEL_ID
        )
        self._dimensions = embedding_dimensions or int(
            os.environ.get("EMBEDDING_DIMENSIONS", DEFAULT_DIMENSIONS)
        )
        self._region = region or os.environ.get("AWS_REGION", "us-east-1")

        if client:
            self._client = client
        else:
            self._client = boto3.client("bedrock-runtime", region_name=self._region)

    @property
    def name(self) -> str:
        return "bedrock-titan"

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def generate_embedding(self, text: str) -> List[float]:
        """
        Generate embedding for text using Titan Embeddings V2.

        Args:
            text: Text to embed (max ~8192 tokens)

        Returns:
            List of floats representing the embedding vector
        """
        # Truncate text if too long (rough estimate: 4 chars per token)
        max_chars = MAX_TOKENS * 4
        if len(text) > max_chars:
            text = text[:max_chars]

        body = json.dumps(
            {
                "inputText": text,
                "dimensions": self._dimensions,
                "normalize": True,
            }
        )

        response = self._client.invoke_model(
            modelId=self._model_id,
            body=body,
            contentType="application/json",
            accept="application/json",
        )

        response_body = json.loads(response["body"].read())
        return response_body["embedding"]

    def generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.

        Note: Titan doesn't support batch API, so this calls sequentially.
        """
        embeddings = []
        for text in texts:
            embedding = self.generate_embedding(text)
            embeddings.append(embedding)
        return embeddings


def create_bedrock_embedding_provider(
    model_id: Optional[str] = None,
    dimensions: Optional[int] = None,
    region: Optional[str] = None,
) -> BedrockEmbeddingProvider:
    """
    Factory function to create Bedrock embedding provider.

    Args:
        model_id: Optional model ID override
        dimensions: Optional dimensions override
        region: Optional region override

    Returns:
        Configured BedrockEmbeddingProvider instance
    """
    return BedrockEmbeddingProvider(
        model_id=model_id,
        embedding_dimensions=dimensions,
        region=region,
    )

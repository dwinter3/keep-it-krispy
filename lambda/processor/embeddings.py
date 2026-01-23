"""
Bedrock Titan embeddings client for generating text embeddings.
"""

import json
import boto3
from typing import List

# Titan Text Embeddings V2 configuration (1024 dimensions)
# Must match the S3 Vectors index configuration
MODEL_ID = 'amazon.titan-embed-text-v2:0'
EMBEDDING_DIMENSIONS = 1024
MAX_TOKENS = 8192  # ~6000 words


def get_bedrock_client():
    """Get Bedrock runtime client."""
    return boto3.client('bedrock-runtime')


def generate_embedding(text: str, bedrock_client=None) -> List[float]:
    """
    Generate embedding for a single text using Titan Embeddings V2.

    Args:
        text: Text to embed (max ~8192 tokens)
        bedrock_client: Optional pre-initialized client

    Returns:
        List of floats representing the embedding vector (1024 dimensions)
    """
    if bedrock_client is None:
        bedrock_client = get_bedrock_client()

    # Truncate text if too long (rough estimate: 4 chars per token)
    max_chars = MAX_TOKENS * 4
    if len(text) > max_chars:
        text = text[:max_chars]

    # Titan v2 supports dimensions and normalization
    body = json.dumps({
        'inputText': text,
        'dimensions': EMBEDDING_DIMENSIONS,
        'normalize': True
    })

    response = bedrock_client.invoke_model(
        modelId=MODEL_ID,
        body=body,
        contentType='application/json',
        accept='application/json'
    )

    response_body = json.loads(response['body'].read())
    return response_body['embedding']


def generate_embeddings_batch(texts: List[str], bedrock_client=None) -> List[List[float]]:
    """
    Generate embeddings for multiple texts.

    Note: Titan doesn't support batch API, so this calls sequentially.
    """
    if bedrock_client is None:
        bedrock_client = get_bedrock_client()

    embeddings = []
    for text in texts:
        embedding = generate_embedding(text, bedrock_client)
        embeddings.append(embedding)

    return embeddings


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
        chunk = ' '.join(chunk_words)
        chunks.append(chunk)

        # Move start forward, accounting for overlap
        start = end - overlap
        if start >= len(words):
            break

    return chunks

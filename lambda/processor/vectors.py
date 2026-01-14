"""
S3 Vectors client for storing and querying vector embeddings.
"""

import os
import boto3
from typing import List, Dict, Any, Optional

VECTOR_BUCKET = os.environ.get('VECTOR_BUCKET', 'krisp-vectors')
INDEX_NAME = os.environ.get('VECTOR_INDEX', 'transcript-chunks')


def get_vectors_client():
    """Get S3 Vectors client."""
    return boto3.client('s3vectors')


def store_vectors(
    vectors: List[Dict[str, Any]],
    vectors_client=None
) -> Dict[str, Any]:
    """
    Store vectors in S3 Vectors index.

    Args:
        vectors: List of vector dicts with 'key', 'data', and 'metadata'
        vectors_client: Optional pre-initialized client

    Returns:
        Response from put_vectors API
    """
    if vectors_client is None:
        vectors_client = get_vectors_client()

    # Format vectors for S3 Vectors API
    formatted_vectors = []
    for v in vectors:
        formatted = {
            'key': v['key'],
            'data': {
                'float32': v['data']
            }
        }
        if v.get('metadata'):
            formatted['metadata'] = v['metadata']
        formatted_vectors.append(formatted)

    response = vectors_client.put_vectors(
        vectorBucketName=VECTOR_BUCKET,
        indexName=INDEX_NAME,
        vectors=formatted_vectors
    )

    return response


def query_vectors(
    query_vector: List[float],
    top_k: int = 10,
    filter_expression: Optional[str] = None,
    vectors_client=None
) -> List[Dict[str, Any]]:
    """
    Query S3 Vectors for similar vectors.

    Args:
        query_vector: Query embedding vector
        top_k: Number of results to return
        filter_expression: Optional filter (e.g., "meeting_id = 'abc123'")
        vectors_client: Optional pre-initialized client

    Returns:
        List of matching vectors with scores
    """
    if vectors_client is None:
        vectors_client = get_vectors_client()

    params = {
        'vectorBucketName': VECTOR_BUCKET,
        'indexName': INDEX_NAME,
        'queryVector': {
            'float32': query_vector
        },
        'topK': top_k
    }

    if filter_expression:
        params['filter'] = filter_expression

    response = vectors_client.query_vectors(**params)

    results = []
    for item in response.get('vectors', []):
        results.append({
            'key': item['key'],
            'score': item.get('score', 0),
            'metadata': item.get('metadata', {})
        })

    return results


def delete_vectors_by_meeting(meeting_id: str, vectors_client=None) -> int:
    """
    Delete all vectors for a specific meeting.

    Args:
        meeting_id: Meeting ID to delete vectors for
        vectors_client: Optional pre-initialized client

    Returns:
        Number of vectors deleted
    """
    if vectors_client is None:
        vectors_client = get_vectors_client()

    # List vectors with meeting_id filter
    response = vectors_client.list_vectors(
        vectorBucketName=VECTOR_BUCKET,
        indexName=INDEX_NAME,
        filter=f"meeting_id = '{meeting_id}'"
    )

    keys_to_delete = [v['key'] for v in response.get('vectors', [])]

    if keys_to_delete:
        vectors_client.delete_vectors(
            vectorBucketName=VECTOR_BUCKET,
            indexName=INDEX_NAME,
            keys=keys_to_delete
        )

    return len(keys_to_delete)

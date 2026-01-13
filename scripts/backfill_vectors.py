#!/usr/bin/env python3
"""
Backfill script to generate vector embeddings for existing transcripts.
Run with: AWS_PROFILE=krisp-buddy python3 backfill_vectors.py
"""

import json
import sys
import boto3
from typing import List, Dict, Any

# Add processor module to path
sys.path.insert(0, '../lambda/processor')

BUCKET_NAME = 'krisp-transcripts-754639201213'
VECTOR_BUCKET = 'krisp-vectors'
INDEX_NAME = 'transcript-chunks'
REGION = 'us-east-1'

# Titan Text Embeddings V2 configuration
MODEL_ID = 'amazon.titan-embed-text-v2:0'
EMBEDDING_DIMENSIONS = 1024

s3 = boto3.client('s3', region_name=REGION)
bedrock = boto3.client('bedrock-runtime', region_name=REGION)
vectors_client = boto3.client('s3vectors', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table = dynamodb.Table('krisp-transcripts-index')


def list_all_transcripts():
    """List all JSON files in meetings/ prefix."""
    transcripts = []
    paginator = s3.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix='meetings/'):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('.json'):
                transcripts.append(obj['Key'])

    return transcripts


def get_meeting_id_from_key(s3_key: str, content: dict) -> str:
    """Extract meeting ID from content or key."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    meeting = data.get('meeting', {})

    meeting_id = meeting.get('id', '')
    if not meeting_id:
        filename = s3_key.split('/')[-1]
        parts = filename.replace('.json', '').split('_')
        if len(parts) >= 4:
            meeting_id = parts[-1]
        else:
            meeting_id = filename.replace('.json', '')

    return meeting_id


def extract_transcript_text(content: dict) -> str:
    """Extract raw transcript text from content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    return data.get('raw_content', '')


def get_speakers(content: dict) -> List[str]:
    """Extract speaker names from content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    meeting = data.get('meeting', {})

    speakers_raw = meeting.get('speakers', [])
    speakers = []
    for s in speakers_raw:
        if s.get('first_name'):
            name = f"{s['first_name']} {s.get('last_name', '')}".strip()
            speakers.append(name)
        elif s.get('index'):
            speakers.append(f"Speaker {s['index']}")

    return speakers


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks."""
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

        start = end - overlap
        if start >= len(words):
            break

    return chunks


def is_real_speaker_name(name: str) -> bool:
    """
    Check if a speaker name is a real name vs generic placeholder.
    Filters out names like "Speaker 1", "Speaker 2", "Unknown", etc.
    """
    if not name:
        return False
    name_lower = name.lower().strip()
    # Filter out generic speaker names
    if name_lower.startswith('speaker '):
        return False
    if name_lower in ('unknown', 'guest', 'participant'):
        return False
    # Must have at least 2 characters
    if len(name_lower) < 2:
        return False
    return True


def generate_embedding(text: str) -> List[float]:
    """Generate embedding using Bedrock Titan."""
    # Truncate if too long
    max_chars = 8192 * 4
    if len(text) > max_chars:
        text = text[:max_chars]

    body = json.dumps({
        'inputText': text,
        'dimensions': EMBEDDING_DIMENSIONS,
        'normalize': True
    })

    response = bedrock.invoke_model(
        modelId=MODEL_ID,
        body=body,
        contentType='application/json',
        accept='application/json'
    )

    response_body = json.loads(response['body'].read())
    return response_body['embedding']


def store_vectors(vectors: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Store vectors in S3 Vectors."""
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


def process_transcript(s3_key: str, content: dict) -> int:
    """Process a single transcript and return number of vectors stored.

    Includes real speaker names in embeddings for relationship-based search.
    Filters out generic names like "Speaker 1", "Speaker 2".
    """
    meeting_id = get_meeting_id_from_key(s3_key, content)
    transcript_text = extract_transcript_text(content)
    speakers = get_speakers(content)

    if not transcript_text:
        print(f"  -> No transcript text found")
        return 0

    # Chunk the transcript
    chunks = chunk_text(transcript_text, chunk_size=500, overlap=50)

    if not chunks:
        print(f"  -> No chunks generated")
        return 0

    # Filter to only real speaker names (not "Speaker 1", etc.)
    real_speakers = [s for s in speakers if is_real_speaker_name(s)]

    # Create speaker context prefix if we have real names
    speaker_context = ""
    if real_speakers:
        speaker_names = ", ".join(real_speakers)
        speaker_context = f"Meeting participants: {speaker_names}. "
        print(f"  -> Including speakers in embeddings: {speaker_names}")

    print(f"  -> Generating embeddings for {len(chunks)} chunks...")

    # Generate embeddings and prepare vectors
    vectors_to_store = []
    primary_speaker = real_speakers[0] if real_speakers else (speakers[0] if speakers else 'unknown')

    for i, chunk in enumerate(chunks):
        # Prepend speaker context to chunk for embedding generation
        # This ensures speaker names are part of the semantic embedding
        text_for_embedding = speaker_context + chunk

        # Generate embedding with speaker-enriched text
        embedding = generate_embedding(text_for_embedding)

        # Create vector record
        vector_key = f"{meeting_id}_chunk_{i:04d}"
        vectors_to_store.append({
            'key': vector_key,
            'data': embedding,
            'metadata': {
                'meeting_id': meeting_id,
                's3_key': s3_key,
                'chunk_index': str(i),
                'speaker': primary_speaker,
                'text': chunk[:500]  # Store original chunk (without speaker prefix) for display
            }
        })

    # Store vectors in batches of 100
    batch_size = 100
    for i in range(0, len(vectors_to_store), batch_size):
        batch = vectors_to_store[i:i + batch_size]
        store_vectors(batch)
        print(f"  -> Stored batch {i//batch_size + 1}/{(len(vectors_to_store) + batch_size - 1)//batch_size}")

    return len(vectors_to_store)


def main():
    print(f"Scanning S3 bucket: {BUCKET_NAME}")
    transcripts = list_all_transcripts()
    print(f"Found {len(transcripts)} transcripts\n")

    total_vectors = 0
    processed = 0
    errors = 0

    for i, key in enumerate(transcripts):
        try:
            print(f"[{i+1}/{len(transcripts)}] Processing: {key}")

            # Fetch from S3
            response = s3.get_object(Bucket=BUCKET_NAME, Key=key)
            content = json.loads(response['Body'].read().decode('utf-8'))

            # Process and store vectors
            num_vectors = process_transcript(key, content)
            total_vectors += num_vectors

            if num_vectors > 0:
                processed += 1
                print(f"  -> Stored {num_vectors} vectors")
            else:
                print(f"  -> Skipped (no content)")

        except Exception as e:
            errors += 1
            print(f"  -> ERROR: {e}")

    print(f"\nBackfill complete!")
    print(f"  Transcripts processed: {processed}")
    print(f"  Total vectors stored: {total_vectors}")
    print(f"  Errors: {errors}")


if __name__ == '__main__':
    main()

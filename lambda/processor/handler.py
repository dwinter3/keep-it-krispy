"""
Processing Lambda for Krisp transcripts.
Triggered by S3 events when new transcripts are uploaded.

Phase 1: Extract metadata and index to DynamoDB
Phase 2: Generate embeddings and store in S3 Vectors
Phase 3: Generate AI topic for the meeting
"""

import json
import os
import boto3
from datetime import datetime
from typing import Any, List, Dict, Optional
from urllib.parse import unquote_plus

from embeddings import generate_embedding, chunk_text, get_bedrock_client
from vectors import store_vectors, get_vectors_client

# Initialize clients outside handler for reuse
# AWS_REGION is automatically set by Lambda
dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
bedrock_client = get_bedrock_client()
vectors_client = get_vectors_client()

TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
ENABLE_VECTORS = os.environ.get('ENABLE_VECTORS', 'true').lower() == 'true'
ENABLE_TOPICS = os.environ.get('ENABLE_TOPICS', 'true').lower() == 'true'
TOPIC_MODEL_ID = os.environ.get('TOPIC_MODEL_ID', 'anthropic.claude-3-haiku-20240307-v1:0')
table = dynamodb.Table(TABLE_NAME)


def handler(event: dict, context: Any) -> dict:
    """
    Process S3 events for new transcript uploads.
    """
    print(f"Processing event: {json.dumps(event)}")

    processed = 0
    vectors_stored = 0
    topics_generated = 0
    errors = []

    for record in event.get('Records', []):
        try:
            # Extract S3 info from event
            bucket = record['s3']['bucket']['name']
            key = unquote_plus(record['s3']['object']['key'])

            # Skip non-JSON files
            if not key.endswith('.json'):
                print(f"Skipping non-JSON file: {key}")
                continue

            # Skip files not in meetings/ prefix
            if not key.startswith('meetings/'):
                print(f"Skipping file outside meetings/: {key}")
                continue

            print(f"Processing: s3://{bucket}/{key}")

            # Fetch transcript from S3
            response = s3.get_object(Bucket=bucket, Key=key)
            content = json.loads(response['Body'].read().decode('utf-8'))

            # Extract transcript text (used for vectors and topic)
            transcript_text = extract_transcript_text(content)

            # Extract and index metadata to DynamoDB
            metadata = extract_metadata(key, content)

            # Generate AI topic for the meeting
            topic = None
            if ENABLE_TOPICS and transcript_text:
                try:
                    topic = generate_topic(transcript_text, metadata['title'], bedrock_client)
                    if topic:
                        metadata['topic'] = topic
                        topics_generated += 1
                        print(f"Generated topic: {topic}")
                except Exception as te:
                    print(f"Topic generation error (non-fatal): {te}")

            index_to_dynamodb(metadata)
            print(f"Indexed to DynamoDB: {metadata['meeting_id']}")

            # Generate embeddings and store vectors
            if ENABLE_VECTORS:
                try:
                    if transcript_text:
                        num_vectors = process_vectors(
                            meeting_id=metadata['meeting_id'],
                            s3_key=key,
                            transcript_text=transcript_text,
                            speakers=metadata.get('speakers', [])
                        )
                        vectors_stored += num_vectors
                        print(f"Stored {num_vectors} vectors for: {metadata['meeting_id']}")
                except Exception as ve:
                    print(f"Vector processing error (non-fatal): {ve}")

            processed += 1

        except Exception as e:
            error_msg = f"Error processing {record}: {str(e)}"
            print(error_msg)
            errors.append(error_msg)

    result = {
        'statusCode': 200,
        'body': json.dumps({
            'processed': processed,
            'vectors_stored': vectors_stored,
            'topics_generated': topics_generated,
            'errors': errors
        })
    }

    print(f"Result: {json.dumps(result)}")
    return result


def extract_transcript_text(content: dict) -> str:
    """Extract raw transcript text from content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    return data.get('raw_content', '')


def generate_topic(transcript_text: str, title: str, bedrock_client) -> Optional[str]:
    """
    Generate a concise 1-5 word topic for the meeting using Claude.

    Args:
        transcript_text: The full transcript text
        title: The meeting title
        bedrock_client: Bedrock runtime client

    Returns:
        A short topic string (1-5 words) or None if generation fails
    """
    if not transcript_text or len(transcript_text.strip()) < 50:
        return None

    # Use first 4000 chars of transcript to keep within token limits
    text_sample = transcript_text[:4000]

    prompt = f"""Based on this meeting transcript, generate a concise 1-5 word topic that describes the main subject discussed.

Meeting title: {title}

Transcript excerpt:
{text_sample}

Return ONLY the topic, nothing else. The topic should be descriptive but brief (1-5 words max). Examples of good topics: "Q4 Sales Review", "Product Roadmap Planning", "Customer Onboarding", "Bug Triage", "Team Standup"."""

    try:
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 50,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        })

        response = bedrock_client.invoke_model(
            modelId=TOPIC_MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())
        topic = response_body.get('content', [{}])[0].get('text', '').strip()

        # Validate topic is reasonable (1-5 words, not too long)
        if topic and len(topic) <= 50 and len(topic.split()) <= 6:
            return topic
        elif topic:
            # Truncate if too long
            words = topic.split()[:5]
            return ' '.join(words)

        return None

    except Exception as e:
        print(f"Error generating topic: {e}")
        return None


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


def process_vectors(
    meeting_id: str,
    s3_key: str,
    transcript_text: str,
    speakers: List[str]
) -> int:
    """
    Chunk transcript, generate embeddings, and store vectors.

    Includes real speaker names in embeddings for relationship-based search.
    Filters out generic names like "Speaker 1", "Speaker 2".

    Returns number of vectors stored.
    """
    # Chunk the transcript
    chunks = chunk_text(transcript_text, chunk_size=500, overlap=50)

    if not chunks:
        return 0

    # Filter to only real speaker names (not "Speaker 1", etc.)
    real_speakers = [s for s in speakers if is_real_speaker_name(s)]

    # Create speaker context prefix if we have real names
    speaker_context = ""
    if real_speakers:
        speaker_names = ", ".join(real_speakers)
        speaker_context = f"Meeting participants: {speaker_names}. "
        print(f"Including speakers in embeddings: {speaker_names}")

    # Generate embeddings and prepare vectors
    vectors_to_store = []
    primary_speaker = real_speakers[0] if real_speakers else (speakers[0] if speakers else 'unknown')

    for i, chunk in enumerate(chunks):
        # Prepend speaker context to chunk for embedding generation
        # This ensures speaker names are part of the semantic embedding
        text_for_embedding = speaker_context + chunk

        # Generate embedding with speaker-enriched text
        embedding = generate_embedding(text_for_embedding, bedrock_client)

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
                'text': chunk[:500]  # Truncate for metadata storage
            }
        })

    # Store vectors in batches of 100
    batch_size = 100
    for i in range(0, len(vectors_to_store), batch_size):
        batch = vectors_to_store[i:i + batch_size]
        store_vectors(batch, vectors_client)

    return len(vectors_to_store)


def extract_metadata(s3_key: str, content: dict) -> dict:
    """
    Extract metadata from transcript content.
    """
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    meeting = data.get('meeting', {})

    # Extract meeting ID from key or content
    meeting_id = meeting.get('id', '')
    if not meeting_id:
        # Try to extract from filename: YYYYMMDD_HHMMSS_title_meetingId.json
        filename = s3_key.split('/')[-1]
        parts = filename.replace('.json', '').split('_')
        if len(parts) >= 4:
            meeting_id = parts[-1]
        else:
            meeting_id = filename.replace('.json', '')

    # Extract date from meeting or key
    start_date = meeting.get('start_date', '')
    if start_date:
        try:
            dt = datetime.fromisoformat(start_date.replace('Z', '+00:00'))
            date_str = dt.strftime('%Y-%m-%d')
            timestamp = start_date
        except:
            date_str = datetime.now().strftime('%Y-%m-%d')
            timestamp = datetime.now().isoformat()
    else:
        # Extract from key: meetings/YYYY/MM/DD/...
        parts = s3_key.split('/')
        if len(parts) >= 4:
            date_str = f"{parts[1]}-{parts[2]}-{parts[3]}"
        else:
            date_str = datetime.now().strftime('%Y-%m-%d')
        timestamp = content.get('received_at', datetime.now().isoformat())

    # Extract speakers
    speakers_raw = meeting.get('speakers', [])
    speakers = []
    for s in speakers_raw:
        if s.get('first_name'):
            name = f"{s['first_name']} {s.get('last_name', '')}".strip()
            speakers.append(name)
        elif s.get('index'):
            speakers.append(f"Speaker {s['index']}")

    # Build metadata object
    metadata = {
        'meeting_id': meeting_id,
        'title': meeting.get('title', 'Untitled'),
        'date': date_str,
        'timestamp': timestamp,
        'duration': meeting.get('duration', 0),
        'speakers': speakers,
        's3_key': s3_key,
        'event_type': content.get('event_type', 'unknown'),
        'received_at': content.get('received_at', ''),
        'url': meeting.get('url', ''),
        'indexed_at': datetime.now().isoformat()
    }

    return metadata


def index_to_dynamodb(metadata: dict) -> None:
    """
    Index transcript metadata to DynamoDB.
    """
    # Prepare item for DynamoDB
    item = {
        'pk': 'TRANSCRIPT',
        'meeting_id': metadata['meeting_id'],
        'title': metadata['title'],
        'date': metadata['date'],
        'timestamp': metadata['timestamp'],
        'duration': metadata['duration'],
        's3_key': metadata['s3_key'],
        'event_type': metadata['event_type'],
        'received_at': metadata['received_at'],
        'url': metadata['url'],
        'indexed_at': metadata['indexed_at']
    }

    # Add speakers (DynamoDB doesn't allow empty lists/sets)
    if metadata['speakers']:
        item['speakers'] = metadata['speakers']
        # Add first speaker as speaker_name for GSI
        item['speaker_name'] = metadata['speakers'][0].lower()

    # Add AI-generated topic if available
    if metadata.get('topic'):
        item['topic'] = metadata['topic']

    # Put item (will overwrite if exists)
    table.put_item(Item=item)
    print(f"Indexed to DynamoDB: {metadata['meeting_id']}")

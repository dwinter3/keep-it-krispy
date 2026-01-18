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
ENABLE_PRIVACY = os.environ.get('ENABLE_PRIVACY', 'true').lower() == 'true'
TOPIC_MODEL_ID = os.environ.get('TOPIC_MODEL_ID', 'amazon.nova-lite-v1:0')
PRIVACY_MODEL_ID = os.environ.get('PRIVACY_MODEL_ID', 'amazon.nova-lite-v1:0')
table = dynamodb.Table(TABLE_NAME)


def handler(event: dict, context: Any) -> dict:
    """
    Process S3 events for new transcript uploads.
    """
    print(f"Processing event: {json.dumps(event)}")

    processed = 0
    vectors_stored = 0
    topics_generated = 0
    privacy_analyzed = 0
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

            # Analyze privacy level of the meeting
            if ENABLE_PRIVACY and transcript_text:
                try:
                    privacy_result = analyze_privacy(transcript_text, metadata['title'], bedrock_client)
                    if privacy_result:
                        metadata['privacy_level'] = privacy_result['level']
                        metadata['privacy_reason'] = privacy_result['reason']
                        metadata['privacy_topics'] = privacy_result['topics']
                        metadata['privacy_confidence'] = privacy_result['confidence']
                        metadata['privacy_work_percent'] = privacy_result['work_percent']
                        privacy_analyzed += 1
                        print(f"Privacy analysis: {privacy_result['level']} ({privacy_result['confidence']}% confidence)")
                except Exception as pe:
                    print(f"Privacy analysis error (non-fatal): {pe}")

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
            'privacy_analyzed': privacy_analyzed,
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
    Generate a descriptive topic for the meeting using Claude.

    Args:
        transcript_text: The full transcript text
        title: The meeting title
        bedrock_client: Bedrock runtime client

    Returns:
        A descriptive topic string (10-20 words) or None if generation fails
    """
    if not transcript_text or len(transcript_text.strip()) < 50:
        return None

    # Use first 4000 chars of transcript to keep within token limits
    text_sample = transcript_text[:4000]

    prompt = f"""Based on this meeting transcript, generate a descriptive topic title (10-20 words) that captures:
1. The main subject or purpose of the meeting
2. Key companies, products, or people mentioned
3. Specific topics or decisions discussed

Meeting title: {title}

Transcript excerpt:
{text_sample}

Return ONLY the topic title, nothing else. Use a dash to separate the main topic from details.

Examples of good topic titles:
- "Partnership discussion - AWS and Azure integration challenges and go-to-market strategy"
- "Q4 Sales Review - ACME Corp deal progress, pipeline forecast, and team quotas"
- "Product roadmap planning - mobile app redesign priorities and Q1 launch timeline"
- "Customer onboarding call with TechCorp - implementation requirements and success criteria"
- "Weekly team standup - sprint progress, blockers on auth feature, and upcoming PTO"

Generate a similarly detailed topic title for this meeting."""

    try:
        body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "maxTokens": 100,
                "temperature": 0.3,
                "topP": 0.9
            }
        })

        response = bedrock_client.invoke_model(
            modelId=TOPIC_MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())
        topic = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()

        # Validate topic is reasonable (max 150 chars, reasonable word count)
        if topic and len(topic) <= 150 and len(topic.split()) <= 25:
            return topic
        elif topic:
            # Truncate if too long - keep first 150 chars and trim to last complete word
            truncated = topic[:150]
            if len(topic) > 150:
                last_space = truncated.rfind(' ')
                if last_space > 50:
                    truncated = truncated[:last_space]
            return truncated

        return None

    except Exception as e:
        print(f"Error generating topic: {e}")
        return None


def analyze_privacy(transcript_text: str, title: str, bedrock_client) -> Optional[Dict]:
    """
    Analyze the privacy level of a meeting transcript.

    Categorizes meetings as:
    - 'work': Clearly work-related content (projects, clients, business discussions)
    - 'work_with_private': Primarily work but contains some private topics (health, personal plans)
    - 'likely_private': Appears to be a personal/private conversation

    Args:
        transcript_text: The full transcript text
        title: The meeting title
        bedrock_client: Bedrock runtime client

    Returns:
        Dict with level, reason, topics, confidence, work_percent or None if analysis fails
    """
    if not transcript_text or len(transcript_text.strip()) < 100:
        return None

    # Use first 6000 chars of transcript for better analysis
    text_sample = transcript_text[:6000]

    prompt = f"""Analyze this meeting transcript and determine its privacy level.

Meeting title: {title}

Transcript:
{text_sample}

Classify the meeting into ONE of these categories:
1. "work" - Clearly work-related: project discussions, client meetings, business strategy, code reviews, team standups, product planning, etc.
2. "work_with_private" - Primarily work but contains private/sensitive topics: health issues, family matters, personal finances, vacation planning, career concerns, salary discussions, etc.
3. "likely_private" - Appears to be a personal/private conversation: medical appointments, therapy sessions, legal consultations, family discussions, friend chats, etc.

Return your analysis as JSON with this exact structure:
{{
  "level": "work" | "work_with_private" | "likely_private",
  "reason": "Brief 1-2 sentence explanation of the classification",
  "topics": ["list", "of", "sensitive", "topics", "found"],
  "confidence": 85,
  "work_percent": 75
}}

- "confidence" is 0-100 how sure you are of the classification
- "work_percent" is 0-100 what percentage of the content is work-related
- "topics" should list any sensitive topics found (health, finances, legal, personal relationships, etc.)

Return ONLY the JSON object, no other text."""

    try:
        body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "maxTokens": 300,
                "temperature": 0.2,
                "topP": 0.9
            }
        })

        response = bedrock_client.invoke_model(
            modelId=PRIVACY_MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())
        result_text = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()

        # Parse the JSON response
        # Handle potential markdown code blocks
        if result_text.startswith('```'):
            result_text = result_text.split('```')[1]
            if result_text.startswith('json'):
                result_text = result_text[4:]
            result_text = result_text.strip()

        result = json.loads(result_text)

        # Validate the result
        valid_levels = ['work', 'work_with_private', 'likely_private']
        if result.get('level') not in valid_levels:
            print(f"Invalid privacy level: {result.get('level')}")
            return None

        return {
            'level': result['level'],
            'reason': result.get('reason', '')[:500],  # Limit reason length
            'topics': result.get('topics', [])[:10],  # Limit topics
            'confidence': min(100, max(0, int(result.get('confidence', 50)))),
            'work_percent': min(100, max(0, int(result.get('work_percent', 50))))
        }

    except Exception as e:
        print(f"Error analyzing privacy: {e}")
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

    # Add privacy analysis fields if available
    if metadata.get('privacy_level'):
        item['privacy_level'] = metadata['privacy_level']
        item['privacy_reason'] = metadata.get('privacy_reason', '')
        item['privacy_topics'] = metadata.get('privacy_topics', [])
        item['privacy_confidence'] = metadata.get('privacy_confidence', 0)
        item['privacy_work_percent'] = metadata.get('privacy_work_percent', 0)

    # Put item (will overwrite if exists)
    table.put_item(Item=item)
    print(f"Indexed to DynamoDB: {metadata['meeting_id']}")

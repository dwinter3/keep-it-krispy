import json
import os
import re
import hashlib
import boto3
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple

s3 = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

BUCKET_NAME = os.environ.get('KRISP_S3_BUCKET', '')  # Required: set via environment variable
WEBHOOK_AUTH_KEY = os.environ.get('KRISP_WEBHOOK_AUTH_KEY')  # Legacy: single shared key
API_KEYS_TABLE = os.environ.get('API_KEYS_TABLE', 'krisp-api-keys')

api_keys_table = dynamodb.Table(API_KEYS_TABLE)


def authenticate_request(headers: dict) -> Tuple[bool, Optional[str], str]:
    """
    Authenticate the request using API key or legacy webhook auth key.

    Checks:
    1. X-API-Key header
    2. Authorization: Bearer <key> header
    3. Legacy WEBHOOK_AUTH_KEY (for backward compatibility)

    Returns:
        Tuple of (is_authenticated, user_id, auth_method)
        - is_authenticated: True if auth succeeded
        - user_id: The user ID if API key auth, None for legacy auth
        - auth_method: 'api_key', 'legacy', or 'none'
    """
    # Try X-API-Key header first
    api_key = headers.get('x-api-key', '')

    # Try Authorization: Bearer <key>
    if not api_key:
        auth_header = headers.get('authorization', '')
        if auth_header.startswith('Bearer '):
            api_key = auth_header[7:]

    # If we have an API key, look it up
    if api_key:
        try:
            key_hash = hashlib.sha256(api_key.encode()).hexdigest()
            response = api_keys_table.get_item(Key={'key_hash': key_hash})
            item = response.get('Item')

            if item and item.get('status') == 'active':
                user_id = item.get('user_id')
                print(f"API key authenticated for user: {user_id}")
                return (True, user_id, 'api_key')
            else:
                print(f"API key not found or inactive: {key_hash[:16]}...")
                return (False, None, 'none')
        except Exception as e:
            print(f"API key lookup error: {e}")
            return (False, None, 'none')

    # Fall back to legacy webhook auth key
    auth_header = headers.get('authorization', '')
    if WEBHOOK_AUTH_KEY and auth_header == WEBHOOK_AUTH_KEY:
        print("Legacy webhook auth key accepted (no user_id)")
        return (True, None, 'legacy')

    # No valid authentication
    if WEBHOOK_AUTH_KEY:
        print(f"Auth failed. No valid API key or legacy key match.")
    return (False, None, 'none')


def format_timestamp(ms: int) -> str:
    """Convert milliseconds to HH:MM:SS or MM:SS format."""
    total_seconds = ms // 1000
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    seconds = total_seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{seconds:02d}"
    return f"{minutes:02d}:{seconds:02d}"


def format_timestamp_seconds(seconds: float) -> str:
    """Convert seconds to HH:MM:SS or MM:SS format."""
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    if hours > 0:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def detect_krispy_live_format(payload: dict) -> Optional[str]:
    """
    Detect if payload is from krispy-live and which format.

    Returns:
        'assemblyai' - AssemblyAI transcript format
        'whisper' - Whisper transcript format
        'gemini' - Gemini Live format
        'webhook' - Krispy-live webhook format (paths + text)
        None - Not krispy-live format (standard Krisp format)
    """
    # Check for krispy-live webhook format (has text fields and paths)
    if 'assembly_text' in payload or 'whisper_text' in payload:
        return 'webhook'

    # Check for raw AssemblyAI format (has utterances array)
    if 'utterances' in payload and isinstance(payload.get('utterances'), list):
        return 'assemblyai'

    # Check for Whisper format (has segments array with no speakers)
    if 'segments' in payload and isinstance(payload.get('segments'), list):
        if payload['segments'] and 'speaker' not in payload['segments'][0]:
            return 'whisper'

    # Check for Gemini Live format (has turns array)
    if 'turns' in payload and isinstance(payload.get('turns'), list):
        if payload['turns'] and 'role' in payload['turns'][0]:
            return 'gemini'

    return None


def convert_assemblyai_to_krisp(payload: dict) -> dict:
    """
    Convert AssemblyAI transcript format to keep-it-krispy format.

    Input format:
    {
        "id": "transcript_id",
        "text": "full text",
        "utterances": [{"speaker": "A", "start": 1234, "end": 5678, "text": "..."}],
        "audio_duration": 3600000
    }
    """
    utterances = payload.get('utterances', [])

    # Build Krisp-style raw_content
    lines = []
    speakers_seen = set()

    for utt in utterances:
        speaker = utt.get('speaker', 'A')
        speaker_name = f"Speaker {speaker}"
        speakers_seen.add(speaker_name)
        start_ms = utt.get('start', 0)
        text = utt.get('text', '').strip()

        timestamp = format_timestamp(start_ms)
        lines.append(f"{speaker_name} | {timestamp}")
        lines.append(text)
        lines.append("")  # Blank line between utterances

    raw_content = "\n".join(lines)

    # Calculate duration from audio_duration (ms) or last utterance
    duration_ms = payload.get('audio_duration', 0)
    if not duration_ms and utterances:
        duration_ms = utterances[-1].get('end', 0)
    duration_seconds = duration_ms // 1000

    # Generate meeting ID from AssemblyAI transcript ID or timestamp
    transcript_id = payload.get('id', '')
    meeting_id = f"assemblyai_{transcript_id}" if transcript_id else f"meeting_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    return {
        'event': 'transcript_created',
        'meeting_id': meeting_id,
        'title': 'Krispy Live Recording',
        'data': {
            'raw_content': raw_content,
            'meeting': {
                'id': meeting_id,
                'title': 'Krispy Live Recording',
                'duration': duration_seconds,
                'start_date': datetime.utcnow().isoformat() + 'Z',
                'speakers': [{'index': i+1, 'first_name': name} for i, name in enumerate(sorted(speakers_seen))]
            }
        },
        '_krispy_live': {
            'source': 'assemblyai',
            'original_id': transcript_id,
            'confidence': payload.get('confidence')
        }
    }


def convert_whisper_to_krisp(payload: dict) -> dict:
    """
    Convert Whisper transcript format to keep-it-krispy format.

    Input format:
    {
        "text": "full text",
        "segments": [{"start": 0.0, "end": 5.23, "text": "..."}],
        "language": "en"
    }
    """
    segments = payload.get('segments', [])

    # Build Krisp-style raw_content (Whisper has no speaker diarization)
    lines = []

    for seg in segments:
        start_seconds = seg.get('start', 0)
        text = seg.get('text', '').strip()

        if text:
            timestamp = format_timestamp_seconds(start_seconds)
            lines.append(f"Speaker 1 | {timestamp}")
            lines.append(text)
            lines.append("")

    raw_content = "\n".join(lines)

    # Calculate duration from last segment
    duration_seconds = 0
    if segments:
        duration_seconds = int(segments[-1].get('end', 0))

    meeting_id = f"whisper_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    return {
        'event': 'transcript_created',
        'meeting_id': meeting_id,
        'title': 'Krispy Live Recording',
        'data': {
            'raw_content': raw_content,
            'meeting': {
                'id': meeting_id,
                'title': 'Krispy Live Recording',
                'duration': duration_seconds,
                'start_date': datetime.utcnow().isoformat() + 'Z',
                'speakers': [{'index': 1, 'first_name': 'Speaker 1'}]
            }
        },
        '_krispy_live': {
            'source': 'whisper',
            'language': payload.get('language', 'en')
        }
    }


def convert_gemini_to_krisp(payload: dict) -> dict:
    """
    Convert Gemini Live transcript format to keep-it-krispy format.

    Input format:
    {
        "created_at": 1234567890.123,
        "turns": [{"role": "user"|"assistant", "text": "...", "ts": 1234567890.123}]
    }
    """
    turns = payload.get('turns', [])
    created_at = payload.get('created_at', 0)

    # Build Krisp-style raw_content
    lines = []
    speakers_seen = set()

    for turn in turns:
        role = turn.get('role', 'user')
        speaker_name = 'You' if role == 'user' else 'Gemini Assistant'
        speakers_seen.add(speaker_name)
        text = turn.get('text', '').strip()
        ts = turn.get('ts', 0)

        # Calculate offset from start
        offset_seconds = ts - created_at if created_at else 0
        timestamp = format_timestamp_seconds(max(0, offset_seconds))

        if text:
            lines.append(f"{speaker_name} | {timestamp}")
            lines.append(text)
            lines.append("")

    raw_content = "\n".join(lines)

    # Calculate duration
    duration_seconds = 0
    if turns and created_at:
        duration_seconds = int(turns[-1].get('ts', created_at) - created_at)

    meeting_id = f"gemini_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    return {
        'event': 'transcript_created',
        'meeting_id': meeting_id,
        'title': 'Gemini Live Conversation',
        'data': {
            'raw_content': raw_content,
            'meeting': {
                'id': meeting_id,
                'title': 'Gemini Live Conversation',
                'duration': duration_seconds,
                'start_date': datetime.utcfromtimestamp(created_at).isoformat() + 'Z' if created_at else datetime.utcnow().isoformat() + 'Z',
                'speakers': [{'index': i+1, 'first_name': name} for i, name in enumerate(sorted(speakers_seen))]
            }
        },
        '_krispy_live': {
            'source': 'gemini_live'
        }
    }


def convert_krispy_webhook_to_krisp(payload: dict) -> dict:
    """
    Convert krispy-live webhook format to keep-it-krispy format.

    Input format:
    {
        "audio_path": "/path/to/meeting.wav",
        "assembly_transcript_path": "/path/to/transcript.json",
        "assembly_text": "full text from assemblyai",
        "whisper_text": "full text from whisper",
        "timestamp": "2025-01-20T14:30:22.123456"
    }
    """
    # Prefer AssemblyAI text, fall back to Whisper
    text = payload.get('assembly_text') or payload.get('whisper_text', '')
    timestamp_str = payload.get('timestamp', datetime.utcnow().isoformat())

    # Extract meeting ID from audio path or generate from timestamp
    audio_path = payload.get('audio_path', '')
    if audio_path:
        # Extract from path like /path/to/meeting_20250120_143022.wav
        filename = audio_path.split('/')[-1].replace('.wav', '')
        meeting_id = filename
    else:
        meeting_id = f"meeting_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}"

    # Format as simple Krisp content (no speaker diarization from webhook)
    raw_content = f"Speaker 1 | 00:00\n{text}"

    # Determine source
    source = 'assemblyai' if payload.get('assembly_text') else 'whisper'

    return {
        'event': 'transcript_created',
        'meeting_id': meeting_id,
        'title': 'Krispy Live Recording',
        'data': {
            'raw_content': raw_content,
            'meeting': {
                'id': meeting_id,
                'title': 'Krispy Live Recording',
                'duration': 0,  # Unknown from webhook
                'start_date': timestamp_str,
                'speakers': [{'index': 1, 'first_name': 'Speaker 1'}]
            }
        },
        '_krispy_live': {
            'source': source,
            'audio_path': audio_path
        }
    }


def transform_krispy_live_payload(payload: dict) -> dict:
    """
    Transform krispy-live payload to keep-it-krispy format if needed.
    Returns original payload if not krispy-live format.
    """
    format_type = detect_krispy_live_format(payload)

    if format_type == 'assemblyai':
        print("Detected krispy-live AssemblyAI format, converting...")
        return convert_assemblyai_to_krisp(payload)
    elif format_type == 'whisper':
        print("Detected krispy-live Whisper format, converting...")
        return convert_whisper_to_krisp(payload)
    elif format_type == 'gemini':
        print("Detected krispy-live Gemini Live format, converting...")
        return convert_gemini_to_krisp(payload)
    elif format_type == 'webhook':
        print("Detected krispy-live webhook format, converting...")
        return convert_krispy_webhook_to_krisp(payload)

    # Not krispy-live format, return as-is
    return payload


def lambda_handler(event, context):
    """
    Krisp Webhook Receiver

    Receives meeting data from Krisp webhooks and stores in S3.
    Supports events: transcript_created, notes_generated, outline_generated

    Authentication:
    - X-API-Key header with user's API key (preferred)
    - Authorization: Bearer <api_key>
    - Legacy: Authorization header matching KRISP_WEBHOOK_AUTH_KEY env var
    """

    # Extract headers (Lambda function URL format)
    headers = event.get('headers', {})

    # Authenticate the request
    is_authenticated, user_id, auth_method = authenticate_request(headers)

    if not is_authenticated:
        return {
            'statusCode': 401,
            'body': json.dumps({'error': 'Unauthorized. Provide API key via X-API-Key header.'})
        }

    # Parse body
    body = event.get('body', '{}')
    if event.get('isBase64Encoded', False):
        import base64
        body = base64.b64decode(body).decode('utf-8')

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {e}")
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'Invalid JSON'})
        }

    # Transform krispy-live format to keep-it-krispy format if needed
    original_format = detect_krispy_live_format(payload)
    payload = transform_krispy_live_payload(payload)

    # Extract meeting info from payload (now normalized)
    event_type = payload.get('event', 'unknown')
    meeting_id = payload.get('meeting_id', payload.get('meetingId', 'unknown'))
    meeting_title = payload.get('title', payload.get('meeting_title', 'Untitled'))

    # Generate S3 key with date-based organization
    now = datetime.utcnow()
    date_prefix = now.strftime('%Y/%m/%d')
    timestamp = now.strftime('%Y%m%d_%H%M%S')

    # Clean meeting title for filename
    safe_title = "".join(c if c.isalnum() or c in (' ', '-', '_') else '_' for c in meeting_title)
    safe_title = safe_title[:50]  # Limit length

    s3_key = f"meetings/{date_prefix}/{timestamp}_{safe_title}_{meeting_id}.json"

    # Enrich payload with metadata
    enriched_payload = {
        'received_at': now.isoformat() + 'Z',
        'event_type': event_type,
        'raw_payload': payload
    }

    # Include user_id if authenticated via API key
    if user_id:
        enriched_payload['user_id'] = user_id
        print(f"Transcript will be owned by user: {user_id}")

    # Store in S3
    try:
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=json.dumps(enriched_payload, indent=2, default=str),
            ContentType='application/json'
        )
        print(f"Stored meeting data: s3://{BUCKET_NAME}/{s3_key}")
    except Exception as e:
        print(f"S3 error: {e}")
        return {
            'statusCode': 500,
            'body': json.dumps({'error': 'Storage failed'})
        }

    response_body = {
        'message': 'Webhook received',
        'event_type': event_type,
        'meeting_id': meeting_id,
        's3_key': s3_key
    }

    # Include transformation info if krispy-live format was detected
    if original_format:
        response_body['krispy_live_format'] = original_format
        response_body['transformed'] = True

    return {
        'statusCode': 200,
        'body': json.dumps(response_body)
    }

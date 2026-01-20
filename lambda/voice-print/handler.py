"""
Voice Print Processing Lambda

Triggered when audio files are uploaded to the krisp-audio bucket.
Uses Amazon Transcribe for speaker diarization to identify speaker segments.

Workflow:
1. Audio uploaded → S3 event triggers this Lambda
2. Start Amazon Transcribe job with speaker diarization
3. Wait for completion, store diarization results
4. When user corrects speaker names, voice embeddings are extracted (separate process)
"""

import json
import os
import boto3
import time
from datetime import datetime
from urllib.parse import unquote_plus
from typing import Any, Dict, List, Optional

# Initialize clients
s3 = boto3.client('s3')
transcribe = boto3.client('transcribe')
dynamodb = boto3.resource('dynamodb')

AUDIO_BUCKET = os.environ.get('AUDIO_BUCKET', 'krisp-audio-754639201213')
TRANSCRIPTS_TABLE = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
VOICE_PRINTS_TABLE = os.environ.get('VOICE_PRINTS_TABLE', 'krisp-voice-prints')

# Max speakers to identify (Transcribe limit is 10)
MAX_SPEAKERS = 10


def handler(event: dict, context: Any) -> dict:
    """
    Process S3 events for new audio uploads.
    """
    print(f"Processing event: {json.dumps(event)}")

    processed = 0
    errors = []

    for record in event.get('Records', []):
        try:
            # Extract S3 info from event
            bucket = record['s3']['bucket']['name']
            key = unquote_plus(record['s3']['object']['key'])

            # Expected key format: users/{user_id}/audio/{meeting_id}/recording.{ext}
            if not key.startswith('users/') or '/audio/' not in key:
                print(f"Skipping non-audio file: {key}")
                continue

            parts = key.split('/')
            if len(parts) < 5:
                print(f"Invalid key format: {key}")
                continue

            user_id = parts[1]
            meeting_id = parts[3]

            print(f"Processing audio for meeting {meeting_id}, user {user_id}")

            # Start transcription with diarization
            result = start_diarization(bucket, key, meeting_id)
            if result:
                processed += 1

        except Exception as e:
            error_msg = f"Error processing {record.get('s3', {}).get('object', {}).get('key', 'unknown')}: {str(e)}"
            print(error_msg)
            errors.append(error_msg)

    return {
        'statusCode': 200,
        'body': json.dumps({
            'processed': processed,
            'errors': errors
        })
    }


def start_diarization(bucket: str, key: str, meeting_id: str) -> bool:
    """
    Start Amazon Transcribe job with speaker diarization.
    """
    # Generate unique job name
    job_name = f"krisp-diarize-{meeting_id}-{int(time.time())}"

    # S3 URI for the audio file
    media_uri = f"s3://{bucket}/{key}"

    # Determine media format from extension
    ext = key.split('.')[-1].lower()
    format_map = {
        'mp3': 'mp3',
        'wav': 'wav',
        'ogg': 'ogg',
        'opus': 'ogg',  # Transcribe treats opus as ogg
        'm4a': 'mp4',
        'aac': 'mp4',
        'webm': 'webm',
    }
    media_format = format_map.get(ext, 'mp3')

    try:
        # Start transcription job with speaker identification
        response = transcribe.start_transcription_job(
            TranscriptionJobName=job_name,
            Media={'MediaFileUri': media_uri},
            MediaFormat=media_format,
            LanguageCode='en-US',  # TODO: Make configurable
            Settings={
                'ShowSpeakerLabels': True,
                'MaxSpeakerLabels': MAX_SPEAKERS,
            },
            # Output to same bucket in a results folder
            OutputBucketName=bucket,
            OutputKey=f"users/{key.split('/')[1]}/diarization/{meeting_id}/result.json",
        )

        print(f"Started transcription job: {job_name}")

        # Update transcript record with diarization status
        update_diarization_status(meeting_id, 'processing', job_name)

        return True

    except Exception as e:
        print(f"Failed to start transcription: {e}")
        update_diarization_status(meeting_id, 'failed', error=str(e))
        return False


def update_diarization_status(
    meeting_id: str,
    status: str,
    job_name: Optional[str] = None,
    error: Optional[str] = None
) -> None:
    """
    Update the transcript record with diarization status.
    """
    table = dynamodb.Table(TRANSCRIPTS_TABLE)

    update_expr = 'SET diarization_status = :status, diarization_updated_at = :updated'
    expr_values: Dict[str, Any] = {
        ':status': status,
        ':updated': datetime.now().isoformat(),
    }

    if job_name:
        update_expr += ', diarization_job_name = :job'
        expr_values[':job'] = job_name

    if error:
        update_expr += ', diarization_error = :error'
        expr_values[':error'] = error

    try:
        table.update_item(
            Key={'meeting_id': meeting_id},
            UpdateExpression=update_expr,
            ExpressionAttributeValues=expr_values,
        )
        print(f"Updated diarization status for {meeting_id}: {status}")
    except Exception as e:
        print(f"Failed to update diarization status: {e}")


def process_transcription_result(event: dict, context: Any) -> dict:
    """
    Handle completed transcription jobs.
    Called by EventBridge when Transcribe job completes.
    """
    print(f"Processing transcription result: {json.dumps(event)}")

    detail = event.get('detail', {})
    job_name = detail.get('TranscriptionJobName', '')
    job_status = detail.get('TranscriptionJobStatus', '')

    if not job_name.startswith('krisp-diarize-'):
        print(f"Ignoring non-krisp job: {job_name}")
        return {'statusCode': 200}

    # Extract meeting_id from job name: krisp-diarize-{meeting_id}-{timestamp}
    parts = job_name.split('-')
    if len(parts) >= 3:
        meeting_id = parts[2]
    else:
        print(f"Cannot extract meeting_id from job name: {job_name}")
        return {'statusCode': 400}

    if job_status == 'COMPLETED':
        # Get the transcription result
        try:
            result = transcribe.get_transcription_job(TranscriptionJobName=job_name)
            transcript_uri = result['TranscriptionJob']['Transcript']['TranscriptFileUri']

            # Fetch and process the result
            diarization_result = fetch_diarization_result(transcript_uri)
            if diarization_result:
                # Store speaker segments in DynamoDB
                store_speaker_segments(meeting_id, diarization_result)
                update_diarization_status(meeting_id, 'complete')
            else:
                update_diarization_status(meeting_id, 'failed', error='No diarization data')

        except Exception as e:
            print(f"Failed to process transcription result: {e}")
            update_diarization_status(meeting_id, 'failed', error=str(e))

    elif job_status == 'FAILED':
        failure_reason = detail.get('FailureReason', 'Unknown error')
        update_diarization_status(meeting_id, 'failed', error=failure_reason)

    return {'statusCode': 200}


def fetch_diarization_result(uri: str) -> Optional[Dict]:
    """
    Fetch and parse the transcription result from S3.
    """
    # URI format: https://s3.region.amazonaws.com/bucket/key or s3://bucket/key
    if uri.startswith('https://'):
        # Parse S3 URL
        # Format: https://s3.{region}.amazonaws.com/{bucket}/{key}
        parts = uri.replace('https://', '').split('/')
        bucket = parts[1]
        key = '/'.join(parts[2:])
    elif uri.startswith('s3://'):
        parts = uri.replace('s3://', '').split('/')
        bucket = parts[0]
        key = '/'.join(parts[1:])
    else:
        print(f"Unknown URI format: {uri}")
        return None

    try:
        response = s3.get_object(Bucket=bucket, Key=key)
        content = json.loads(response['Body'].read().decode('utf-8'))
        return content
    except Exception as e:
        print(f"Failed to fetch diarization result: {e}")
        return None


def store_speaker_segments(meeting_id: str, result: Dict) -> None:
    """
    Extract and store speaker segments from transcription result.

    Format stored:
    {
        "speaker_labels": {
            "spk_0": [
                {"start_time": 0.0, "end_time": 5.2},
                {"start_time": 10.1, "end_time": 15.5}
            ],
            "spk_1": [...]
        },
        "speaker_count": 2
    }
    """
    # Extract speaker labels from Transcribe result
    results = result.get('results', {})
    speaker_labels = results.get('speaker_labels', {})
    segments = speaker_labels.get('segments', [])

    # Group segments by speaker
    speakers: Dict[str, List[Dict]] = {}
    for segment in segments:
        speaker = segment.get('speaker_label', 'unknown')
        start_time = float(segment.get('start_time', 0))
        end_time = float(segment.get('end_time', 0))

        if speaker not in speakers:
            speakers[speaker] = []
        speakers[speaker].append({
            'start_time': start_time,
            'end_time': end_time,
        })

    speaker_data = {
        'speaker_labels': speakers,
        'speaker_count': len(speakers),
        'processed_at': datetime.now().isoformat(),
    }

    # Update transcript record
    table = dynamodb.Table(TRANSCRIPTS_TABLE)
    try:
        table.update_item(
            Key={'meeting_id': meeting_id},
            UpdateExpression='SET diarization_result = :result',
            ExpressionAttributeValues={':result': speaker_data},
        )
        print(f"Stored speaker segments for {meeting_id}: {len(speakers)} speakers")
    except Exception as e:
        print(f"Failed to store speaker segments: {e}")

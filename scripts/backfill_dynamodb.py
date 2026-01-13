#!/usr/bin/env python3
"""
Backfill script to index existing S3 transcripts to DynamoDB.
Run with: AWS_PROFILE=krisp-buddy python3 backfill_dynamodb.py
"""

import json
import boto3
from datetime import datetime

BUCKET_NAME = 'krisp-transcripts-754639201213'
TABLE_NAME = 'krisp-transcripts-index'
REGION = 'us-east-1'

s3 = boto3.client('s3', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
table = dynamodb.Table(TABLE_NAME)


def list_all_transcripts():
    """List all JSON files in meetings/ prefix."""
    transcripts = []
    paginator = s3.get_paginator('list_objects_v2')

    for page in paginator.paginate(Bucket=BUCKET_NAME, Prefix='meetings/'):
        for obj in page.get('Contents', []):
            if obj['Key'].endswith('.json'):
                transcripts.append(obj['Key'])

    return transcripts


def extract_metadata(s3_key: str, content: dict) -> dict:
    """Extract metadata from transcript content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    meeting = data.get('meeting', {})

    # Extract meeting ID
    meeting_id = meeting.get('id', '')
    if not meeting_id:
        filename = s3_key.split('/')[-1]
        parts = filename.replace('.json', '').split('_')
        if len(parts) >= 4:
            meeting_id = parts[-1]
        else:
            meeting_id = filename.replace('.json', '')

    # Extract date
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

    return {
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


def index_to_dynamodb(metadata: dict) -> None:
    """Index transcript metadata to DynamoDB."""
    item = {
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

    if metadata['speakers']:
        item['speakers'] = metadata['speakers']
        item['speaker_name'] = metadata['speakers'][0].lower()

    table.put_item(Item=item)


def main():
    print(f"Scanning S3 bucket: {BUCKET_NAME}")
    transcripts = list_all_transcripts()
    print(f"Found {len(transcripts)} transcripts")

    indexed = 0
    errors = 0

    for i, key in enumerate(transcripts):
        try:
            print(f"[{i+1}/{len(transcripts)}] Processing: {key}")

            # Fetch from S3
            response = s3.get_object(Bucket=BUCKET_NAME, Key=key)
            content = json.loads(response['Body'].read().decode('utf-8'))

            # Extract and index
            metadata = extract_metadata(key, content)
            index_to_dynamodb(metadata)

            indexed += 1
            print(f"  -> Indexed: {metadata['meeting_id']} ({metadata['title'][:50]})")

        except Exception as e:
            errors += 1
            print(f"  -> ERROR: {e}")

    print(f"\nBackfill complete!")
    print(f"  Indexed: {indexed}")
    print(f"  Errors: {errors}")


if __name__ == '__main__':
    main()

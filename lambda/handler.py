import json
import os
import boto3
from datetime import datetime

s3 = boto3.client('s3')

BUCKET_NAME = os.environ.get('KRISP_S3_BUCKET', 'krisp-transcripts-dwinter')
WEBHOOK_AUTH_KEY = os.environ.get('KRISP_WEBHOOK_AUTH_KEY')


def lambda_handler(event, context):
    """
    Krisp Webhook Receiver

    Receives meeting data from Krisp webhooks and stores in S3.
    Supports events: transcript_created, notes_generated, outline_generated
    """

    # Extract headers (Lambda function URL format)
    headers = event.get('headers', {})
    auth_header = headers.get('authorization', '')

    # Validate authorization
    if WEBHOOK_AUTH_KEY and auth_header != WEBHOOK_AUTH_KEY:
        print(f"Auth failed. Expected: {WEBHOOK_AUTH_KEY[:8]}..., Got: {auth_header[:8]}...")
        return {
            'statusCode': 401,
            'body': json.dumps({'error': 'Unauthorized'})
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

    # Extract meeting info from payload
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

    return {
        'statusCode': 200,
        'body': json.dumps({
            'message': 'Webhook received',
            'event_type': event_type,
            'meeting_id': meeting_id,
            's3_key': s3_key
        })
    }

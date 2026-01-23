#!/usr/bin/env python3
"""
Re-index transcripts to regenerate vectors.

This script re-processes transcripts that were uploaded after the vector indexing
broke (due to IAM permission issues). It triggers the processor Lambda to
regenerate embeddings and store them in S3 Vectors.

Usage:
    python scripts/reindex-transcripts.py --since 2026-01-13 --profile krisp-buddy

    # Dry run (see what would be processed):
    python scripts/reindex-transcripts.py --since 2026-01-13 --dry-run --profile krisp-buddy

    # Process specific meeting IDs:
    python scripts/reindex-transcripts.py --meeting-ids "id1,id2,id3" --profile krisp-buddy
"""

import argparse
import boto3
import json
from datetime import datetime
from typing import List, Dict, Any


def get_transcripts_since(dynamodb, date_str: str, limit: int = 1000) -> List[Dict[str, Any]]:
    """Get all transcripts since a given date."""
    table = dynamodb.Table('krisp-transcripts-index')

    items = []
    last_key = None

    while True:
        scan_kwargs = {
            'FilterExpression': '#date >= :since AND (attribute_not_exists(pk) OR pk <> :docPk)',
            'ExpressionAttributeNames': {'#date': 'date'},
            'ExpressionAttributeValues': {
                ':since': date_str,
                ':docPk': 'DOCUMENT',
            },
            'ProjectionExpression': 'meeting_id, s3_key, #date, title, user_id',
            'Limit': min(limit, 100),
        }

        if last_key:
            scan_kwargs['ExclusiveStartKey'] = last_key

        response = table.scan(**scan_kwargs)
        items.extend(response.get('Items', []))

        last_key = response.get('LastEvaluatedKey')
        if not last_key or len(items) >= limit:
            break

    return items[:limit]


def get_transcripts_by_ids(dynamodb, meeting_ids: List[str]) -> List[Dict[str, Any]]:
    """Get transcripts by specific meeting IDs."""
    table = dynamodb.Table('krisp-transcripts-index')

    items = []
    for meeting_id in meeting_ids:
        response = table.get_item(
            Key={'meeting_id': meeting_id},
            ProjectionExpression='meeting_id, s3_key, #date, title, user_id',
            ExpressionAttributeNames={'#date': 'date'},
        )
        if 'Item' in response:
            items.append(response['Item'])
        else:
            print(f"Warning: Meeting ID not found: {meeting_id}")

    return items


def trigger_reprocessing(lambda_client, bucket: str, s3_key: str) -> Dict[str, Any]:
    """Trigger the processor Lambda to reprocess a transcript."""
    # Create an S3 event payload similar to what S3 would send
    event = {
        'Records': [{
            'eventVersion': '2.1',
            'eventSource': 'aws:s3',
            'awsRegion': 'us-east-1',
            'eventName': 'ObjectCreated:Put',
            's3': {
                'bucket': {'name': bucket},
                'object': {'key': s3_key},
            },
        }],
    }

    response = lambda_client.invoke(
        FunctionName='krisp-transcript-processor',
        InvocationType='RequestResponse',
        Payload=json.dumps(event),
    )

    payload = json.loads(response['Payload'].read())
    return payload


def main():
    parser = argparse.ArgumentParser(description='Re-index transcripts to regenerate vectors')
    parser.add_argument('--since', type=str, help='Re-index transcripts since this date (YYYY-MM-DD)')
    parser.add_argument('--meeting-ids', type=str, help='Comma-separated list of meeting IDs to re-index')
    parser.add_argument('--limit', type=int, default=100, help='Maximum number of transcripts to process')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed without actually processing')
    parser.add_argument('--profile', type=str, default='krisp-buddy', help='AWS profile to use')
    parser.add_argument('--bucket', type=str, default='krisp-transcripts-754639201213', help='S3 bucket name')

    args = parser.parse_args()

    if not args.since and not args.meeting_ids:
        parser.error('Either --since or --meeting-ids must be specified')

    # Initialize AWS clients
    session = boto3.Session(profile_name=args.profile)
    dynamodb = session.resource('dynamodb', region_name='us-east-1')
    lambda_client = session.client('lambda', region_name='us-east-1')

    # Get transcripts to process
    if args.meeting_ids:
        meeting_ids = [mid.strip() for mid in args.meeting_ids.split(',')]
        transcripts = get_transcripts_by_ids(dynamodb, meeting_ids)
    else:
        transcripts = get_transcripts_since(dynamodb, args.since, args.limit)

    print(f"\nFound {len(transcripts)} transcripts to process")
    print("=" * 60)

    if args.dry_run:
        print("\n[DRY RUN - No changes will be made]\n")
        for t in transcripts:
            print(f"  - {t.get('date', 'unknown')} | {t.get('title', 'Untitled')[:50]}")
            print(f"    Meeting ID: {t.get('meeting_id')}")
            print(f"    S3 Key: {t.get('s3_key')}")
            print()
        return

    # Process each transcript
    success_count = 0
    error_count = 0

    for i, t in enumerate(transcripts, 1):
        meeting_id = t.get('meeting_id')
        s3_key = t.get('s3_key')
        title = t.get('title', 'Untitled')[:50]
        date = t.get('date', 'unknown')

        print(f"\n[{i}/{len(transcripts)}] Processing: {date} - {title}")
        print(f"    Meeting ID: {meeting_id}")

        if not s3_key:
            print(f"    ERROR: No S3 key found, skipping")
            error_count += 1
            continue

        try:
            result = trigger_reprocessing(lambda_client, args.bucket, s3_key)

            if 'statusCode' in result and result['statusCode'] == 200:
                body = json.loads(result.get('body', '{}'))
                vectors = body.get('vectors_stored', 0)
                topics = body.get('topics_generated', 0)
                print(f"    SUCCESS: {vectors} vectors stored, {topics} topics generated")
                success_count += 1
            else:
                print(f"    ERROR: {result}")
                error_count += 1

        except Exception as e:
            print(f"    ERROR: {e}")
            error_count += 1

    print("\n" + "=" * 60)
    print(f"Completed: {success_count} successful, {error_count} errors")


if __name__ == '__main__':
    main()

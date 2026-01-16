#!/usr/bin/env python3
"""
Backfill script to add 'pk' field to existing DynamoDB items.

This enables the all-transcripts-index GSI for efficient pagination.
Run this after deploying the CloudFormation stack with the new GSI.

Usage:
    python scripts/backfill_pk.py [--dry-run]
"""

import argparse
import boto3
import os
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
AWS_REGION = os.environ.get('AWS_REGION', 'us-east-1')


def backfill_pk(dry_run: bool = False) -> dict:
    """
    Scan all items and add pk='TRANSCRIPT' to those missing it.

    Returns stats about the operation.
    """
    dynamodb = boto3.resource('dynamodb', region_name=AWS_REGION)
    table = dynamodb.Table(TABLE_NAME)

    stats = {
        'scanned': 0,
        'updated': 0,
        'skipped': 0,
        'errors': 0
    }

    print(f"Backfilling pk field in table: {TABLE_NAME}")
    print(f"Dry run: {dry_run}")
    print("-" * 50)

    # Paginate through all items
    last_evaluated_key = None

    while True:
        scan_kwargs = {
            'ProjectionExpression': 'meeting_id, pk'
        }
        if last_evaluated_key:
            scan_kwargs['ExclusiveStartKey'] = last_evaluated_key

        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])

        for item in items:
            stats['scanned'] += 1
            meeting_id = item.get('meeting_id')

            # Skip if pk already exists
            if 'pk' in item:
                stats['skipped'] += 1
                continue

            if dry_run:
                print(f"[DRY RUN] Would update: {meeting_id}")
                stats['updated'] += 1
                continue

            # Update the item with pk field
            try:
                table.update_item(
                    Key={'meeting_id': meeting_id},
                    UpdateExpression='SET pk = :pk',
                    ExpressionAttributeValues={':pk': 'TRANSCRIPT'},
                    ConditionExpression='attribute_not_exists(pk)'
                )
                stats['updated'] += 1
                print(f"Updated: {meeting_id}")
            except ClientError as e:
                if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                    # Item was updated by another process
                    stats['skipped'] += 1
                else:
                    stats['errors'] += 1
                    print(f"Error updating {meeting_id}: {e}")

        # Check for more pages
        last_evaluated_key = response.get('LastEvaluatedKey')
        if not last_evaluated_key:
            break

    print("-" * 50)
    print(f"Scanned: {stats['scanned']}")
    print(f"Updated: {stats['updated']}")
    print(f"Skipped (already had pk): {stats['skipped']}")
    print(f"Errors: {stats['errors']}")

    return stats


def main():
    parser = argparse.ArgumentParser(
        description='Backfill pk field for all-transcripts-index GSI'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without modifying data'
    )
    args = parser.parse_args()

    backfill_pk(dry_run=args.dry_run)


if __name__ == '__main__':
    main()

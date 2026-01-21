#!/usr/bin/env python3
"""
Backfill script to analyze privacy levels for existing transcripts.

This script:
1. Scans DynamoDB for transcripts without privacy_level
2. Fetches transcript content from S3
3. Analyzes privacy using Bedrock Nova Lite
4. Updates the DynamoDB record with privacy analysis

Run with: AWS_PROFILE=krisp-buddy python3 backfill_privacy.py

Options:
  --dry-run: Show what would be updated without making changes
  --limit N: Process at most N transcripts
  --force: Reanalyze ALL transcripts, not just those without privacy_level
"""

import argparse
import json
import os
import boto3
from typing import Optional, Dict

# Configuration
BUCKET_NAME = os.environ.get('KRISP_S3_BUCKET', '')  # Required: set KRISP_S3_BUCKET env var
TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
PRIVACY_MODEL_ID = os.environ.get('PRIVACY_MODEL_ID', 'amazon.nova-2-lite-v1:0')

# Initialize clients
s3 = boto3.client('s3', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
bedrock = boto3.client('bedrock-runtime', region_name=REGION)
table = dynamodb.Table(TABLE_NAME)


def extract_transcript_text(content: dict) -> str:
    """Extract raw transcript text from S3 content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    return data.get('raw_content', '')


def analyze_privacy(transcript_text: str, title: str) -> Optional[Dict]:
    """
    Analyze the privacy level of a meeting transcript.

    Categorizes meetings as:
    - 'work': Clearly work-related content
    - 'work_with_private': Primarily work but contains some private topics
    - 'likely_private': Appears to be a personal/private conversation
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

        response = bedrock.invoke_model(
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
            print(f"  -> Invalid privacy level: {result.get('level')}")
            return None

        return {
            'level': result['level'],
            'reason': result.get('reason', '')[:500],
            'topics': result.get('topics', [])[:10],
            'confidence': min(100, max(0, int(result.get('confidence', 50)))),
            'work_percent': min(100, max(0, int(result.get('work_percent', 50))))
        }

    except Exception as e:
        print(f"  -> Error analyzing privacy: {e}")
        return None


def get_transcripts(limit: Optional[int] = None, force: bool = False):
    """Scan DynamoDB for transcripts to process."""
    transcripts = []

    # Scan with filter for items without privacy_level attribute (unless force)
    scan_kwargs = {}
    if not force:
        scan_kwargs['FilterExpression'] = 'attribute_not_exists(privacy_level)'

    done = False
    start_key = None

    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key

        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])
        transcripts.extend(items)

        start_key = response.get('LastEvaluatedKey')
        done = start_key is None

        # Check limit
        if limit and len(transcripts) >= limit:
            transcripts = transcripts[:limit]
            done = True

    return transcripts


def update_privacy(meeting_id: str, privacy_result: Dict) -> bool:
    """Update the privacy fields in DynamoDB."""
    try:
        table.update_item(
            Key={'meeting_id': meeting_id},
            UpdateExpression='SET privacy_level = :level, privacy_reason = :reason, privacy_topics = :topics, privacy_confidence = :confidence, privacy_work_percent = :work_percent',
            ExpressionAttributeValues={
                ':level': privacy_result['level'],
                ':reason': privacy_result['reason'],
                ':topics': privacy_result['topics'],
                ':confidence': privacy_result['confidence'],
                ':work_percent': privacy_result['work_percent']
            }
        )
        return True
    except Exception as e:
        print(f"  -> Error updating DynamoDB: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Backfill privacy analysis for existing transcripts')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be updated without making changes')
    parser.add_argument('--limit', type=int, help='Process at most N transcripts')
    parser.add_argument('--force', action='store_true', help='Reanalyze ALL transcripts, not just those without privacy_level')
    args = parser.parse_args()

    if not BUCKET_NAME:
        print("ERROR: KRISP_S3_BUCKET environment variable is required")
        return

    print(f"Scanning DynamoDB table: {TABLE_NAME}")
    print(f"S3 bucket: {BUCKET_NAME}")
    print(f"Model: {PRIVACY_MODEL_ID}")
    if args.dry_run:
        print("DRY RUN MODE - no changes will be made")
    if args.force:
        print("FORCE MODE - reanalyzing ALL transcripts")
    print()

    transcripts = get_transcripts(args.limit, args.force)
    if args.force:
        print(f"Found {len(transcripts)} transcripts to reanalyze")
    else:
        print(f"Found {len(transcripts)} transcripts without privacy analysis")
    print()

    updated = 0
    skipped = 0
    errors = 0

    # Track privacy level distribution
    levels = {'work': 0, 'work_with_private': 0, 'likely_private': 0}

    for i, item in enumerate(transcripts):
        meeting_id = item.get('meeting_id', 'unknown')
        title = item.get('title', 'Untitled')
        s3_key = item.get('s3_key', '')

        print(f"[{i+1}/{len(transcripts)}] Processing: {title[:50]}... (ID: {meeting_id})")

        if not s3_key:
            print("  -> Skipping: no S3 key")
            skipped += 1
            continue

        try:
            # Fetch transcript from S3
            response = s3.get_object(Bucket=BUCKET_NAME, Key=s3_key)
            content = json.loads(response['Body'].read().decode('utf-8'))
            transcript_text = extract_transcript_text(content)

            if not transcript_text or len(transcript_text.strip()) < 100:
                print("  -> Skipping: transcript too short")
                skipped += 1
                continue

            # Analyze privacy
            privacy_result = analyze_privacy(transcript_text, title)

            if not privacy_result:
                print("  -> Skipping: could not analyze privacy")
                skipped += 1
                continue

            level = privacy_result['level']
            confidence = privacy_result['confidence']
            levels[level] += 1

            print(f"  -> Privacy: {level} ({confidence}% confidence)")
            if privacy_result['topics']:
                print(f"     Topics: {', '.join(privacy_result['topics'][:5])}")

            if args.dry_run:
                print("  -> (dry run - not updating)")
            else:
                if update_privacy(meeting_id, privacy_result):
                    updated += 1
                else:
                    errors += 1

        except Exception as e:
            print(f"  -> Error: {e}")
            errors += 1

    print()
    print("=" * 50)
    print("Backfill complete!")
    print(f"  Updated: {updated}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors:  {errors}")
    print()
    print("Privacy level distribution:")
    for level, count in levels.items():
        print(f"  {level}: {count}")


if __name__ == '__main__':
    main()

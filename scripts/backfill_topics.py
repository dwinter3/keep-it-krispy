#!/usr/bin/env python3
"""
Backfill script to generate AI topics for existing transcripts.

This script:
1. Scans DynamoDB for transcripts without topics
2. Fetches transcript content from S3
3. Generates a topic using Bedrock Claude
4. Updates the DynamoDB record with the topic

Run with: AWS_PROFILE=krisp-buddy python3 backfill_topics.py

Options:
  --dry-run: Show what would be updated without making changes
  --limit N: Process at most N transcripts
"""

import argparse
import json
import os
import boto3
from typing import Optional

# Configuration
BUCKET_NAME = os.environ.get('KRISP_S3_BUCKET', '')  # Required: set KRISP_S3_BUCKET env var
TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
TOPIC_MODEL_ID = os.environ.get('TOPIC_MODEL_ID', 'amazon.nova-lite-v1:0')

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


def generate_topic(transcript_text: str, title: str) -> Optional[str]:
    """
    Generate a descriptive topic for the meeting using Claude.
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

        response = bedrock.invoke_model(
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
        print(f"  -> Error generating topic: {e}")
        return None


def get_transcripts(limit: Optional[int] = None, force: bool = False):
    """Scan DynamoDB for transcripts to process."""
    transcripts = []

    # Scan with filter for items without topic attribute (unless force)
    scan_kwargs = {}
    if not force:
        scan_kwargs['FilterExpression'] = 'attribute_not_exists(topic)'

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


def update_topic(meeting_id: str, topic: str) -> bool:
    """Update the topic field in DynamoDB."""
    try:
        table.update_item(
            Key={'meeting_id': meeting_id},
            UpdateExpression='SET topic = :topic',
            ExpressionAttributeValues={':topic': topic}
        )
        return True
    except Exception as e:
        print(f"  -> Error updating DynamoDB: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Backfill topics for existing transcripts')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be updated without making changes')
    parser.add_argument('--limit', type=int, help='Process at most N transcripts')
    parser.add_argument('--force', action='store_true', help='Regenerate topics for ALL transcripts, not just those without')
    args = parser.parse_args()

    if not BUCKET_NAME:
        print("ERROR: KRISP_S3_BUCKET environment variable is required")
        return

    print(f"Scanning DynamoDB table: {TABLE_NAME}")
    print(f"S3 bucket: {BUCKET_NAME}")
    print(f"Model: {TOPIC_MODEL_ID}")
    if args.dry_run:
        print("DRY RUN MODE - no changes will be made")
    if args.force:
        print("FORCE MODE - regenerating ALL topics")
    print()

    transcripts = get_transcripts(args.limit, args.force)
    if args.force:
        print(f"Found {len(transcripts)} transcripts to regenerate")
    else:
        print(f"Found {len(transcripts)} transcripts without topics")
    print()

    updated = 0
    skipped = 0
    errors = 0

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

            if not transcript_text or len(transcript_text.strip()) < 50:
                print("  -> Skipping: transcript too short")
                skipped += 1
                continue

            # Generate topic
            topic = generate_topic(transcript_text, title)

            if not topic:
                print("  -> Skipping: could not generate topic")
                skipped += 1
                continue

            print(f"  -> Generated topic: {topic}")

            if args.dry_run:
                print("  -> (dry run - not updating)")
            else:
                if update_topic(meeting_id, topic):
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


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Backfill script to extract companies from existing transcripts.

This script:
1. Scans DynamoDB for transcripts without company extraction
2. Fetches transcript content from S3
3. Uses Bedrock Nova Lite to extract company names
4. Stores companies in the krisp-companies table
5. Updates transcript records with extracted companies

Run with: AWS_PROFILE=krisp-buddy python3 backfill_companies.py

Options:
  --dry-run: Show what would be updated without making changes
  --limit N: Process at most N transcripts
  --force: Re-extract companies for ALL transcripts
"""

import argparse
import json
import os
import re
import hashlib
from datetime import datetime
from typing import Optional, List, Dict
import boto3

# Configuration
BUCKET_NAME = os.environ.get('KRISP_S3_BUCKET', '')
TABLE_NAME = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
COMPANIES_TABLE = os.environ.get('COMPANIES_TABLE', 'krisp-companies')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
MODEL_ID = os.environ.get('COMPANY_MODEL_ID', 'amazon.nova-lite-v1:0')

# Initialize clients
s3 = boto3.client('s3', region_name=REGION)
dynamodb = boto3.resource('dynamodb', region_name=REGION)
bedrock = boto3.client('bedrock-runtime', region_name=REGION)
transcripts_table = dynamodb.Table(TABLE_NAME)
companies_table = dynamodb.Table(COMPANIES_TABLE)

# Common company name patterns to validate
COMPANY_SUFFIXES = ['Inc', 'LLC', 'Ltd', 'Corp', 'Corporation', 'Company', 'Co', 'Group', 'Labs', 'Technologies', 'Software', 'Systems', 'Solutions', 'Services', 'Partners', 'Ventures', 'Capital', 'Holdings']


def generate_company_id(name: str) -> str:
    """Generate a stable ID for a company based on normalized name."""
    normalized = name.lower().strip()
    # Remove common suffixes for normalization
    for suffix in COMPANY_SUFFIXES:
        normalized = re.sub(rf',?\s*{suffix.lower()}\.?$', '', normalized, flags=re.IGNORECASE)
    normalized = normalized.strip()
    # Create hash for ID
    return hashlib.md5(normalized.encode()).hexdigest()[:12]


def extract_transcript_text(content: dict) -> str:
    """Extract raw transcript text from S3 content."""
    raw_payload = content.get('raw_payload', {})
    data = raw_payload.get('data', {})
    return data.get('raw_content', '')


def extract_companies(transcript_text: str, title: str) -> Optional[List[Dict]]:
    """
    Extract company names from meeting transcript using AI.
    Returns list of companies with confidence scores.
    """
    if not transcript_text or len(transcript_text.strip()) < 100:
        return None

    # Use first 6000 chars of transcript to stay within token limits
    text_sample = transcript_text[:6000]

    prompt = f"""Analyze this meeting transcript and extract all company/organization names mentioned.

Meeting title: {title}

Transcript:
{text_sample}

Instructions:
1. Extract ALL company, organization, or business names mentioned
2. Include both explicit company names and implied references (e.g., "the client" if context makes it clear)
3. Do NOT include:
   - Generic terms like "the company", "their team", "the client" without clear identification
   - Personal names (unless they're company names like "McKinsey")
   - Product names (unless they're also company names)
   - Government agencies or universities (unless directly relevant to business relationship)

For each company, provide:
- name: The canonical company name
- type: One of: customer, prospect, partner, vendor, competitor, internal, unknown
- confidence: 0-100 (how confident you are this is a real company mentioned)
- context: Brief note on how the company was mentioned

Return ONLY valid JSON array:
[
  {{"name": "Company Name", "type": "customer", "confidence": 85, "context": "Discussed as potential client"}},
  ...
]

If no companies found, return: []"""

    try:
        body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "maxTokens": 1000,
                "temperature": 0.2,
                "topP": 0.9
            }
        })

        response = bedrock.invoke_model(
            modelId=MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())
        result_text = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()

        # Parse JSON from response
        # Try to find JSON array in response
        json_match = re.search(r'\[[\s\S]*\]', result_text)
        if json_match:
            companies = json.loads(json_match.group())
            # Filter out low confidence results
            companies = [c for c in companies if c.get('confidence', 0) >= 50]
            return companies

        return []

    except Exception as e:
        print(f"  -> Error extracting companies: {e}")
        return None


def get_or_create_company(company_data: Dict, transcript_id: str, transcript_date: str) -> Optional[str]:
    """
    Get existing company or create new one. Returns company ID.
    Updates mention count and last mentioned date.
    """
    name = company_data.get('name', '').strip()
    if not name or len(name) < 2:
        return None

    company_id = generate_company_id(name)
    company_type = company_data.get('type', 'unknown')
    confidence = company_data.get('confidence', 50)
    now = datetime.utcnow().isoformat() + 'Z'

    try:
        # Try to get existing company
        response = companies_table.get_item(Key={'id': company_id})
        existing = response.get('Item')

        if existing:
            # Update existing company
            update_expr = 'SET mentionCount = mentionCount + :inc, lastMentioned = :lastMentioned'
            expr_values = {
                ':inc': 1,
                ':lastMentioned': transcript_date or now,
            }

            # Update confidence if higher
            if confidence > existing.get('confidence', 0):
                update_expr += ', confidence = :confidence'
                expr_values[':confidence'] = confidence

            # Update type if currently unknown
            if existing.get('type') == 'unknown' and company_type != 'unknown':
                update_expr += ', #type = :type'
                expr_values[':type'] = company_type

            # Add transcript to mentions if not already there
            mentions = existing.get('transcriptMentions', [])
            if transcript_id not in mentions:
                update_expr += ', transcriptMentions = list_append(if_not_exists(transcriptMentions, :empty), :mention)'
                expr_values[':empty'] = []
                expr_values[':mention'] = [transcript_id]

            companies_table.update_item(
                Key={'id': company_id},
                UpdateExpression=update_expr,
                ExpressionAttributeValues=expr_values,
                ExpressionAttributeNames={'#type': 'type'} if company_type != 'unknown' else {}
            )
        else:
            # Create new company
            companies_table.put_item(Item={
                'id': company_id,
                'pk': 'COMPANY',  # For GSI querying
                'name': name,
                'nameLower': name.lower(),
                'type': company_type,
                'confidence': confidence,
                'mentionCount': 1,
                'firstMentioned': transcript_date or now,
                'lastMentioned': transcript_date or now,
                'transcriptMentions': [transcript_id],
                'createdAt': now,
            })

        return company_id

    except Exception as e:
        print(f"  -> Error saving company {name}: {e}")
        return None


def update_transcript_companies(meeting_id: str, company_ids: List[str], company_names: List[str]) -> bool:
    """Update the transcript record with extracted companies."""
    try:
        transcripts_table.update_item(
            Key={'meeting_id': meeting_id},
            UpdateExpression='SET companies = :companies, companyNames = :names, companiesExtractedAt = :extractedAt',
            ExpressionAttributeValues={
                ':companies': company_ids,
                ':names': company_names,
                ':extractedAt': datetime.utcnow().isoformat() + 'Z',
            }
        )
        return True
    except Exception as e:
        print(f"  -> Error updating transcript: {e}")
        return False


def get_transcripts(limit: Optional[int] = None, force: bool = False):
    """Scan DynamoDB for transcripts to process."""
    transcripts = []

    # Scan with filter for items without companies extraction (unless force)
    scan_kwargs = {}
    if not force:
        scan_kwargs['FilterExpression'] = 'attribute_not_exists(companiesExtractedAt) AND attribute_not_exists(isPrivate)'
    else:
        scan_kwargs['FilterExpression'] = 'attribute_not_exists(isPrivate)'

    done = False
    start_key = None

    while not done:
        if start_key:
            scan_kwargs['ExclusiveStartKey'] = start_key

        response = transcripts_table.scan(**scan_kwargs)
        items = response.get('Items', [])
        transcripts.extend(items)

        start_key = response.get('LastEvaluatedKey')
        done = start_key is None

        # Check limit
        if limit and len(transcripts) >= limit:
            transcripts = transcripts[:limit]
            done = True

    return transcripts


def main():
    parser = argparse.ArgumentParser(description='Extract companies from existing transcripts')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be updated without making changes')
    parser.add_argument('--limit', type=int, help='Process at most N transcripts')
    parser.add_argument('--force', action='store_true', help='Re-extract companies for ALL transcripts')
    args = parser.parse_args()

    if not BUCKET_NAME:
        print("ERROR: KRISP_S3_BUCKET environment variable is required")
        return

    print(f"Scanning DynamoDB table: {TABLE_NAME}")
    print(f"Companies table: {COMPANIES_TABLE}")
    print(f"S3 bucket: {BUCKET_NAME}")
    print(f"Model: {MODEL_ID}")
    if args.dry_run:
        print("DRY RUN MODE - no changes will be made")
    if args.force:
        print("FORCE MODE - re-extracting ALL transcripts")
    print()

    transcripts = get_transcripts(args.limit, args.force)
    print(f"Found {len(transcripts)} transcripts to process")
    print()

    processed = 0
    skipped = 0
    errors = 0
    total_companies = 0

    for i, item in enumerate(transcripts):
        meeting_id = item.get('meeting_id', 'unknown')
        title = item.get('title', 'Untitled')
        s3_key = item.get('s3_key', '')
        date_str = item.get('timestamp') or item.get('date', '')

        print(f"[{i+1}/{len(transcripts)}] Processing: {title[:50]}...")

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

            # Extract companies
            companies = extract_companies(transcript_text, title)

            if companies is None:
                print("  -> Skipping: could not extract companies")
                skipped += 1
                continue

            if len(companies) == 0:
                print("  -> No companies found in transcript")
                if not args.dry_run:
                    update_transcript_companies(meeting_id, [], [])
                processed += 1
                continue

            print(f"  -> Found {len(companies)} companies:")
            company_ids = []
            company_names = []
            for comp in companies:
                name = comp.get('name', 'Unknown')
                comp_type = comp.get('type', 'unknown')
                confidence = comp.get('confidence', 0)
                print(f"     - {name} ({comp_type}, {confidence}% confidence)")

                if not args.dry_run:
                    company_id = get_or_create_company(comp, meeting_id, date_str)
                    if company_id:
                        company_ids.append(company_id)
                        company_names.append(name)

            total_companies += len(companies)

            if not args.dry_run:
                if update_transcript_companies(meeting_id, company_ids, company_names):
                    processed += 1
                else:
                    errors += 1
            else:
                processed += 1

        except Exception as e:
            print(f"  -> Error: {e}")
            errors += 1

    print()
    print("=" * 50)
    print("Company extraction complete!")
    print(f"  Processed: {processed}")
    print(f"  Skipped:   {skipped}")
    print(f"  Errors:    {errors}")
    print(f"  Total companies found: {total_companies}")


if __name__ == '__main__':
    main()

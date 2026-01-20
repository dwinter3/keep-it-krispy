"""
Morning Briefing Lambda

Generates daily summaries of all meetings from the previous day for each user.
Triggered by CloudWatch Events (cron) or manually via API.

The briefing includes:
- Meeting count and overview
- Key themes across all meetings
- Action items extracted from each meeting
- Cross-references (topics mentioned across multiple meetings)
- Per-meeting summaries
"""

import json
import os
import uuid
import boto3
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

# Initialize clients outside handler for reuse
dynamodb = boto3.resource('dynamodb')
s3 = boto3.client('s3')
bedrock_client = boto3.client('bedrock-runtime')

# Environment variables
TRANSCRIPTS_TABLE = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
BRIEFINGS_TABLE = os.environ.get('BRIEFINGS_TABLE', 'krisp-briefings')
USERS_TABLE = os.environ.get('USERS_TABLE', 'krisp-users')
S3_BUCKET = os.environ.get('KRISP_S3_BUCKET', '')
MODEL_ID = os.environ.get('BRIEFING_MODEL_ID', 'amazon.nova-lite-v1:0')

transcripts_table = dynamodb.Table(TRANSCRIPTS_TABLE)
briefings_table = dynamodb.Table(BRIEFINGS_TABLE)
users_table = dynamodb.Table(USERS_TABLE)


def handler(event: dict, context: Any) -> dict:
    """
    Main handler for morning briefing generation.

    Can be triggered by:
    1. CloudWatch Events (cron) - processes all users
    2. API Gateway - processes single user from request body
    """
    print(f"Morning briefing triggered with event: {json.dumps(event)}")

    # Determine if this is a manual trigger (API) or scheduled (cron)
    is_manual = event.get('source') != 'aws.events'

    # For manual triggers, get user_id from request body
    if is_manual:
        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body) if body else {}

        user_id = body.get('user_id')
        target_date = body.get('date')  # Optional: specific date in YYYY-MM-DD format

        if not user_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'user_id is required'})
            }

        # Generate briefing for single user
        briefing = generate_briefing_for_user(user_id, target_date)

        return {
            'statusCode': 200,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps(briefing) if briefing else json.dumps({'message': 'No transcripts found for the specified date'})
        }

    # Scheduled trigger - process all active users
    users_processed = 0
    briefings_created = 0
    errors = []

    try:
        # Get all users from the users table
        response = users_table.scan(
            ProjectionExpression='user_id'
        )

        users = response.get('Items', [])

        # Handle pagination for large user bases
        while 'LastEvaluatedKey' in response:
            response = users_table.scan(
                ProjectionExpression='user_id',
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            users.extend(response.get('Items', []))

        print(f"Processing {len(users)} users")

        for user in users:
            user_id = user.get('user_id')
            if not user_id:
                continue

            users_processed += 1

            try:
                briefing = generate_briefing_for_user(user_id)
                if briefing:
                    briefings_created += 1
            except Exception as e:
                error_msg = f"Error processing user {user_id}: {str(e)}"
                print(error_msg)
                errors.append(error_msg)

    except Exception as e:
        print(f"Error in scheduled processing: {str(e)}")
        errors.append(str(e))

    result = {
        'statusCode': 200,
        'body': json.dumps({
            'users_processed': users_processed,
            'briefings_created': briefings_created,
            'errors': errors
        })
    }

    print(f"Result: {json.dumps(result)}")
    return result


def generate_briefing_for_user(user_id: str, target_date: Optional[str] = None) -> Optional[Dict]:
    """
    Generate a morning briefing for a specific user.

    Args:
        user_id: The user's ID
        target_date: Optional date string (YYYY-MM-DD). Defaults to yesterday.

    Returns:
        The briefing document if transcripts were found, None otherwise.
    """
    # Determine the date to summarize (default: yesterday)
    if target_date:
        briefing_date = target_date
    else:
        yesterday = datetime.now() - timedelta(days=1)
        briefing_date = yesterday.strftime('%Y-%m-%d')

    print(f"Generating briefing for user {user_id} for date {briefing_date}")

    # Query transcripts for this user and date
    response = transcripts_table.query(
        IndexName='user-index',
        KeyConditionExpression='user_id = :userId',
        FilterExpression='#date = :targetDate',
        ExpressionAttributeNames={'#date': 'date'},
        ExpressionAttributeValues={
            ':userId': user_id,
            ':targetDate': briefing_date
        }
    )

    transcripts = response.get('Items', [])

    if not transcripts:
        print(f"No transcripts found for user {user_id} on {briefing_date}")
        return None

    print(f"Found {len(transcripts)} transcripts for user {user_id}")

    # Fetch full content for each transcript from S3
    meeting_contents = []
    for transcript in transcripts:
        s3_key = transcript.get('s3_key')
        if not s3_key:
            continue

        try:
            s3_response = s3.get_object(Bucket=S3_BUCKET, Key=s3_key)
            content = json.loads(s3_response['Body'].read().decode('utf-8'))

            raw_payload = content.get('raw_payload', {})
            data = raw_payload.get('data', {})
            raw_content = data.get('raw_content', '')

            meeting_contents.append({
                'meeting_id': transcript.get('meeting_id'),
                'title': transcript.get('title', 'Untitled'),
                'duration': transcript.get('duration', 0),
                'speakers': transcript.get('speakers', []),
                'topic': transcript.get('topic'),
                'content': raw_content[:8000] if raw_content else ''  # Truncate for token limits
            })
        except Exception as e:
            print(f"Error fetching transcript {s3_key}: {str(e)}")
            meeting_contents.append({
                'meeting_id': transcript.get('meeting_id'),
                'title': transcript.get('title', 'Untitled'),
                'duration': transcript.get('duration', 0),
                'speakers': transcript.get('speakers', []),
                'topic': transcript.get('topic'),
                'content': ''
            })

    # Generate the briefing using Bedrock
    briefing_summary = generate_briefing_summary(meeting_contents)

    # Create the briefing document
    briefing_id = str(uuid.uuid4())
    now = datetime.now().isoformat() + 'Z'

    briefing = {
        'briefing_id': briefing_id,
        'user_id': user_id,
        'date': briefing_date,
        'generated_at': now,
        'summary': briefing_summary
    }

    # Store in DynamoDB
    briefings_table.put_item(Item=briefing)

    print(f"Created briefing {briefing_id} for user {user_id}")

    return briefing


def generate_briefing_summary(meetings: List[Dict]) -> Dict:
    """
    Use Bedrock to generate a comprehensive summary of all meetings.

    Args:
        meetings: List of meeting content dictionaries

    Returns:
        Summary dictionary with themes, action items, and meeting summaries
    """
    if not meetings:
        return {
            'meeting_count': 0,
            'key_themes': [],
            'action_items': [],
            'cross_references': [],
            'meeting_summaries': []
        }

    # Build the prompt with all meeting content
    meetings_text = []
    for i, meeting in enumerate(meetings, 1):
        duration_mins = int(meeting.get('duration', 0) / 60)
        speakers = ', '.join(meeting.get('speakers', [])[:5])  # Limit speakers shown

        meeting_text = f"""
Meeting {i}: {meeting.get('title', 'Untitled')}
Duration: {duration_mins} minutes
Participants: {speakers}
Topic: {meeting.get('topic', 'Not specified')}

Transcript excerpt:
{meeting.get('content', 'No content available')[:4000]}
"""
        meetings_text.append(meeting_text)

    all_meetings_text = '\n---\n'.join(meetings_text)

    prompt = f"""You are an executive assistant creating a daily morning briefing.
Analyze the following {len(meetings)} meetings from the day and provide a comprehensive summary.

{all_meetings_text}

Create a JSON summary with the following structure:
{{
    "meeting_count": {len(meetings)},
    "key_themes": ["List 3-5 overarching themes or topics that were discussed across meetings"],
    "action_items": [
        {{"text": "Specific action item or task", "meeting": "Meeting title where this was mentioned"}}
    ],
    "cross_references": [
        {{"topic": "Topic that appeared in multiple meetings", "meetings": ["Meeting 1", "Meeting 2"]}}
    ],
    "meeting_summaries": [
        {{"title": "Meeting title", "summary": "2-3 sentence summary of key points"}}
    ]
}}

Focus on:
1. Extracting concrete action items (tasks, follow-ups, deadlines)
2. Identifying themes that span multiple meetings
3. Creating concise but informative meeting summaries
4. Noting any cross-references or related topics across meetings

Return ONLY valid JSON, no additional text."""

    try:
        body = json.dumps({
            "messages": [
                {
                    "role": "user",
                    "content": [{"text": prompt}]
                }
            ],
            "inferenceConfig": {
                "maxTokens": 3000,
                "temperature": 0.3,
                "topP": 0.9
            }
        })

        response = bedrock_client.invoke_model(
            modelId=MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())
        result_text = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '').strip()

        # Handle potential markdown code blocks
        if result_text.startswith('```'):
            result_text = result_text.split('```')[1]
            if result_text.startswith('json'):
                result_text = result_text[4:]
            result_text = result_text.strip()

        summary = json.loads(result_text)

        # Validate and set defaults
        return {
            'meeting_count': summary.get('meeting_count', len(meetings)),
            'key_themes': summary.get('key_themes', [])[:10],
            'action_items': summary.get('action_items', [])[:20],
            'cross_references': summary.get('cross_references', [])[:10],
            'meeting_summaries': summary.get('meeting_summaries', [])
        }

    except Exception as e:
        print(f"Error generating briefing summary: {str(e)}")
        # Return a basic summary on error
        return {
            'meeting_count': len(meetings),
            'key_themes': [],
            'action_items': [],
            'cross_references': [],
            'meeting_summaries': [
                {'title': m.get('title', 'Untitled'), 'summary': f"Meeting with {', '.join(m.get('speakers', [])[:3])}"}
                for m in meetings
            ]
        }

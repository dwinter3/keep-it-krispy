"""
Morning Briefing Lambda

Generates daily narrative summaries of all meetings from the previous day for each user.
Triggered by CloudWatch Events (cron) or manually via API.

The briefing includes:
- Narrative prose summary like a human assistant would write
- Meeting summaries in natural language
- Correlations between today's meetings
- Historical threads from the past 2 weeks
- Action items extracted from each meeting
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
bedrock_client = boto3.client('bedrock-runtime', region_name='us-east-1')

# Environment variables
TRANSCRIPTS_TABLE = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
BRIEFINGS_TABLE = os.environ.get('BRIEFINGS_TABLE', 'krisp-briefings')
USERS_TABLE = os.environ.get('USERS_TABLE', 'krisp-users')
S3_BUCKET = os.environ.get('KRISP_S3_BUCKET', '')
MODEL_ID = os.environ.get('BRIEFING_MODEL_ID', 'amazon.nova-pro-v1:0')
HISTORICAL_CONTEXT_DAYS = int(os.environ.get('HISTORICAL_CONTEXT_DAYS', '14'))

transcripts_table = dynamodb.Table(TRANSCRIPTS_TABLE)
briefings_table = dynamodb.Table(BRIEFINGS_TABLE)
users_table = dynamodb.Table(USERS_TABLE)


def lambda_handler(event: dict, context: Any) -> dict:
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


def fetch_historical_context(user_id: str, target_date: str, days: int = 14) -> List[Dict]:
    """
    Fetch metadata-only for past N days of meetings (no S3 content needed).

    This provides context for identifying ongoing threads and recurring topics.

    Args:
        user_id: The user's ID
        target_date: The date being briefed (YYYY-MM-DD)
        days: Number of days to look back (default 14)

    Returns:
        List of meeting metadata dictionaries
    """
    start_date = (datetime.strptime(target_date, '%Y-%m-%d') - timedelta(days=days)).strftime('%Y-%m-%d')

    print(f"Fetching historical context from {start_date} to {target_date} (excluding target date)")

    try:
        response = transcripts_table.query(
            IndexName='user-index',
            KeyConditionExpression='user_id = :userId',
            FilterExpression='#date BETWEEN :startDate AND :endDate AND #date <> :targetDate',
            ExpressionAttributeNames={'#date': 'date', '#dur': 'duration'},
            ExpressionAttributeValues={
                ':userId': user_id,
                ':startDate': start_date,
                ':endDate': target_date,
                ':targetDate': target_date
            },
            ProjectionExpression='meeting_id, title, #date, speakers, topic, #dur'
        )

        historical = response.get('Items', [])

        # Handle pagination
        while 'LastEvaluatedKey' in response:
            response = transcripts_table.query(
                IndexName='user-index',
                KeyConditionExpression='user_id = :userId',
                FilterExpression='#date BETWEEN :startDate AND :endDate AND #date <> :targetDate',
                ExpressionAttributeNames={'#date': 'date', '#dur': 'duration'},
                ExpressionAttributeValues={
                    ':userId': user_id,
                    ':startDate': start_date,
                    ':endDate': target_date,
                    ':targetDate': target_date
                },
                ProjectionExpression='meeting_id, title, #date, speakers, topic, #dur',
                ExclusiveStartKey=response['LastEvaluatedKey']
            )
            historical.extend(response.get('Items', []))

        print(f"Found {len(historical)} historical meetings for context")
        return historical

    except Exception as e:
        print(f"Error fetching historical context: {str(e)}")
        return []


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
    total_duration = 0

    for transcript in transcripts:
        s3_key = transcript.get('s3_key')
        duration = transcript.get('duration', 0)
        total_duration += duration

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
                'duration': duration,
                'speakers': transcript.get('speakers', []),
                'topic': transcript.get('topic'),
                'content': raw_content[:8000] if raw_content else ''  # Truncate for token limits
            })
        except Exception as e:
            print(f"Error fetching transcript {s3_key}: {str(e)}")
            meeting_contents.append({
                'meeting_id': transcript.get('meeting_id'),
                'title': transcript.get('title', 'Untitled'),
                'duration': duration,
                'speakers': transcript.get('speakers', []),
                'topic': transcript.get('topic'),
                'content': ''
            })

    # Fetch historical context (past 2 weeks)
    historical_context = fetch_historical_context(user_id, briefing_date, HISTORICAL_CONTEXT_DAYS)

    # Generate the briefing using Bedrock
    briefing_summary = generate_briefing_summary(meeting_contents, historical_context, briefing_date)

    # Add total duration
    briefing_summary['total_duration_minutes'] = int(total_duration / 60)

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


def generate_briefing_summary(meetings: List[Dict], historical_context: List[Dict], briefing_date: str) -> Dict:
    """
    Use Bedrock to generate a comprehensive narrative summary of all meetings.

    Args:
        meetings: List of today's meeting content dictionaries
        historical_context: List of past meetings metadata (no content)
        briefing_date: The date being briefed (YYYY-MM-DD)

    Returns:
        Summary dictionary with narrative, themes, action items, and meeting summaries
    """
    if not meetings:
        return {
            'narrative': '',
            'meeting_count': 0,
            'key_themes': [],
            'action_items': [],
            'cross_references': [],
            'meeting_summaries': [],
            'historical_correlations': []
        }

    # Build today's meetings text with full content
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

    # Build historical context text (metadata only, no content)
    historical_text = ""
    if historical_context:
        historical_lines = []
        # Group by date for readability
        by_date = {}
        for meeting in historical_context:
            date = meeting.get('date', 'Unknown')
            if date not in by_date:
                by_date[date] = []
            by_date[date].append(meeting)

        for date in sorted(by_date.keys(), reverse=True):
            historical_lines.append(f"\n{date}:")
            for m in by_date[date]:
                speakers = ', '.join(m.get('speakers', [])[:3])
                duration = int(m.get('duration', 0) / 60)
                historical_lines.append(f"  - {m.get('title', 'Untitled')} ({duration}min) with {speakers}")
                if m.get('topic'):
                    historical_lines.append(f"    Topic: {m.get('topic')}")

        historical_text = '\n'.join(historical_lines)

    prompt = f"""You are an executive assistant providing a morning briefing for a busy professional.
Write naturally and conversationally, as if speaking to the person directly. Avoid bulleted lists in the narrative sections - write in prose.

TODAY'S DATE: {briefing_date}

=== TODAY'S MEETINGS ===
{all_meetings_text}

=== HISTORICAL CONTEXT (Past {HISTORICAL_CONTEXT_DAYS} Days) ===
{historical_text if historical_text else "No previous meetings in the last 2 weeks."}

---

Create a narrative morning briefing. Your response must be valid JSON with this structure:

{{
    "narrative": "A multi-paragraph narrative briefing. Include:\\n\\n**Good morning!** Start with a warm opening summarizing the day's activity level.\\n\\nThen write 2-3 sentences about each meeting, capturing key discussion points, decisions made, and notable moments. Reference specific speakers when relevant.\\n\\nInclude a section on connections you noticed - topics that came up in multiple meetings today, or threads that connect to discussions from the past 2 weeks.\\n\\nEnd with any forward-looking items mentioned in the meetings.",

    "meeting_count": {len(meetings)},

    "key_themes": ["3-5 overarching themes from today's meetings"],

    "action_items": [
        {{"text": "Specific action item or follow-up", "meeting": "Meeting title", "assignee": "Person responsible if mentioned"}}
    ],

    "cross_references": [
        {{"topic": "Topic appearing in multiple TODAY's meetings", "meetings": ["Meeting 1", "Meeting 2"]}}
    ],

    "meeting_summaries": [
        {{"title": "Meeting title", "summary": "2-3 sentence summary"}}
    ],

    "historical_correlations": [
        {{"topic": "Ongoing topic/project from past 2 weeks", "meetings": ["Meeting titles where it appeared"], "insight": "Brief note on the pattern or trend"}}
    ]
}}

Guidelines for the narrative:
1. Write in a warm, professional tone - like a trusted assistant briefing their executive
2. Use the person's actual meeting titles and speaker names
3. Be specific rather than generic - reference actual topics discussed
4. For historical correlations, look for: recurring projects, people met multiple times, themes gaining momentum
5. The narrative should flow naturally - don't just list things
6. Use \\n for line breaks within the narrative string

Return ONLY valid JSON, no additional text or markdown code blocks."""

    try:
        # Use Bedrock with Amazon Nova
        body = json.dumps({
            "messages": [{"role": "user", "content": [{"text": prompt}]}],
            "inferenceConfig": {
                "maxTokens": 5000,
                "temperature": 0.4
            }
        })

        response = bedrock_client.invoke_model(
            modelId=MODEL_ID,
            body=body,
            contentType='application/json',
            accept='application/json'
        )

        response_body = json.loads(response['body'].read())

        # Nova response format
        result_text = ''
        if 'output' in response_body and 'message' in response_body['output']:
            content = response_body['output']['message'].get('content', [])
            for block in content:
                if 'text' in block:
                    result_text = block['text']
                    break

        # Handle potential markdown code blocks
        if result_text.startswith('```'):
            result_text = result_text.split('```')[1]
            if result_text.startswith('json'):
                result_text = result_text[4:]
            result_text = result_text.strip()

        print(f"Raw response (first 500 chars): {result_text[:500]}")

        summary = json.loads(result_text)

        # Validate and set defaults
        return {
            'narrative': summary.get('narrative', ''),
            'meeting_count': summary.get('meeting_count', len(meetings)),
            'key_themes': summary.get('key_themes', [])[:10],
            'action_items': summary.get('action_items', [])[:20],
            'cross_references': summary.get('cross_references', [])[:10],
            'meeting_summaries': summary.get('meeting_summaries', []),
            'historical_correlations': summary.get('historical_correlations', [])[:10]
        }

    except Exception as e:
        print(f"Error generating briefing summary: {str(e)}")
        import traceback
        traceback.print_exc()

        # Return a basic summary on error
        return {
            'narrative': f"Unable to generate narrative briefing. You had {len(meetings)} meeting(s) on {briefing_date}.",
            'meeting_count': len(meetings),
            'key_themes': [],
            'action_items': [],
            'cross_references': [],
            'meeting_summaries': [
                {'title': m.get('title', 'Untitled'), 'summary': f"Meeting with {', '.join(m.get('speakers', [])[:3])}"}
                for m in meetings
            ],
            'historical_correlations': []
        }

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
from datetime import datetime, timedelta, timezone
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

# =============================================================================
# PROMPT TEMPLATES
# =============================================================================

def get_est_datetime() -> str:
    """Get current datetime in EST timezone."""
    from datetime import timezone as tz
    est = tz(timedelta(hours=-5))
    return datetime.now(est).strftime('%Y-%m-%d %I:%M %p EST')

PROMPTS = {
    "prompt_001": {
        "id": "prompt_001",
        "name": "Standard Briefing",
        "created_at": "2026-01-25 06:00 PM EST",
        "description": "Original narrative briefing format",
        "template": """You are an executive assistant providing a morning briefing for a busy professional.
Write naturally and conversationally, as if speaking to the person directly. Avoid bulleted lists in the narrative sections - write in prose.

BRIEFING DATE: {briefing_date}

=== MEETINGS FROM {briefing_date} ===
{all_meetings_text}

=== HISTORICAL CONTEXT (Past {historical_days} Days) ===
{historical_text}

---

Create a narrative morning briefing. Your response must be valid JSON with this structure:

{{
    "narrative": "A multi-paragraph narrative briefing. Include:\\n\\n**Good morning!** Start with a warm opening summarizing the day's activity level.\\n\\nThen write 2-3 sentences about each meeting, capturing key discussion points, decisions made, and notable moments. Reference specific speakers when relevant.\\n\\nInclude a section on connections you noticed - topics that came up in multiple meetings, or threads that connect to discussions from the past 2 weeks.\\n\\nEnd with any forward-looking items mentioned in the meetings.",

    "meeting_count": {meeting_count},

    "key_themes": ["3-5 overarching themes from the meetings"],

    "action_items": [
        {{"text": "Specific action item or follow-up", "meeting": "Meeting title", "assignee": "Person responsible if mentioned"}}
    ],

    "cross_references": [
        {{"topic": "Topic appearing in multiple meetings", "meetings": ["Meeting 1", "Meeting 2"]}}
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
    },

    "prompt_002": {
        "id": "prompt_002",
        "name": "Deep Analysis + Research",
        "created_at": get_est_datetime(),
        "description": "Enhanced briefing with detailed cross-references per meeting and research suggestions",
        "template": """You are an executive assistant providing a RECAP briefing of meetings from a previous day.
This is NOT about today - you are summarizing what happened on {briefing_date} to help the executive remember and follow up.

Write naturally and conversationally. Be analytical and insightful.

RECAP DATE: {briefing_date} (this day has already passed)

=== MEETINGS FROM {briefing_date} ===
{all_meetings_text}

=== HISTORICAL CONTEXT (Past {historical_days} Days) ===
{historical_text}

---

Create an analytical recap briefing. Your response must be valid JSON with this structure:

{{
    "narrative": "A multi-paragraph recap briefing. Include:\\n\\n**Here's your recap of {briefing_date}:** Start by framing this as a look back at the day.\\n\\nFor each meeting, write 2-3 sentences capturing key discussion points. IMPORTANTLY: after each meeting summary, add a line noting any connections to past meetings from the historical context (e.g., 'This continues the discussion from your Jan 15 call with the same team about X').\\n\\nInclude a 'Connecting the Dots' section analyzing patterns across all meetings and historical context.\\n\\nEnd with a 'Suggested Follow-ups' section with specific next steps.",

    "meeting_count": {meeting_count},

    "key_themes": ["3-5 overarching themes - be specific to the actual content discussed"],

    "action_items": [
        {{"text": "Specific action item or follow-up", "meeting": "Meeting title", "assignee": "Person responsible if mentioned", "priority": "high/medium/low"}}
    ],

    "cross_references": [
        {{"topic": "Topic appearing in multiple meetings", "meetings": ["Meeting 1", "Meeting 2"], "evolution": "How the topic evolved across meetings"}}
    ],

    "meeting_summaries": [
        {{"title": "Meeting title", "summary": "2-3 sentence summary", "related_past_meetings": ["List of past meeting titles that relate to this one"], "key_decisions": ["Any decisions made"], "open_questions": ["Unresolved items"]}}
    ],

    "historical_correlations": [
        {{"topic": "Ongoing topic/project from past 2 weeks", "meetings": ["All meeting titles where it appeared, both from recap day and history"], "insight": "Analysis of how this topic is progressing", "trajectory": "growing/stable/declining"}}
    ],

    "research_suggestions": [
        {{"topic": "A topic worth researching", "reason": "Why this would be valuable", "suggested_searches": ["2-3 specific search queries that would yield useful results"]}}
    ],

    "people_insights": [
        {{"person": "Name of person met with", "recent_interactions": "Summary of recent meetings with this person", "relationship_notes": "Any patterns in what you discuss with them"}}
    ]
}}

Guidelines:
1. Frame everything as a RECAP - past tense, reflecting on what happened
2. For EACH meeting summary, explicitly reference related past meetings from the historical context
3. Be specific about connections - mention actual dates, names, and topics from history
4. Research suggestions should be practical and tied to actual discussion points
5. Look for patterns: people you meet with repeatedly, topics that keep coming up, projects gaining/losing momentum
6. Identify any inconsistencies or evolving positions across meetings
7. Use \\n for line breaks within strings

Return ONLY valid JSON, no additional text or markdown code blocks."""
    }
}

DEFAULT_PROMPT_ID = "prompt_001"

def get_prompt_template(prompt_id: str) -> Dict:
    """Get a prompt template by ID, falling back to default if not found."""
    return PROMPTS.get(prompt_id, PROMPTS[DEFAULT_PROMPT_ID])

def list_prompts() -> List[Dict]:
    """Return list of available prompts with metadata (no template text)."""
    return [
        {"id": p["id"], "name": p["name"], "created_at": p["created_at"], "description": p["description"]}
        for p in PROMPTS.values()
    ]

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

        # Special action: list available prompts
        action = body.get('action')
        if action == 'list_prompts':
            return {
                'statusCode': 200,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'prompts': list_prompts()})
            }

        user_id = body.get('user_id')
        target_date = body.get('date')  # Optional: specific date in YYYY-MM-DD format
        prompt_id = body.get('prompt_id', DEFAULT_PROMPT_ID)  # Optional: which prompt to use

        if not user_id:
            return {
                'statusCode': 400,
                'headers': {'Content-Type': 'application/json'},
                'body': json.dumps({'error': 'user_id is required'})
            }

        # Generate briefing for single user
        briefing = generate_briefing_for_user(user_id, target_date, prompt_id)

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


def generate_briefing_for_user(user_id: str, target_date: Optional[str] = None, prompt_id: str = DEFAULT_PROMPT_ID) -> Optional[Dict]:
    """
    Generate a morning briefing for a specific user.

    Args:
        user_id: The user's ID
        target_date: Optional date string (YYYY-MM-DD). Defaults to yesterday.
        prompt_id: Which prompt template to use. Defaults to prompt_001.

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

    # Generate the briefing using Bedrock with selected prompt
    briefing_summary = generate_briefing_summary(meeting_contents, historical_context, briefing_date, prompt_id)

    # Add total duration
    briefing_summary['total_duration_minutes'] = int(total_duration / 60)

    # Create the briefing document
    briefing_id = str(uuid.uuid4())
    now = datetime.now().isoformat() + 'Z'
    prompt_info = get_prompt_template(prompt_id)

    briefing = {
        'briefing_id': briefing_id,
        'user_id': user_id,
        'date': briefing_date,
        'generated_at': now,
        'prompt_id': prompt_id,
        'prompt_name': prompt_info['name'],
        'summary': briefing_summary
    }

    # Store in DynamoDB
    briefings_table.put_item(Item=briefing)

    print(f"Created briefing {briefing_id} for user {user_id}")

    return briefing


def generate_briefing_summary(meetings: List[Dict], historical_context: List[Dict], briefing_date: str, prompt_id: str = DEFAULT_PROMPT_ID) -> Dict:
    """
    Use Bedrock to generate a comprehensive narrative summary of all meetings.

    Args:
        meetings: List of meeting content dictionaries
        historical_context: List of past meetings metadata (no content)
        briefing_date: The date being briefed (YYYY-MM-DD)
        prompt_id: Which prompt template to use

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

    # Build meetings text with full content
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
    else:
        historical_text = "No previous meetings in the last 2 weeks."

    # Get the prompt template and format it
    prompt_template = get_prompt_template(prompt_id)
    prompt = prompt_template['template'].format(
        briefing_date=briefing_date,
        all_meetings_text=all_meetings_text,
        historical_days=HISTORICAL_CONTEXT_DAYS,
        historical_text=historical_text,
        meeting_count=len(meetings)
    )

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

        # Validate and set defaults - include all possible fields from different prompts
        result = {
            'narrative': summary.get('narrative', ''),
            'meeting_count': summary.get('meeting_count', len(meetings)),
            'key_themes': summary.get('key_themes', [])[:10],
            'action_items': summary.get('action_items', [])[:20],
            'cross_references': summary.get('cross_references', [])[:10],
            'meeting_summaries': summary.get('meeting_summaries', []),
            'historical_correlations': summary.get('historical_correlations', [])[:10],
        }

        # Add optional fields from enhanced prompts (prompt_002+)
        if 'research_suggestions' in summary:
            result['research_suggestions'] = summary['research_suggestions'][:10]
        if 'people_insights' in summary:
            result['people_insights'] = summary['people_insights'][:10]

        return result

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

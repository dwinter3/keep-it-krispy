"""
Speaker Enrichment Lambda

Performs nightly batch enrichment of speaker profiles by searching the web
for professional information and validating against meeting context.

Triggered by CloudWatch Events (cron) at 2am UTC daily.

Enrichment targets:
- Speakers with no enrichment data
- Speakers with low confidence (<70%)
- Speakers not enriched in 14+ days

Rate limiting:
- Max 50 enrichments per run
- 2-second delay between searches
- Skip speakers enriched in last 24 hours
"""

import json
import os
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

import boto3

# Initialize clients outside handler for reuse
dynamodb = boto3.resource('dynamodb')
bedrock_client = boto3.client('bedrock-runtime')
s3 = boto3.client('s3')

# Environment variables
SPEAKERS_TABLE = os.environ.get('SPEAKERS_TABLE', 'krisp-speakers')
ENTITIES_TABLE = os.environ.get('ENTITIES_TABLE', 'krisp-entities')
TRANSCRIPTS_TABLE = os.environ.get('DYNAMODB_TABLE', 'krisp-transcripts-index')
S3_BUCKET = os.environ.get('KRISP_S3_BUCKET', '')
MODEL_ID = os.environ.get('MODEL_ID', 'amazon.nova-2-lite-v1:0')

# Configuration
MAX_ENRICHMENTS_PER_RUN = 50
SEARCH_DELAY_SECONDS = 2
MIN_HOURS_BETWEEN_ENRICHMENTS = 24
STALE_ENRICHMENT_DAYS = 14
LOW_CONFIDENCE_THRESHOLD = 70

speakers_table = dynamodb.Table(SPEAKERS_TABLE)
entities_table = dynamodb.Table(ENTITIES_TABLE)
transcripts_table = dynamodb.Table(TRANSCRIPTS_TABLE)


def handler(event: dict, context: Any) -> dict:
    """
    Main handler for nightly speaker enrichment.

    Finds speakers that need enrichment and processes them in batches.
    """
    print(f"Speaker enrichment triggered with event: {json.dumps(event)}")

    start_time = datetime.utcnow()
    speakers_processed = 0
    speakers_enriched = 0
    speakers_skipped = 0
    errors: List[str] = []

    try:
        # Get all speakers that need enrichment
        candidates = find_enrichment_candidates()
        print(f"Found {len(candidates)} enrichment candidates")

        for speaker in candidates[:MAX_ENRICHMENTS_PER_RUN]:
            speaker_name = speaker.get('name', speaker.get('displayName', ''))
            user_id = speaker.get('user_id')

            if not speaker_name:
                continue

            try:
                # Check if recently enriched (within 24 hours)
                last_enriched = speaker.get('webEnrichedAt')
                if last_enriched:
                    last_enriched_dt = datetime.fromisoformat(last_enriched.replace('Z', '+00:00'))
                    hours_since = (datetime.utcnow().replace(tzinfo=last_enriched_dt.tzinfo) - last_enriched_dt).total_seconds() / 3600
                    if hours_since < MIN_HOURS_BETWEEN_ENRICHMENTS:
                        print(f"Skipping {speaker_name}: enriched {hours_since:.1f}h ago")
                        speakers_skipped += 1
                        continue

                print(f"Enriching speaker: {speaker_name}")
                speakers_processed += 1

                # Build context from transcripts
                context = build_speaker_context(speaker_name, user_id)

                if not context:
                    print(f"No context available for {speaker_name}")
                    continue

                # Search web for speaker
                search_results = search_web(build_search_query(speaker_name, context))

                if not search_results:
                    print(f"No search results for {speaker_name}")
                    continue

                # Validate top results
                best_result, confidence, reasoning = validate_results(context, search_results)

                if best_result and confidence >= 30:
                    # Extract and save enrichment data
                    enriched_data = extract_enriched_data(context, best_result)
                    save_enrichment(speaker_name, enriched_data, confidence, reasoning, [best_result['url']], user_id)
                    speakers_enriched += 1
                    print(f"Enriched {speaker_name} with {confidence}% confidence")
                else:
                    print(f"Low confidence match for {speaker_name}: {confidence}%")

                # Rate limiting
                time.sleep(SEARCH_DELAY_SECONDS)

            except Exception as e:
                error_msg = f"Error enriching {speaker_name}: {str(e)}"
                print(error_msg)
                errors.append(error_msg)

        duration = (datetime.utcnow() - start_time).total_seconds()

        result = {
            'statusCode': 200,
            'body': {
                'message': 'Batch enrichment completed',
                'speakers_processed': speakers_processed,
                'speakers_enriched': speakers_enriched,
                'speakers_skipped': speakers_skipped,
                'errors': len(errors),
                'duration_seconds': round(duration, 2),
                'timestamp': datetime.utcnow().isoformat()
            }
        }

        print(f"Enrichment complete: {json.dumps(result)}")
        return result

    except Exception as e:
        print(f"Batch enrichment error: {str(e)}")
        return {
            'statusCode': 500,
            'body': {'error': str(e)}
        }


def find_enrichment_candidates() -> List[Dict]:
    """
    Find speakers that need enrichment.

    Criteria:
    - No enrichment data, OR
    - Low confidence (<70%), OR
    - Stale enrichment (>14 days old)
    """
    candidates = []
    now = datetime.utcnow()
    stale_cutoff = (now - timedelta(days=STALE_ENRICHMENT_DAYS)).isoformat()

    # Scan speakers table
    response = speakers_table.scan()

    for speaker in response.get('Items', []):
        name = speaker.get('name', speaker.get('displayName', ''))
        if not name:
            continue

        # Skip generic speaker names
        if name.lower().startswith('speaker '):
            continue

        # Skip already verified speakers
        if speaker.get('humanVerified'):
            continue

        confidence = speaker.get('enrichedConfidence', 0)
        last_enriched = speaker.get('webEnrichedAt')

        # Add if: no enrichment, low confidence, or stale
        needs_enrichment = (
            not last_enriched or
            confidence < LOW_CONFIDENCE_THRESHOLD or
            (last_enriched and last_enriched < stale_cutoff)
        )

        if needs_enrichment:
            candidates.append(speaker)

    # Handle pagination
    while 'LastEvaluatedKey' in response:
        response = speakers_table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
        for speaker in response.get('Items', []):
            name = speaker.get('name', speaker.get('displayName', ''))
            if not name or name.lower().startswith('speaker '):
                continue
            if speaker.get('humanVerified'):
                continue
            confidence = speaker.get('enrichedConfidence', 0)
            last_enriched = speaker.get('webEnrichedAt')
            needs_enrichment = (
                not last_enriched or
                confidence < LOW_CONFIDENCE_THRESHOLD or
                (last_enriched and last_enriched < stale_cutoff)
            )
            if needs_enrichment:
                candidates.append(speaker)

    # Sort by priority: no enrichment first, then low confidence, then stale
    def sort_key(s):
        if not s.get('webEnrichedAt'):
            return 0  # Highest priority
        if s.get('enrichedConfidence', 0) < LOW_CONFIDENCE_THRESHOLD:
            return 1
        return 2  # Stale but decent confidence

    candidates.sort(key=sort_key)
    return candidates


def build_speaker_context(speaker_name: str, user_id: Optional[str] = None) -> Optional[Dict]:
    """
    Build context for a speaker from their transcripts.
    """
    # Query transcripts table for meetings with this speaker
    # Note: This is a simplified version - the full version would use GSI
    filter_expr = 'contains(speakers, :speaker)'
    expr_values = {':speaker': speaker_name}

    if user_id:
        filter_expr = f'user_id = :userId AND {filter_expr}'
        expr_values[':userId'] = user_id

    response = transcripts_table.scan(
        FilterExpression=filter_expr,
        ExpressionAttributeValues=expr_values,
        Limit=20  # Sample of recent meetings
    )

    meetings = response.get('Items', [])
    if not meetings:
        return None

    # Extract context from meetings
    companies: set = set()
    topics: set = set()
    role_hints: set = set()

    for meeting in meetings[:10]:  # Use top 10
        title = meeting.get('title', '')
        topic = meeting.get('topic', '')

        # Extract company mentions from title/topic
        if 'company' in meeting:
            companies.add(meeting['company'])

        if topic:
            topics.add(topic)

        # Look for role hints in speaker_corrections
        corrections = meeting.get('speaker_corrections', {})
        speaker_key = speaker_name.lower()
        if speaker_key in corrections:
            correction = corrections[speaker_key]
            if isinstance(correction, dict) and correction.get('name'):
                # Use corrected name
                pass

    return {
        'name': speaker_name,
        'companies': list(companies)[:3],
        'topics': list(topics)[:5],
        'roleHints': list(role_hints)[:3],
        'transcriptCount': len(meetings)
    }


def build_search_query(speaker_name: str, context: Dict) -> str:
    """
    Build an effective search query for finding the speaker online.
    """
    terms = [speaker_name]

    if context.get('companies'):
        terms.append(context['companies'][0])

    if context.get('roleHints'):
        terms.append(context['roleHints'][0])

    terms.append('LinkedIn')

    return ' '.join(terms)


def search_web(query: str) -> List[Dict]:
    """
    Search the web using DuckDuckGo HTML scraping.
    """
    try:
        encoded_query = urllib.parse.quote(query)
        url = f'https://html.duckduckgo.com/html/?q={encoded_query}'

        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; KrispBuddy/1.0)'}
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8')

        results = []

        # Parse results from HTML
        result_pattern = re.compile(
            r'<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)</a>[\s\S]*?'
            r'<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)</a>',
            re.IGNORECASE
        )

        for match in result_pattern.finditer(html):
            encoded_url, title, snippet_html = match.groups()

            # Decode DuckDuckGo redirect URL
            url_match = re.search(r'uddg=([^&]+)', encoded_url)
            actual_url = urllib.parse.unquote(url_match.group(1)) if url_match else encoded_url

            # Clean HTML from snippet
            snippet = re.sub(r'<[^>]*>', '', snippet_html).strip()

            if title and actual_url:
                results.append({
                    'title': title.strip(),
                    'url': actual_url,
                    'snippet': snippet
                })

            if len(results) >= 5:
                break

        return results

    except Exception as e:
        print(f"Web search error: {str(e)}")
        return []


def validate_results(context: Dict, results: List[Dict]) -> tuple:
    """
    Validate search results against speaker context using AI.
    Returns (best_result, confidence, reasoning)
    """
    if not results:
        return None, 0, "No results"

    best_result = None
    best_confidence = 0
    best_reasoning = ""

    for result in results[:3]:
        prompt = f"""Given this context about a speaker from meeting transcripts:
- Name: {context['name']}
- Companies mentioned: {', '.join(context.get('companies', [])) or 'Unknown'}
- Topics: {', '.join(context.get('topics', [])) or 'Unknown'}
- Transcript count: {context.get('transcriptCount', 0)}

And this web search result:
- Title: {result['title']}
- URL: {result['url']}
- Snippet: {result['snippet']}

Evaluate if this is likely the same person. Return ONLY valid JSON:
{{"confidence": 0-100, "reasoning": "brief explanation"}}"""

        try:
            response = bedrock_client.invoke_model(
                modelId=MODEL_ID,
                contentType='application/json',
                accept='application/json',
                body=json.dumps({
                    'messages': [{'role': 'user', 'content': [{'text': prompt}]}],
                    'inferenceConfig': {'maxTokens': 200, 'temperature': 0.2}
                })
            )

            response_body = json.loads(response['body'].read())
            text = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '')

            # Parse JSON from response
            json_match = re.search(r'\{[\s\S]*\}', text)
            if json_match:
                parsed = json.loads(json_match.group())
                confidence = min(100, max(0, parsed.get('confidence', 0)))
                reasoning = parsed.get('reasoning', '')

                if confidence > best_confidence:
                    best_result = result
                    best_confidence = confidence
                    best_reasoning = reasoning

        except Exception as e:
            print(f"Validation error for {result['url']}: {str(e)}")

    return best_result, best_confidence, best_reasoning


def extract_enriched_data(context: Dict, result: Dict) -> Dict:
    """
    Extract structured profile data from best result.
    """
    prompt = f"""Extract professional profile information from this web search result about {context['name']}:

Title: {result['title']}
URL: {result['url']}
Snippet: {result['snippet']}

Return ONLY valid JSON:
{{"title": "job title if found", "company": "company if found", "summary": "2-3 sentence summary", "linkedinUrl": "personal linkedin URL if found"}}"""

    try:
        response = bedrock_client.invoke_model(
            modelId=MODEL_ID,
            contentType='application/json',
            accept='application/json',
            body=json.dumps({
                'messages': [{'role': 'user', 'content': [{'text': prompt}]}],
                'inferenceConfig': {'maxTokens': 300, 'temperature': 0.3}
            })
        )

        response_body = json.loads(response['body'].read())
        text = response_body.get('output', {}).get('message', {}).get('content', [{}])[0].get('text', '')

        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            return json.loads(json_match.group())

    except Exception as e:
        print(f"Extract error: {str(e)}")

    return {
        'title': '',
        'company': '',
        'summary': result.get('snippet', ''),
        'linkedinUrl': result['url'] if 'linkedin.com/in/' in result['url'] else None
    }


def save_enrichment(
    speaker_name: str,
    enriched_data: Dict,
    confidence: int,
    reasoning: str,
    sources: List[str],
    user_id: Optional[str] = None
) -> None:
    """
    Save enrichment data to speakers table.
    """
    now = datetime.utcnow().isoformat()
    speaker_key = speaker_name.lower()

    update_expr = """SET
        enrichedData = :enrichedData,
        enrichedConfidence = :confidence,
        enrichedReasoning = :reasoning,
        enrichedSources = :sources,
        webEnrichedAt = :now,
        enrichedAt = :now,
        #role = :role,
        company = :company,
        linkedin = :linkedin"""

    expr_attr_names = {'#role': 'role'}

    expr_attr_values = {
        ':enrichedData': enriched_data,
        ':confidence': confidence,
        ':reasoning': reasoning,
        ':sources': sources,
        ':now': now,
        ':role': enriched_data.get('title') or None,
        ':company': enriched_data.get('company') or None,
        ':linkedin': enriched_data.get('linkedinUrl') or None
    }

    try:
        speakers_table.update_item(
            Key={'name': speaker_key},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_attr_names,
            ExpressionAttributeValues=expr_attr_values
        )
        print(f"Saved enrichment for {speaker_name}")

        # Also update entity if exists
        if user_id:
            update_speaker_entity(speaker_name, enriched_data, confidence, user_id)

    except Exception as e:
        print(f"Error saving enrichment for {speaker_name}: {str(e)}")


def update_speaker_entity(
    speaker_name: str,
    enriched_data: Dict,
    confidence: int,
    user_id: str
) -> None:
    """
    Update speaker entity with enrichment data.
    """
    # Find entity by canonical name
    canonical = speaker_name.lower().strip()
    canonical = re.sub(r'[^a-z0-9\s]', '', canonical)
    canonical = re.sub(r'\s+', ' ', canonical)

    try:
        response = entities_table.query(
            IndexName='type-name-index',
            KeyConditionExpression='entity_type = :type AND canonical_name = :name',
            FilterExpression='user_id = :userId',
            ExpressionAttributeValues={
                ':type': 'speaker',
                ':name': canonical,
                ':userId': user_id
            },
            Limit=1
        )

        if response.get('Items'):
            entity_id = response['Items'][0]['entity_id']
            now = datetime.utcnow().isoformat()

            entities_table.update_item(
                Key={'entity_id': entity_id},
                UpdateExpression="""SET
                    metadata.linkedin = :linkedin,
                    metadata.#role = :role,
                    metadata.company_name = :company,
                    metadata.bio = :bio,
                    enriched_at = :now,
                    confidence = :confidence,
                    enrichment_source = :source,
                    updated_at = :now""",
                ExpressionAttributeNames={'#role': 'role'},
                ExpressionAttributeValues={
                    ':linkedin': enriched_data.get('linkedinUrl'),
                    ':role': enriched_data.get('title'),
                    ':company': enriched_data.get('company'),
                    ':bio': enriched_data.get('summary'),
                    ':now': now,
                    ':confidence': confidence,
                    ':source': 'batch_enrichment'
                }
            )
            print(f"Updated entity {entity_id} for {speaker_name}")

    except Exception as e:
        print(f"Error updating entity for {speaker_name}: {str(e)}")

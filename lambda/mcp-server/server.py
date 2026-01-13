"""Keep It Krispy MCP Server - Access Krisp meeting transcripts."""

from datetime import datetime, timedelta
from typing import Optional, List

from fastmcp import FastMCP

from s3_client import S3TranscriptClient

mcp = FastMCP(
    name="Keep It Krispy",
    instructions="""Access your Krisp meeting transcripts. You can:
- List recent transcripts with metadata
- Search transcripts by keyword or speaker
- Retrieve full transcript content for analysis

Typical workflow:
1. Use list_transcripts to see recent meetings
2. Use search_transcripts to find specific topics or speakers
3. Use get_transcripts to fetch full content of selected meetings
""",
)


@mcp.tool()
def list_transcripts(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 20,
) -> dict:
    """
    List recent meeting transcripts with metadata.

    Returns transcript keys, titles, dates, and meeting IDs for meetings
    within the specified date range. Use the keys with get_transcripts
    to fetch full content.

    Args:
        start_date: Start date filter (YYYY-MM-DD). Defaults to 30 days ago.
        end_date: End date filter (YYYY-MM-DD). Defaults to today.
        limit: Maximum transcripts to return (1-100). Defaults to 20.

    Returns:
        Dictionary with count, date_range, and list of transcript metadata.
    """
    client = S3TranscriptClient()

    # Parse dates with defaults
    end = datetime.utcnow()
    start = end - timedelta(days=30)

    if end_date:
        try:
            end = datetime.strptime(end_date, "%Y-%m-%d").replace(
                hour=23, minute=59, second=59
            )
        except ValueError:
            pass

    if start_date:
        try:
            start = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            pass

    # Clamp limit
    limit = max(1, min(100, limit))

    transcripts = client.list_transcripts(start, end, limit)

    return {
        "count": len(transcripts),
        "date_range": {
            "start": start.strftime("%Y-%m-%d"),
            "end": end.strftime("%Y-%m-%d"),
        },
        "transcripts": [
            {
                "key": t["key"],
                "title": t["title"],
                "date": t["date_str"],
                "meeting_id": t["meeting_id"],
            }
            for t in transcripts
        ],
    }


@mcp.tool()
def search_transcripts(
    query: str,
    speaker: Optional[str] = None,
    limit: int = 10,
) -> dict:
    """
    Search transcripts by keyword or speaker name.

    Searches across transcript text, titles, summaries, and notes
    from the last 90 days. Returns matching transcripts with
    relevance snippets.

    Args:
        query: Search term to find in transcript content.
        speaker: Optional filter by speaker name.
        limit: Maximum results to return (1-50). Defaults to 10.

    Returns:
        Dictionary with query info, count, and matching transcripts
        with snippets showing where the match occurred.
    """
    client = S3TranscriptClient()

    # Clamp limit
    limit = max(1, min(50, limit))

    results = client.search(query, speaker, limit)

    return {
        "query": query,
        "speaker_filter": speaker,
        "count": len(results),
        "results": [
            {
                "key": r["key"],
                "title": r["title"],
                "date": r["date_str"],
                "speakers": r.get("speakers", []),
                "snippet": r.get("snippet", ""),
                "summary": r.get("summary", ""),
            }
            for r in results
        ],
    }


@mcp.tool()
def get_transcripts(keys: List[str]) -> dict:
    """
    Fetch full content of one or more transcripts.

    Retrieves complete transcript data including full text,
    summary, notes, action items, and speaker information.
    Use keys from list_transcripts or search_transcripts.

    Args:
        keys: List of S3 keys for transcripts to fetch.
              Get these from list_transcripts or search_transcripts.

    Returns:
        Dictionary with list of transcript contents including
        full transcript text, summary, notes, and action items.
    """
    if not keys:
        return {"error": "No keys provided", "transcripts": []}

    # Limit to 10 transcripts at a time to avoid timeouts
    keys = keys[:10]

    client = S3TranscriptClient()
    transcripts = client.get_transcripts(keys)

    return {
        "count": len(transcripts),
        "transcripts": transcripts,
    }

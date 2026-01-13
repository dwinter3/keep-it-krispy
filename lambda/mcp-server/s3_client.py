"""S3 client for accessing Krisp meeting transcripts."""

import os
import json
import re
from datetime import datetime, timedelta
from typing import List, Optional, Dict, Any

import boto3
from botocore.config import Config

BUCKET_NAME = os.environ.get("KRISP_S3_BUCKET", "")  # Required: set via environment variable
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Key format regex: YYYYMMDD_HHMMSS_title_meetingId.json
KEY_PATTERN = re.compile(r"^(\d{8})_(\d{6})_(.+)_([^_]+)\.json$")


class S3TranscriptClient:
    """Client for S3 transcript operations."""

    def __init__(self):
        self.s3 = boto3.client(
            "s3",
            region_name=AWS_REGION,
            config=Config(retries={"max_attempts": 3, "mode": "adaptive"}),
        )
        self.bucket = BUCKET_NAME

    def list_transcripts(
        self,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """List transcripts within date range."""
        if end_date is None:
            end_date = datetime.utcnow()
        if start_date is None:
            start_date = end_date - timedelta(days=30)

        # Generate prefixes for efficient S3 listing
        prefixes = self._generate_date_prefixes(start_date, end_date)

        all_objects = []
        for prefix in prefixes:
            paginator = self.s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    if obj["Key"].endswith(".json"):
                        metadata = self._parse_key_metadata(obj["Key"], obj)
                        if metadata and start_date <= metadata["date"] <= end_date:
                            all_objects.append(metadata)

        # Sort by date descending, apply limit
        all_objects.sort(key=lambda x: x["date"], reverse=True)
        return all_objects[:limit]

    def get_transcript(self, key: str) -> Dict[str, Any]:
        """Fetch full transcript content by S3 key."""
        response = self.s3.get_object(Bucket=self.bucket, Key=key)
        content = json.loads(response["Body"].read().decode("utf-8"))
        return content

    def get_transcripts(self, keys: List[str]) -> List[Dict[str, Any]]:
        """Fetch multiple transcripts by S3 keys."""
        results = []
        for key in keys:
            try:
                content = self.get_transcript(key)
                raw = content.get("raw_payload", {})
                results.append({
                    "key": key,
                    "title": raw.get("title", "Untitled"),
                    "summary": raw.get("summary", ""),
                    "notes": raw.get("notes", ""),
                    "transcript": raw.get("transcript", ""),
                    "action_items": raw.get("action_items", []),
                    "speakers": raw.get("speakers", []),
                    "received_at": content.get("received_at", ""),
                    "event_type": content.get("event_type", ""),
                    "error": None,
                })
            except Exception as e:
                results.append({"key": key, "error": str(e)})
        return results

    def search(
        self,
        query: str,
        speaker: Optional[str] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search transcripts by content and/or speaker."""
        # Search across last 90 days
        recent = self.list_transcripts(
            start_date=datetime.utcnow() - timedelta(days=90),
            end_date=datetime.utcnow(),
            limit=200,  # Search pool
        )

        results = []
        query_lower = query.lower()

        for meta in recent:
            try:
                content = self.get_transcript(meta["key"])
                raw = content.get("raw_payload", {})

                # Check speaker filter
                if speaker:
                    speakers = raw.get("speakers", [])
                    speaker_names = [s.get("name", "").lower() for s in speakers]
                    if not any(speaker.lower() in name for name in speaker_names):
                        continue

                # Search in relevant fields
                searchable = " ".join([
                    raw.get("transcript", ""),
                    raw.get("summary", ""),
                    raw.get("notes", ""),
                    raw.get("title", ""),
                ]).lower()

                if query_lower in searchable:
                    snippet = self._extract_snippet(searchable, query_lower)
                    results.append({
                        **meta,
                        "snippet": snippet,
                        "summary": raw.get("summary", "")[:300],
                        "speakers": [s.get("name", "") for s in raw.get("speakers", [])],
                    })

                if len(results) >= limit:
                    break
            except Exception:
                continue  # Skip failed fetches

        return results

    def _parse_key_metadata(self, key: str, obj: dict) -> Optional[Dict[str, Any]]:
        """Parse metadata from S3 key format."""
        parts = key.split("/")
        if len(parts) < 2:
            return None

        filename = parts[-1]
        match = KEY_PATTERN.match(filename)

        if match:
            date_str, time_str, title, meeting_id = match.groups()
            date = datetime.strptime(f"{date_str}_{time_str}", "%Y%m%d_%H%M%S")
            title = title.replace("_", " ")
        else:
            date = obj.get("LastModified", datetime.utcnow())
            if hasattr(date, "replace"):
                date = date.replace(tzinfo=None)
            title = filename.replace(".json", "")
            meeting_id = ""

        return {
            "key": key,
            "title": title,
            "meeting_id": meeting_id,
            "date": date,
            "date_str": date.strftime("%Y-%m-%d %H:%M"),
            "size": obj.get("Size", 0),
        }

    def _generate_date_prefixes(
        self, start: datetime, end: datetime
    ) -> List[str]:
        """Generate S3 prefixes for date range."""
        prefixes = set()
        current = start
        while current <= end:
            prefixes.add(f"meetings/{current.strftime('%Y/%m/')}")
            # Move to next month
            if current.month == 12:
                current = current.replace(year=current.year + 1, month=1, day=1)
            else:
                current = current.replace(month=current.month + 1, day=1)
        return sorted(prefixes)

    def _extract_snippet(self, text: str, query: str, context: int = 100) -> str:
        """Extract text snippet around search match."""
        idx = text.find(query)
        if idx == -1:
            return text[:200] + "..." if len(text) > 200 else text

        start = max(0, idx - context)
        end = min(len(text), idx + len(query) + context)
        snippet = text[start:end]

        if start > 0:
            snippet = "..." + snippet
        if end < len(text):
            snippet = snippet + "..."

        return snippet

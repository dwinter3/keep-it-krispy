#!/usr/bin/env python3
"""
Import vectors from JSONL into RuVector.

Usage:
    python import_ruvector.py --input vectors.jsonl
    python import_ruvector.py --input vectors.jsonl --endpoint http://localhost:8080 --collection transcript-chunks

Input format (JSONL):
    {"id": "meeting_chunk_0001", "vector": [0.1, 0.2, ...], "metadata": {...}}
    {"id": "meeting_chunk_0002", "vector": [0.1, 0.2, ...], "metadata": {...}}
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import List, Dict, Any
import urllib.request
import urllib.error


def ruvector_request(
    endpoint: str,
    method: str,
    path: str,
    data: Any = None,
    timeout: int = 30,
) -> Any:
    """Make HTTP request to RuVector server."""
    url = f"{endpoint}{path}"

    body = None
    if data is not None:
        body = json.dumps(data).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            if response.status == 204:
                return None
            return json.loads(response.read().decode("utf-8"))

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8") if e.fp else str(e)
        raise RuntimeError(f"RuVector HTTP error {e.code}: {error_body}")

    except urllib.error.URLError as e:
        raise RuntimeError(f"RuVector connection error: {e}")


def ensure_collection(endpoint: str, collection: str, dimensions: int = 1024):
    """Ensure collection exists, create if not."""
    try:
        # Check if collection exists
        ruvector_request(endpoint, "GET", f"/collections/{collection}")
        print(f"Collection '{collection}' exists")
    except RuntimeError:
        # Create collection
        print(f"Creating collection '{collection}' with {dimensions} dimensions...")
        ruvector_request(
            endpoint,
            "POST",
            "/collections",
            {
                "name": collection,
                "dimensions": dimensions,
                "distance_metric": "cosine",
            },
        )
        print(f"Collection '{collection}' created")


def import_batch(
    endpoint: str,
    collection: str,
    vectors: List[Dict[str, Any]],
) -> int:
    """Import a batch of vectors."""
    formatted = [
        {
            "id": v["id"],
            "vector": v["vector"],
            "metadata": v.get("metadata", {}),
        }
        for v in vectors
    ]

    ruvector_request(
        endpoint,
        "POST",
        f"/collections/{collection}/vectors/batch",
        {"vectors": formatted},
        timeout=60,
    )

    return len(vectors)


def import_vectors(
    input_file: str,
    endpoint: str,
    collection: str,
    batch_size: int = 100,
    skip_existing: bool = False,
):
    """
    Import vectors from JSONL file into RuVector.

    Args:
        input_file: Input JSONL file path
        endpoint: RuVector server endpoint
        collection: Collection name
        batch_size: Batch size for import
        skip_existing: Skip vectors that already exist
    """
    total_imported = 0
    total_skipped = 0
    batch: List[Dict[str, Any]] = []
    dimensions = None

    print(f"Importing vectors from {input_file}")
    print(f"Target: {endpoint}/collections/{collection}")
    print()

    # First pass: count lines and get dimensions
    line_count = 0
    with open(input_file, "r") as f:
        for line in f:
            line_count += 1
            if dimensions is None:
                record = json.loads(line)
                dimensions = len(record.get("vector", []))

    print(f"Found {line_count} vectors to import")
    print(f"Vector dimensions: {dimensions}")
    print()

    # Ensure collection exists
    if dimensions:
        ensure_collection(endpoint, collection, dimensions)

    # Import vectors
    with open(input_file, "r") as f:
        for i, line in enumerate(f):
            try:
                record = json.loads(line.strip())

                if not record.get("vector"):
                    print(f"Warning: Skipping record {i} with no vector")
                    continue

                batch.append(record)

                # Import batch when full
                if len(batch) >= batch_size:
                    try:
                        imported = import_batch(endpoint, collection, batch)
                        total_imported += imported
                    except RuntimeError as e:
                        if "already exists" in str(e) and skip_existing:
                            total_skipped += len(batch)
                        else:
                            print(f"Error importing batch: {e}")
                    batch = []

                    # Progress
                    progress = (i + 1) / line_count * 100
                    print(
                        f"Progress: {progress:.1f}% ({total_imported} imported, {total_skipped} skipped)",
                        end="\r",
                    )

            except json.JSONDecodeError as e:
                print(f"Warning: Invalid JSON on line {i}: {e}")

    # Import remaining batch
    if batch:
        try:
            imported = import_batch(endpoint, collection, batch)
            total_imported += imported
        except RuntimeError as e:
            if "already exists" in str(e) and skip_existing:
                total_skipped += len(batch)
            else:
                print(f"Error importing final batch: {e}")

    print()
    print(f"Import complete: {total_imported} vectors imported, {total_skipped} skipped")
    return total_imported


def validate_import(
    input_file: str,
    endpoint: str,
    collection: str,
    sample_size: int = 10,
):
    """
    Validate import by checking sample vectors.

    Args:
        input_file: Input JSONL file (for comparison)
        endpoint: RuVector server endpoint
        collection: Collection name
        sample_size: Number of vectors to validate
    """
    print()
    print("Validating import...")

    # Get collection stats
    stats = ruvector_request(endpoint, "GET", f"/collections/{collection}/stats")
    print(f"Collection vector count: {stats.get('vector_count', 'unknown')}")

    # Check sample vectors
    validated = 0
    mismatched = 0

    with open(input_file, "r") as f:
        for i, line in enumerate(f):
            if i >= sample_size:
                break

            record = json.loads(line.strip())
            vector_id = record["id"]

            try:
                # Fetch vector from RuVector
                result = ruvector_request(
                    endpoint,
                    "GET",
                    f"/collections/{collection}/vectors/{vector_id}",
                )

                # Compare metadata
                expected_metadata = record.get("metadata", {})
                actual_metadata = result.get("metadata", {})

                # Check key metadata fields
                for key in ["meeting_id", "s3_key", "chunk_index"]:
                    if str(expected_metadata.get(key)) != str(actual_metadata.get(key)):
                        print(
                            f"Warning: Mismatch for {vector_id}.{key}: "
                            f"expected {expected_metadata.get(key)}, "
                            f"got {actual_metadata.get(key)}"
                        )
                        mismatched += 1
                        break
                else:
                    validated += 1

            except RuntimeError as e:
                print(f"Warning: Could not validate {vector_id}: {e}")
                mismatched += 1

    print(f"Validated {validated}/{sample_size} sample vectors")
    if mismatched > 0:
        print(f"Warning: {mismatched} vectors had mismatches")

    return mismatched == 0


def main():
    parser = argparse.ArgumentParser(
        description="Import vectors from JSONL into RuVector"
    )
    parser.add_argument(
        "--input",
        "-i",
        required=True,
        help="Input JSONL file path",
    )
    parser.add_argument(
        "--endpoint",
        "-e",
        default=os.environ.get("RUVECTOR_ENDPOINT", "http://localhost:8080"),
        help="RuVector server endpoint",
    )
    parser.add_argument(
        "--collection",
        "-c",
        default=os.environ.get("RUVECTOR_COLLECTION", "transcript-chunks"),
        help="Collection name",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Batch size for import",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip vectors that already exist",
    )
    parser.add_argument(
        "--validate",
        action="store_true",
        help="Validate import after completion",
    )

    args = parser.parse_args()

    print(f"RuVector Import")
    print(f"===============")
    print(f"Input: {args.input}")
    print(f"Endpoint: {args.endpoint}")
    print(f"Collection: {args.collection}")
    print()

    # Check RuVector is accessible
    try:
        ruvector_request(args.endpoint, "GET", "/health")
        print("RuVector server is healthy")
    except RuntimeError as e:
        print(f"Error: Cannot connect to RuVector: {e}")
        sys.exit(1)

    print()
    start = datetime.now()

    total = import_vectors(
        input_file=args.input,
        endpoint=args.endpoint,
        collection=args.collection,
        batch_size=args.batch_size,
        skip_existing=args.skip_existing,
    )

    elapsed = (datetime.now() - start).total_seconds()
    print()
    print(f"Time: {elapsed:.1f} seconds")
    print(f"Rate: {total / elapsed:.1f} vectors/second")

    if args.validate:
        success = validate_import(
            input_file=args.input,
            endpoint=args.endpoint,
            collection=args.collection,
        )
        sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""
Export S3 Vectors to JSONL for migration to RuVector.

Usage:
    python export_s3_vectors.py --output vectors.jsonl
    python export_s3_vectors.py --output vectors.jsonl --bucket krisp-vectors --index transcript-chunks

Output format (JSONL):
    {"id": "meeting_chunk_0001", "vector": [0.1, 0.2, ...], "metadata": {...}}
    {"id": "meeting_chunk_0002", "vector": [0.1, 0.2, ...], "metadata": {...}}
"""

import argparse
import json
import os
import sys
from datetime import datetime

import boto3


def get_vectors_client(region: str = "us-east-1", profile: str = None):
    """Get S3 Vectors client."""
    session_kwargs = {}
    if profile:
        session_kwargs["profile_name"] = profile

    session = boto3.Session(**session_kwargs)
    return session.client("s3vectors", region_name=region)


def export_vectors(
    bucket: str,
    index_name: str,
    output_file: str,
    region: str = "us-east-1",
    profile: str = None,
    batch_size: int = 100,
):
    """
    Export all vectors from S3 Vectors to JSONL file.

    Args:
        bucket: S3 Vectors bucket name
        index_name: Vector index name
        output_file: Output JSONL file path
        region: AWS region
        profile: AWS profile name (optional)
        batch_size: Batch size for pagination
    """
    client = get_vectors_client(region, profile)

    total_exported = 0
    continuation_token = None

    print(f"Exporting vectors from s3vectors://{bucket}/{index_name}")
    print(f"Output: {output_file}")
    print()

    with open(output_file, "w") as f:
        while True:
            # Build list request
            params = {
                "vectorBucketName": bucket,
                "indexName": index_name,
                "maxResults": batch_size,
                "returnData": True,
                "returnMetadata": True,
            }

            if continuation_token:
                params["continuationToken"] = continuation_token

            try:
                response = client.list_vectors(**params)
            except Exception as e:
                print(f"Error listing vectors: {e}")
                sys.exit(1)

            vectors = response.get("vectors", [])

            for vector in vectors:
                # Format for export
                record = {
                    "id": vector["key"],
                    "vector": vector.get("data", {}).get("float32", []),
                    "metadata": vector.get("metadata", {}),
                }

                f.write(json.dumps(record) + "\n")
                total_exported += 1

            # Progress update
            print(f"Exported {total_exported} vectors...", end="\r")

            # Check for more pages
            continuation_token = response.get("nextContinuationToken")
            if not continuation_token:
                break

    print()
    print(f"Export complete: {total_exported} vectors written to {output_file}")
    return total_exported


def main():
    parser = argparse.ArgumentParser(
        description="Export S3 Vectors to JSONL for migration"
    )
    parser.add_argument(
        "--output",
        "-o",
        required=True,
        help="Output JSONL file path",
    )
    parser.add_argument(
        "--bucket",
        "-b",
        default=os.environ.get("VECTOR_BUCKET", "krisp-vectors-754639201213"),
        help="S3 Vectors bucket name",
    )
    parser.add_argument(
        "--index",
        "-i",
        default=os.environ.get("VECTOR_INDEX", "transcript-chunks"),
        help="Vector index name",
    )
    parser.add_argument(
        "--region",
        "-r",
        default=os.environ.get("AWS_REGION", "us-east-1"),
        help="AWS region",
    )
    parser.add_argument(
        "--profile",
        "-p",
        default=os.environ.get("AWS_PROFILE", "krisp-buddy"),
        help="AWS profile name",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Batch size for pagination",
    )

    args = parser.parse_args()

    print(f"S3 Vectors Export")
    print(f"================")
    print(f"Bucket: {args.bucket}")
    print(f"Index: {args.index}")
    print(f"Region: {args.region}")
    print(f"Profile: {args.profile}")
    print()

    start = datetime.now()

    total = export_vectors(
        bucket=args.bucket,
        index_name=args.index,
        output_file=args.output,
        region=args.region,
        profile=args.profile,
        batch_size=args.batch_size,
    )

    elapsed = (datetime.now() - start).total_seconds()
    print()
    print(f"Time: {elapsed:.1f} seconds")
    print(f"Rate: {total / elapsed:.1f} vectors/second")


if __name__ == "__main__":
    main()

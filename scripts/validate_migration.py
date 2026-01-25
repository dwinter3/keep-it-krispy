#!/usr/bin/env python3
"""
Validate vector migration between S3 Vectors and RuVector.

Compares:
1. Vector counts in both systems
2. Sample vector metadata matches
3. Search result quality (recall@10, rank correlation)

Usage:
    python validate_migration.py
    python validate_migration.py --sample-size 100 --search-queries "quarterly review,project update"
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import List, Dict, Any, Optional
import urllib.request
import urllib.error
import random

import boto3


def get_s3_vectors_client(region: str = "us-east-1", profile: str = None):
    """Get S3 Vectors client."""
    session_kwargs = {}
    if profile:
        session_kwargs["profile_name"] = profile

    session = boto3.Session(**session_kwargs)
    return session.client("s3vectors", region_name=region)


def get_bedrock_client(region: str = "us-east-1", profile: str = None):
    """Get Bedrock client for embeddings."""
    session_kwargs = {}
    if profile:
        session_kwargs["profile_name"] = profile

    session = boto3.Session(**session_kwargs)
    return session.client("bedrock-runtime", region_name=region)


def generate_embedding(text: str, bedrock_client) -> List[float]:
    """Generate embedding using Bedrock Titan."""
    body = json.dumps({
        "inputText": text,
        "dimensions": 1024,
        "normalize": True,
    })

    response = bedrock_client.invoke_model(
        modelId="amazon.titan-embed-text-v2:0",
        body=body,
        contentType="application/json",
        accept="application/json",
    )

    response_body = json.loads(response["body"].read())
    return response_body["embedding"]


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


def s3_vectors_search(
    client,
    bucket: str,
    index: str,
    embedding: List[float],
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """Search S3 Vectors."""
    response = client.query_vectors(
        vectorBucketName=bucket,
        indexName=index,
        queryVector={"float32": embedding},
        topK=top_k,
        returnMetadata=True,
    )

    return [
        {
            "id": v["key"],
            "score": v.get("score", 0),
            "metadata": v.get("metadata", {}),
        }
        for v in response.get("vectors", [])
    ]


def ruvector_search(
    endpoint: str,
    collection: str,
    embedding: List[float],
    top_k: int = 10,
) -> List[Dict[str, Any]]:
    """Search RuVector."""
    result = ruvector_request(
        endpoint,
        "POST",
        f"/collections/{collection}/query",
        {
            "vector": embedding,
            "top_k": top_k,
            "include_metadata": True,
        },
    )

    return [
        {
            "id": r["id"],
            "score": r.get("score", 0),
            "metadata": r.get("metadata", {}),
        }
        for r in result.get("results", [])
    ]


def calculate_recall_at_k(
    baseline: List[Dict[str, Any]],
    test: List[Dict[str, Any]],
    k: int = 10,
) -> float:
    """Calculate recall@k (what fraction of baseline's top-k appear in test's top-k)."""
    baseline_ids = set(r["id"] for r in baseline[:k])
    test_ids = set(r["id"] for r in test[:k])

    if not baseline_ids:
        return 1.0

    matches = len(baseline_ids & test_ids)
    return matches / len(baseline_ids)


def calculate_rank_correlation(
    baseline: List[Dict[str, Any]],
    test: List[Dict[str, Any]],
) -> float:
    """Calculate Spearman rank correlation."""
    # Create rank maps
    baseline_ranks = {r["id"]: i + 1 for i, r in enumerate(baseline)}
    test_ranks = {r["id"]: i + 1 for i, r in enumerate(test)}

    # Find common IDs
    common_ids = set(baseline_ranks.keys()) & set(test_ranks.keys())

    if len(common_ids) < 2:
        return 0.0

    n = len(common_ids)
    sum_d_squared = sum(
        (baseline_ranks[id] - test_ranks[id]) ** 2
        for id in common_ids
    )

    return 1 - (6 * sum_d_squared) / (n * (n * n - 1))


def validate_vector_counts(
    s3_client,
    s3_bucket: str,
    s3_index: str,
    ruvector_endpoint: str,
    ruvector_collection: str,
) -> Dict[str, int]:
    """Compare vector counts between systems."""
    print("Comparing vector counts...")

    # Get RuVector count
    try:
        stats = ruvector_request(
            ruvector_endpoint,
            "GET",
            f"/collections/{ruvector_collection}/stats",
        )
        ruvector_count = stats.get("vector_count", 0)
    except RuntimeError as e:
        print(f"Warning: Could not get RuVector count: {e}")
        ruvector_count = -1

    # Count S3 Vectors (by listing)
    s3_count = 0
    continuation_token = None

    while True:
        params = {
            "vectorBucketName": s3_bucket,
            "indexName": s3_index,
            "maxResults": 1000,
        }
        if continuation_token:
            params["continuationToken"] = continuation_token

        response = s3_client.list_vectors(**params)
        s3_count += len(response.get("vectors", []))

        continuation_token = response.get("nextContinuationToken")
        if not continuation_token:
            break

    print(f"  S3 Vectors: {s3_count}")
    print(f"  RuVector: {ruvector_count}")

    if s3_count == ruvector_count:
        print("  Status: MATCH")
    elif ruvector_count < 0:
        print("  Status: UNKNOWN (RuVector count failed)")
    else:
        diff = s3_count - ruvector_count
        pct = abs(diff) / s3_count * 100 if s3_count > 0 else 0
        print(f"  Status: MISMATCH (diff: {diff}, {pct:.1f}%)")

    return {"s3_vectors": s3_count, "ruvector": ruvector_count}


def validate_sample_metadata(
    s3_client,
    s3_bucket: str,
    s3_index: str,
    ruvector_endpoint: str,
    ruvector_collection: str,
    sample_size: int = 10,
) -> Dict[str, Any]:
    """Compare sample vector metadata between systems."""
    print(f"\nValidating {sample_size} sample vectors...")

    # Get sample from S3 Vectors
    response = s3_client.list_vectors(
        vectorBucketName=s3_bucket,
        indexName=s3_index,
        maxResults=sample_size,
        returnMetadata=True,
    )

    matches = 0
    mismatches = 0
    missing = 0

    for s3_vector in response.get("vectors", []):
        vector_id = s3_vector["key"]
        s3_metadata = s3_vector.get("metadata", {})

        try:
            # Get from RuVector
            rv_result = ruvector_request(
                ruvector_endpoint,
                "GET",
                f"/collections/{ruvector_collection}/vectors/{vector_id}",
            )
            rv_metadata = rv_result.get("metadata", {})

            # Compare key fields
            fields_match = True
            for key in ["meeting_id", "s3_key"]:
                if str(s3_metadata.get(key)) != str(rv_metadata.get(key)):
                    print(f"  Mismatch for {vector_id}.{key}")
                    fields_match = False

            if fields_match:
                matches += 1
            else:
                mismatches += 1

        except RuntimeError:
            print(f"  Missing in RuVector: {vector_id}")
            missing += 1

    print(f"  Matches: {matches}")
    print(f"  Mismatches: {mismatches}")
    print(f"  Missing: {missing}")

    return {
        "matches": matches,
        "mismatches": mismatches,
        "missing": missing,
        "success": mismatches == 0 and missing == 0,
    }


def validate_search_quality(
    s3_client,
    s3_bucket: str,
    s3_index: str,
    ruvector_endpoint: str,
    ruvector_collection: str,
    bedrock_client,
    queries: List[str],
    top_k: int = 10,
) -> Dict[str, Any]:
    """Compare search quality between systems."""
    print(f"\nValidating search quality with {len(queries)} queries...")

    recalls = []
    correlations = []
    s3_latencies = []
    rv_latencies = []

    for query in queries:
        print(f"  Query: '{query}'")

        # Generate embedding
        embedding = generate_embedding(query, bedrock_client)

        # Search S3 Vectors
        start = datetime.now()
        s3_results = s3_vectors_search(
            s3_client, s3_bucket, s3_index, embedding, top_k
        )
        s3_latencies.append((datetime.now() - start).total_seconds() * 1000)

        # Search RuVector
        start = datetime.now()
        rv_results = ruvector_search(
            ruvector_endpoint, ruvector_collection, embedding, top_k
        )
        rv_latencies.append((datetime.now() - start).total_seconds() * 1000)

        # Calculate metrics
        recall = calculate_recall_at_k(s3_results, rv_results, top_k)
        correlation = calculate_rank_correlation(s3_results, rv_results)

        recalls.append(recall)
        correlations.append(correlation)

        print(f"    Recall@{top_k}: {recall:.2f}")
        print(f"    Rank correlation: {correlation:.2f}")
        print(f"    S3 latency: {s3_latencies[-1]:.1f}ms")
        print(f"    RuVector latency: {rv_latencies[-1]:.1f}ms")

    avg_recall = sum(recalls) / len(recalls) if recalls else 0
    avg_correlation = sum(correlations) / len(correlations) if correlations else 0
    avg_s3_latency = sum(s3_latencies) / len(s3_latencies) if s3_latencies else 0
    avg_rv_latency = sum(rv_latencies) / len(rv_latencies) if rv_latencies else 0

    print(f"\nSearch Quality Summary:")
    print(f"  Average Recall@{top_k}: {avg_recall:.2f}")
    print(f"  Average Rank Correlation: {avg_correlation:.2f}")
    print(f"  Average S3 Latency: {avg_s3_latency:.1f}ms")
    print(f"  Average RuVector Latency: {avg_rv_latency:.1f}ms")
    print(f"  Latency Improvement: {(avg_s3_latency - avg_rv_latency) / avg_s3_latency * 100:.1f}%")

    return {
        "avg_recall": avg_recall,
        "avg_correlation": avg_correlation,
        "avg_s3_latency": avg_s3_latency,
        "avg_rv_latency": avg_rv_latency,
        "success": avg_recall >= 0.9 and avg_correlation >= 0.8,
    }


def main():
    parser = argparse.ArgumentParser(
        description="Validate vector migration between S3 Vectors and RuVector"
    )
    parser.add_argument(
        "--s3-bucket",
        default=os.environ.get("VECTOR_BUCKET", "krisp-vectors-754639201213"),
        help="S3 Vectors bucket name",
    )
    parser.add_argument(
        "--s3-index",
        default=os.environ.get("VECTOR_INDEX", "transcript-chunks"),
        help="S3 Vectors index name",
    )
    parser.add_argument(
        "--ruvector-endpoint",
        default=os.environ.get("RUVECTOR_ENDPOINT", "http://localhost:8080"),
        help="RuVector server endpoint",
    )
    parser.add_argument(
        "--ruvector-collection",
        default=os.environ.get("RUVECTOR_COLLECTION", "transcript-chunks"),
        help="RuVector collection name",
    )
    parser.add_argument(
        "--region",
        default=os.environ.get("AWS_REGION", "us-east-1"),
        help="AWS region",
    )
    parser.add_argument(
        "--profile",
        default=os.environ.get("AWS_PROFILE", "krisp-buddy"),
        help="AWS profile name",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=10,
        help="Number of vectors to sample for metadata validation",
    )
    parser.add_argument(
        "--search-queries",
        default="quarterly review,project update,customer meeting,team standup,product roadmap",
        help="Comma-separated search queries for quality validation",
    )
    parser.add_argument(
        "--skip-search",
        action="store_true",
        help="Skip search quality validation",
    )

    args = parser.parse_args()
    queries = [q.strip() for q in args.search_queries.split(",")]

    print("Migration Validation")
    print("====================")
    print(f"S3 Vectors: {args.s3_bucket}/{args.s3_index}")
    print(f"RuVector: {args.ruvector_endpoint}/{args.ruvector_collection}")
    print()

    # Initialize clients
    s3_client = get_s3_vectors_client(args.region, args.profile)
    bedrock_client = get_bedrock_client(args.region, args.profile)

    # Run validations
    results = {}

    results["counts"] = validate_vector_counts(
        s3_client,
        args.s3_bucket,
        args.s3_index,
        args.ruvector_endpoint,
        args.ruvector_collection,
    )

    results["metadata"] = validate_sample_metadata(
        s3_client,
        args.s3_bucket,
        args.s3_index,
        args.ruvector_endpoint,
        args.ruvector_collection,
        args.sample_size,
    )

    if not args.skip_search:
        results["search"] = validate_search_quality(
            s3_client,
            args.s3_bucket,
            args.s3_index,
            args.ruvector_endpoint,
            args.ruvector_collection,
            bedrock_client,
            queries,
        )

    # Summary
    print("\n" + "=" * 40)
    print("VALIDATION SUMMARY")
    print("=" * 40)

    all_passed = True

    count_match = results["counts"]["s3_vectors"] == results["counts"]["ruvector"]
    print(f"Vector Counts: {'PASS' if count_match else 'FAIL'}")
    all_passed = all_passed and count_match

    metadata_pass = results["metadata"]["success"]
    print(f"Metadata Match: {'PASS' if metadata_pass else 'FAIL'}")
    all_passed = all_passed and metadata_pass

    if "search" in results:
        search_pass = results["search"]["success"]
        print(f"Search Quality: {'PASS' if search_pass else 'FAIL'}")
        print(f"  - Recall@10: {results['search']['avg_recall']:.2f} (target >= 0.90)")
        print(f"  - Correlation: {results['search']['avg_correlation']:.2f} (target >= 0.80)")
        all_passed = all_passed and search_pass

    print()
    print(f"Overall: {'PASS - Safe to migrate' if all_passed else 'FAIL - Review issues before migrating'}")

    sys.exit(0 if all_passed else 1)


if __name__ == "__main__":
    main()

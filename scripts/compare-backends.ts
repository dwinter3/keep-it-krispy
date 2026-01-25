#!/usr/bin/env npx ts-node
/**
 * Compare S3 Vectors vs RuVector performance and quality
 *
 * This script:
 * 1. Fetches vectors from S3 Vectors
 * 2. Creates a local RuVector database with the same vectors
 * 3. Runs sample queries on both
 * 4. Compares latency, results, and quality metrics
 */

import { S3VectorsClient, QueryVectorsCommand, ListVectorsCommand } from '@aws-sdk/client-s3vectors'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { fromIni } from '@aws-sdk/credential-providers'
import { createRequire } from 'module'

// RuVector imports (CommonJS module)
const require = createRequire(import.meta.url)
const ruvector = require('@ruvector/core')

// Configuration
const AWS_PROFILE = 'krisp-buddy'
const AWS_REGION = 'us-east-1'
const VECTOR_BUCKET = 'krisp-vectors'
const VECTOR_INDEX = 'transcript-chunks'
const EMBEDDING_MODEL = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

// Test queries
const TEST_QUERIES = [
  'quarterly review meeting',
  'project timeline discussion',
  'customer feedback',
  'budget planning',
  'team standup updates',
  'product roadmap',
  'sales pipeline',
  'technical architecture',
]

interface Vector {
  id: string
  embedding: number[]
  metadata: Record<string, string>
}

interface SearchResult {
  id: string
  score: number
  metadata: Record<string, string>
}

interface QueryResult {
  query: string
  s3Vectors: {
    results: SearchResult[]
    latencyMs: number
  }
  ruVector: {
    results: SearchResult[]
    latencyMs: number
  }
  metrics: {
    recallAt10: number
    rankCorrelation: number
    latencyDiffMs: number
    latencyImprovement: string
  }
}

// Initialize AWS clients
const credentials = fromIni({ profile: AWS_PROFILE })
const s3VectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION, credentials })

async function generateEmbedding(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: EMBEDDING_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.slice(0, 8192 * 4),
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    }),
  })

  const response = await bedrockClient.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  return responseBody.embedding
}

async function fetchS3Vectors(limit: number = 500): Promise<Vector[]> {
  console.log(`Fetching up to ${limit} vectors from S3 Vectors...`)

  const vectors: Vector[] = []
  let nextToken: string | undefined

  while (vectors.length < limit) {
    const params: any = {
      vectorBucketName: VECTOR_BUCKET,
      indexName: VECTOR_INDEX,
      maxResults: Math.min(100, limit - vectors.length),
      returnData: true,
      returnMetadata: true,
    }
    if (nextToken) {
      params.nextToken = nextToken
    }

    const command = new ListVectorsCommand(params)
    const response: any = await s3VectorsClient.send(command)

    for (const v of response.vectors || []) {
      const embedding = v.data?.float32 || []
      if (embedding.length !== EMBEDDING_DIMENSIONS) {
        // console.log(`  Skipping ${v.key}: embedding length ${embedding.length}`)
        continue
      }
      vectors.push({
        id: v.key!,
        embedding,
        metadata: (v.metadata || {}) as Record<string, string>,
      })
    }

    // Try various pagination token fields
    nextToken = response.nextToken || response.NextToken || response.nextPaginationToken
    if (!nextToken || response.vectors?.length === 0) break

    process.stdout.write(`  Fetched ${vectors.length} vectors...\r`)
  }

  console.log(`Fetched ${vectors.length} vectors                `)
  return vectors
}

async function searchS3Vectors(embedding: number[], topK: number = 10): Promise<{ results: SearchResult[], latencyMs: number }> {
  const start = Date.now()

  const command = new QueryVectorsCommand({
    vectorBucketName: VECTOR_BUCKET,
    indexName: VECTOR_INDEX,
    queryVector: { float32: embedding },
    topK,
    returnMetadata: true,
  })

  const response: any = await s3VectorsClient.send(command)
  const latencyMs = Date.now() - start

  const results: SearchResult[] = (response.vectors || []).map((v: any, i: number) => ({
    id: v.key!,
    score: v.score ?? (1 - i * 0.05), // S3 Vectors may not return scores
    metadata: (v.metadata || {}) as Record<string, string>,
  }))

  return { results, latencyMs }
}

async function createRuVectorDB(vectors: Vector[]): Promise<any> {
  console.log('Creating RuVector database...')

  // Create database with proper dimensions
  const db = new ruvector.VectorDb({ dimensions: EMBEDDING_DIMENSIONS })

  // Insert vectors
  console.log(`Inserting ${vectors.length} vectors into RuVector...`)
  let inserted = 0
  let failed = 0

  for (const v of vectors) {
    try {
      // Skip vectors without proper embedding
      if (!v.embedding || v.embedding.length !== EMBEDDING_DIMENSIONS) {
        console.log(`  Skipping ${v.id}: Invalid embedding length ${v.embedding?.length}`)
        failed++
        continue
      }

      // Convert to Float32Array and serialize metadata
      const float32Vector = new Float32Array(v.embedding)
      db.insert({
        id: v.id,
        vector: float32Vector,
        metadata: JSON.stringify(v.metadata),
      })
      inserted++
    } catch (err: any) {
      console.log(`  Failed to insert ${v.id}: ${err.message}`)
      failed++
    }
  }

  const len = await db.len()
  console.log(`RuVector database ready: ${inserted} inserted, ${failed} failed, ${len} total in DB`)
  return db
}

async function searchRuVector(db: any, embedding: number[], topK: number = 10): Promise<{ results: SearchResult[], latencyMs: number }> {
  const start = Date.now()

  const float32Query = new Float32Array(embedding)
  const results = await db.search({ vector: float32Query, k: topK })
  const latencyMs = Date.now() - start

  return {
    results: results.map((r: any) => ({
      id: r.id,
      score: r.score,
      metadata: r.metadata ? JSON.parse(r.metadata) : {},
    })),
    latencyMs,
  }
}

function calculateRecallAtK(baseline: SearchResult[], test: SearchResult[], k: number = 10): number {
  const baselineIds = new Set(baseline.slice(0, k).map(r => r.id))
  const testIds = new Set(test.slice(0, k).map(r => r.id))

  if (baselineIds.size === 0) return 1.0

  let matches = 0
  for (const id of baselineIds) {
    if (testIds.has(id)) matches++
  }

  return matches / baselineIds.size
}

function calculateRankCorrelation(baseline: SearchResult[], test: SearchResult[]): number {
  const baselineRanks = new Map<string, number>()
  baseline.forEach((r, i) => baselineRanks.set(r.id, i + 1))

  const testRanks = new Map<string, number>()
  test.forEach((r, i) => testRanks.set(r.id, i + 1))

  const commonIds = [...baselineRanks.keys()].filter(id => testRanks.has(id))

  if (commonIds.length < 2) return 0

  const n = commonIds.length
  let sumDSquared = 0

  for (const id of commonIds) {
    const d = (baselineRanks.get(id) || 0) - (testRanks.get(id) || 0)
    sumDSquared += d * d
  }

  return 1 - (6 * sumDSquared) / (n * (n * n - 1))
}

async function runComparison(): Promise<void> {
  console.log('=' .repeat(70))
  console.log('S3 Vectors vs RuVector Comparison')
  console.log('=' .repeat(70))
  console.log()

  // Fetch ALL vectors from S3 Vectors for accurate comparison
  const vectors = await fetchS3Vectors(10000)  // Fetch up to 10k

  if (vectors.length === 0) {
    console.log('No vectors found in S3 Vectors. Exiting.')
    return
  }

  // Create RuVector database
  const ruDB = await createRuVectorDB(vectors)

  console.log()
  console.log('Running queries...')
  console.log('-'.repeat(70))

  const results: QueryResult[] = []

  for (const query of TEST_QUERIES) {
    process.stdout.write(`  Query: "${query}"... `)

    // Generate embedding
    const embedding = await generateEmbedding(query)

    // Search S3 Vectors
    const s3Result = await searchS3Vectors(embedding)

    // Search RuVector
    const ruResult = await searchRuVector(ruDB, embedding)

    // Calculate metrics
    const recallAt10 = calculateRecallAtK(s3Result.results, ruResult.results)
    const rankCorrelation = calculateRankCorrelation(s3Result.results, ruResult.results)
    const latencyDiffMs = s3Result.latencyMs - ruResult.latencyMs
    const latencyImprovement = s3Result.latencyMs > 0
      ? `${((latencyDiffMs / s3Result.latencyMs) * 100).toFixed(1)}%`
      : 'N/A'

    results.push({
      query,
      s3Vectors: s3Result,
      ruVector: ruResult,
      metrics: {
        recallAt10,
        rankCorrelation,
        latencyDiffMs,
        latencyImprovement,
      },
    })

    console.log(`S3: ${s3Result.latencyMs}ms, RuVector: ${ruResult.latencyMs}ms, Recall: ${(recallAt10 * 100).toFixed(0)}%`)
  }

  // Summary
  console.log()
  console.log('=' .repeat(70))
  console.log('SUMMARY')
  console.log('=' .repeat(70))

  const avgS3Latency = results.reduce((sum, r) => sum + r.s3Vectors.latencyMs, 0) / results.length
  const avgRuLatency = results.reduce((sum, r) => sum + r.ruVector.latencyMs, 0) / results.length
  const avgRecall = results.reduce((sum, r) => sum + r.metrics.recallAt10, 0) / results.length
  const avgCorrelation = results.reduce((sum, r) => sum + r.metrics.rankCorrelation, 0) / results.length

  console.log()
  console.log('Latency (average):')
  console.log(`  S3 Vectors:    ${avgS3Latency.toFixed(1)} ms`)
  console.log(`  RuVector:      ${avgRuLatency.toFixed(1)} ms`)
  console.log(`  Improvement:   ${((avgS3Latency - avgRuLatency) / avgS3Latency * 100).toFixed(1)}%`)

  console.log()
  console.log('Quality Metrics (average):')
  console.log(`  Recall@10:         ${(avgRecall * 100).toFixed(1)}%`)
  console.log(`  Rank Correlation:  ${avgCorrelation.toFixed(3)}`)

  console.log()
  console.log('Per-Query Results:')
  console.log('-'.repeat(70))
  console.log(`${'Query'.padEnd(30)} | ${'S3 (ms)'.padStart(8)} | ${'RuV (ms)'.padStart(8)} | ${'Recall'.padStart(7)} | ${'Corr'.padStart(6)}`)
  console.log('-'.repeat(70))

  for (const r of results) {
    console.log(
      `${r.query.slice(0, 28).padEnd(30)} | ` +
      `${r.s3Vectors.latencyMs.toString().padStart(8)} | ` +
      `${r.ruVector.latencyMs.toString().padStart(8)} | ` +
      `${(r.metrics.recallAt10 * 100).toFixed(0).padStart(6)}% | ` +
      `${r.metrics.rankCorrelation.toFixed(3).padStart(6)}`
    )
  }

  console.log('-'.repeat(70))
  console.log(
    `${'AVERAGE'.padEnd(30)} | ` +
    `${avgS3Latency.toFixed(0).padStart(8)} | ` +
    `${avgRuLatency.toFixed(0).padStart(8)} | ` +
    `${(avgRecall * 100).toFixed(0).padStart(6)}% | ` +
    `${avgCorrelation.toFixed(3).padStart(6)}`
  )

  console.log()
  console.log('Sample Results Comparison (first query):')
  console.log('-'.repeat(70))

  const firstResult = results[0]
  console.log(`Query: "${firstResult.query}"`)
  console.log()
  console.log('S3 Vectors Top 5:')
  for (let i = 0; i < Math.min(5, firstResult.s3Vectors.results.length); i++) {
    const r = firstResult.s3Vectors.results[i]
    console.log(`  ${i + 1}. ${r.id} (score: ${r.score.toFixed(3)})`)
    console.log(`     ${r.metadata.text?.slice(0, 80) || 'No text'}...`)
  }

  console.log()
  console.log('RuVector Top 5:')
  for (let i = 0; i < Math.min(5, firstResult.ruVector.results.length); i++) {
    const r = firstResult.ruVector.results[i]
    console.log(`  ${i + 1}. ${r.id} (score: ${r.score.toFixed(3)})`)
    console.log(`     ${r.metadata.text?.slice(0, 80) || 'No text'}...`)
  }

  console.log()
  console.log('=' .repeat(70))
  console.log('CONCLUSION')
  console.log('=' .repeat(70))

  if (avgRecall >= 0.9 && avgCorrelation >= 0.8) {
    console.log('PASS: RuVector meets quality thresholds')
    console.log(`  - Recall@10 ${(avgRecall * 100).toFixed(1)}% >= 90%`)
    console.log(`  - Rank Correlation ${avgCorrelation.toFixed(3)} >= 0.80`)
    console.log(`  - Latency improved by ${((avgS3Latency - avgRuLatency) / avgS3Latency * 100).toFixed(1)}%`)
  } else {
    console.log('REVIEW NEEDED: Quality thresholds not fully met')
    if (avgRecall < 0.9) {
      console.log(`  - Recall@10 ${(avgRecall * 100).toFixed(1)}% < 90% target`)
    }
    if (avgCorrelation < 0.8) {
      console.log(`  - Rank Correlation ${avgCorrelation.toFixed(3)} < 0.80 target`)
    }
  }
}

runComparison().catch(console.error)

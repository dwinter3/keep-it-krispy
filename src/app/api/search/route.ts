import { NextRequest, NextResponse } from 'next/server'
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { S3VectorsClient, QueryVectorsCommand } from '@aws-sdk/client-s3vectors'

const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const VECTOR_BUCKET = process.env.VECTOR_BUCKET || 'krisp-vectors'
const INDEX_NAME = process.env.VECTOR_INDEX || 'transcript-chunks'
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const MODEL_ID = 'amazon.titan-embed-text-v2:0'
const EMBEDDING_DIMENSIONS = 1024

// AWS clients
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const bedrock = new BedrockRuntimeClient({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface VectorResult {
  key: string
  metadata: {
    meeting_id: string
    s3_key: string
    chunk_index: string
    speaker: string
    text: string
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const limit = parseInt(searchParams.get('limit') || '10')

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 })
  }

  try {
    // Generate embedding for query using Bedrock Titan
    console.log('Generating embedding for:', query)
    const embedding = await generateEmbedding(query)
    console.log('Embedding generated, length:', embedding.length)

    // Query S3 Vectors
    console.log('Querying vectors with topK:', limit * 2)
    const vectorResults = await queryVectors(embedding, limit * 2)
    console.log('Vector results count:', vectorResults.length)

    // Group by meeting and get metadata from DynamoDB
    const meetingGroups = new Map<string, {
      meetingId: string
      s3Key: string
      chunks: VectorResult[]
      score: number
    }>()

    for (let i = 0; i < vectorResults.length; i++) {
      const result = vectorResults[i]
      const meetingId = result.metadata.meeting_id

      if (!meetingGroups.has(meetingId)) {
        meetingGroups.set(meetingId, {
          meetingId,
          s3Key: result.metadata.s3_key,
          chunks: [],
          score: 1 - (i * 0.05), // Relative score based on position
        })
      }

      meetingGroups.get(meetingId)!.chunks.push(result)
    }

    // Fetch meeting metadata from DynamoDB
    const results = []
    for (const [meetingId, group] of meetingGroups) {
      const metadata = await getMeetingMetadata(meetingId)

      results.push({
        meetingId,
        s3Key: group.s3Key,
        title: metadata?.title || 'Untitled Meeting',
        date: metadata?.date || '',
        speakers: metadata?.speakers || [],
        duration: metadata?.duration || 0,
        relevanceScore: Math.round(group.score * 100),
        matchingChunks: group.chunks.length,
        snippets: group.chunks.slice(0, 3).map(c => c.metadata.text),
      })
    }

    // Sort by score and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)
    const limitedResults = results.slice(0, limit)

    return NextResponse.json({
      query,
      searchType: 'semantic',
      count: limitedResults.length,
      results: limitedResults,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json(
      { error: 'Search failed', details: String(error) },
      { status: 500 }
    )
  }
}

async function generateEmbedding(text: string): Promise<number[]> {
  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      inputText: text.slice(0, 8192 * 4), // Truncate if too long
      dimensions: EMBEDDING_DIMENSIONS,
      normalize: true,
    }),
  })

  const response = await bedrock.send(command)
  const responseBody = JSON.parse(new TextDecoder().decode(response.body))
  return responseBody.embedding
}

async function queryVectors(embedding: number[], topK: number): Promise<VectorResult[]> {
  try {
    console.log('Creating S3VectorsClient with region:', AWS_REGION)
    console.log('Vector bucket:', VECTOR_BUCKET, 'Index:', INDEX_NAME)
    const vectorsClient = new S3VectorsClient({ region: AWS_REGION, credentials })
    const command = new QueryVectorsCommand({
      vectorBucketName: VECTOR_BUCKET,
      indexName: INDEX_NAME,
      queryVector: { float32: embedding },
      topK,
      returnMetadata: true,
    })
    console.log('Sending query to S3 Vectors...')
    const response = await vectorsClient.send(command)
    console.log('S3 Vectors response vectors count:', response.vectors?.length || 0)
    return (response.vectors || []) as VectorResult[]
  } catch (error) {
    console.error('Vector query error:', error)
    // Return error details for debugging
    throw error
  }
}

async function getMeetingMetadata(meetingId: string) {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const response = await dynamodb.send(command)
    return response.Item
  } catch {
    return null
  }
}

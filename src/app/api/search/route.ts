import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb'
import { getMemoryProvider } from '@/lib/memory'

const AWS_REGION = process.env.APP_REGION || 'us-east-1'
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'

// AWS credentials for DynamoDB
const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface MeetingMetadata {
  meeting_id: string
  title?: string
  date?: string
  timestamp?: string
  speakers?: string[]
  duration?: number
  isPrivate?: boolean
  topic?: string
  pk?: string
  format?: string
  document_id?: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q')
  const limit = parseInt(searchParams.get('limit') || '10')
  const speaker = searchParams.get('speaker')
  const fromDate = searchParams.get('from')
  const toDate = searchParams.get('to')

  if (!query) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 })
  }

  try {
    // Get the memory provider (abstraction over S3 Vectors, RuVector, etc.)
    const memory = getMemoryProvider()

    // If searching for a specific speaker, include their name for better semantic matching
    const searchQuery = speaker ? `${query} with ${speaker}` : query
    console.log('Generating embedding for:', searchQuery)

    // Use memory provider for embedding generation
    const embedding = await memory.generateEmbedding(searchQuery)
    console.log('Embedding generated, length:', embedding.length)

    // Query vectors - fetch more results to account for filtering
    const fetchMultiplier = speaker || fromDate || toDate ? 5 : 2
    const topK = limit * fetchMultiplier
    console.log('Querying vectors with topK:', topK)

    // Use memory provider for vector search
    const vectorResults = await memory.search(embedding, {
      topK,
      includeMetadata: true,
    })
    console.log('Vector results count:', vectorResults.length)

    // Group by meeting and get metadata from DynamoDB
    const meetingGroups = new Map<
      string,
      {
        meetingId: string
        s3Key: string
        chunks: Array<{ text?: string }>
        score: number
      }
    >()

    for (const result of vectorResults) {
      const meetingId = result.metadata.meetingId

      if (!meetingGroups.has(meetingId)) {
        meetingGroups.set(meetingId, {
          meetingId,
          s3Key: result.metadata.s3Key,
          chunks: [],
          score: result.score,
        })
      }

      const group = meetingGroups.get(meetingId)!
      if (result.score > group.score) {
        group.score = result.score
      }
      group.chunks.push({ text: result.metadata.text })
    }

    // Fetch meeting metadata from DynamoDB and apply filters
    const results = []
    for (const [meetingId, group] of meetingGroups) {
      const metadata = await getMeetingMetadata(meetingId)

      // Skip private transcripts
      if (metadata?.isPrivate === true) {
        console.log('Skipping private transcript:', meetingId)
        continue
      }

      // Apply speaker filter
      if (speaker) {
        const speakerLower = speaker.toLowerCase()
        const meetingSpeakers = (metadata?.speakers || []).map((s) => s.toLowerCase())
        if (!meetingSpeakers.some((s) => s.includes(speakerLower) || speakerLower.includes(s))) {
          continue
        }
      }

      // Apply date range filter
      const meetingDate = metadata?.date || ''
      if (fromDate && meetingDate < fromDate) {
        continue
      }
      if (toDate && meetingDate > toDate) {
        continue
      }

      // Determine if this is a document or transcript
      const isDocument = meetingId.startsWith('doc_') || metadata?.pk === 'DOCUMENT'
      const type = isDocument ? 'document' : 'transcript'

      results.push({
        meetingId,
        s3Key: group.s3Key,
        title: metadata?.title || (isDocument ? 'Untitled Document' : 'Untitled Meeting'),
        date: meetingDate,
        speakers: metadata?.speakers || [],
        duration: metadata?.duration || 0,
        topic: metadata?.topic || null,
        relevanceScore: Math.round(group.score * 100),
        matchingChunks: group.chunks.length,
        snippets: group.chunks.slice(0, 3).map((c) => c.text || ''),
        type,
        format: isDocument ? metadata?.format : undefined,
        documentId: isDocument ? metadata?.document_id : undefined,
      })
    }

    // Sort by score and limit
    results.sort((a, b) => b.relevanceScore - a.relevanceScore)
    const limitedResults = results.slice(0, limit)

    return NextResponse.json({
      query,
      searchType: 'semantic',
      filters: {
        speaker: speaker || null,
        from: fromDate || null,
        to: toDate || null,
      },
      count: limitedResults.length,
      results: limitedResults,
    })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Search failed', details: String(error) }, { status: 500 })
  }
}

async function getMeetingMetadata(meetingId: string): Promise<MeetingMetadata | null> {
  try {
    const command = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const response = await dynamodb.send(command)
    return (response.Item as MeetingMetadata | undefined) ?? null
  } catch {
    return null
  }
}

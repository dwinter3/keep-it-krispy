import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  BatchGetCommand,
} from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import type { CompanyEntity, SpeakerEntity, CompanyMetadata, SpeakerMetadata } from '@/lib/entities'
import type { Relationship } from '@/lib/relationships'

const ENTITIES_TABLE = 'krisp-entities'
const RELATIONSHIPS_TABLE = 'krisp-relationships'
const TRANSCRIPTS_TABLE = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID
  ? {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    }
  : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface TranscriptItem {
  meeting_id: string
  s3_key: string
  title: string
  topic?: string
  date: string
  timestamp: string
  duration?: number
  speakers?: string[]
}

// GET /api/companies/[id] - Get company details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  try {
    const { id } = await params
    const companyId = decodeURIComponent(id)

    // Get company entity
    const getCommand = new GetCommand({
      TableName: ENTITIES_TABLE,
      Key: { entity_id: companyId },
    })

    const companyResult = await dynamodb.send(getCommand)
    const company = companyResult.Item as CompanyEntity | undefined

    if (!company || company.user_id !== userId || company.entity_type !== 'company') {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const metadata = company.metadata as CompanyMetadata

    // Get employees via works_at relationships (speaker -> company)
    const employees: Array<{
      id: string
      name: string
      displayName: string
      role?: string
      linkedin?: string
    }> = []

    try {
      const relCommand = new QueryCommand({
        TableName: RELATIONSHIPS_TABLE,
        IndexName: 'to-index',
        KeyConditionExpression: 'to_entity_id = :companyId',
        FilterExpression: 'rel_type = :relType AND user_id = :userId',
        ExpressionAttributeValues: {
          ':companyId': companyId,
          ':relType': 'works_at',
          ':userId': userId,
        },
      })

      const relResponse = await dynamodb.send(relCommand)
      const relationships = (relResponse.Items || []) as Relationship[]

      // Get speaker entities for each relationship
      if (relationships.length > 0) {
        const speakerIds = relationships.map((r) => r.from_entity_id)
        const uniqueIds = [...new Set(speakerIds)]

        // Batch get speakers (max 100 at a time)
        for (let i = 0; i < uniqueIds.length; i += 100) {
          const batch = uniqueIds.slice(i, i + 100)
          const batchCommand = new BatchGetCommand({
            RequestItems: {
              [ENTITIES_TABLE]: {
                Keys: batch.map((id) => ({ entity_id: id })),
              },
            },
          })

          const batchResult = await dynamodb.send(batchCommand)
          const speakers = (batchResult.Responses?.[ENTITIES_TABLE] || []) as SpeakerEntity[]

          for (const speaker of speakers) {
            const rel = relationships.find((r) => r.from_entity_id === speaker.entity_id)
            const speakerMeta = speaker.metadata as SpeakerMetadata
            employees.push({
              id: speaker.entity_id,
              name: speaker.canonical_name,
              displayName: speaker.name,
              role: rel?.role || speakerMeta?.role,
              linkedin: speakerMeta?.linkedin,
            })
          }
        }
      }
    } catch (err) {
      console.error('Error fetching employees:', err)
    }

    // Get transcripts where this company's employees participated
    const transcripts: TranscriptItem[] = []
    const transcriptIds = new Set<string>()

    try {
      // Get participant relationships for all employees
      for (const employee of employees) {
        const participantCommand = new QueryCommand({
          TableName: RELATIONSHIPS_TABLE,
          IndexName: 'from-index',
          KeyConditionExpression: 'from_entity_id = :speakerId',
          FilterExpression: 'rel_type = :relType AND user_id = :userId',
          ExpressionAttributeValues: {
            ':speakerId': employee.id,
            ':relType': 'participant',
            ':userId': userId,
          },
        })

        const participantResult = await dynamodb.send(participantCommand)
        for (const rel of (participantResult.Items || []) as Relationship[]) {
          if (rel.to_entity_type === 'transcript') {
            transcriptIds.add(rel.to_entity_id)
          }
        }
      }

      // Fetch transcript details (limit to 50)
      const transcriptIdList = Array.from(transcriptIds).slice(0, 50)
      for (const meetingId of transcriptIdList) {
        try {
          const transcriptResult = await dynamodb.send(
            new GetCommand({
              TableName: TRANSCRIPTS_TABLE,
              Key: { meeting_id: meetingId },
            })
          )
          if (transcriptResult.Item) {
            transcripts.push(transcriptResult.Item as TranscriptItem)
          }
        } catch {
          // Skip if transcript not found
        }
      }
    } catch (err) {
      console.error('Error fetching transcripts:', err)
    }

    // Sort transcripts by date (newest first)
    transcripts.sort((a, b) => {
      const dateA = a.timestamp || a.date
      const dateB = b.timestamp || b.date
      return dateB.localeCompare(dateA)
    })

    return NextResponse.json({
      id: company.entity_id,
      name: company.name,
      type: metadata?.type || 'other',
      confidence: company.confidence || 0,
      mentionCount: transcripts.length,
      firstMentioned: company.created_at,
      lastMentioned: company.updated_at,
      firstMentionedFormatted: formatDate(company.created_at),
      lastMentionedFormatted: formatDate(company.updated_at),
      aliases: company.aliases || [],
      description: metadata?.description,
      website: metadata?.website,
      industry: metadata?.industry,
      location: metadata?.location,
      notes: metadata?.notes,
      employees: employees.slice(0, 20),
      transcripts: transcripts.map((t) => ({
        meetingId: t.meeting_id,
        key: t.s3_key,
        title: t.title || 'Untitled Meeting',
        topic: t.topic || null,
        date: t.date,
        timestamp: t.timestamp,
        duration: t.duration || 0,
        durationFormatted: formatDuration(t.duration || 0),
        speakers: t.speakers || [],
      })),
      speakersInvolved: employees.map((e) => e.displayName).slice(0, 20),
    })
  } catch (error) {
    console.error('Company detail API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch company details', details: String(error) },
      { status: 500 }
    )
  }
}

// PUT /api/companies/[id] - Update company details
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  const userId = user.user_id

  try {
    const { id } = await params
    const companyId = decodeURIComponent(id)
    const body = await request.json()

    // Verify ownership
    const getCommand = new GetCommand({
      TableName: ENTITIES_TABLE,
      Key: { entity_id: companyId },
    })

    const existing = await dynamodb.send(getCommand)
    if (!existing.Item || existing.Item.user_id !== userId) {
      return NextResponse.json({ error: 'Company not found' }, { status: 404 })
    }

    const { type, description, website, industry, location, notes, aliases } = body
    const now = new Date().toISOString()

    // Build the current metadata
    const currentMetadata = (existing.Item.metadata as CompanyMetadata) || {}
    const newMetadata: CompanyMetadata = {
      ...currentMetadata,
    }

    if (type !== undefined) {
      newMetadata.type = type
    }
    if (description !== undefined) {
      newMetadata.description = description || undefined
    }
    if (website !== undefined) {
      newMetadata.website = website || undefined
    }
    if (industry !== undefined) {
      newMetadata.industry = industry || undefined
    }
    if (location !== undefined) {
      newMetadata.location = location || undefined
    }
    if (notes !== undefined) {
      newMetadata.notes = notes || undefined
    }

    // Build update expression
    const updateParts: string[] = ['#metadata = :metadata', '#updated_at = :updated_at', '#updated_by = :updated_by']
    const exprNames: Record<string, string> = {
      '#metadata': 'metadata',
      '#updated_at': 'updated_at',
      '#updated_by': 'updated_by',
    }
    const exprValues: Record<string, unknown> = {
      ':metadata': newMetadata,
      ':updated_at': now,
      ':updated_by': userId,
    }

    if (aliases !== undefined) {
      updateParts.push('#aliases = :aliases')
      exprNames['#aliases'] = 'aliases'
      exprValues[':aliases'] = aliases || []
    }

    const updateCommand = new UpdateCommand({
      TableName: ENTITIES_TABLE,
      Key: { entity_id: companyId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ExpressionAttributeNames: exprNames,
      ExpressionAttributeValues: exprValues,
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      company: result.Attributes,
    })
  } catch (error) {
    console.error('Company update error:', error)
    return NextResponse.json(
      { error: 'Failed to update company', details: String(error) },
      { status: 500 }
    )
  }
}

function formatDate(dateStr: string): string {
  if (!dateStr) return 'Unknown'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function formatDuration(seconds: number): string {
  if (!seconds) return '0m'
  if (seconds < 60) {
    return `${seconds}s`
  }
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

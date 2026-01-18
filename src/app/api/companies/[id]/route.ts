import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'krisp-companies'
const SPEAKERS_TABLE = process.env.SPEAKERS_TABLE || 'krisp-speakers'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface CompanyItem {
  id: string
  name: string
  nameLower: string
  type: 'customer' | 'prospect' | 'partner' | 'vendor' | 'competitor' | 'internal' | 'unknown'
  confidence: number
  mentionCount: number
  firstMentioned: string
  lastMentioned: string
  transcriptMentions?: string[]
  employees?: string[]
  aliases?: string[]
  description?: string
  website?: string
  notes?: string
}

interface TranscriptItem {
  meeting_id: string
  s3_key: string
  title: string
  date: string
  timestamp: string
  duration?: number
  speakers?: string[]
  companies?: string[]
  companyNames?: string[]
}

interface SpeakerItem {
  name: string
  displayName?: string
  company?: string
  enrichedData?: {
    company?: string
  }
}

// GET /api/companies/[id] - Get company details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const companyId = decodeURIComponent(id)

    // Get company from companies table
    const getCommand = new GetCommand({
      TableName: COMPANIES_TABLE,
      Key: { id: companyId },
    })

    const companyResult = await dynamodb.send(getCommand)
    const company = companyResult.Item as CompanyItem | undefined

    if (!company) {
      return NextResponse.json(
        { error: 'Company not found' },
        { status: 404 }
      )
    }

    // Get transcripts that mention this company
    const transcripts: TranscriptItem[] = []
    const transcriptMentions = company.transcriptMentions || []

    // If we have transcript IDs, fetch them
    if (transcriptMentions.length > 0) {
      for (const meetingId of transcriptMentions.slice(0, 50)) {
        try {
          const transcriptResult = await dynamodb.send(new GetCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: meetingId },
          }))
          if (transcriptResult.Item) {
            transcripts.push(transcriptResult.Item as TranscriptItem)
          }
        } catch {
          // Skip if transcript not found
        }
      }
    }

    // Find employees (speakers associated with this company)
    const employees: Array<{ name: string; displayName: string; linkedin?: string }> = []

    // Scan speakers table for company matches
    try {
      let lastKey: Record<string, unknown> | undefined

      do {
        const scanCommand = new ScanCommand({
          TableName: SPEAKERS_TABLE,
          FilterExpression: 'contains(#company, :companyName) OR contains(#enrichedCompany, :companyName)',
          ExpressionAttributeNames: {
            '#company': 'company',
            '#enrichedCompany': 'enrichedData',
          },
          ExpressionAttributeValues: {
            ':companyName': company.name,
          },
          ...(lastKey && { ExclusiveStartKey: lastKey }),
        })

        const response = await dynamodb.send(scanCommand)
        if (response.Items) {
          for (const item of response.Items as SpeakerItem[]) {
            const speakerCompany = item.company || item.enrichedData?.company || ''
            // Check if company name matches (case-insensitive)
            if (speakerCompany.toLowerCase().includes(company.name.toLowerCase()) ||
                company.name.toLowerCase().includes(speakerCompany.toLowerCase())) {
              employees.push({
                name: item.name,
                displayName: item.displayName || item.name,
              })
            }
          }
        }
        lastKey = response.LastEvaluatedKey
      } while (lastKey)
    } catch {
      // Speakers table might not exist
    }

    // Also check transcript speakers who mentioned this company
    const speakerSet = new Set<string>()
    for (const transcript of transcripts) {
      for (const speaker of transcript.speakers || []) {
        speakerSet.add(speaker.toLowerCase())
      }
    }

    // Sort transcripts by date (newest first)
    transcripts.sort((a, b) => {
      const dateA = a.timestamp || a.date
      const dateB = b.timestamp || b.date
      return dateB.localeCompare(dateA)
    })

    return NextResponse.json({
      id: company.id,
      name: company.name,
      type: company.type || 'unknown',
      confidence: company.confidence || 0,
      mentionCount: company.mentionCount || 0,
      firstMentioned: company.firstMentioned,
      lastMentioned: company.lastMentioned,
      firstMentionedFormatted: formatDate(company.firstMentioned),
      lastMentionedFormatted: formatDate(company.lastMentioned),
      aliases: company.aliases || [],
      description: company.description,
      website: company.website,
      notes: company.notes,
      employees: employees.slice(0, 20),
      transcripts: transcripts.map(t => ({
        meetingId: t.meeting_id,
        key: t.s3_key,
        title: t.title || 'Untitled Meeting',
        date: t.date,
        timestamp: t.timestamp,
        duration: t.duration || 0,
        durationFormatted: formatDuration(t.duration || 0),
        speakers: t.speakers || [],
      })),
      speakersInvolved: Array.from(speakerSet).slice(0, 20),
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
  try {
    const { id } = await params
    const companyId = decodeURIComponent(id)
    const body = await request.json()

    const { type, description, website, notes, aliases } = body

    // Build update expression dynamically
    const updateParts: string[] = []
    const exprNames: Record<string, string> = {}
    const exprValues: Record<string, unknown> = {}

    if (type !== undefined) {
      updateParts.push('#type = :type')
      exprNames['#type'] = 'type'
      exprValues[':type'] = type
    }

    if (description !== undefined) {
      updateParts.push('#description = :description')
      exprNames['#description'] = 'description'
      exprValues[':description'] = description || null
    }

    if (website !== undefined) {
      updateParts.push('#website = :website')
      exprNames['#website'] = 'website'
      exprValues[':website'] = website || null
    }

    if (notes !== undefined) {
      updateParts.push('#notes = :notes')
      exprNames['#notes'] = 'notes'
      exprValues[':notes'] = notes || null
    }

    if (aliases !== undefined) {
      updateParts.push('#aliases = :aliases')
      exprNames['#aliases'] = 'aliases'
      exprValues[':aliases'] = aliases || []
    }

    // Always update updatedAt
    updateParts.push('#updatedAt = :updatedAt')
    exprNames['#updatedAt'] = 'updatedAt'
    exprValues[':updatedAt'] = new Date().toISOString()

    if (updateParts.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const updateCommand = new UpdateCommand({
      TableName: COMPANIES_TABLE,
      Key: { id: companyId },
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

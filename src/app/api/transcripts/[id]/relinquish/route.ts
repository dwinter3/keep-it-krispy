import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { getTeamId, canRelinquishToTeam, getTeamMembers } from '@/lib/teams'
import { logAuditEvent, getClientInfo } from '@/lib/auditLog'

const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

type RouteParams = { params: Promise<{ id: string }> }

interface TranscriptRecord {
  meeting_id: string
  user_id: string
  owner_type?: 'user' | 'team'
  owner_id?: string
  visibility?: 'private' | 'team_shared' | 'team_owned'
  relinquished_by?: string
  relinquished_at?: string
  shared_with_user_ids?: string[]
}

/**
 * POST /api/transcripts/[id]/relinquish
 * Transfer ownership of a transcript to a team
 *
 * The transcript becomes team-owned:
 * - owner_type changes from 'user' to 'team'
 * - owner_id changes to the team_id
 * - visibility changes to 'team_owned'
 * - Original owner retains read access while in the team
 * - All team members gain read access
 * - This operation cannot be undone
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id: meetingId } = await params

  try {
    // Get authenticated user
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Parse request body
    const body = await request.json()
    const { teamId } = body as { teamId?: string }

    // If no teamId provided, use the user's default team
    const targetTeamId = teamId || await getTeamId(user.user_id)

    if (!targetTeamId) {
      return NextResponse.json(
        { error: 'No team specified and user has no default team. You must be part of a team to relinquish transcripts.' },
        { status: 400 }
      )
    }

    // Validate user can relinquish to this team
    const canRelinquish = await canRelinquishToTeam(user.user_id, targetTeamId)
    if (!canRelinquish) {
      return NextResponse.json(
        { error: 'You are not a member of the specified team' },
        { status: 403 }
      )
    }

    // Get transcript
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const record = await dynamodb.send(getCommand)
    const transcript = record.Item as TranscriptRecord | undefined

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Only the owner can relinquish
    if (transcript.user_id !== user.user_id) {
      return NextResponse.json(
        { error: 'Only the owner can transfer ownership of this transcript' },
        { status: 403 }
      )
    }

    // Check if already relinquished
    if (transcript.owner_type === 'team') {
      return NextResponse.json(
        { error: 'This transcript has already been transferred to a team' },
        { status: 400 }
      )
    }

    const now = new Date().toISOString()

    // Get all team member IDs for shared_with_user_ids
    // This ensures all team members have read access
    const teamMembers = await getTeamMembers(targetTeamId)
    const teamMemberIds = teamMembers.map(m => m.user_id)

    // Include the original owner in shared_with_user_ids so they keep read access
    const allWithAccess = new Set([
      ...teamMemberIds,
      user.user_id,
      targetTeamId, // The team lead
    ])
    // Remove the team owner since they have full access via owner_id
    allWithAccess.delete(targetTeamId)

    // Update transcript
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: `
        SET owner_type = :ownerType,
            owner_id = :ownerId,
            visibility = :visibility,
            relinquished_by = :relinquishedBy,
            relinquished_at = :relinquishedAt,
            shared_with_user_ids = :sharedWith
      `,
      ExpressionAttributeValues: {
        ':ownerType': 'team',
        ':ownerId': targetTeamId,
        ':visibility': 'team_owned',
        ':relinquishedBy': user.user_id,
        ':relinquishedAt': now,
        ':sharedWith': Array.from(allWithAccess),
      },
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    // Log audit event
    const { ipAddress, userAgent } = getClientInfo(request)
    await logAuditEvent({
      actorId: user.user_id,
      actorEmail: session.user.email,
      eventType: 'relinquish.item',
      targetType: 'transcript',
      targetId: meetingId,
      teamId: targetTeamId,
      metadata: {
        original_owner: user.user_id,
        team_id: targetTeamId,
        team_members_granted_access: Array.from(allWithAccess),
      },
      ipAddress,
      userAgent,
    })

    return NextResponse.json({
      success: true,
      meeting_id: meetingId,
      owner_type: 'team',
      owner_id: targetTeamId,
      visibility: 'team_owned',
      relinquished_by: user.user_id,
      relinquished_at: now,
      transcript: result.Attributes,
    })
  } catch (error) {
    console.error('POST relinquish error:', error)
    return NextResponse.json(
      { error: 'Failed to transfer ownership', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * GET /api/transcripts/[id]/relinquish
 * Get relinquish eligibility info for a transcript
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const { id: meetingId } = await params

  try {
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get transcript
    const getCommand = new GetCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
    })
    const record = await dynamodb.send(getCommand)
    const transcript = record.Item as TranscriptRecord | undefined

    if (!transcript) {
      return NextResponse.json({ error: 'Transcript not found' }, { status: 404 })
    }

    // Check ownership
    const isOwner = transcript.user_id === user.user_id
    const isAlreadyTeamOwned = transcript.owner_type === 'team'

    // Get user's team
    const teamId = await getTeamId(user.user_id)
    const teamMembers = teamId ? await getTeamMembers(user.user_id) : []

    return NextResponse.json({
      isOwner,
      isAlreadyTeamOwned,
      canRelinquish: isOwner && !isAlreadyTeamOwned && !!teamId,
      teamId,
      teamMemberCount: teamMembers.length,
      relinquishedBy: transcript.relinquished_by || null,
      relinquishedAt: transcript.relinquished_at || null,
    })
  } catch (error) {
    console.error('GET relinquish error:', error)
    return NextResponse.json(
      { error: 'Failed to get relinquish info', details: String(error) },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { getTeamMembers, getUsersById, isInTeam } from '@/lib/teams'
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
  shared_with_user_ids?: string[]
  visibility?: 'private' | 'team_shared' | 'team_owned'
}

/**
 * GET /api/transcripts/[id]/share
 * Get sharing info for a transcript
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

    // Check if user owns the transcript or is shared with them
    const isOwner = transcript.user_id === user.user_id
    const isSharedWith = transcript.shared_with_user_ids?.includes(user.user_id)

    if (!isOwner && !isSharedWith) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get team members for share modal
    const teamMembers = await getTeamMembers(user.user_id)

    // Get details of users transcript is shared with
    const sharedWithUsers = transcript.shared_with_user_ids
      ? await getUsersById(transcript.shared_with_user_ids)
      : []

    return NextResponse.json({
      isOwner,
      visibility: transcript.visibility || 'private',
      sharedWith: sharedWithUsers,
      teamMembers: isOwner ? teamMembers : [], // Only owners can see team members for sharing
    })
  } catch (error) {
    console.error('GET share error:', error)
    return NextResponse.json(
      { error: 'Failed to get sharing info', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * POST /api/transcripts/[id]/share
 * Share transcript with specified users
 */
export async function POST(
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

    const body = await request.json()
    const { userIds } = body as { userIds: string[] }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: 'userIds array required' },
        { status: 400 }
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

    // Only owner can share
    if (transcript.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Only the owner can share this transcript' }, { status: 403 })
    }

    // Validate that all userIds are team members
    const teamMembers = await getTeamMembers(user.user_id)
    const teamMemberIds = new Set(teamMembers.map(m => m.user_id))

    for (const userId of userIds) {
      if (!teamMemberIds.has(userId)) {
        return NextResponse.json(
          { error: `User ${userId} is not in your team` },
          { status: 400 }
        )
      }
    }

    // Merge with existing shared users (deduplicate)
    const existingShared = new Set(transcript.shared_with_user_ids || [])
    for (const userId of userIds) {
      existingShared.add(userId)
    }
    const newSharedList = Array.from(existingShared)

    // Update transcript
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'SET shared_with_user_ids = :userIds, visibility = :visibility',
      ExpressionAttributeValues: {
        ':userIds': newSharedList,
        ':visibility': 'team_shared',
      },
      ReturnValues: 'ALL_NEW',
    })

    await dynamodb.send(updateCommand)

    // Log audit event
    const { ipAddress, userAgent } = getClientInfo(request)
    await logAuditEvent({
      actorId: user.user_id,
      actorEmail: session.user.email,
      eventType: 'share.item',
      targetType: 'transcript',
      targetId: meetingId,
      metadata: {
        shared_with: userIds,
        action: 'add',
      },
      ipAddress,
      userAgent,
    })

    // Get user details for response
    const sharedWithUsers = await getUsersById(newSharedList)

    return NextResponse.json({
      success: true,
      visibility: 'team_shared',
      sharedWith: sharedWithUsers,
    })
  } catch (error) {
    console.error('POST share error:', error)
    return NextResponse.json(
      { error: 'Failed to share transcript', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/transcripts/[id]/share
 * Remove sharing for specified users
 */
export async function DELETE(
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

    const body = await request.json()
    const { userIds } = body as { userIds: string[] }

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return NextResponse.json(
        { error: 'userIds array required' },
        { status: 400 }
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

    // Only owner can unshare
    if (transcript.user_id !== user.user_id) {
      return NextResponse.json({ error: 'Only the owner can modify sharing' }, { status: 403 })
    }

    // Remove specified users from shared list
    const existingShared = new Set(transcript.shared_with_user_ids || [])
    for (const userId of userIds) {
      existingShared.delete(userId)
    }
    const newSharedList = Array.from(existingShared)

    // Determine new visibility
    const newVisibility = newSharedList.length > 0 ? 'team_shared' : 'private'

    // Update transcript
    const updateCommand = new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { meeting_id: meetingId },
      UpdateExpression: 'SET shared_with_user_ids = :userIds, visibility = :visibility',
      ExpressionAttributeValues: {
        ':userIds': newSharedList,
        ':visibility': newVisibility,
      },
      ReturnValues: 'ALL_NEW',
    })

    await dynamodb.send(updateCommand)

    // Log audit event
    const { ipAddress, userAgent } = getClientInfo(request)
    await logAuditEvent({
      actorId: user.user_id,
      actorEmail: session.user.email,
      eventType: 'share.item',
      targetType: 'transcript',
      targetId: meetingId,
      metadata: {
        removed_from: userIds,
        action: 'remove',
      },
      ipAddress,
      userAgent,
    })

    // Get user details for response
    const sharedWithUsers = newSharedList.length > 0
      ? await getUsersById(newSharedList)
      : []

    return NextResponse.json({
      success: true,
      visibility: newVisibility,
      sharedWith: sharedWithUsers,
    })
  } catch (error) {
    console.error('DELETE share error:', error)
    return NextResponse.json(
      { error: 'Failed to unshare transcript', details: String(error) },
      { status: 500 }
    )
  }
}

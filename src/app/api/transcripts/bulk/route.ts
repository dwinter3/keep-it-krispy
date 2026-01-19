import { NextRequest, NextResponse } from 'next/server'
import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand, DeleteCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { getTeamId, canRelinquishToTeam, getTeamMembers } from '@/lib/teams'
import { logAuditEvent, getClientInfo } from '@/lib/auditLog'

const BUCKET_NAME = process.env.KRISP_S3_BUCKET || ''
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'krisp-transcripts-index'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const s3 = new S3Client({ region: AWS_REGION, credentials })
const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

interface TranscriptRecord {
  meeting_id: string
  s3_key: string
  user_id?: string
  isPrivate?: boolean
  owner_type?: 'user' | 'team'
}

interface BulkRequest {
  action: 'delete' | 'markPrivate' | 'relinquish'
  meetingIds: string[]
  teamId?: string
}

/**
 * POST /api/transcripts/bulk
 * Perform bulk operations on transcripts
 */
export async function POST(request: NextRequest) {
  try {
    // Get authenticated user
    const session = await auth()
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's ID for tenant isolation
    const user = await getUserByEmail(session.user.email)
    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }
    const userId = user.user_id

    const body: BulkRequest = await request.json()
    const { action, meetingIds, teamId } = body

    if (!action || !meetingIds || !Array.isArray(meetingIds) || meetingIds.length === 0) {
      return NextResponse.json(
        { error: 'Invalid request. Required: action (delete|markPrivate|relinquish), meetingIds (array)' },
        { status: 400 }
      )
    }

    if (meetingIds.length > 50) {
      return NextResponse.json(
        { error: 'Maximum 50 transcripts can be processed at once' },
        { status: 400 }
      )
    }

    // Fetch all transcripts to verify ownership
    const batchGetCommand = new BatchGetCommand({
      RequestItems: {
        [TABLE_NAME]: {
          Keys: meetingIds.map(id => ({ meeting_id: id })),
        },
      },
    })
    const batchResult = await dynamodb.send(batchGetCommand)
    const transcripts = (batchResult.Responses?.[TABLE_NAME] || []) as TranscriptRecord[]

    // Verify user owns all transcripts
    const unauthorizedIds = transcripts
      .filter(t => t.user_id && t.user_id !== userId)
      .map(t => t.meeting_id)

    if (unauthorizedIds.length > 0) {
      return NextResponse.json(
        { error: 'Unauthorized access to some transcripts', unauthorizedIds },
        { status: 403 }
      )
    }

    const results = {
      success: [] as string[],
      failed: [] as { id: string; error: string }[],
    }

    // Get client info for audit logging
    const { ipAddress, userAgent } = getClientInfo(request)

    if (action === 'delete') {
      for (const transcript of transcripts) {
        try {
          // Delete from S3
          if (transcript.s3_key) {
            try {
              await s3.send(new DeleteObjectCommand({
                Bucket: BUCKET_NAME,
                Key: transcript.s3_key,
              }))
            } catch (s3Error) {
              console.error(`Error deleting S3 object ${transcript.s3_key}:`, s3Error)
            }
          }

          // Note: Vector deletion skipped in serverless environment
          // Vectors will be orphaned but cleaned up separately if needed

          // Delete from DynamoDB
          await dynamodb.send(new DeleteCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: transcript.meeting_id },
          }))

          // Log audit event for deletion
          await logAuditEvent({
            actorId: userId,
            actorEmail: session.user.email,
            eventType: 'delete.item',
            targetType: 'transcript',
            targetId: transcript.meeting_id,
            metadata: {
              s3_key: transcript.s3_key,
              bulk_operation: true,
            },
            ipAddress,
            userAgent,
          })

          results.success.push(transcript.meeting_id)
        } catch (error) {
          results.failed.push({
            id: transcript.meeting_id,
            error: String(error),
          })
        }
      }
    } else if (action === 'markPrivate') {
      for (const transcript of transcripts) {
        try {
          // Skip if already private
          if (transcript.isPrivate) {
            results.success.push(transcript.meeting_id)
            continue
          }

          // Note: Vector deletion skipped in serverless environment

          // Update DynamoDB
          await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: transcript.meeting_id },
            UpdateExpression: 'SET #isPrivate = :isPrivate',
            ExpressionAttributeNames: { '#isPrivate': 'isPrivate' },
            ExpressionAttributeValues: { ':isPrivate': true },
          }))

          // Log audit event for privacy change
          await logAuditEvent({
            actorId: userId,
            actorEmail: session.user.email,
            eventType: 'update.privacy',
            targetType: 'transcript',
            targetId: transcript.meeting_id,
            metadata: {
              previous_privacy: false,
              new_privacy: true,
              bulk_operation: true,
            },
            ipAddress,
            userAgent,
          })

          results.success.push(transcript.meeting_id)
        } catch (error) {
          results.failed.push({
            id: transcript.meeting_id,
            error: String(error),
          })
        }
      }
    } else if (action === 'relinquish') {
      // Determine target team
      const targetTeamId = teamId || await getTeamId(userId)

      if (!targetTeamId) {
        return NextResponse.json(
          { error: 'No team specified and user has no default team' },
          { status: 400 }
        )
      }

      // Validate user can relinquish to this team
      const canRelinquish = await canRelinquishToTeam(userId, targetTeamId)
      if (!canRelinquish) {
        return NextResponse.json(
          { error: 'You are not a member of the specified team' },
          { status: 403 }
        )
      }

      // Get all team member IDs for shared_with_user_ids
      const teamMembers = await getTeamMembers(targetTeamId)
      const teamMemberIds = teamMembers.map(m => m.user_id)

      const now = new Date().toISOString()

      for (const transcript of transcripts) {
        try {
          // Skip if already team-owned
          if (transcript.owner_type === 'team') {
            results.failed.push({
              id: transcript.meeting_id,
              error: 'Already team-owned',
            })
            continue
          }

          // Build list of users who should have read access
          const allWithAccess = new Set([
            ...teamMemberIds,
            userId, // Original owner keeps read access
            targetTeamId, // Team lead
          ])
          // Remove the team owner since they have full access via owner_id
          allWithAccess.delete(targetTeamId)

          // Update DynamoDB
          await dynamodb.send(new UpdateCommand({
            TableName: TABLE_NAME,
            Key: { meeting_id: transcript.meeting_id },
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
              ':relinquishedBy': userId,
              ':relinquishedAt': now,
              ':sharedWith': Array.from(allWithAccess),
            },
          }))

          // Log audit event for relinquish
          await logAuditEvent({
            actorId: userId,
            actorEmail: session.user.email,
            eventType: 'relinquish.item',
            targetType: 'transcript',
            targetId: transcript.meeting_id,
            teamId: targetTeamId,
            metadata: {
              original_owner: userId,
              team_id: targetTeamId,
              bulk_operation: true,
            },
            ipAddress,
            userAgent,
          })

          results.success.push(transcript.meeting_id)
        } catch (error) {
          results.failed.push({
            id: transcript.meeting_id,
            error: String(error),
          })
        }
      }
    } else {
      return NextResponse.json(
        { error: 'Invalid action. Must be "delete", "markPrivate", or "relinquish"' },
        { status: 400 }
      )
    }

    return NextResponse.json({
      success: true,
      action,
      results,
      summary: {
        requested: meetingIds.length,
        succeeded: results.success.length,
        failed: results.failed.length,
      },
    })
  } catch (error) {
    console.error('Bulk operation error:', error)
    return NextResponse.json(
      { error: 'Failed to perform bulk operation', details: String(error) },
      { status: 500 }
    )
  }
}

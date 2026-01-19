/**
 * Audit Logging Utility for SOC2 Compliance
 *
 * Provides structured audit logging for sensitive operations like
 * deletions, privacy changes, and data access.
 *
 * Table: krisp-audit-logs
 * - Primary key: log_id (UUID)
 * - GSI: actor-index (actor_id + timestamp)
 * - GSI: target-index (target_id + timestamp)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb'
import { v4 as uuidv4 } from 'uuid'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const client = new DynamoDBClient({
  region: process.env.APP_REGION || process.env.AWS_REGION || 'us-east-1',
  credentials,
})
const docClient = DynamoDBDocumentClient.from(client)

const AUDIT_LOGS_TABLE = 'krisp-audit-logs'

/**
 * Supported audit event types for SOC2 compliance
 */
export type AuditEventType =
  | 'delete.item'      // User deletes transcript
  | 'update.privacy'   // Privacy setting changed
  | 'share.item'       // Manual share (future)
  | 'share.enable_auto'  // User enables auto-share
  | 'share.disable_auto' // User disables auto-share
  | 'share.update_auto'  // User updates auto-share list
  | 'relinquish.item'  // User transfers ownership to team
  | 'access.item'      // Export or privileged access
  | 'team.join'        // User joins team (future)
  | 'team.leave'       // User leaves team (future)

/**
 * Target types for audit events
 */
export type AuditTargetType =
  | 'transcript'
  | 'speaker'
  | 'team'
  | 'document'
  | 'user'

/**
 * Input for creating an audit event
 */
export interface AuditEvent {
  actorId: string
  actorEmail: string
  eventType: AuditEventType
  targetType: AuditTargetType
  targetId: string
  teamId?: string
  metadata?: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

/**
 * Stored audit log record
 */
export interface AuditLog {
  log_id: string
  actor_id: string
  actor_email: string
  event_type: AuditEventType
  target_type: AuditTargetType
  target_id: string
  team_id?: string
  metadata?: Record<string, unknown>
  ip_address?: string
  user_agent?: string
  timestamp: string
}

/**
 * Log an audit event
 *
 * This function is designed to be fire-and-forget. Errors are logged
 * but not thrown, so audit logging failures don't break the main operation.
 *
 * @param event - The audit event to log
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  const logId = uuidv4()
  const timestamp = new Date().toISOString()

  const auditLog: AuditLog = {
    log_id: logId,
    actor_id: event.actorId,
    actor_email: event.actorEmail,
    event_type: event.eventType,
    target_type: event.targetType,
    target_id: event.targetId,
    timestamp,
    ...(event.teamId && { team_id: event.teamId }),
    ...(event.metadata && { metadata: event.metadata }),
    ...(event.ipAddress && { ip_address: event.ipAddress }),
    ...(event.userAgent && { user_agent: event.userAgent }),
  }

  try {
    await docClient.send(new PutCommand({
      TableName: AUDIT_LOGS_TABLE,
      Item: auditLog,
    }))
    console.log(`[AUDIT] ${event.eventType} by ${event.actorEmail} on ${event.targetType}:${event.targetId}`)
  } catch (error) {
    // Log but don't throw - audit logging should not break main operations
    console.error('[AUDIT ERROR] Failed to log audit event:', error)
    console.error('[AUDIT ERROR] Event was:', JSON.stringify(auditLog))
  }
}

/**
 * Get audit logs by actor (user who performed the action)
 *
 * @param actorId - The user ID of the actor
 * @param limit - Maximum number of logs to return (default 100)
 * @returns Array of audit logs sorted by timestamp descending
 */
export async function getAuditLogsByActor(
  actorId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: AUDIT_LOGS_TABLE,
      IndexName: 'actor-index',
      KeyConditionExpression: 'actor_id = :actorId',
      ExpressionAttributeValues: {
        ':actorId': actorId,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    }))

    return (result.Items || []) as AuditLog[]
  } catch (error) {
    console.error('[AUDIT ERROR] Failed to get audit logs by actor:', error)
    return []
  }
}

/**
 * Get audit logs by target (resource that was acted upon)
 *
 * @param targetId - The ID of the target resource
 * @param limit - Maximum number of logs to return (default 100)
 * @returns Array of audit logs sorted by timestamp descending
 */
export async function getAuditLogsByTarget(
  targetId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: AUDIT_LOGS_TABLE,
      IndexName: 'target-index',
      KeyConditionExpression: 'target_id = :targetId',
      ExpressionAttributeValues: {
        ':targetId': targetId,
      },
      ScanIndexForward: false, // Most recent first
      Limit: limit,
    }))

    return (result.Items || []) as AuditLog[]
  } catch (error) {
    console.error('[AUDIT ERROR] Failed to get audit logs by target:', error)
    return []
  }
}

/**
 * Helper to extract client info from a request
 * Used to capture IP address and user agent for audit logs
 *
 * @param request - The NextRequest object
 * @returns Object with ipAddress and userAgent
 */
export function getClientInfo(request: Request): {
  ipAddress?: string
  userAgent?: string
} {
  const headers = request.headers

  // Get IP address (check common proxy headers)
  const ipAddress =
    headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headers.get('x-real-ip') ||
    headers.get('cf-connecting-ip') ||
    undefined

  // Get user agent
  const userAgent = headers.get('user-agent') || undefined

  return { ipAddress, userAgent }
}

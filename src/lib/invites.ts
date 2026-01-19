/**
 * Invitation system for multi-tenant onboarding
 *
 * Data Model (krisp-invites table):
 * - invite_token: Primary key, 32-char secure token
 * - inviter_id: User ID of the person who sent the invite
 * - invitee_email: Email address being invited
 * - inviter_name: Display name of inviter (for invite page)
 * - status: 'pending' | 'accepted' | 'revoked' | 'expired'
 * - created_at: ISO timestamp
 * - accepted_at: ISO timestamp (when accepted)
 * - ttl: Unix timestamp for DynamoDB TTL (7 days from creation)
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb'
import { nanoid } from 'nanoid'

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

const INVITES_TABLE = 'krisp-invites'

// Rate limit: max 10 invites per day per user
const MAX_INVITES_PER_DAY = 10
const INVITE_EXPIRY_DAYS = 7

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired'

export interface Invite {
  invite_token: string
  inviter_id: string
  inviter_name: string
  invitee_email: string
  status: InviteStatus
  created_at: string
  accepted_at?: string
  ttl: number
}

/**
 * Generate a secure 32-character invite token
 */
export function generateInviteToken(): string {
  return nanoid(32)
}

/**
 * Validate email format
 */
export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

/**
 * Check if user has exceeded daily invite limit
 */
export async function checkInviteRateLimit(inviterId: string): Promise<{ allowed: boolean; remaining: number }> {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayIso = today.toISOString()

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'inviter-index',
      KeyConditionExpression: 'inviter_id = :inviterId',
      FilterExpression: 'created_at >= :today',
      ExpressionAttributeValues: {
        ':inviterId': inviterId,
        ':today': todayIso,
      },
    }))

    const todayCount = result.Items?.length || 0
    const remaining = Math.max(0, MAX_INVITES_PER_DAY - todayCount)

    return {
      allowed: todayCount < MAX_INVITES_PER_DAY,
      remaining,
    }
  } catch (error) {
    console.error('Error checking rate limit:', error)
    // Allow on error to not block legitimate users
    return { allowed: true, remaining: MAX_INVITES_PER_DAY }
  }
}

/**
 * Check if an email already has a pending invite
 */
export async function getPendingInviteByEmail(email: string): Promise<Invite | null> {
  const normalizedEmail = email.toLowerCase().trim()

  try {
    const result = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'invitee_email = :email',
      FilterExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':email': normalizedEmail,
        ':pending': 'pending',
      },
    }))

    if (result.Items && result.Items.length > 0) {
      return result.Items[0] as Invite
    }
    return null
  } catch (error) {
    console.error('Error checking pending invite:', error)
    return null
  }
}

/**
 * Create a new invitation
 */
export async function createInvite(params: {
  inviterId: string
  inviterName: string
  inviteeEmail: string
}): Promise<{ invite: Invite; token: string }> {
  const { inviterId, inviterName, inviteeEmail } = params
  const normalizedEmail = inviteeEmail.toLowerCase().trim()
  const token = generateInviteToken()
  const now = new Date()
  const ttl = Math.floor(now.getTime() / 1000) + (INVITE_EXPIRY_DAYS * 24 * 60 * 60)

  const invite: Invite = {
    invite_token: token,
    inviter_id: inviterId,
    inviter_name: inviterName,
    invitee_email: normalizedEmail,
    status: 'pending',
    created_at: now.toISOString(),
    ttl,
  }

  await docClient.send(new PutCommand({
    TableName: INVITES_TABLE,
    Item: invite,
  }))

  return { invite, token }
}

/**
 * Get invite by token
 */
export async function getInvite(token: string): Promise<Invite | null> {
  try {
    const result = await docClient.send(new GetCommand({
      TableName: INVITES_TABLE,
      Key: { invite_token: token },
    }))

    return result.Item as Invite | null
  } catch (error) {
    console.error('Error fetching invite:', error)
    return null
  }
}

/**
 * Validate an invite token
 * Returns details if valid, or reason if invalid
 */
export async function validateInvite(token: string): Promise<{
  valid: boolean
  inviterName?: string
  email?: string
  reason?: string
}> {
  const invite = await getInvite(token)

  if (!invite) {
    return { valid: false, reason: 'Invite not found' }
  }

  // Check if expired via TTL
  const now = Math.floor(Date.now() / 1000)
  if (invite.ttl < now) {
    return { valid: false, reason: 'Invite has expired' }
  }

  // Check status
  if (invite.status === 'accepted') {
    return { valid: false, reason: 'Invite has already been used' }
  }

  if (invite.status === 'revoked') {
    return { valid: false, reason: 'Invite has been revoked' }
  }

  if (invite.status !== 'pending') {
    return { valid: false, reason: 'Invite is no longer valid' }
  }

  return {
    valid: true,
    inviterName: invite.inviter_name,
    email: invite.invitee_email,
  }
}

/**
 * Accept an invitation (mark as used)
 */
export async function acceptInvite(token: string): Promise<boolean> {
  try {
    await docClient.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { invite_token: token },
      UpdateExpression: 'SET #status = :accepted, accepted_at = :now',
      ConditionExpression: '#status = :pending',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':accepted': 'accepted',
        ':pending': 'pending',
        ':now': new Date().toISOString(),
      },
    }))
    return true
  } catch (error) {
    console.error('Error accepting invite:', error)
    return false
  }
}

/**
 * Revoke an invitation
 */
export async function revokeInvite(token: string, inviterId: string): Promise<boolean> {
  try {
    // First verify the invite belongs to this user
    const invite = await getInvite(token)
    if (!invite || invite.inviter_id !== inviterId) {
      return false
    }

    if (invite.status !== 'pending') {
      return false
    }

    await docClient.send(new UpdateCommand({
      TableName: INVITES_TABLE,
      Key: { invite_token: token },
      UpdateExpression: 'SET #status = :revoked',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':revoked': 'revoked',
      },
    }))
    return true
  } catch (error) {
    console.error('Error revoking invite:', error)
    return false
  }
}

/**
 * List all invites sent by a user
 */
export async function listUserInvites(inviterId: string): Promise<Invite[]> {
  try {
    const result = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'inviter-index',
      KeyConditionExpression: 'inviter_id = :inviterId',
      ExpressionAttributeValues: {
        ':inviterId': inviterId,
      },
      ScanIndexForward: false, // newest first
    }))

    const invites = (result.Items || []) as Invite[]

    // Mark expired invites based on TTL
    const now = Math.floor(Date.now() / 1000)
    return invites.map(invite => ({
      ...invite,
      status: invite.status === 'pending' && invite.ttl < now ? 'expired' : invite.status,
    }))
  } catch (error) {
    console.error('Error listing invites:', error)
    return []
  }
}

/**
 * Resend an invitation (creates a new one with same email, marks old as revoked)
 */
export async function resendInvite(params: {
  originalToken: string
  inviterId: string
  inviterName: string
}): Promise<{ invite: Invite; token: string } | null> {
  const { originalToken, inviterId, inviterName } = params

  // Get original invite
  const original = await getInvite(originalToken)
  if (!original || original.inviter_id !== inviterId) {
    return null
  }

  // Revoke the old one
  await revokeInvite(originalToken, inviterId)

  // Create a new one
  return createInvite({
    inviterId,
    inviterName,
    inviteeEmail: original.invitee_email,
  })
}

/**
 * Send invite email (stub for now - logs to console)
 * TODO: Implement with AWS SES
 */
export async function sendInviteEmail(params: {
  inviteeEmail: string
  inviterName: string
  inviteToken: string
  baseUrl: string
}): Promise<boolean> {
  const { inviteeEmail, inviterName, inviteToken, baseUrl } = params
  const inviteUrl = `${baseUrl}/invite/${inviteToken}`

  // TODO: Replace with AWS SES implementation
  console.log('=== INVITE EMAIL (stub) ===')
  console.log(`To: ${inviteeEmail}`)
  console.log(`Subject: ${inviterName} invited you to Keep It Krispy`)
  console.log(`Body:`)
  console.log(`${inviterName} has invited you to join Keep It Krispy.`)
  console.log(`Click here to accept: ${inviteUrl}`)
  console.log(`This invitation expires in 7 days.`)
  console.log('========================')

  return true
}

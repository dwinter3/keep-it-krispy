/**
 * Team/Sharing utilities for multi-tenant collaboration
 *
 * For now, teams are implicit - users who share the same inviter
 * are considered part of the same "team". This allows sharing
 * transcripts with colleagues without a formal team management system.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
} from '@aws-sdk/lib-dynamodb'
import { getUser, getUserByEmail, type User } from './users'

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
const USERS_TABLE = 'krisp-users'

export interface TeamMember {
  user_id: string
  email: string
  name: string
  relationship: 'inviter' | 'invitee' | 'peer'
}

/**
 * Get all team members for a user
 *
 * A user's team consists of:
 * 1. Users they have invited (and who accepted)
 * 2. The user who invited them
 * 3. Other users invited by their inviter (peers)
 */
export async function getTeamMembers(userId: string): Promise<TeamMember[]> {
  const teamMembers: Map<string, TeamMember> = new Map()

  try {
    // 1. Get users this person invited (accepted invites only)
    const invitedByMe = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'inviter-index',
      KeyConditionExpression: 'inviter_id = :inviterId',
      FilterExpression: '#status = :accepted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':inviterId': userId,
        ':accepted': 'accepted',
      },
    }))

    // Look up user details for each invitee
    for (const invite of invitedByMe.Items || []) {
      const invitee = await getUserByEmail(invite.invitee_email)
      if (invitee && invitee.user_id !== userId) {
        teamMembers.set(invitee.user_id, {
          user_id: invitee.user_id,
          email: invitee.primary_email,
          name: invitee.name,
          relationship: 'invitee',
        })
      }
    }

    // 2. Find who invited this user
    const invitesToMe = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'invitee_email = :email',
      FilterExpression: '#status = :accepted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':email': (await getUser(userId))?.primary_email?.toLowerCase() || '',
        ':accepted': 'accepted',
      },
    }))

    const myInvite = invitesToMe.Items?.[0]
    if (myInvite?.inviter_id) {
      // Add my inviter to team
      const inviter = await getUser(myInvite.inviter_id)
      if (inviter && inviter.user_id !== userId) {
        teamMembers.set(inviter.user_id, {
          user_id: inviter.user_id,
          email: inviter.primary_email,
          name: inviter.name,
          relationship: 'inviter',
        })

        // 3. Get peers (other users invited by my inviter)
        const peersQuery = await docClient.send(new QueryCommand({
          TableName: INVITES_TABLE,
          IndexName: 'inviter-index',
          KeyConditionExpression: 'inviter_id = :inviterId',
          FilterExpression: '#status = :accepted',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: {
            ':inviterId': myInvite.inviter_id,
            ':accepted': 'accepted',
          },
        }))

        for (const peerInvite of peersQuery.Items || []) {
          const peer = await getUserByEmail(peerInvite.invitee_email)
          if (peer && peer.user_id !== userId && !teamMembers.has(peer.user_id)) {
            teamMembers.set(peer.user_id, {
              user_id: peer.user_id,
              email: peer.primary_email,
              name: peer.name,
              relationship: 'peer',
            })
          }
        }
      }
    }
  } catch (error) {
    console.error('Error getting team members:', error)
  }

  return Array.from(teamMembers.values())
}

/**
 * Check if a user is in another user's team
 */
export async function isInTeam(userId: string, otherUserId: string): Promise<boolean> {
  const teamMembers = await getTeamMembers(userId)
  return teamMembers.some(m => m.user_id === otherUserId)
}

/**
 * Get minimal user info for display in sharing UI
 */
export async function getUsersById(userIds: string[]): Promise<Array<{ user_id: string; name: string; email: string }>> {
  const users: Array<{ user_id: string; name: string; email: string }> = []

  for (const userId of userIds) {
    try {
      const user = await getUser(userId)
      if (user) {
        users.push({
          user_id: user.user_id,
          name: user.name,
          email: user.primary_email,
        })
      }
    } catch (error) {
      console.error(`Error fetching user ${userId}:`, error)
    }
  }

  return users
}

/**
 * Get the team ID for a user
 *
 * For now, teams are implicit based on invites:
 * - If user was invited by someone, team_id = inviter's user_id
 * - If user is an inviter (has invited others), team_id = their own user_id
 * - If user has no team relationships, returns null
 */
export async function getTeamId(userId: string): Promise<string | null> {
  try {
    // First check if user was invited by someone
    const user = await getUser(userId)
    if (!user) return null

    const invitesToMe = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'email-index',
      KeyConditionExpression: 'invitee_email = :email',
      FilterExpression: '#status = :accepted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':email': user.primary_email?.toLowerCase() || '',
        ':accepted': 'accepted',
      },
    }))

    const myInvite = invitesToMe.Items?.[0]
    if (myInvite?.inviter_id) {
      // User was invited, team_id is the inviter's user_id
      return myInvite.inviter_id as string
    }

    // Check if user has invited anyone (making them a team lead)
    const myInvites = await docClient.send(new QueryCommand({
      TableName: INVITES_TABLE,
      IndexName: 'inviter-index',
      KeyConditionExpression: 'inviter_id = :inviterId',
      FilterExpression: '#status = :accepted',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':inviterId': userId,
        ':accepted': 'accepted',
      },
      Limit: 1,
    }))

    if (myInvites.Items && myInvites.Items.length > 0) {
      // User has invited others, they are the team lead
      return userId
    }

    // User has no team relationships
    return null
  } catch (error) {
    console.error('Error getting team ID:', error)
    return null
  }
}

/**
 * Validate that a user can relinquish to a specific team
 * Returns true if the user is a member of the team
 */
export async function canRelinquishToTeam(userId: string, teamId: string): Promise<boolean> {
  const teamMembers = await getTeamMembers(userId)
  // User can relinquish to their own team (team they belong to)
  const userTeamId = await getTeamId(userId)
  return userTeamId === teamId || teamMembers.some(m => m.user_id === teamId)
}

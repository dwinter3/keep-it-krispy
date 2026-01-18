/**
 * User management utilities for multi-tenant authentication
 *
 * Data Model:
 * - krisp-users: Main user records with role and settings
 * - krisp-email-mapping: Maps email addresses to user_id (supports multiple emails per user)
 * - krisp-api-keys: User-owned API keys for webhooks and MCP
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
import { randomBytes, createHash } from 'crypto'

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
const docClient = DynamoDBDocumentClient.from(client)

const USERS_TABLE = 'krisp-users'
const EMAIL_MAPPING_TABLE = 'krisp-email-mapping'
const API_KEYS_TABLE = 'krisp-api-keys'

export type UserRole = 'admin' | 'customer'

export interface User {
  user_id: string
  primary_email: string
  email_aliases: string[]
  name: string
  role: UserRole
  created_at: string
  updated_at: string
  settings?: {
    timezone?: string
    default_privacy?: 'normal' | 'strict'
  }
  // OAuth tokens (encrypted in production)
  google_access_token?: string
  google_refresh_token?: string
}

export interface ApiKey {
  key_hash: string
  key_id: string // Public ID for display
  user_id: string
  name: string
  status: 'active' | 'revoked'
  created_at: string
  last_used_at?: string
  revoked_at?: string
}

/**
 * Generate a unique user ID
 */
export function generateUserId(): string {
  return `usr_${randomBytes(12).toString('hex')}`
}

/**
 * Generate an API key
 * Returns both the raw key (show once) and the hash (store in DB)
 */
export function generateApiKey(): { key: string; keyHash: string; keyId: string } {
  const keyId = `kk_${randomBytes(4).toString('hex')}`
  const keySecret = randomBytes(24).toString('base64url')
  const key = `${keyId}_${keySecret}`
  const keyHash = createHash('sha256').update(key).digest('hex')
  return { key, keyHash, keyId }
}

/**
 * Hash an API key for lookup
 */
export function hashApiKey(key: string): string {
  return createHash('sha256').update(key).digest('hex')
}

/**
 * Look up user by email address
 * Returns user_id if found, null otherwise
 */
export async function getUserIdByEmail(email: string): Promise<string | null> {
  const normalizedEmail = email.toLowerCase().trim()

  const result = await docClient.send(new GetCommand({
    TableName: EMAIL_MAPPING_TABLE,
    Key: { email: normalizedEmail },
  }))

  return result.Item?.user_id || null
}

/**
 * Get user by user_id
 */
export async function getUser(userId: string): Promise<User | null> {
  const result = await docClient.send(new GetCommand({
    TableName: USERS_TABLE,
    Key: { user_id: userId },
  }))

  return result.Item as User | null
}

/**
 * Get user by email (convenience function)
 */
export async function getUserByEmail(email: string): Promise<User | null> {
  const userId = await getUserIdByEmail(email)
  if (!userId) return null
  return getUser(userId)
}

/**
 * Create or update user on OAuth sign-in
 * Handles the case where user might sign in with different email aliases
 */
export async function upsertUserOnSignIn(params: {
  email: string
  name: string
  googleAccessToken?: string
  googleRefreshToken?: string
}): Promise<User> {
  const { email, name, googleAccessToken, googleRefreshToken } = params
  const normalizedEmail = email.toLowerCase().trim()

  // Check if this email is already mapped to a user
  let userId = await getUserIdByEmail(normalizedEmail)

  if (userId) {
    // Existing user - update tokens and last sign in
    const updateParams: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (googleAccessToken) {
      updateParams.google_access_token = googleAccessToken
    }
    if (googleRefreshToken) {
      updateParams.google_refresh_token = googleRefreshToken
    }

    const updateExpressions = Object.keys(updateParams).map(k => `#${k} = :${k}`)
    const expressionAttributeNames = Object.fromEntries(
      Object.keys(updateParams).map(k => [`#${k}`, k])
    )
    const expressionAttributeValues = Object.fromEntries(
      Object.entries(updateParams).map(([k, v]) => [`:${k}`, v])
    )

    await docClient.send(new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: userId },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    }))

    return (await getUser(userId))!
  }

  // New user - create user record and email mapping
  userId = generateUserId()
  const now = new Date().toISOString()

  const newUser: User = {
    user_id: userId,
    primary_email: normalizedEmail,
    email_aliases: [],
    name,
    role: 'customer', // Default role, admin must be set manually
    created_at: now,
    updated_at: now,
    google_access_token: googleAccessToken,
    google_refresh_token: googleRefreshToken,
  }

  // Create user record
  await docClient.send(new PutCommand({
    TableName: USERS_TABLE,
    Item: newUser,
  }))

  // Create email mapping
  await docClient.send(new PutCommand({
    TableName: EMAIL_MAPPING_TABLE,
    Item: {
      email: normalizedEmail,
      user_id: userId,
      created_at: now,
    },
  }))

  return newUser
}

/**
 * Add an email alias to an existing user
 * Used to link multiple Google accounts to the same user
 */
export async function addEmailAlias(userId: string, email: string): Promise<void> {
  const normalizedEmail = email.toLowerCase().trim()

  // Check if email is already mapped
  const existingUserId = await getUserIdByEmail(normalizedEmail)
  if (existingUserId) {
    if (existingUserId === userId) {
      return // Already mapped to this user
    }
    throw new Error(`Email ${email} is already mapped to another user`)
  }

  const now = new Date().toISOString()

  // Add to email mapping
  await docClient.send(new PutCommand({
    TableName: EMAIL_MAPPING_TABLE,
    Item: {
      email: normalizedEmail,
      user_id: userId,
      created_at: now,
    },
  }))

  // Add to user's email_aliases
  await docClient.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET email_aliases = list_append(if_not_exists(email_aliases, :empty), :alias), updated_at = :now',
    ExpressionAttributeValues: {
      ':alias': [normalizedEmail],
      ':empty': [],
      ':now': now,
    },
  }))
}

/**
 * Set user role (admin only operation)
 */
export async function setUserRole(userId: string, role: UserRole): Promise<void> {
  await docClient.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { user_id: userId },
    UpdateExpression: 'SET #role = :role, updated_at = :now',
    ExpressionAttributeNames: { '#role': 'role' },
    ExpressionAttributeValues: {
      ':role': role,
      ':now': new Date().toISOString(),
    },
  }))
}

// ============= API Key Management =============

/**
 * Create a new API key for a user
 * Returns the raw key (show once to user)
 */
export async function createApiKey(userId: string, name: string): Promise<{ key: string; keyId: string }> {
  const { key, keyHash, keyId } = generateApiKey()
  const now = new Date().toISOString()

  const apiKey: ApiKey = {
    key_hash: keyHash,
    key_id: keyId,
    user_id: userId,
    name,
    status: 'active',
    created_at: now,
  }

  await docClient.send(new PutCommand({
    TableName: API_KEYS_TABLE,
    Item: apiKey,
  }))

  return { key, keyId }
}

/**
 * Look up user by API key
 */
export async function getUserByApiKey(key: string): Promise<User | null> {
  const keyHash = hashApiKey(key)

  const result = await docClient.send(new GetCommand({
    TableName: API_KEYS_TABLE,
    Key: { key_hash: keyHash },
  }))

  if (!result.Item || result.Item.revoked_at) {
    return null
  }

  // Update last_used_at
  await docClient.send(new UpdateCommand({
    TableName: API_KEYS_TABLE,
    Key: { key_hash: keyHash },
    UpdateExpression: 'SET last_used_at = :now',
    ExpressionAttributeValues: { ':now': new Date().toISOString() },
  }))

  return getUser(result.Item.user_id)
}

/**
 * List API keys for a user (without the actual key values)
 */
export async function listUserApiKeys(userId: string): Promise<Omit<ApiKey, 'key_hash'>[]> {
  try {
    // Try using GSI first (more efficient)
    const result = await docClient.send(new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: 'user-index',
      KeyConditionExpression: 'user_id = :userId',
      ExpressionAttributeValues: { ':userId': userId },
    }))

    return (result.Items || [])
      .filter(item => item.status === 'active')
      .map(item => ({
        key_id: item.key_id,
        user_id: item.user_id,
        name: item.name,
        status: item.status as 'active' | 'revoked',
        created_at: item.created_at,
        last_used_at: item.last_used_at,
      }))
  } catch (error) {
    // Fall back to scan if GSI isn't ready yet
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')
    const result = await docClient.send(new ScanCommand({
      TableName: API_KEYS_TABLE,
      FilterExpression: 'user_id = :userId AND #status = :active',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':userId': userId, ':active': 'active' },
    }))

    return (result.Items || []).map(item => ({
      key_id: item.key_id,
      user_id: item.user_id,
      name: item.name,
      status: item.status as 'active' | 'revoked',
      created_at: item.created_at,
      last_used_at: item.last_used_at,
    }))
  }
}

/**
 * Revoke an API key
 */
export async function revokeApiKey(keyId: string, userId: string): Promise<boolean> {
  let key: Record<string, unknown> | undefined

  try {
    // Try using GSI first
    const result = await docClient.send(new QueryCommand({
      TableName: API_KEYS_TABLE,
      IndexName: 'keyid-index',
      KeyConditionExpression: 'key_id = :keyId',
      ExpressionAttributeValues: { ':keyId': keyId },
    }))
    key = result.Items?.[0]
  } catch (error) {
    // Fall back to scan if GSI isn't ready
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb')
    const result = await docClient.send(new ScanCommand({
      TableName: API_KEYS_TABLE,
      FilterExpression: 'key_id = :keyId',
      ExpressionAttributeValues: { ':keyId': keyId },
    }))
    key = result.Items?.[0]
  }

  if (!key || key.user_id !== userId) {
    return false
  }

  await docClient.send(new UpdateCommand({
    TableName: API_KEYS_TABLE,
    Key: { key_hash: key.key_hash as string },
    UpdateExpression: 'SET revoked_at = :now, #status = :revoked',
    ExpressionAttributeNames: { '#status': 'status' },
    ExpressionAttributeValues: {
      ':now': new Date().toISOString(),
      ':revoked': 'revoked',
    },
  }))

  return true
}

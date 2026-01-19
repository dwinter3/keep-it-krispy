import { NextRequest, NextResponse } from 'next/server'
import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'

const USERS_TABLE = 'krisp-users'
const AWS_REGION = process.env.APP_REGION || 'us-east-1'

// AWS clients with custom credentials for Amplify
const credentials = process.env.S3_ACCESS_KEY_ID ? {
  accessKeyId: process.env.S3_ACCESS_KEY_ID,
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
} : undefined

const dynamoClient = new DynamoDBClient({ region: AWS_REGION, credentials })
const dynamodb = DynamoDBDocumentClient.from(dynamoClient)

/**
 * GET /api/user/profile - Get current user's profile
 */
export async function GET() {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  // Return profile data (exclude sensitive fields)
  return NextResponse.json({
    user_id: user.user_id,
    email: user.primary_email,
    name: user.name,
    role: user.role,
    created_at: user.created_at,
    settings: user.settings || {},
    // Include OAuth avatar from session
    avatar: session.user.image || null,
  })
}

/**
 * PUT /api/user/profile - Update current user's profile
 */
export async function PUT(request: NextRequest) {
  const session = await auth()
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  try {
    const body = await request.json()
    const { name, settings } = body

    // Build update expression dynamically
    const updateExpressions: string[] = []
    const expressionAttributeNames: Record<string, string> = {}
    const expressionAttributeValues: Record<string, unknown> = {}

    // Update name if provided
    if (name !== undefined && typeof name === 'string') {
      updateExpressions.push('#name = :name')
      expressionAttributeNames['#name'] = 'name'
      expressionAttributeValues[':name'] = name.trim()
    }

    // Update settings if provided
    if (settings !== undefined && typeof settings === 'object') {
      // Merge with existing settings
      const mergedSettings = { ...user.settings, ...settings }
      updateExpressions.push('#settings = :settings')
      expressionAttributeNames['#settings'] = 'settings'
      expressionAttributeValues[':settings'] = mergedSettings
    }

    // Always update updated_at
    updateExpressions.push('#updated_at = :updated_at')
    expressionAttributeNames['#updated_at'] = 'updated_at'
    expressionAttributeValues[':updated_at'] = new Date().toISOString()

    if (updateExpressions.length === 1) {
      // Only updated_at, nothing else to update
      return NextResponse.json({
        success: true,
        message: 'No fields to update',
      })
    }

    const updateCommand = new UpdateCommand({
      TableName: USERS_TABLE,
      Key: { user_id: user.user_id },
      UpdateExpression: `SET ${updateExpressions.join(', ')}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })

    const result = await dynamodb.send(updateCommand)

    return NextResponse.json({
      success: true,
      user: {
        user_id: result.Attributes?.user_id,
        email: result.Attributes?.primary_email,
        name: result.Attributes?.name,
        role: result.Attributes?.role,
        settings: result.Attributes?.settings || {},
        avatar: session.user.image || null,
      },
    })
  } catch (error) {
    console.error('Profile update error:', error)
    return NextResponse.json(
      { error: 'Failed to update profile', details: String(error) },
      { status: 500 }
    )
  }
}

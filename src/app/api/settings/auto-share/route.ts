import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import {
  getUserByEmail,
  getAutoShareSettings,
  updateAutoShareSettings,
  getTeamMembers,
} from '@/lib/users'
import { logAuditEvent } from '@/lib/auditLog'

/**
 * GET /api/settings/auto-share
 * Get current auto-share settings and available team members
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

  try {
    // Get current auto-share settings
    const { userIds } = await getAutoShareSettings(user.user_id)

    // Get available team members for selection
    const teamMembers = await getTeamMembers(user.user_id)

    return NextResponse.json({
      enabled: userIds.length > 0,
      userIds,
      teamMembers,
    })
  } catch (error) {
    console.error('Error getting auto-share settings:', error)
    return NextResponse.json({ error: 'Failed to get auto-share settings' }, { status: 500 })
  }
}

/**
 * PUT /api/settings/auto-share
 * Update auto-share settings
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
    const { userIds } = body

    // Validate userIds is an array
    if (!Array.isArray(userIds)) {
      return NextResponse.json({ error: 'userIds must be an array' }, { status: 400 })
    }

    // Validate all userIds are strings
    if (!userIds.every(id => typeof id === 'string')) {
      return NextResponse.json({ error: 'All userIds must be strings' }, { status: 400 })
    }

    // Get current settings to determine audit event type
    const currentSettings = await getAutoShareSettings(user.user_id)
    const wasEnabled = currentSettings.userIds.length > 0
    const willBeEnabled = userIds.length > 0

    // Validate that all userIds are valid team members
    const teamMembers = await getTeamMembers(user.user_id)
    const validUserIds = new Set(teamMembers.map(m => m.user_id))

    const invalidUserIds = userIds.filter(id => !validUserIds.has(id))
    if (invalidUserIds.length > 0) {
      return NextResponse.json({
        error: 'Some user IDs are not valid team members',
        invalidUserIds,
      }, { status: 400 })
    }

    // Update settings
    await updateAutoShareSettings(user.user_id, userIds)

    // Log audit event
    let eventType: 'share.enable_auto' | 'share.disable_auto' | 'share.update_auto'
    if (!wasEnabled && willBeEnabled) {
      eventType = 'share.enable_auto'
    } else if (wasEnabled && !willBeEnabled) {
      eventType = 'share.disable_auto'
    } else {
      eventType = 'share.update_auto'
    }

    await logAuditEvent({
      actorId: user.user_id,
      actorEmail: user.primary_email,
      eventType,
      targetType: 'user',
      targetId: user.user_id,
      metadata: {
        previousUserIds: currentSettings.userIds,
        newUserIds: userIds,
      },
    })

    return NextResponse.json({
      success: true,
      enabled: willBeEnabled,
      userIds,
      message: willBeEnabled
        ? 'Auto-share enabled for selected team members'
        : 'Auto-share disabled',
    })
  } catch (error) {
    console.error('Error updating auto-share settings:', error)
    return NextResponse.json({ error: 'Failed to update auto-share settings' }, { status: 500 })
  }
}

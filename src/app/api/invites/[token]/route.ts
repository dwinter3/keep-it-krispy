import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import { revokeInvite, resendInvite, sendInviteEmail } from '@/lib/invites'

type RouteParams = { params: Promise<{ token: string }> }

/**
 * DELETE /api/invites/[token]
 * Revoke an invitation
 */
export async function DELETE(
  request: NextRequest,
  { params }: RouteParams
) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { token } = await params

  try {
    const revoked = await revokeInvite(token, user.user_id)

    if (!revoked) {
      return NextResponse.json(
        { error: 'Invite not found, already used, or not owned by you' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      message: 'Invitation revoked',
    })
  } catch (error) {
    console.error('Error revoking invite:', error)
    return NextResponse.json({ error: 'Failed to revoke invitation' }, { status: 500 })
  }
}

/**
 * POST /api/invites/[token]
 * Resend an invitation (creates new token, revokes old one)
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const user = await getUserByEmail(session.user.email)
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }

  const { token } = await params

  try {
    const result = await resendInvite({
      originalToken: token,
      inviterId: user.user_id,
      inviterName: user.name || user.primary_email,
    })

    if (!result) {
      return NextResponse.json(
        { error: 'Invite not found or not owned by you' },
        { status: 404 }
      )
    }

    // Send email (stub for now)
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await sendInviteEmail({
      inviteeEmail: result.invite.invitee_email,
      inviterName: user.name || 'A team member',
      inviteToken: result.token,
      baseUrl,
    })

    return NextResponse.json({
      success: true,
      invite: {
        token: result.invite.invite_token,
        email: result.invite.invitee_email,
        status: result.invite.status,
        createdAt: result.invite.created_at,
      },
      message: 'Invitation resent successfully',
    })
  } catch (error) {
    console.error('Error resending invite:', error)
    return NextResponse.json({ error: 'Failed to resend invitation' }, { status: 500 })
  }
}

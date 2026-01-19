import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { acceptInvite, validateInvite, getInvite } from '@/lib/invites'

type RouteParams = { params: Promise<{ token: string }> }

/**
 * POST /api/invites/[token]/accept
 * Accept an invitation after OAuth sign-in
 * This is called after the user has successfully authenticated via Google
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  const session = await auth()

  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Must be signed in to accept invite' }, { status: 401 })
  }

  const { token } = await params

  if (!token) {
    return NextResponse.json({ error: 'Token required' }, { status: 400 })
  }

  try {
    // Validate the invite first
    const validation = await validateInvite(token)

    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        error: validation.reason,
      }, { status: 400 })
    }

    // Verify the signed-in email matches the invite email
    const invite = await getInvite(token)
    if (!invite) {
      return NextResponse.json({
        success: false,
        error: 'Invite not found',
      }, { status: 404 })
    }

    const signedInEmail = session.user.email.toLowerCase()
    const invitedEmail = invite.invitee_email.toLowerCase()

    if (signedInEmail !== invitedEmail) {
      return NextResponse.json({
        success: false,
        error: `This invitation was sent to ${invite.invitee_email}. Please sign in with that email address.`,
      }, { status: 403 })
    }

    // Accept the invite
    const accepted = await acceptInvite(token)

    if (!accepted) {
      return NextResponse.json({
        success: false,
        error: 'Failed to accept invitation. It may have already been used.',
      }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      message: 'Invitation accepted! Welcome to Keep It Krispy.',
    })
  } catch (error) {
    console.error('Error accepting invite:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to accept invitation' },
      { status: 500 }
    )
  }
}

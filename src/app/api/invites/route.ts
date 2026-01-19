import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail } from '@/lib/users'
import {
  createInvite,
  listUserInvites,
  checkInviteRateLimit,
  getPendingInviteByEmail,
  isValidEmail,
  sendInviteEmail,
} from '@/lib/invites'

/**
 * GET /api/invites
 * List user's sent invitations
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
    const invites = await listUserInvites(user.user_id)

    // Return invites without sensitive data
    const sanitizedInvites = invites.map(invite => ({
      token: invite.invite_token,
      email: invite.invitee_email,
      status: invite.status,
      createdAt: invite.created_at,
      acceptedAt: invite.accepted_at,
    }))

    return NextResponse.json({ invites: sanitizedInvites })
  } catch (error) {
    console.error('Error listing invites:', error)
    return NextResponse.json({ error: 'Failed to list invites' }, { status: 500 })
  }
}

/**
 * POST /api/invites
 * Send a new invitation
 */
export async function POST(request: NextRequest) {
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
    const { email } = body

    // Validate email format
    if (!email || !isValidEmail(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 })
    }

    const normalizedEmail = email.toLowerCase().trim()

    // Check if user is trying to invite themselves
    if (normalizedEmail === user.primary_email.toLowerCase()) {
      return NextResponse.json({ error: 'You cannot invite yourself' }, { status: 400 })
    }

    // Check if email already exists as a user
    const existingUser = await getUserByEmail(normalizedEmail)
    if (existingUser) {
      return NextResponse.json({ error: 'This email is already registered' }, { status: 400 })
    }

    // Check for existing pending invite to this email
    const existingInvite = await getPendingInviteByEmail(normalizedEmail)
    if (existingInvite) {
      return NextResponse.json(
        { error: 'An invitation to this email is already pending' },
        { status: 400 }
      )
    }

    // Check rate limit
    const { allowed, remaining } = await checkInviteRateLimit(user.user_id)
    if (!allowed) {
      return NextResponse.json(
        { error: 'Daily invite limit reached. Try again tomorrow.' },
        { status: 429 }
      )
    }

    // Create the invite
    const { invite, token } = await createInvite({
      inviterId: user.user_id,
      inviterName: user.name || user.primary_email,
      inviteeEmail: normalizedEmail,
    })

    // Send email (stub for now)
    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    await sendInviteEmail({
      inviteeEmail: normalizedEmail,
      inviterName: user.name || 'A team member',
      inviteToken: token,
      baseUrl,
    })

    return NextResponse.json({
      success: true,
      invite: {
        token: invite.invite_token,
        email: invite.invitee_email,
        status: invite.status,
        createdAt: invite.created_at,
      },
      remaining,
      message: 'Invitation sent successfully',
    })
  } catch (error) {
    console.error('Error creating invite:', error)
    return NextResponse.json({ error: 'Failed to create invitation' }, { status: 500 })
  }
}

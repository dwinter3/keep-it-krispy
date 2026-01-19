import { NextRequest, NextResponse } from 'next/server'
import { validateInvite } from '@/lib/invites'

type RouteParams = { params: Promise<{ token: string }> }

/**
 * GET /api/invites/[token]/validate
 * Validate an invite token (public endpoint, no auth required)
 * Used by the invite landing page to show invite details
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  const { token } = await params

  if (!token) {
    return NextResponse.json({ valid: false, reason: 'Token required' }, { status: 400 })
  }

  try {
    const result = await validateInvite(token)

    if (!result.valid) {
      return NextResponse.json({
        valid: false,
        reason: result.reason,
      })
    }

    return NextResponse.json({
      valid: true,
      inviterName: result.inviterName,
      email: result.email,
    })
  } catch (error) {
    console.error('Error validating invite:', error)
    return NextResponse.json(
      { valid: false, reason: 'Failed to validate invitation' },
      { status: 500 }
    )
  }
}

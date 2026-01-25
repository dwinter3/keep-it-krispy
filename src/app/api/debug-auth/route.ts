import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { authenticateApiRequest } from '@/lib/api-auth'
import { cookies } from 'next/headers'

export async function GET(request: NextRequest) {
  // Get all cookies
  const cookieStore = await cookies()
  const allCookies = cookieStore.getAll()

  // Try direct auth
  let session = null
  let authError = null
  try {
    session = await auth()
  } catch (e) {
    authError = String(e)
  }

  // Try authenticateApiRequest
  let apiAuthResult = null
  try {
    apiAuthResult = await authenticateApiRequest(request)
  } catch (e) {
    apiAuthResult = { error: String(e) }
  }

  return NextResponse.json({
    cookies: allCookies.map(c => ({ name: c.name, valueLength: c.value?.length || 0 })),
    session: session ? {
      hasUser: !!session.user,
      email: session.user?.email,
      id: session.user?.id
    } : null,
    authError,
    apiAuthResult,
    headers: {
      cookie: request.headers.get('cookie')?.substring(0, 100) + '...',
      host: request.headers.get('host'),
    }
  })
}

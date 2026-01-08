import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const SITE_PASSWORD = process.env.SITE_PASSWORD || 'krispy123'
const AUTH_COOKIE = 'krisp-auth'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow login page and API routes
  if (pathname === '/login' || pathname.startsWith('/api/')) {
    return NextResponse.next()
  }

  // Check for auth cookie
  const authCookie = request.cookies.get(AUTH_COOKIE)

  if (authCookie?.value === SITE_PASSWORD) {
    return NextResponse.next()
  }

  // Redirect to login
  const loginUrl = new URL('/login', request.url)
  loginUrl.searchParams.set('redirect', pathname)
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}

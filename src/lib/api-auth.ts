/**
 * API Authentication Helper
 *
 * Provides unified authentication for API routes that support:
 * 1. Session-based auth (NextAuth cookies)
 * 2. API key auth (x-api-key header)
 *
 * Usage:
 *   import { authenticateApiRequest, ApiAuthResult } from '@/lib/api-auth'
 *
 *   export async function GET(request: NextRequest) {
 *     const authResult = await authenticateApiRequest(request)
 *     if (!authResult.authenticated) {
 *       return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 *     }
 *     const userId = authResult.userId
 *     // ... rest of handler
 *   }
 */

import { NextRequest } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserByEmail, getUserByApiKey } from '@/lib/users'

export interface ApiAuthResult {
  authenticated: boolean
  userId: string | null
  authMethod: 'session' | 'api_key' | null
  error?: string
}

/**
 * Authenticate an API request via session or API key.
 *
 * @param request - The incoming NextRequest
 * @returns Authentication result with userId if successful
 */
export async function authenticateApiRequest(request: NextRequest): Promise<ApiAuthResult> {
  // 1. Check for API key in header
  const apiKey = request.headers.get('x-api-key')
  if (apiKey) {
    try {
      const user = await getUserByApiKey(apiKey)
      if (user) {
        return {
          authenticated: true,
          userId: user.user_id,
          authMethod: 'api_key',
        }
      }
      return {
        authenticated: false,
        userId: null,
        authMethod: null,
        error: 'Invalid API key',
      }
    } catch (error) {
      console.error('API key auth error:', error)
      return {
        authenticated: false,
        userId: null,
        authMethod: null,
        error: 'API key validation failed',
      }
    }
  }

  // 2. Fall back to session auth
  try {
    const session = await auth()
    if (session?.user?.email) {
      const user = await getUserByEmail(session.user.email)
      if (user) {
        return {
          authenticated: true,
          userId: user.user_id,
          authMethod: 'session',
        }
      }
      return {
        authenticated: false,
        userId: null,
        authMethod: null,
        error: 'User not found',
      }
    }
  } catch (error) {
    console.error('Session auth error:', error)
  }

  return {
    authenticated: false,
    userId: null,
    authMethod: null,
    error: 'No valid authentication provided',
  }
}

/**
 * Get user ID from request, returning null if not authenticated.
 * Convenience wrapper around authenticateApiRequest.
 */
export async function getUserIdFromRequest(request: NextRequest): Promise<string | null> {
  const result = await authenticateApiRequest(request)
  return result.userId
}

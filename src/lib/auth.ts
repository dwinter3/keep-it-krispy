import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import type { NextAuthConfig } from "next-auth"

// Allowed emails that can sign in (legacy allowlist for admin/founding users)
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim().toLowerCase()).filter(Boolean)

/**
 * Check if a user is authorized to sign in
 * Authorization is granted if:
 * 1. Email is in the legacy ALLOWED_EMAILS list (admin users)
 * 2. User already exists in the database (returning user)
 * 3. User has a pending invitation (new user via invite)
 *
 * Note: Database checks are done dynamically to avoid importing modules
 * that use Node.js crypto in Edge Runtime (middleware)
 */
async function isAuthorizedUser(email: string): Promise<{ authorized: boolean; reason: string }> {
  const normalizedEmail = email.toLowerCase().trim()

  // 1. Check legacy allowlist (for admin/founding users)
  if (ALLOWED_EMAILS.includes(normalizedEmail)) {
    return { authorized: true, reason: 'allowlist' }
  }

  // Dynamic import to avoid Edge Runtime issues
  // These modules use Node.js crypto which is not available in Edge
  try {
    const { getUserByEmail } = await import("@/lib/users")
    const { getPendingInviteByEmail } = await import("@/lib/invites")

    // 2. Check if user already exists (returning user)
    const existingUser = await getUserByEmail(normalizedEmail)
    if (existingUser) {
      return { authorized: true, reason: 'existing_user' }
    }

    // 3. Check for pending invitation (new user via invite)
    const pendingInvite = await getPendingInviteByEmail(normalizedEmail)
    if (pendingInvite) {
      return { authorized: true, reason: 'pending_invite' }
    }
  } catch (err) {
    console.error('Error checking user authorization:', err)
    // If database check fails, fall back to allowlist only
    // This ensures the middleware can still function
  }

  // Not authorized
  return { authorized: false, reason: 'no_access' }
}

export const authConfig: NextAuthConfig = {
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      authorization: {
        params: {
          scope: "openid email profile https://www.googleapis.com/auth/drive.readonly",
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async signIn({ user, account }) {
      const email = user.email?.toLowerCase()
      if (!email) {
        console.log('Sign-in rejected: no email provided')
        return false
      }

      // Check authorization
      const { authorized, reason } = await isAuthorizedUser(email)

      if (!authorized) {
        console.log(`Sign-in rejected for email: ${email} (reason: ${reason})`)
        return false
      }

      console.log(`Sign-in approved for email: ${email} (reason: ${reason})`)

      // Create or update user record on successful sign-in
      try {
        const { upsertUserOnSignIn } = await import("@/lib/users")
        await upsertUserOnSignIn({
          email,
          name: user.name || email,
          googleAccessToken: account?.access_token,
          googleRefreshToken: account?.refresh_token,
        })
      } catch (err) {
        console.error('Error upserting user on sign-in:', err)
        // Don't block sign-in if user record creation fails
      }

      return true
    },
    async jwt({ token, account, user }) {
      // Persist access_token and refresh_token on initial sign in
      if (account) {
        token.accessToken = account.access_token
        token.refreshToken = account.refresh_token
        token.accessTokenExpires = account.expires_at ? account.expires_at * 1000 : undefined
        token.provider = account.provider
      }

      // Add user_id to token (using sub as the user_id)
      if (user) {
        token.user_id = user.id || token.sub
      }

      return token
    },
    async session({ session, token }) {
      // Include user_id and access token in session
      if (session.user) {
        session.user.id = token.user_id as string
        session.accessToken = token.accessToken as string | undefined
        session.refreshToken = token.refreshToken as string | undefined
      }
      return session
    },
  },
  session: {
    strategy: "jwt",
  },
  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)

// Type augmentation for NextAuth
declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
    accessToken?: string
    refreshToken?: string
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    user_id?: string
    accessToken?: string
    refreshToken?: string
    accessTokenExpires?: number
    provider?: string
  }
}

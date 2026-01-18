import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import type { NextAuthConfig } from "next-auth"

// Allowed emails that can sign in
const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || "").split(",").map(e => e.trim().toLowerCase())

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
      // Check if user's email is in the allowlist
      const email = user.email?.toLowerCase()
      if (!email || !ALLOWED_EMAILS.includes(email)) {
        console.log(`Sign-in rejected for email: ${email}`)
        return false
      }
      console.log(`Sign-in approved for email: ${email}`)
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

import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { SessionProvider } from 'next-auth/react'
import ProtectedLayoutClient from './ProtectedLayoutClient'

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  if (!session) {
    redirect('/api/auth/signin')
  }

  return (
    <SessionProvider session={session}>
      <ProtectedLayoutClient>{children}</ProtectedLayoutClient>
    </SessionProvider>
  )
}

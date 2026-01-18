'use client'

import WindsterLayout from './WindsterLayout'

/**
 * Shell component - wraps pages with the Windster-themed sidebar layout.
 * This is a compatibility wrapper that delegates to WindsterLayout.
 */
export default function Shell({ children }: { children: React.ReactNode }) {
  return <WindsterLayout>{children}</WindsterLayout>
}

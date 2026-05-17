'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface LeadExpiryWatcherProps {
  expiresAt: string // ISO string
}

// Reloads the page when the lead's expiry time passes in the browser.
// Prevents providers from seeing a stale "Accept job" button on cached pages.
export function LeadExpiryWatcher({ expiresAt }: LeadExpiryWatcherProps) {
  const router = useRouter()

  useEffect(() => {
    const msUntilExpiry = new Date(expiresAt).getTime() - Date.now()
    if (msUntilExpiry <= 0) {
      router.refresh()
      return
    }
    const id = setTimeout(() => router.refresh(), msUntilExpiry)
    return () => clearTimeout(id)
  }, [expiresAt, router])

  return null
}

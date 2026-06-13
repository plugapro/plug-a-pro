'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AUTH_SESSION_CHANGED_EVENT, AUTH_SESSION_PING_KEY } from '@/lib/auth-client-signout'

// Re-renders the current server-rendered tree when the auth session changes, so
// personalised content (e.g. the home "Hi <name>" greeting) can't linger after
// sign-out. Mounted in the customer and provider layouts.
//
// - Same tab: signOutClient() dispatches AUTH_SESSION_CHANGED_EVENT synchronously
//   before it navigates away.
// - Other tabs: signOutClient() writes AUTH_SESSION_PING_KEY to localStorage,
//   which fires a `storage` event only in the *other* same-origin tabs.
export function AuthRefresh() {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => router.refresh()

    const onStorage = (event: StorageEvent) => {
      if (event.key === AUTH_SESSION_PING_KEY) router.refresh()
    }

    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, refresh)
    window.addEventListener('storage', onStorage)

    return () => {
      window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, refresh)
      window.removeEventListener('storage', onStorage)
    }
  }, [router])

  return null
}

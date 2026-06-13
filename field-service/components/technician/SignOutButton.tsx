'use client'

import { useRouter } from 'next/navigation'
import { signOutClient } from '@/lib/auth-client-signout'

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await signOutClient()
    router.push('/provider-sign-in')
  }

  return (
    <button
      onClick={handleSignOut}
      className="w-full rounded-xl border px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
    >
      Sign out
    </button>
  )
}

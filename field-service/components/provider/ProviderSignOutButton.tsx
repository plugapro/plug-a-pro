'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { signOutClient } from '@/lib/auth-client-signout'

export function ProviderSignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await signOutClient()
    router.push('/provider-sign-in')
  }

  return (
    <button
      type="button"
      onClick={handleSignOut}
      aria-label="Sign out"
      className="flex items-center justify-center w-9 h-9 rounded-[12px] bg-card shadow-[inset_0_0_0_1px_var(--border)] text-[var(--ink-mute)] hover:text-[var(--danger)] transition-colors press-feedback"
    >
      <LogOut size={16} />
    </button>
  )
}

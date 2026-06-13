'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { signOutClient } from '@/lib/auth-client-signout'

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    await signOutClient()
    router.push('/sign-in')
  }

  return (
    <button
      onClick={handleSignOut}
      className="flex items-center gap-3 w-full text-left"
    >
      <div className="flex items-center justify-center w-9 h-9 rounded-[11px] shrink-0 bg-[rgba(229,72,77,0.1)] text-[var(--danger)]">
        <LogOut size={18} />
      </div>
      <span className="text-[14px] font-semibold text-[var(--danger)] tracking-[-0.01em]">
        Sign out
      </span>
    </button>
  )
}

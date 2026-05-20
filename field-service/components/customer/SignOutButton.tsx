'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

export function SignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    const supabase = getSupabase()
    await supabase.auth.signOut().catch(() => undefined)
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined)
    window.dispatchEvent(new Event('pap:auth-session-changed'))
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

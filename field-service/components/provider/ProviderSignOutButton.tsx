'use client'

import { useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { createClient } from '@supabase/supabase-js'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
}

export function ProviderSignOutButton() {
  const router = useRouter()

  async function handleSignOut() {
    // Invalidate the Supabase session server-side (refresh token revocation)
    await getSupabase().auth.signOut().catch(() => undefined)
    // Clear the HttpOnly session cookie written by POST /api/auth/session
    await fetch('/api/auth/session', { method: 'DELETE' }).catch(() => undefined)
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

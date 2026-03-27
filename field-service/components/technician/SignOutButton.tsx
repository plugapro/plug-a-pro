'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@supabase/supabase-js'

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
    await supabase.auth.signOut()
    router.push('/technician-sign-in')
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

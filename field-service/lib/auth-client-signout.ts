import { createClient } from '@supabase/supabase-js'

// Single source of truth for signing a user out of the PWA. Every customer- and
// provider-facing sign-out button must call this so the three teardown steps
// stay in sync. A drift here is what caused the "Hi <provider> - what needs
// fixing?" bug: the provider profile's sign-out cleared only the client-side
// Supabase session and left the HttpOnly cookie intact, so the server-rendered
// customer home still resolved the old session.
export const AUTH_SESSION_CHANGED_EVENT = 'pap:auth-session-changed'

export async function signOutClient(): Promise<void> {
  // 1. Revoke the Supabase refresh token and clear the client-side (localStorage)
  //    session. Best-effort: a missing/expired client session must not block the
  //    cookie teardown below.
  try {
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    )
    await supabase.auth.signOut()
  } catch {
    // best-effort
  }

  // 2. Clear the HttpOnly `sb-access-token` cookie that server components read via
  //    getSession(). JavaScript cannot clear an HttpOnly cookie directly, so this
  //    MUST go through DELETE /api/auth/session. This is the step the provider
  //    profile sign-out previously skipped.
  try {
    await fetch('/api/auth/session', { method: 'DELETE' })
  } catch {
    // best-effort
  }

  // 3. Tell other mounted client views in this tab (e.g. bottom-nav) to re-probe
  //    auth so they don't keep showing a signed-in account item after sign-out.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(AUTH_SESSION_CHANGED_EVENT))
  }
}

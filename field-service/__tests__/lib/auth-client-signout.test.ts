// Regression: provider profile sign-out must clear the HttpOnly session cookie,
// not only the client-side Supabase session. The original bug left the cookie
// intact, so the server-rendered customer home kept greeting "Hi <provider>".
// signOutClient() is the single teardown path every sign-out button now uses.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const signOutSpy = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { signOut: signOutSpy } }),
}))

describe('signOutClient', () => {
  let fetchSpy: ReturnType<typeof vi.fn>
  let dispatchSpy: ReturnType<typeof vi.fn>
  let setItemSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    signOutSpy.mockReset().mockResolvedValue(undefined)
    fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    dispatchSpy = vi.fn()
    setItemSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubGlobal('window', { dispatchEvent: dispatchSpy, localStorage: { setItem: setItemSpy } })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('revokes the Supabase session, clears the HttpOnly cookie, and broadcasts the change', async () => {
    const { signOutClient, AUTH_SESSION_CHANGED_EVENT, AUTH_SESSION_PING_KEY } = await import(
      '@/lib/auth-client-signout'
    )

    await signOutClient()

    expect(signOutSpy).toHaveBeenCalledTimes(1)
    // The step the broken provider sign-out skipped: clear the server cookie.
    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/session', { method: 'DELETE' })
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
    expect(dispatchSpy.mock.calls[0][0]).toMatchObject({ type: AUTH_SESSION_CHANGED_EVENT })
    // Cross-tab signal so other open tabs drop stale personalised content.
    expect(setItemSpy).toHaveBeenCalledWith(AUTH_SESSION_PING_KEY, expect.any(String))
  })

  it('still clears the cookie when Supabase signOut rejects', async () => {
    signOutSpy.mockRejectedValueOnce(new Error('network down'))
    const { signOutClient } = await import('@/lib/auth-client-signout')

    await expect(signOutClient()).resolves.toBeUndefined()

    expect(fetchSpy).toHaveBeenCalledWith('/api/auth/session', { method: 'DELETE' })
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })

  it('does not throw when the cookie DELETE request fails', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('offline'))
    const { signOutClient } = await import('@/lib/auth-client-signout')

    await expect(signOutClient()).resolves.toBeUndefined()
    // Broadcast still fires so other tabs/views re-probe auth.
    expect(dispatchSpy).toHaveBeenCalledTimes(1)
  })
})

/**
 * VodaPay bridge login tests (Task 15).
 *
 * The vitest environment is node (no DOM), so both halves of the amended
 * contract live in dependency-injected, hook-free functions and are tested
 * headlessly here — mirroring the createInlineOtpController() split in
 * use-inline-otp.test.ts:
 *
 *  - interpretVodapayLoginResponse(status, body): pure. This is the entire
 *    point of the Task 15 security-review deviation from the brief's
 *    `Boolean(res?.ok)` sketch — a 200 stepUpRequired response must NEVER be
 *    treated as a real session.
 *  - performVodapayLogin(available, bridge, deps): orchestrates
 *    getAuthCode → fetch → interpretVodapayLoginResponse → navigate, with
 *    the bridge, fetchImpl and navigate all injected so no window/fetch is
 *    touched in this file.
 *
 * useVodapayLogin() itself is a thin useCallback binding of
 * performVodapayLogin() to real browser globals (window.my, fetch,
 * window.location.assign) and is intentionally NOT exercised here — there is
 * no renderHook precedent in this repo (grep confirms `use-inline-otp.test.ts`
 * tests its controller the same headless way), and adding one would be new
 * test infrastructure for a hook whose entire logic already lives in, and is
 * covered via, the two functions above.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  interpretVodapayLoginResponse,
  performVodapayLogin,
  type VodapayLoginDeps,
} from '@/components/customer/useVodapayLogin'
import type { MiniProgramBridge } from '@/lib/vodapay/bridge'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('interpretVodapayLoginResponse', () => {
  it('body.ok === true → { ok: true } (the only real-session case)', () => {
    expect(interpretVodapayLoginResponse(200, { ok: true })).toEqual({ ok: true })
  })

  it('200 { stepUpRequired, redirectTo } → NOT ok, stepUp: true, carries redirectTo', () => {
    expect(
      interpretVodapayLoginResponse(200, {
        stepUpRequired: true,
        redirectTo: '/security/checkpoint',
      }),
    ).toEqual({ ok: false, stepUp: true, redirectTo: '/security/checkpoint' })
  })

  it('423 { locked, code } → NOT ok, locked: true', () => {
    expect(
      interpretVodapayLoginResponse(423, { locked: true, code: 'ACCOUNT_LOCKED' }),
    ).toEqual({ ok: false, locked: true })
  })

  it('423 with no locked field in the body still resolves locked (status is authoritative)', () => {
    expect(interpretVodapayLoginResponse(423, {})).toEqual({ ok: false, locked: true })
  })

  it('401 { error: "vodapay_auth_failed" } → generic failure', () => {
    expect(interpretVodapayLoginResponse(401, { error: 'vodapay_auth_failed' })).toEqual({
      ok: false,
    })
  })

  it('403 { error: "account_not_eligible" } → generic failure', () => {
    expect(interpretVodapayLoginResponse(403, { error: 'account_not_eligible' })).toEqual({
      ok: false,
    })
  })

  it('404 { error: "not_available" } (channel.vodapay.v1 off) → generic failure', () => {
    expect(interpretVodapayLoginResponse(404, { error: 'not_available' })).toEqual({ ok: false })
  })

  it('429 / 500 / 503 → generic failure', () => {
    expect(interpretVodapayLoginResponse(429, { error: 'rate_limited' })).toEqual({ ok: false })
    expect(interpretVodapayLoginResponse(500, { error: 'internal' })).toEqual({ ok: false })
    expect(interpretVodapayLoginResponse(503, { error: 'rate_limiter_unavailable' })).toEqual({
      ok: false,
    })
  })

  it('malformed/unparseable body (null, the shape res.json().catch(() => null) produces) → generic failure', () => {
    expect(interpretVodapayLoginResponse(200, null)).toEqual({ ok: false })
    expect(interpretVodapayLoginResponse(401, null)).toEqual({ ok: false })
  })

  it('stepUpRequired true but redirectTo missing/non-string → generic failure, not stepUp', () => {
    expect(interpretVodapayLoginResponse(200, { stepUpRequired: true })).toEqual({ ok: false })
    expect(
      interpretVodapayLoginResponse(200, { stepUpRequired: true, redirectTo: 42 }),
    ).toEqual({ ok: false })
  })

  it('ok: "true" (truthy string, not boolean true) is never treated as success', () => {
    expect(interpretVodapayLoginResponse(200, { ok: 'true' })).toEqual({ ok: false })
  })
})

describe('performVodapayLogin', () => {
  function buildBridge(overrides: {
    authCode?: string | null
    failInstead?: boolean
  } = {}): { bridge: MiniProgramBridge; getAuthCode: ReturnType<typeof vi.fn> } {
    const getAuthCode = vi.fn((opts: Parameters<MiniProgramBridge['getAuthCode']>[0]) => {
      if (overrides.failInstead) {
        opts.fail?.({ errorMessage: 'user declined' })
        return
      }
      opts.success?.({ authCode: overrides.authCode ?? 'auth-code-1' })
    })
    return {
      bridge: { getAuthCode } as unknown as MiniProgramBridge,
      getAuthCode,
    }
  }

  function buildDeps(overrides: {
    fetchImpl?: VodapayLoginDeps['fetchImpl']
  } = {}): { deps: VodapayLoginDeps; navigate: ReturnType<typeof vi.fn> } {
    const navigate = vi.fn()
    const deps: VodapayLoginDeps = {
      fetchImpl: overrides.fetchImpl ?? (async () => jsonResponse({ ok: true })),
      navigate,
    }
    return { deps, navigate }
  }

  it('success: getAuthCode → POST with the authCode → { ok: true }', async () => {
    const { bridge, getAuthCode } = buildBridge({ authCode: 'code-xyz' })
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ ok: true }))
    const { deps, navigate } = buildDeps({ fetchImpl })

    const result = await performVodapayLogin(true, bridge, deps)

    expect(result).toEqual({ ok: true })
    expect(getAuthCode).toHaveBeenCalledTimes(1)
    expect(getAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['auth_user'] }),
    )
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/auth/vodapay')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ authCode: 'code-xyz' })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('200 stepUpRequired: navigates to redirectTo and resolves not-ok, stepUp: true (no session)', async () => {
    const { bridge } = buildBridge()
    const { deps, navigate } = buildDeps({
      fetchImpl: async () =>
        jsonResponse({ stepUpRequired: true, redirectTo: '/security/checkpoint' }),
    })

    const result = await performVodapayLogin(true, bridge, deps)

    expect(result).toEqual({ ok: false, stepUp: true })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('/security/checkpoint')
  })

  it('423 locked: resolves { ok: false, locked: true } and never navigates', async () => {
    const { bridge } = buildBridge()
    const { deps, navigate } = buildDeps({
      fetchImpl: async () => jsonResponse({ locked: true, code: 'ACCOUNT_LOCKED' }, 423),
    })

    const result = await performVodapayLogin(true, bridge, deps)

    expect(result).toEqual({ ok: false, locked: true })
    expect(navigate).not.toHaveBeenCalled()
  })

  it('401 vodapay_auth_failed: generic failure', async () => {
    const { bridge } = buildBridge()
    const { deps } = buildDeps({
      fetchImpl: async () => jsonResponse({ error: 'vodapay_auth_failed' }, 401),
    })

    expect(await performVodapayLogin(true, bridge, deps)).toEqual({ ok: false })
  })

  it('malformed/non-JSON response body: generic failure, does not throw', async () => {
    const { bridge } = buildBridge()
    const { deps } = buildDeps({
      fetchImpl: async () =>
        new Response('not json', { status: 200, headers: { 'Content-Type': 'text/plain' } }),
    })

    await expect(performVodapayLogin(true, bridge, deps)).resolves.toEqual({ ok: false })
  })

  it('fetch rejects (network failure): generic failure, does not throw', async () => {
    const { bridge } = buildBridge()
    const { deps } = buildDeps({
      fetchImpl: async () => {
        throw new Error('network down')
      },
    })

    await expect(performVodapayLogin(true, bridge, deps)).resolves.toEqual({ ok: false })
  })

  it('getAuthCode fail callback: generic failure, and fetch is never called', async () => {
    const { bridge } = buildBridge({ failInstead: true })
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const { deps } = buildDeps({ fetchImpl })

    const result = await performVodapayLogin(true, bridge, deps)

    expect(result).toEqual({ ok: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('not available: short-circuits before touching the bridge or fetch', async () => {
    const { bridge, getAuthCode } = buildBridge()
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const { deps } = buildDeps({ fetchImpl })

    const result = await performVodapayLogin(false, bridge, deps)

    expect(result).toEqual({ ok: false })
    expect(getAuthCode).not.toHaveBeenCalled()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('no bridge (window.my undefined): short-circuits without touching fetch', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    const { deps } = buildDeps({ fetchImpl })

    const result = await performVodapayLogin(true, undefined, deps)

    expect(result).toEqual({ ok: false })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

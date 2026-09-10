'use client'

// ─── VodaPay bridge login (Task 15) ────────────────────────────────────────
// Federated login for a customer running inside the VodaPay mini-program
// WebView: exchange the host-issued authCode (window.my.getAuthCode) for a
// Plug A Pro session via POST /api/auth/vodapay, then let the caller retry
// whatever it was doing (see BookingFlow's wiring of the auth gate).
//
// CONTRACT DEVIATION FROM THE TASK 15 BRIEF: the brief's sketch collapsed
// the route's response to `Boolean(res?.ok)` (fetch's `Response.ok`, i.e.
// "2xx"). That is wrong — see the contract comment at the top of
// app/api/auth/vodapay/route.ts. The route returns 200 in TWO distinct
// cases, only one of which sets a session cookie:
//   200 { ok: true }                     — session cookie set (real success)
//   200 { stepUpRequired, redirectTo }   — NO session cookie; a pending
//                                          step-up cookie is set instead and
//                                          the browser must be sent to
//                                          redirectTo to complete a checkpoint
// `Response.ok` is true for BOTH, so treating any 2xx as success would let a
// step-up response silently fall through as a "successful" login with no
// actual session. The other non-2xx statuses (400/401/403/404/429/500/503)
// are unambiguous failures, and 423 additionally carries a `locked` outcome
// the caller should surface distinctly rather than folding into the generic
// OTP-dialog fallback.
//
// TESTABILITY: response-interpretation (interpretVodapayLoginResponse) and
// the fetch/getAuthCode orchestration (performVodapayLogin) are pure,
// dependency-injected functions, unit-tested headlessly in
// __tests__/components/use-vodapay-login.test.ts (vitest's default
// environment here is node — no DOM/React rendering). useVodapayLogin() is a
// thin binding of performVodapayLogin() to a React useCallback, mirroring the
// createInlineOtpController() / useInlineOtp() split in ./useInlineOtp.ts.
import { useCallback } from 'react'
import { detectMiniProgram, type MiniProgramBridge } from '@/lib/vodapay/bridge'

export interface VodapayLoginResult {
  ok: boolean
  locked?: boolean
  stepUp?: boolean
}

interface VodapayAuthResponseBody {
  ok?: unknown
  stepUpRequired?: unknown
  redirectTo?: unknown
  locked?: unknown
}

export interface InterpretedVodapayLoginResponse {
  ok: boolean
  locked?: boolean
  stepUp?: boolean
  redirectTo?: string
}

// Pure: turns POST /api/auth/vodapay's (status, body) into the outcome the
// hook returns. This is the amended contract in full — the entire reason
// Task 15 deviated from the brief's `Boolean(res?.ok)` sketch.
export function interpretVodapayLoginResponse(
  status: number,
  body: unknown,
): InterpretedVodapayLoginResponse {
  const parsed = (body ?? null) as VodapayAuthResponseBody | null

  // ONLY body.ok === true sets a session — never widen this to res.ok
  // (Response.ok is true for the 200 stepUpRequired response too).
  if (parsed?.ok === true) return { ok: true }

  if (status === 423 || parsed?.locked === true) {
    return { ok: false, locked: true }
  }

  if (parsed?.stepUpRequired === true && typeof parsed.redirectTo === 'string') {
    return { ok: false, stepUp: true, redirectTo: parsed.redirectTo }
  }

  // 400/401/403/404/429/500/503, a network failure, an unparseable body, or
  // any other unrecognised shape: generic failure, caller falls back to
  // inline OTP.
  return { ok: false }
}

export interface VodapayLoginDeps {
  fetchImpl: typeof fetch
  /** Only invoked for the stepUpRequired redirect. */
  navigate: (url: string) => void
}

function defaultVodapayLoginDeps(): VodapayLoginDeps {
  return {
    fetchImpl: (input, init) => fetch(input, init),
    navigate: (url) => {
      window.location.assign(url)
    },
  }
}

// Dependency-injected orchestration: getAuthCode → POST /api/auth/vodapay →
// interpretVodapayLoginResponse → (maybe) navigate. No hook, no window
// access beyond what's passed in — safe to call directly from a test.
export async function performVodapayLogin(
  available: boolean,
  bridge: MiniProgramBridge | undefined,
  deps: VodapayLoginDeps,
): Promise<VodapayLoginResult> {
  if (!available || !bridge) return { ok: false }

  const authCode = await new Promise<string | null>((resolve) => {
    bridge.getAuthCode({
      scopes: ['auth_user'],
      success: (res) => resolve(res.authCode ?? null),
      fail: () => resolve(null),
    })
  })
  if (!authCode) return { ok: false }

  const res = await deps
    .fetchImpl('/api/auth/vodapay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authCode }),
    })
    .catch(() => null)
  if (!res) return { ok: false }

  const body = await res.json().catch(() => null)
  const interpreted = interpretVodapayLoginResponse(res.status, body)

  if (interpreted.stepUp && interpreted.redirectTo) {
    deps.navigate(interpreted.redirectTo)
  }

  return { ok: interpreted.ok, locked: interpreted.locked, stepUp: interpreted.stepUp }
}

export function useVodapayLogin(): {
  available: boolean
  login: () => Promise<VodapayLoginResult>
} {
  const available =
    typeof window !== 'undefined' && detectMiniProgram(navigator.userAgent, window.my)

  const login = useCallback(async (): Promise<VodapayLoginResult> => {
    if (!available || !window.my) return { ok: false }
    return performVodapayLogin(available, window.my, defaultVodapayLoginDeps())
  }, [available])

  return { available, login }
}

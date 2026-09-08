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
// So: only `body.ok === true` is success. `stepUpRequired` navigates the
// browser itself (the checkpoint flow takes over) and resolves `stepUp:
// true`. 423 resolves `locked: true`. Everything else resolves `{ ok: false
// }` with neither flag set, and the caller falls back to inline OTP.
import { useCallback } from 'react'
import { detectMiniProgram } from '@/lib/vodapay/bridge'

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

export function useVodapayLogin(): {
  available: boolean
  login: () => Promise<VodapayLoginResult>
} {
  const available =
    typeof window !== 'undefined' && detectMiniProgram(navigator.userAgent, window.my)

  const login = useCallback(async (): Promise<VodapayLoginResult> => {
    if (!available || !window.my) return { ok: false }

    const authCode = await new Promise<string | null>((resolve) => {
      window.my!.getAuthCode({
        scopes: ['auth_user'],
        success: (res) => resolve(res.authCode ?? null),
        fail: () => resolve(null),
      })
    })
    if (!authCode) return { ok: false }

    const res = await fetch('/api/auth/vodapay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authCode }),
    }).catch(() => null)
    if (!res) return { ok: false }

    const body = (await res.json().catch(() => null)) as VodapayAuthResponseBody | null

    // ONLY body.ok === true sets a session — never widen this to res.ok.
    if (body?.ok === true) return { ok: true }

    if (res.status === 423 || body?.locked === true) {
      return { ok: false, locked: true }
    }

    if (body?.stepUpRequired === true && typeof body.redirectTo === 'string') {
      window.location.assign(body.redirectTo)
      return { ok: false, stepUp: true }
    }

    // 400/401/403/404/429/500/503 or an unrecognised body shape: generic
    // failure, caller falls back to inline OTP.
    return { ok: false }
  }, [available])

  return { available, login }
}

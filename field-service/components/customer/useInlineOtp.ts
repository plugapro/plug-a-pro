'use client'

// ─── Inline OTP (customer.booking.inline_otp) ─────────────────────────────────
// Encapsulates the full sign-in-at-submit chain (send OTP → verify → session
// cookie → auth-changed event → customer link → onVerified) so BookingFlow can
// authenticate a submitter inside a dialog instead of bouncing to /sign-in.
//
// All logic lives in createInlineOtpController(), a dependency-injected state
// machine that is unit-tested headlessly (vitest runs in a node environment).
// useInlineOtp() is a thin binding of that controller to React state.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { normalizeOtpPhoneNumber } from '@/lib/phone-normalization'
import {
  getCustomerOtpSendErrorMessage,
  getOtpVerifyErrorMessage,
} from '@/lib/auth-client-errors'
import { createCustomerOtpClient } from '@/lib/supabase-auth-client'

export type InlineOtpStep = 'phone' | 'code'

export const INLINE_OTP_RESEND_COOLDOWN_SECONDS = 30

// Structural subset of the Supabase client so tests can inject a plain object.
export type InlineOtpAuthClient = {
  auth: {
    signInWithOtp(params: { phone: string }): Promise<{
      error: { message: string } | null
    }>
    verifyOtp(params: { phone: string; token: string; type: 'sms' }): Promise<{
      data: {
        user: unknown | null
        session: { access_token?: string; expires_in?: number } | null
      }
      error: { message: string } | null
    }>
  }
}

export type InlineOtpDeps = {
  createOtpClient: () => InlineOtpAuthClient
  fetchImpl: typeof fetch
  dispatchAuthChanged: () => void
  /** Used only for the security step-up redirect returned by /api/auth/session. */
  navigate: (url: string) => void
}

type SessionGatePayload = {
  error?: string
  locked?: boolean
  code?: string
  stepUpRequired?: boolean
  redirectTo?: string
}

export type InlineOtpState = {
  step: InlineOtpStep
  /** Raw phone input as typed (local or E.164). */
  phone: string
  /** Normalized number the code was sent to; set after a successful send. */
  e164: string | null
  code: string
  sending: boolean
  verifying: boolean
  error: string | null
  resendCooldown: number
}

export type InlineOtpController = {
  getState(): InlineOtpState
  subscribe(listener: () => void): () => void
  /** Swap the verified callback (the hook keeps it fresh across renders). */
  setOnVerified(fn: () => void | Promise<void>): void
  setPhone(value: string): void
  setCode(value: string): void
  sendCode(): Promise<void>
  verifyCode(): Promise<void>
  resend(): Promise<void>
  reset(): void
  dispose(): void
}

export type InlineOtpOptions = {
  onVerified: () => void | Promise<void>
  initialPhone?: string
  deps?: Partial<InlineOtpDeps>
}

function defaultDeps(): InlineOtpDeps {
  return {
    createOtpClient: () => createCustomerOtpClient(),
    fetchImpl: (input, init) => fetch(input, init),
    dispatchAuthChanged: () => {
      window.dispatchEvent(new Event('pap:auth-session-changed'))
    },
    navigate: (url) => {
      window.location.href = url
    },
  }
}

export function createInlineOtpController(opts: InlineOtpOptions): InlineOtpController {
  const deps: InlineOtpDeps = { ...defaultDeps(), ...opts.deps }
  let onVerified = opts.onVerified

  let state: InlineOtpState = {
    step: 'phone',
    phone: opts.initialPhone ?? '',
    e164: null,
    code: '',
    sending: false,
    verifying: false,
    error: null,
    resendCooldown: 0,
  }

  const listeners = new Set<() => void>()
  let cooldownTimer: ReturnType<typeof setInterval> | null = null

  function set(patch: Partial<InlineOtpState>) {
    state = { ...state, ...patch }
    for (const listener of listeners) listener()
  }

  function stopCooldown() {
    if (cooldownTimer !== null) {
      clearInterval(cooldownTimer)
      cooldownTimer = null
    }
  }

  function startCooldown() {
    stopCooldown()
    set({ resendCooldown: INLINE_OTP_RESEND_COOLDOWN_SECONDS })
    cooldownTimer = setInterval(() => {
      const next = Math.max(0, state.resendCooldown - 1)
      set({ resendCooldown: next })
      if (next <= 0) stopCooldown()
    }, 1000)
  }

  /** Sends the OTP to an already-normalized number. Returns true on success. */
  async function requestCode(e164: string): Promise<boolean> {
    const supabase = deps.createOtpClient()
    const { error: otpError } = await supabase.auth.signInWithOtp({ phone: e164 })
    if (otpError) {
      console.error('[inline-otp] OTP send error:', otpError.message)
      set({ error: getCustomerOtpSendErrorMessage(otpError.message) })
      return false
    }
    return true
  }

  async function sendCode() {
    if (state.sending) return
    set({ error: null, sending: true })
    try {
      const normalized = normalizeOtpPhoneNumber(state.phone, 'ZA')
      if (!normalized.ok) {
        set({ error: 'Please enter a valid South African mobile number.' })
        return
      }
      const sent = await requestCode(normalized.e164)
      if (!sent) return
      set({ e164: normalized.e164, step: 'code', code: '' })
      startCooldown()
    } catch (error) {
      console.error('[inline-otp] unexpected OTP request failure:', error)
      set({ error: 'Something went wrong. Please try again.' })
    } finally {
      set({ sending: false })
    }
  }

  async function resend() {
    if (state.sending || state.resendCooldown > 0) return
    const phone = state.e164
    if (!phone) return
    set({ error: null, sending: true })
    try {
      const sent = await requestCode(phone)
      if (sent) startCooldown()
    } catch (error) {
      console.error('[inline-otp] unexpected OTP resend failure:', error)
      set({ error: 'Something went wrong. Please try again.' })
    } finally {
      set({ sending: false })
    }
  }

  async function verifyCode() {
    if (state.verifying) return
    const phone = state.e164
    if (!phone || state.code.length !== 6) return

    set({ error: null, verifying: true })
    try {
      const supabase = deps.createOtpClient()
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone,
        token: state.code.trim(),
        type: 'sms',
      })

      if (verifyError || !data.user) {
        set({ error: getOtpVerifyErrorMessage(verifyError?.message), code: '' })
        // Same security beacon the /verify page fires — fire-and-forget.
        void deps
          .fetchImpl('/api/security/otp/verify-failed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneE164: phone }),
          })
          .catch(() => undefined)
        if (verifyError) {
          console.error('[inline-otp] OTP verification error:', verifyError.message)
        } else {
          console.error('[inline-otp] OTP verification returned no user without error')
        }
        return
      }

      if (!data.session?.access_token) {
        set({ error: 'We could not complete sign in. Please request a new code.', code: '' })
        return
      }

      const sessionResponse = await deps.fetchImpl('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accessToken: data.session.access_token,
          expiresIn: data.session.expires_in ?? 3600,
        }),
      })
      const sessionPayload = (await sessionResponse
        .json()
        .catch(() => ({}))) as SessionGatePayload

      if (sessionPayload.stepUpRequired && sessionPayload.redirectTo) {
        deps.navigate(sessionPayload.redirectTo)
        return
      }

      if (!sessionResponse.ok || sessionPayload.locked) {
        set({
          error: sessionPayload.locked
            ? 'We could not complete sign in securely. Please request a new code.'
            : sessionPayload.error ?? 'We could not complete sign in. Please request a new code.',
          code: '',
        })
        return
      }

      deps.dispatchAuthChanged()

      // Link failure is non-fatal (mirrors /verify), except the provider-phone
      // guard which must block the customer path.
      const linkResponse = await deps.fetchImpl('/api/auth/link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone }),
      })
      if (linkResponse.ok) {
        const json = (await linkResponse.json().catch(() => ({}))) as { isProvider?: boolean }
        if (json.isProvider) {
          set({
            error:
              'This phone is already registered as a service provider. To manage your bookings as a customer, please contact support@plugapro.co.za.',
          })
          return
        }
      } else {
        console.warn(
          '[inline-otp] linkCustomerAccount failed:',
          await linkResponse.text().catch(() => ''),
        )
      }

      await onVerified()
    } catch (error) {
      console.error('[inline-otp] unexpected OTP verify failure:', error)
      set({ error: 'Something went wrong. Please try again.' })
    } finally {
      set({ verifying: false })
    }
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    setOnVerified(fn) {
      onVerified = fn
    },
    setPhone(value) {
      set({ phone: value, error: null })
    },
    setCode(value) {
      set({ code: value, error: null })
    },
    sendCode,
    verifyCode,
    resend,
    reset() {
      stopCooldown()
      set({ step: 'phone', e164: null, code: '', error: null, resendCooldown: 0 })
    },
    dispose() {
      stopCooldown()
      listeners.clear()
    },
  }
}

export function useInlineOtp(opts: InlineOtpOptions) {
  // useState initializer gives a stable controller instance; an effect keeps
  // the onVerified callback fresh across renders via the controller's own
  // setter (no ref reads or mutation of render-created values during render).
  const [controller] = useState<InlineOtpController>(() =>
    createInlineOtpController({
      onVerified: opts.onVerified,
      initialPhone: opts.initialPhone,
      deps: opts.deps,
    }),
  )
  useEffect(() => {
    controller.setOnVerified(opts.onVerified)
  }, [controller, opts.onVerified])

  useEffect(() => () => controller.dispose(), [controller])

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)

  return {
    step: state.step,
    phone: state.phone,
    setPhone: controller.setPhone,
    e164: state.e164,
    code: state.code,
    setCode: controller.setCode,
    sending: state.sending,
    verifying: state.verifying,
    error: state.error,
    resendCooldown: state.resendCooldown,
    sendCode: controller.sendCode,
    verifyCode: controller.verifyCode,
    resend: controller.resend,
    reset: controller.reset,
  }
}

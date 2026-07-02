/**
 * Inline OTP controller tests (customer.booking.inline_otp).
 *
 * The vitest environment is node (no DOM), so all send/verify/session/link
 * logic lives in createInlineOtpController() — a pure, dependency-injected
 * state machine that the useInlineOtp hook binds to React state. These tests
 * cover the controller headlessly.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  createInlineOtpController,
  INLINE_OTP_RESEND_COOLDOWN_SECONDS,
  type InlineOtpAuthClient,
  type InlineOtpController,
  type InlineOtpDeps,
} from '@/components/customer/useInlineOtp'

type FetchCall = { url: string; init?: RequestInit }
type SignInWithOtpFn = InlineOtpAuthClient['auth']['signInWithOtp']
type VerifyOtpFn = InlineOtpAuthClient['auth']['verifyOtp']

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function buildHarness(overrides: {
  signInWithOtp?: SignInWithOtpFn
  verifyOtp?: VerifyOtpFn
  sessionResponse?: () => Response
  linkResponse?: () => Response
  onVerified?: () => void | Promise<void>
  initialPhone?: string
} = {}) {
  const order: string[] = []
  const fetchCalls: FetchCall[] = []

  const signInWithOtp = vi.fn<SignInWithOtpFn>(
    overrides.signInWithOtp ??
      (async () => {
        order.push('send')
        return { error: null }
      }),
  )

  const verifyOtp = vi.fn<VerifyOtpFn>(
    overrides.verifyOtp ??
      (async () => {
        order.push('verify')
        return {
          data: {
            user: { id: 'user-1' },
            session: { access_token: 'access-token-1', expires_in: 3600 },
          },
          error: null,
        }
      }),
  )

  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    fetchCalls.push({ url, init })
    if (url === '/api/auth/session') {
      order.push('session')
      return overrides.sessionResponse?.() ?? jsonResponse({})
    }
    if (url === '/api/auth/link') {
      order.push('link')
      return overrides.linkResponse?.() ?? jsonResponse({ customerId: 'c1', isNew: false })
    }
    return jsonResponse({})
  }) as unknown as typeof fetch

  const dispatchAuthChanged = vi.fn(() => {
    order.push('dispatch')
  })

  const onVerified = vi.fn(async () => {
    order.push('verified')
    await overrides.onVerified?.()
  })

  const deps: Partial<InlineOtpDeps> = {
    createOtpClient: () => ({ auth: { signInWithOtp, verifyOtp } }),
    fetchImpl,
    dispatchAuthChanged,
    navigate: vi.fn(),
  }

  const controller = createInlineOtpController({
    onVerified,
    initialPhone: overrides.initialPhone,
    deps,
  })

  return { controller, order, fetchCalls, signInWithOtp, verifyOtp, fetchImpl, dispatchAuthChanged, onVerified }
}

async function sendToCodeStep(controller: InlineOtpController) {
  controller.setPhone('083 123 4567')
  await controller.sendCode()
  expect(controller.getState().step).toBe('code')
}

let activeControllers: InlineOtpController[] = []

function track(controller: InlineOtpController) {
  activeControllers.push(controller)
  return controller
}

afterEach(() => {
  for (const controller of activeControllers) controller.dispose()
  activeControllers = []
  vi.useRealTimers()
})

describe('createInlineOtpController — sendCode', () => {
  it('advances to code step and starts the resend cooldown on success', async () => {
    const { controller, signInWithOtp } = buildHarness()
    track(controller)

    controller.setPhone('083 123 4567')
    await controller.sendCode()

    const state = controller.getState()
    expect(signInWithOtp).toHaveBeenCalledTimes(1)
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+27831234567' })
    expect(state.step).toBe('code')
    expect(state.e164).toBe('+27831234567')
    expect(state.error).toBeNull()
    expect(state.sending).toBe(false)
    expect(state.resendCooldown).toBe(INLINE_OTP_RESEND_COOLDOWN_SECONDS)
  })

  it('surfaces the mapped send error and stays on the phone step', async () => {
    const signInWithOtp = vi.fn(async () => ({
      error: { message: 'sms rate limit exceeded' },
    }))
    const { controller } = buildHarness({ signInWithOtp })
    track(controller)

    controller.setPhone('083 123 4567')
    await controller.sendCode()

    const state = controller.getState()
    expect(state.step).toBe('phone')
    expect(state.error).toBe('Too many attempts. Please wait a few minutes before trying again.')
    expect(state.resendCooldown).toBe(0)
  })

  it('rejects an invalid phone number without calling Supabase', async () => {
    const { controller, signInWithOtp } = buildHarness()
    track(controller)

    controller.setPhone('123')
    await controller.sendCode()

    const state = controller.getState()
    expect(signInWithOtp).not.toHaveBeenCalled()
    expect(state.step).toBe('phone')
    expect(state.error).toBe('Please enter a valid South African mobile number.')
  })
})

describe('createInlineOtpController — verifyCode', () => {
  it('runs verify → session POST → auth-changed dispatch → link POST → onVerified, in order', async () => {
    const { controller, order, fetchCalls, onVerified } = buildHarness()
    track(controller)

    await sendToCodeStep(controller)
    controller.setCode('123456')
    await controller.verifyCode()

    expect(order).toEqual(['send', 'verify', 'session', 'dispatch', 'link', 'verified'])
    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(controller.getState().error).toBeNull()

    const sessionCall = fetchCalls.find((c) => c.url === '/api/auth/session')
    expect(sessionCall).toBeDefined()
    expect(sessionCall?.init?.method).toBe('POST')
    expect(JSON.parse(String(sessionCall?.init?.body))).toEqual({
      accessToken: 'access-token-1',
      expiresIn: 3600,
    })

    const linkCall = fetchCalls.find((c) => c.url === '/api/auth/link')
    expect(linkCall).toBeDefined()
    expect(JSON.parse(String(linkCall?.init?.body))).toEqual({ phone: '+27831234567' })
  })

  it('session POST failure surfaces the error and never calls link or onVerified', async () => {
    const { controller, order, fetchCalls, dispatchAuthChanged, onVerified } = buildHarness({
      sessionResponse: () => jsonResponse({ error: 'session store unavailable' }, 500),
    })
    track(controller)

    await sendToCodeStep(controller)
    controller.setCode('123456')
    await controller.verifyCode()

    const state = controller.getState()
    expect(state.error).toBe('session store unavailable')
    expect(state.step).toBe('code')
    expect(dispatchAuthChanged).not.toHaveBeenCalled()
    expect(onVerified).not.toHaveBeenCalled()
    expect(order).not.toContain('link')
    expect(fetchCalls.some((c) => c.url === '/api/auth/link')).toBe(false)
  })

  it('wrong OTP surfaces the mapped message, clears the code and stays on the code step', async () => {
    const verifyOtp = vi.fn(async () => ({
      data: { user: null, session: null },
      error: { message: 'Token has expired or is invalid' },
    }))
    const { controller, onVerified, fetchCalls } = buildHarness({ verifyOtp })
    track(controller)

    await sendToCodeStep(controller)
    controller.setCode('000000')
    await controller.verifyCode()

    const state = controller.getState()
    expect(state.step).toBe('code')
    expect(state.code).toBe('')
    expect(state.error).toBe('Your code has expired. Please request a new one and try again.')
    expect(onVerified).not.toHaveBeenCalled()
    expect(fetchCalls.some((c) => c.url === '/api/auth/session')).toBe(false)
  })

  it('link POST failure is non-fatal: onVerified still runs', async () => {
    const { controller, onVerified } = buildHarness({
      linkResponse: () => jsonResponse({ error: 'link failed' }, 500),
    })
    track(controller)

    await sendToCodeStep(controller)
    controller.setCode('123456')
    await controller.verifyCode()

    expect(onVerified).toHaveBeenCalledTimes(1)
    expect(controller.getState().error).toBeNull()
  })
})

describe('createInlineOtpController — resend', () => {
  it('is a no-op while the cooldown is running, then re-sends after it lapses', async () => {
    vi.useFakeTimers()
    const { controller, signInWithOtp } = buildHarness()
    track(controller)

    await sendToCodeStep(controller)
    expect(signInWithOtp).toHaveBeenCalledTimes(1)
    expect(controller.getState().resendCooldown).toBe(INLINE_OTP_RESEND_COOLDOWN_SECONDS)

    await controller.resend()
    expect(signInWithOtp).toHaveBeenCalledTimes(1) // blocked by cooldown

    await vi.advanceTimersByTimeAsync(INLINE_OTP_RESEND_COOLDOWN_SECONDS * 1000)
    expect(controller.getState().resendCooldown).toBe(0)

    await controller.resend()
    expect(signInWithOtp).toHaveBeenCalledTimes(2)
    expect(controller.getState().resendCooldown).toBe(INLINE_OTP_RESEND_COOLDOWN_SECONDS)
  })
})

describe('createInlineOtpController — reset', () => {
  it('returns to the phone step, clears code/error/cooldown and keeps the phone input', async () => {
    vi.useFakeTimers()
    const { controller } = buildHarness()
    track(controller)

    await sendToCodeStep(controller)
    controller.setCode('12')
    controller.reset()

    const state = controller.getState()
    expect(state.step).toBe('phone')
    expect(state.code).toBe('')
    expect(state.error).toBeNull()
    expect(state.resendCooldown).toBe(0)
    expect(state.e164).toBeNull()
    expect(state.phone).toBe('083 123 4567')
  })
})

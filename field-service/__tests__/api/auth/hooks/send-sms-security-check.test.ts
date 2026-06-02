import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const HOOK_SECRET_RAW = Buffer.from('hook-secret-raw-bytes-for-tests-1234')
const HOOK_SECRET_ENV = `v1,whsec_${HOOK_SECRET_RAW.toString('base64')}`

vi.mock('@/lib/flags', () => ({
  FLAG_KEYS: { AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp' },
  isEnabled: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkOtpSendLimit: vi.fn(),
}))

vi.mock('@/lib/request-ip', () => ({
  trustedClientIp: vi.fn(),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn(),
}))

vi.mock('@/lib/otp-delivery', () => {
  class MockOtpDeliveryError extends Error {
    readonly code: string
    constructor(code: string, message: string) {
      super(message)
      this.name = 'OtpDeliveryError'
      this.code = code
    }
  }
  return { deliverOtp: vi.fn(), OtpDeliveryError: MockOtpDeliveryError }
})

vi.mock('@/lib/otp-security', () => ({
  recordOtpChallenge: vi.fn(),
  markChallengeSent: vi.fn(),
  markChallengeSendFailed: vi.fn(),
  markChallengeCancelled: vi.fn(),
  isDeliveryAllowed: vi.fn(),
  recordDeliveryRefusedDuringLock: vi.fn(),
}))

vi.mock('@/lib/otp-security-signals', () => ({
  shouldSendSecurityCheck: vi.fn(),
}))

vi.mock('@/lib/otp-security-report-prompt', () => ({
  sendOtpSecurityCheckBestEffort: vi.fn(),
}))

// after() from next/server runs the callback post-response in production.
// In tests we don't have a request scope, so this stub schedules the
// callback as a microtask. Tests need to flush microtasks between
// `await POST(...)` and assertions over phase-2 work. The repo uses this
// same pattern in create-job-request.test.ts.
vi.mock('next/server', async (importOriginal) => {
  const original = await importOriginal<typeof import('next/server')>()
  return {
    ...original,
    after: (fn: () => void | Promise<void>) => {
      void Promise.resolve().then(fn).catch(() => undefined)
    },
  }
})

async function flushPhaseTwoWork(): Promise<void> {
  // Wait a microtask tick + a small timer to let after() run + the awaited
  // signal/send promises resolve.
  await new Promise<void>((resolve) => setTimeout(resolve, 10))
}

import { isEnabled } from '@/lib/flags'
import { checkOtpSendLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { deliverOtp } from '@/lib/otp-delivery'
import {
  isDeliveryAllowed,
  recordOtpChallenge,
} from '@/lib/otp-security'
import { shouldSendSecurityCheck } from '@/lib/otp-security-signals'
import { sendOtpSecurityCheckBestEffort } from '@/lib/otp-security-report-prompt'

let POST: typeof import('@/app/api/auth/hooks/send-sms/route').POST

const TEST_OTP = '987654'
const TEST_PHONE = '+27821234567'
const TEST_USER_ID = 'user_test_1'
const TEST_IP = '8.8.8.8'
const TEST_UA = 'Vitest Security Check'
const TEST_CHALLENGE_ID = 'otp_challenge_test_1'
const TEST_REPORT_TOKEN = 'report_token_test_1'

beforeEach(async () => {
  process.env.SUPABASE_AUTH_HOOK_SECRET = HOOK_SECRET_ENV
  vi.clearAllMocks()

  vi.mocked(isEnabled).mockImplementation(async (key) =>
    key === 'auth.otp.whatsapp' || key === 'security.otp.report',
  )
  vi.mocked(checkOtpSendLimit).mockResolvedValue({ ok: true })
  vi.mocked(trustedClientIp).mockReturnValue(TEST_IP)
  vi.mocked(recordOtpChallenge).mockResolvedValue({
    challengeId: TEST_CHALLENGE_ID,
    reportToken: TEST_REPORT_TOKEN,
  })
  vi.mocked(isDeliveryAllowed).mockResolvedValue({ allowed: true })
  vi.mocked(deliverOtp).mockResolvedValue({
    ok: true,
    whatsappMessageId: 'wamid.test.1',
    phoneE164: TEST_PHONE,
  })
  vi.mocked(shouldSendSecurityCheck).mockResolvedValue({ trigger: null })
  vi.mocked(sendOtpSecurityCheckBestEffort).mockResolvedValue({ sent: true, messageId: 'wamid.sc.1' })

  vi.spyOn(console, 'info').mockImplementation(() => undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)

  if (!POST) {
    POST = (await import('@/app/api/auth/hooks/send-sms/route')).POST
  }
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.SUPABASE_AUTH_HOOK_SECRET
  vi.restoreAllMocks()
})

function signed(): NextRequest {
  const body = JSON.stringify({
    user: { id: TEST_USER_ID },
    sms: { otp: TEST_OTP, phone: TEST_PHONE },
  })
  const id = 'msg_test_check_1'
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = `v1,${createHmac('sha256', HOOK_SECRET_RAW)
    .update(`${id}.${timestamp}.${body}`)
    .digest('base64')}`
  return new NextRequest('http://localhost/api/auth/hooks/send-sms', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': TEST_UA,
      'x-forwarded-for': '10.0.0.1, 8.8.8.8',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': signature,
    },
    body,
  })
}

describe('POST /api/auth/hooks/send-sms security-check phase-2 wiring', () => {
  it('does NOT evaluate or send the security-check prompt when security.otp.report is OFF', async () => {
    vi.mocked(isEnabled).mockImplementation(async (key) => key === 'auth.otp.whatsapp')

    const res = await POST(signed())
    await flushPhaseTwoWork()

    expect(res.status).toBe(200)
    expect(shouldSendSecurityCheck).not.toHaveBeenCalled()
    expect(sendOtpSecurityCheckBestEffort).not.toHaveBeenCalled()
  })

  it('sends the security-check prompt with always_on when no fraud signal matches', async () => {
    await POST(signed())
    await flushPhaseTwoWork()

    expect(deliverOtp).toHaveBeenCalledTimes(1)
    expect(shouldSendSecurityCheck).toHaveBeenCalledWith({ phoneE164: TEST_PHONE })
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledTimes(1)
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      reportToken: TEST_REPORT_TOKEN,
      trigger: 'always_on',
      hookRequestId: expect.any(String),
      userId: TEST_USER_ID,
    })
  })

  it('fires the security-check prompt when a signal matches', async () => {
    vi.mocked(shouldSendSecurityCheck).mockResolvedValueOnce({
      trigger: 'send_velocity',
      signalDetail: { sendCountLastHour: 4 },
    })

    const res = await POST(signed())
    await flushPhaseTwoWork()

    expect(res.status).toBe(200)
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledTimes(1)
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      reportToken: TEST_REPORT_TOKEN,
      trigger: 'send_velocity',
      hookRequestId: expect.any(String),
      userId: TEST_USER_ID,
    })
  })

  it('uses always_on when no signal matches (default path)', async () => {
    vi.mocked(shouldSendSecurityCheck).mockResolvedValueOnce({ trigger: null })

    await POST(signed())
    await flushPhaseTwoWork()

    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      reportToken: TEST_REPORT_TOKEN,
      trigger: 'always_on',
      hookRequestId: expect.any(String),
      userId: TEST_USER_ID,
    })
  })

  it('does NOT send the prompt or evaluate signals when OTP delivery fails', async () => {
    const { OtpDeliveryError } = await import('@/lib/otp-delivery')
    vi.mocked(deliverOtp).mockRejectedValueOnce(
      new OtpDeliveryError('WA_TRANSIENT', 'transient meta error'),
    )

    const res = await POST(signed())
    await flushPhaseTwoWork()

    expect(res.status).toBe(503)
    expect(shouldSendSecurityCheck).not.toHaveBeenCalled()
    expect(sendOtpSecurityCheckBestEffort).not.toHaveBeenCalled()
  })

  it('falls back to always_on if shouldSendSecurityCheck throws', async () => {
    vi.mocked(shouldSendSecurityCheck).mockRejectedValueOnce(new Error('signal eval broke'))

    const res = await POST(signed())
    await flushPhaseTwoWork()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      reportToken: TEST_REPORT_TOKEN,
      trigger: 'always_on',
      hookRequestId: expect.any(String),
      userId: TEST_USER_ID,
    })
  })

  it('returns 200 even if sendOtpSecurityCheckBestEffort throws (defence in depth)', async () => {
    vi.mocked(shouldSendSecurityCheck).mockResolvedValueOnce({
      trigger: 'prior_event',
      signalDetail: { priorEventId: 'evt_abc' },
    })
    vi.mocked(sendOtpSecurityCheckBestEffort).mockRejectedValueOnce(
      new Error('send failed unexpectedly'),
    )

    const res = await POST(signed())
    await flushPhaseTwoWork()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
  })

  // HIGH-priority finding from PR #20 code review (2026-05-27): the phase-2
  // block used to be awaited inline before the hook returned to Supabase.
  // That added up to ~4.5s of signal-eval latency + ~10s of Meta-API
  // latency BEFORE the response, easily exceeding Supabase's ~5s
  // auth-hook timeout (which would trigger retries and duplicate OTP
  // sends). The fix is to schedule the always-on phase-2 work via Next.js
  // after() so the response returns immediately.
  it('returns the response BEFORE the signal evaluation runs (after() detachment)', async () => {
    // Make shouldSendSecurityCheck take a measurable amount of time so we
    // can prove it didn't block the response. 200ms is generous enough that
    // any sync awaiting would be obvious.
    let signalEvalStarted = false
    let signalEvalCompleted = false
    vi.mocked(shouldSendSecurityCheck).mockImplementationOnce(async () => {
      signalEvalStarted = true
      await new Promise((resolve) => setTimeout(resolve, 200))
      signalEvalCompleted = true
      return { trigger: 'send_velocity', signalDetail: { sendCountLastHour: 5 } }
    })

    const start = Date.now()
    const res = await POST(signed())
    const elapsed = Date.now() - start

    // Response returned in well under the 200ms eval window → not awaited.
    expect(res.status).toBe(200)
    expect(elapsed).toBeLessThan(150)
    // Signal eval should NOT have completed by the time the response returned.
    // It may have STARTED (microtask) but not completed (still waiting on its
    // setTimeout).
    expect(signalEvalCompleted).toBe(false)

    // Now flush the after() callback to let the deferred work complete.
    await flushPhaseTwoWork()
    await new Promise((resolve) => setTimeout(resolve, 250))
    expect(signalEvalStarted).toBe(true)
    expect(signalEvalCompleted).toBe(true)
    expect(sendOtpSecurityCheckBestEffort).toHaveBeenCalledTimes(1)
  })
})

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

  return {
    deliverOtp: vi.fn(),
    OtpDeliveryError: MockOtpDeliveryError,
  }
})

vi.mock('@/lib/otp-security', () => ({
  recordOtpChallenge: vi.fn(),
  markChallengeSent: vi.fn(),
  markChallengeSendFailed: vi.fn(),
  markChallengeCancelled: vi.fn(),
  isDeliveryAllowed: vi.fn(),
  recordDeliveryRefusedDuringLock: vi.fn(),
}))

import { isEnabled } from '@/lib/flags'
import { checkOtpSendLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { sendTemplate } from '@/lib/whatsapp'
import { deliverOtp, OtpDeliveryError } from '@/lib/otp-delivery'
import {
  isDeliveryAllowed,
  markChallengeCancelled,
  markChallengeSendFailed,
  markChallengeSent,
  recordDeliveryRefusedDuringLock,
  recordOtpChallenge,
} from '@/lib/otp-security'

let POST: typeof import('@/app/api/auth/hooks/send-sms/route').POST

const TEST_OTP = '987654'
const TEST_PHONE = '+27821234567'
const TEST_USER_ID = 'user_test_1'
const TEST_IP = '8.8.8.8'
const TEST_UA = 'Vitest Security Gate'
const TEST_CHALLENGE_ID = 'otp_challenge_test_1'
const TEST_REPORT_TOKEN = 'report_token_test_1'

const consoleSpies = {
  info: vi.spyOn(console, 'info').mockImplementation(() => undefined),
  warn: vi.spyOn(console, 'warn').mockImplementation(() => undefined),
  error: vi.spyOn(console, 'error').mockImplementation(() => undefined),
}

beforeEach(async () => {
  process.env.SUPABASE_AUTH_HOOK_SECRET = HOOK_SECRET_ENV
  vi.clearAllMocks()
  consoleSpies.info.mockClear()
  consoleSpies.warn.mockClear()
  consoleSpies.error.mockClear()

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

  if (!POST) {
    POST = (await import('@/app/api/auth/hooks/send-sms/route')).POST
  }
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.SUPABASE_AUTH_HOOK_SECRET
  vi.unstubAllEnvs()
})

function buildSignedRequest(params: {
  body?: unknown
  id?: string
  timestamp?: number
} = {}): NextRequest {
  const body = JSON.stringify(
    params.body ?? {
      user: { id: TEST_USER_ID },
      sms: { otp: TEST_OTP, phone: TEST_PHONE },
    },
  )
  const id = params.id ?? 'msg_test_security_gate_1'
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000)
  const signed = `${id}.${timestamp}.${body}`
  const signature = `v1,${createHmac('sha256', HOOK_SECRET_RAW)
    .update(signed)
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

function stringifyConsoleCall(call: unknown[]): string {
  return call
    .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg ?? null)))
    .join(' ')
}

describe('POST /api/auth/hooks/send-sms security gate', () => {
  it('when security.otp.report is off, preserves legacy deliverOtp path without challenge writes', async () => {
    vi.mocked(isEnabled).mockImplementation(async (key) => key === 'auth.otp.whatsapp')

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(trustedClientIp).toHaveBeenCalledTimes(1)
    expect(checkOtpSendLimit).toHaveBeenCalledWith(
      expect.objectContaining({ phone: TEST_PHONE, ip: TEST_IP }),
    )
    expect(deliverOtp).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      code: TEST_OTP,
      context: expect.objectContaining({
        userId: TEST_USER_ID,
        hookRequestId: expect.any(String),
        traceId: expect.any(String),
      }),
    })
    expect(recordOtpChallenge).not.toHaveBeenCalled()
    expect(isDeliveryAllowed).not.toHaveBeenCalled()
    expect(markChallengeSent).not.toHaveBeenCalled()
    expect(markChallengeSendFailed).not.toHaveBeenCalled()
    expect(markChallengeCancelled).not.toHaveBeenCalled()
    expect(recordDeliveryRefusedDuringLock).not.toHaveBeenCalled()
  })

  it('does not require OTP_HASH_PEPPER when security.otp.report is off in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VITEST', 'false')
    vi.stubEnv('OTP_HASH_PEPPER', '')
    vi.mocked(isEnabled).mockImplementation(async (key) => key === 'auth.otp.whatsapp')

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(deliverOtp).toHaveBeenCalledWith({
      phone: TEST_PHONE,
      code: TEST_OTP,
      context: expect.objectContaining({
        userId: TEST_USER_ID,
        hookRequestId: expect.any(String),
        traceId: expect.any(String),
      }),
    })
    expect(recordOtpChallenge).not.toHaveBeenCalled()
  })

  it('records a challenge, delivers OTP and marks SENT when security.otp.report is on', async () => {
    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(recordOtpChallenge).toHaveBeenCalledWith({
      phoneE164: TEST_PHONE,
      userId: TEST_USER_ID,
      purpose: 'LOGIN',
      code: TEST_OTP,
      ip: TEST_IP,
      ua: TEST_UA,
      context: {
        traceId: expect.any(String),
        hookRequestId: expect.any(String),
        source: 'send_sms_hook',
      },
    })
    const challengeContext = vi.mocked(recordOtpChallenge).mock.calls[0]![0]
      .context as Record<string, unknown>
    expect(challengeContext.traceId).toBe(challengeContext.hookRequestId)
    expect(isDeliveryAllowed).toHaveBeenCalledWith(TEST_PHONE)
    expect(deliverOtp).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(vi.mocked(deliverOtp).mock.calls[0]![0])).not.toContain(
      TEST_REPORT_TOKEN,
    )
    expect(markChallengeSent).toHaveBeenCalledWith(
      TEST_CHALLENGE_ID,
      'wamid.test.1',
    )
    expect(markChallengeSendFailed).not.toHaveBeenCalled()
    expect(markChallengeCancelled).not.toHaveBeenCalled()
  })

  it('returns 200 when markChallengeSent fails after successful delivery', async () => {
    vi.mocked(markChallengeSent).mockRejectedValueOnce(new Error('shadow sent failed'))

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(deliverOtp).toHaveBeenCalledTimes(1)
    expect(markChallengeSent).toHaveBeenCalledWith(
      TEST_CHALLENGE_ID,
      'wamid.test.1',
    )
    expect(markChallengeSendFailed).not.toHaveBeenCalled()
  })

  it('marks challenge FAILED when deliverOtp throws', async () => {
    vi.mocked(deliverOtp).mockRejectedValueOnce(
      new OtpDeliveryError('WA_TRANSIENT', 'transient failure'),
    )

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: { http_code: 503, message: 'wa_transient' },
    })
    expect(markChallengeSendFailed).toHaveBeenCalledWith(TEST_CHALLENGE_ID)
    expect(markChallengeSent).not.toHaveBeenCalled()
    expect(markChallengeCancelled).not.toHaveBeenCalled()
  })

  it('returns the provider-mapped error when markChallengeSendFailed throws', async () => {
    vi.mocked(deliverOtp).mockRejectedValueOnce(
      new OtpDeliveryError('TEMPLATE_NOT_APPROVED', 'template is not approved'),
    )
    vi.mocked(markChallengeSendFailed).mockRejectedValueOnce(
      new Error('shadow failed update failed'),
    )

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(503)
    await expect(res.json()).resolves.toEqual({
      error: { http_code: 503, message: 'template_not_approved' },
    })
    expect(markChallengeSendFailed).toHaveBeenCalledWith(TEST_CHALLENGE_ID)
    expect(markChallengeSent).not.toHaveBeenCalled()
  })

  it('returns hook-success shape, records CANCELLED and does not call deliverOtp when locked', async () => {
    vi.mocked(isDeliveryAllowed).mockResolvedValueOnce({
      allowed: false,
      reason: 'locked',
      stateId: 'account_security_state_1',
    })

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({})
    expect(recordDeliveryRefusedDuringLock).toHaveBeenCalledWith({
      phoneE164: TEST_PHONE,
      userId: TEST_USER_ID,
      challengeId: TEST_CHALLENGE_ID,
      ip: TEST_IP,
      ua: TEST_UA,
    })
    expect(markChallengeCancelled).toHaveBeenCalledWith(
      TEST_CHALLENGE_ID,
      'delivery_refused_during_lock',
    )
    expect(deliverOtp).not.toHaveBeenCalled()
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(markChallengeSent).not.toHaveBeenCalled()
    expect(markChallengeSendFailed).not.toHaveBeenCalled()
  })

  it('raises deduped OTP_DELIVERY_REFUSED_DURING_LOCK for locked delivery refusal', async () => {
    vi.mocked(isDeliveryAllowed).mockResolvedValueOnce({
      allowed: false,
      reason: 'locked',
      stateId: 'account_security_state_1',
    })

    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    expect(recordDeliveryRefusedDuringLock).toHaveBeenCalledTimes(1)
    expect(recordDeliveryRefusedDuringLock).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneE164: TEST_PHONE,
        challengeId: TEST_CHALLENGE_ID,
      }),
    )
  })

  it('does not log or persist the raw OTP outside the code hash', async () => {
    const res = await POST(buildSignedRequest())

    expect(res.status).toBe(200)
    const challengePayload = vi.mocked(recordOtpChallenge).mock.calls[0]![0]
    expect(challengePayload.code).toBe(TEST_OTP)

    const { code: _code, ...persistedChallengePayload } = challengePayload
    expect(JSON.stringify(persistedChallengePayload)).not.toContain(TEST_OTP)

    const deliveryPayload = vi.mocked(deliverOtp).mock.calls[0]![0]
    expect(deliveryPayload.code).toBe(TEST_OTP)
    expect(JSON.stringify(deliveryPayload.context)).not.toContain(TEST_OTP)

    for (const spy of [consoleSpies.info, consoleSpies.warn, consoleSpies.error]) {
      for (const call of spy.mock.calls) {
        expect(stringifyConsoleCall(call)).not.toContain(TEST_OTP)
      }
    }
  })
})

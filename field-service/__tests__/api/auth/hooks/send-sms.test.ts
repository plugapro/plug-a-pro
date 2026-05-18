import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

const HOOK_SECRET_RAW = Buffer.from('hook-secret-raw-bytes-for-tests-1234')
const HOOK_SECRET_ENV = `v1,whsec_${HOOK_SECRET_RAW.toString('base64')}`

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    otpDeliveryAttempt: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/audit', () => ({
  recordAuditLog: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', () => ({
  FLAG_KEYS: { AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp' },
  isEnabled: vi.fn(),
}))

vi.mock('@/lib/rate-limit', () => ({
  checkOtpSendLimit: vi.fn(),
}))

import { sendTemplate } from '@/lib/whatsapp'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { checkOtpSendLimit } from '@/lib/rate-limit'

let POST: typeof import('@/app/api/auth/hooks/send-sms/route').POST

const TEST_OTP = '987654'
const TEST_PHONE = '+27821234567'

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
  vi.mocked(isEnabled).mockResolvedValue(true)
  vi.mocked(checkOtpSendLimit).mockResolvedValue({ ok: true })
  if (!POST) {
    POST = (await import('@/app/api/auth/hooks/send-sms/route')).POST
  }
})

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.SUPABASE_AUTH_HOOK_SECRET
})

function buildSignedRequest(params: {
  body: unknown
  id?: string
  timestamp?: number
  withSignature?: boolean
  signature?: string
}): NextRequest {
  const body =
    typeof params.body === 'string' ? params.body : JSON.stringify(params.body)
  const id = params.id ?? 'msg_test_1'
  const timestamp = params.timestamp ?? Math.floor(Date.now() / 1000)
  const signed = `${id}.${timestamp}.${body}`
  const signature =
    params.signature ??
    `v1,${createHmac('sha256', HOOK_SECRET_RAW).update(signed).digest('base64')}`

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
  }
  if (params.withSignature !== false) {
    headers['webhook-signature'] = signature
  }

  return new NextRequest('http://localhost/api/auth/hooks/send-sms', {
    method: 'POST',
    headers,
    body,
  })
}

describe('POST /api/auth/hooks/send-sms', () => {
  it('rejects requests missing the webhook-signature header with 401', async () => {
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
      withSignature: false,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.message).toBe('invalid_signature')
    expect(sendTemplate).not.toHaveBeenCalled()
    expect(db.otpDeliveryAttempt.create).not.toHaveBeenCalled()
  })

  it('rejects stale timestamps with 401', async () => {
    const oneHourAgo = Math.floor(Date.now() / 1000) - 60 * 60
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
      timestamp: oneHourAgo,
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
    const json = await res.json()
    expect(json.error.message).toBe('invalid_signature')
  })

  it('returns 503 otp_whatsapp_disabled when the feature flag is off', async () => {
    vi.mocked(isEnabled).mockResolvedValueOnce(false)
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.message).toBe('otp_whatsapp_disabled')
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('returns 429 rate_limited when the rate limiter rejects the send', async () => {
    vi.mocked(checkOtpSendLimit).mockResolvedValueOnce({
      ok: false,
      code: 'phone_limit',
      retryAfterMs: 60_000,
    })
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    const res = await POST(req)
    expect(res.status).toBe(429)
    const json = await res.json()
    expect(json.error.message).toBe('rate_limited')
    expect(sendTemplate).not.toHaveBeenCalled()
  })

  it('delivers via WhatsApp on the happy path and never leaks the OTP to logs', async () => {
    vi.mocked(sendTemplate).mockResolvedValueOnce('wamid.OK1')
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({})

    expect(sendTemplate).toHaveBeenCalledTimes(1)
    const sendArg = vi.mocked(sendTemplate).mock.calls[0]![0]
    expect(sendArg.template).toBe('otp_login')
    expect(sendArg.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: TEST_OTP }] },
      {
        type: 'button',
        sub_type: 'url',
        index: 0,
        parameters: [{ type: 'text', text: TEST_OTP }],
      },
    ])

    for (const spy of [consoleSpies.info, consoleSpies.warn, consoleSpies.error]) {
      for (const call of spy.mock.calls) {
        const serialized = call
          .map((arg) =>
            typeof arg === 'string' ? arg : JSON.stringify(arg ?? null),
          )
          .join(' ')
        expect(serialized).not.toContain(TEST_OTP)
      }
    }
  })

  it('maps [TEMPLATE_NOT_APPROVED] errors from sendTemplate to 503 template_not_approved', async () => {
    vi.mocked(sendTemplate).mockRejectedValueOnce(
      new Error('[TEMPLATE_NOT_APPROVED] otp_login not approved. code=132001'),
    )
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    const res = await POST(req)
    expect(res.status).toBe(503)
    const json = await res.json()
    expect(json.error.message).toBe('template_not_approved')
  })

  it('returns 400 invalid_body when sms.otp is missing', async () => {
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { phone: TEST_PHONE } },
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error.message).toBe('invalid_body')
  })

  // ─── Observability: every non-2xx branch must self-diagnose from logs ──────
  it('logs a warn entry with phoneMasked and message="otp_whatsapp_disabled" when the flag is off', async () => {
    vi.mocked(isEnabled).mockResolvedValueOnce(false)
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    await POST(req)

    const flagOffCall = consoleSpies.warn.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('[send-sms-hook]') &&
        call[0].includes('flag off'),
    )
    expect(flagOffCall).toBeDefined()
    const payload = flagOffCall![1] as Record<string, unknown>
    expect(payload.message).toBe('otp_whatsapp_disabled')
    expect(payload.httpCode).toBe(503)
    expect(payload.step).toBe('send-sms-hook')
    expect(payload.userId).toBe('u1')
    expect(typeof payload.phoneMasked).toBe('string')
    expect(payload.phoneMasked).not.toContain('1234567')
    expect(payload.timestamp).toEqual(expect.any(String))
  })

  it('logs a warn entry with phoneMasked and message="rate_limited" when the rate limiter rejects', async () => {
    vi.mocked(checkOtpSendLimit).mockResolvedValueOnce({
      ok: false,
      code: 'phone_limit',
      retryAfterMs: 60_000,
    })
    const req = buildSignedRequest({
      body: { user: { id: 'u1' }, sms: { otp: TEST_OTP, phone: TEST_PHONE } },
    })
    await POST(req)

    const rateLimitedCall = consoleSpies.warn.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('rate limited'),
    )
    expect(rateLimitedCall).toBeDefined()
    const payload = rateLimitedCall![1] as Record<string, unknown>
    expect(payload.message).toBe('rate_limited')
    expect(payload.httpCode).toBe(429)
    expect(payload.step).toBe('send-sms-hook')
    expect(typeof payload.phoneMasked).toBe('string')
    expect(payload.phoneMasked).not.toContain('1234567')
  })
})

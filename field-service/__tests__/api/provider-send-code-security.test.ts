import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  db: {
    provider: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    providerApplication: {
      findFirst: vi.fn(),
    },
  },
  checkOtpSendLimit: vi.fn(),
  checkProviderLookupLimit: vi.fn(),
  checkPublicProviderSendCodeLimit: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/db', () => ({
  db: mocks.db,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkOtpSendLimit: mocks.checkOtpSendLimit,
  checkProviderLookupLimit: mocks.checkProviderLookupLimit,
  checkPublicProviderSendCodeLimit: mocks.checkPublicProviderSendCodeLimit,
}))

const RAW_PHONE = '0821234567'
const NORMALIZED_PHONE = '+27821234567'

function validBotCheck() {
  return { startedAt: Date.now(), website: '' }
}

async function postProviderSendCode(body: Record<string, unknown>) {
  const { POST } = await import('../../app/api/auth/provider/send-code/route')
  const req = new NextRequest('http://localhost/api/auth/provider/send-code', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })

  return POST(req)
}

function expectSerializedValueNotToContainPhones(value: unknown, phones: string[]) {
  const serialized = JSON.stringify(value)
  for (const phone of phones) {
    expect(serialized).not.toContain(phone)
  }
  return serialized
}

function expectLogsToUseMaskedPhoneOnly(params: {
  calls: unknown[]
  traceId: string
  phones: string[]
}) {
  const serialized = expectSerializedValueNotToContainPhones(params.calls, params.phones)
  expect(serialized).not.toContain('rawPhone')
  expect(serialized).not.toContain('normalizedPhone')
  expect(serialized).toContain(params.traceId)
  expect(serialized).toContain('phoneMasked')
}

function expectFullErrorEnvelope(error: Record<string, unknown>) {
  expect(error.reference_id).toMatch(/^PAP-\d{8}-[A-Z0-9]{6}$/)
  expect(error.referenceId).toBe(error.reference_id)
  expect(typeof error.category).toBe('string')
  expect(typeof error.retryable).toBe('boolean')
  expect(Array.isArray(error.suggested_actions)).toBe(true)
  expect(error.context).toMatchObject({ surface: 'provider_send_code' })
  expect(Date.parse(error.timestamp as string)).not.toBeNaN()
}

describe('POST /api/auth/provider/send-code security hardening', () => {
  const originalEnv = { ...process.env }
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>
  let infoSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    process.env = { ...originalEnv }
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'

    mocks.db.provider.findUnique.mockResolvedValue(null)
    mocks.db.provider.findFirst.mockResolvedValue(null)
    mocks.db.provider.update.mockResolvedValue(null)
    mocks.db.providerApplication.findFirst.mockResolvedValue(null)
    mocks.checkOtpSendLimit.mockResolvedValue({ ok: true })
    mocks.checkProviderLookupLimit.mockResolvedValue({ ok: true })
    mocks.checkPublicProviderSendCodeLimit.mockResolvedValue({ ok: true })
    mocks.createClient.mockReturnValue({
      auth: {
        signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      },
    })

    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })

  afterEach(() => {
    warnSpy.mockRestore()
    errorSpy.mockRestore()
    infoSpy.mockRestore()
    process.env = { ...originalEnv }
  })

  it.each([
    {
      name: 'not found',
      traceId: 'provider_security_not_found',
      provider: null,
      expectedCode: 'WORKER_NOT_FOUND',
    },
    {
      name: 'not approved',
      traceId: 'provider_security_not_approved',
      provider: {
        id: 'prov-under-review',
        userId: null,
        phone: NORMALIZED_PHONE,
        active: true,
        verified: false,
        status: 'UNDER_REVIEW',
      },
      expectedCode: 'WORKER_NOT_APPROVED',
    },
    {
      name: 'inactive',
      traceId: 'provider_security_inactive',
      provider: {
        id: 'prov-inactive',
        userId: null,
        phone: NORMALIZED_PHONE,
        active: false,
        verified: true,
        status: 'ACTIVE',
      },
      expectedCode: 'WORKER_INACTIVE',
    },
  ])('returns a uniform OTP-start response and masked logs for $name providers', async (scenario) => {
    mocks.db.provider.findUnique.mockResolvedValue(scenario.provider)

    const res = await postProviderSendCode({
      phone: RAW_PHONE,
      traceId: scenario.traceId,
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      nextStep: 'verify_otp',
      phone: NORMALIZED_PHONE,
      traceId: scenario.traceId,
    })
    expect(body.error).toBeUndefined()
    expect(mocks.createClient).toHaveBeenCalled()

    expectSerializedValueNotToContainPhones(body, [RAW_PHONE])
    expectLogsToUseMaskedPhoneOnly({
      calls: [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls],
      traceId: scenario.traceId,
      phones: [RAW_PHONE, NORMALIZED_PHONE],
    })
  })

  it('blocks missing bot proof before provider lookup when bot checks are required', async () => {
    const traceId = 'provider_security_bot_missing'
    process.env.PROVIDER_OTP_BOT_CHECK_REQUIRED = 'true'

    const res = await postProviderSendCode({ phone: RAW_PHONE, traceId })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body).toMatchObject({
      ok: false,
      code: 'BOT_CHECK_FAILED',
      traceId,
    })
    expect(body.error).toMatchObject({
      code: 'BOT_CHECK_FAILED',
      step: 'Worker portal send-code',
      traceId,
    })
    expectFullErrorEnvelope(body.error)
    expect(mocks.db.provider.findUnique).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('accepts valid bot proof and continues to OTP for active providers', async () => {
    const traceId = 'provider_security_bot_valid'
    const signInWithOtp = vi.fn().mockResolvedValue({ error: null })
    process.env.PROVIDER_OTP_BOT_CHECK_REQUIRED = 'true'
    mocks.db.provider.findUnique.mockResolvedValue({
      id: 'prov-active',
      userId: null,
      phone: NORMALIZED_PHONE,
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    mocks.createClient.mockReturnValue({ auth: { signInWithOtp } })

    const res = await postProviderSendCode({
      phone: RAW_PHONE,
      traceId,
      botCheck: validBotCheck(),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      nextStep: 'verify_otp',
      phone: NORMALIZED_PHONE,
      traceId,
    })
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: NORMALIZED_PHONE })
  })

  it('does not leak phone values or DB internals when provider lookup fails', async () => {
    const traceId = 'provider_security_db_error'
    mocks.db.provider.findUnique.mockRejectedValue(
      new Error(`database lookup failed for ${NORMALIZED_PHONE} via db://private-host`),
    )

    const res = await postProviderSendCode({ phone: RAW_PHONE, traceId })
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body).toMatchObject({
      ok: false,
      code: 'OTP_PROVIDER_UNAVAILABLE',
      message: "We couldn't send the code right now. Please try again shortly.",
      traceId,
    })
    expect(mocks.createClient).not.toHaveBeenCalled()

    const serializedBody = expectSerializedValueNotToContainPhones(body, [RAW_PHONE, NORMALIZED_PHONE])
    expect(serializedBody).not.toContain('database lookup failed')
    expect(serializedBody).not.toContain('db://private-host')
    expectLogsToUseMaskedPhoneOnly({
      calls: [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls],
      traceId,
      phones: [RAW_PHONE, NORMALIZED_PHONE],
    })
  })

  it('keeps invalid phone responses non-enumerating and logs only masked phone context', async () => {
    const traceId = 'provider_security_invalid_phone'
    const invalidPhone = '12345'

    const res = await postProviderSendCode({ phone: invalidPhone, traceId })
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body).toMatchObject({
      ok: false,
      code: 'INVALID_MOBILE_NUMBER',
      message: 'Enter a valid South African mobile number.',
      traceId,
    })
    expect(mocks.db.provider.findUnique).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()

    expectSerializedValueNotToContainPhones(body, [invalidPhone])
    expectLogsToUseMaskedPhoneOnly({
      calls: [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls],
      traceId,
      phones: [invalidPhone],
    })
  })

  it('keeps rate-limit responses non-enumerating and logs only masked phone context', async () => {
    const traceId = 'provider_security_rate_limited'
    mocks.checkPublicProviderSendCodeLimit.mockResolvedValue({
      ok: false,
      code: 'ip_phone_limit',
      retryAfterMs: 60_000,
    })

    const res = await postProviderSendCode({ phone: RAW_PHONE, traceId })
    const body = await res.json()

    expect(res.status).toBe(429)
    expect(body).toMatchObject({
      ok: false,
      code: 'RATE_LIMITED',
      traceId,
    })
    expect(mocks.db.provider.findUnique).not.toHaveBeenCalled()
    expect(mocks.createClient).not.toHaveBeenCalled()

    expectSerializedValueNotToContainPhones(body, [RAW_PHONE, NORMALIZED_PHONE])
    expectLogsToUseMaskedPhoneOnly({
      calls: [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls],
      traceId,
      phones: [RAW_PHONE, NORMALIZED_PHONE],
    })
  })

  it('does not leak provider outage internals to the API response or phone values to logs', async () => {
    const traceId = 'provider_security_provider_outage'
    const signInWithOtp = vi.fn().mockResolvedValue({
      error: new Error(`OTP gateway rejected message for ${NORMALIZED_PHONE}; provider-secret=abc123`),
    })
    mocks.db.provider.findUnique.mockResolvedValue({
      id: 'prov-active',
      userId: null,
      phone: NORMALIZED_PHONE,
      active: true,
      verified: true,
      status: 'ACTIVE',
    })
    mocks.createClient.mockReturnValue({ auth: { signInWithOtp } })

    const res = await postProviderSendCode({ phone: RAW_PHONE, traceId })
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body).toMatchObject({
      ok: false,
      code: 'OTP_DELIVERY_FAILED',
      message: "We couldn't send the code right now. Please try again shortly.",
      traceId,
    })
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: NORMALIZED_PHONE })

    const serializedBody = expectSerializedValueNotToContainPhones(body, [RAW_PHONE, NORMALIZED_PHONE])
    expect(serializedBody).not.toContain('provider-secret')
    expect(serializedBody).not.toContain('OTP gateway rejected')
    expectLogsToUseMaskedPhoneOnly({
      calls: [...warnSpy.mock.calls, ...errorSpy.mock.calls, ...infoSpy.mock.calls],
      traceId,
      phones: [RAW_PHONE, NORMALIZED_PHONE],
    })
  })
})

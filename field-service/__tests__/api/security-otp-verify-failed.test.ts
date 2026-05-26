import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  checkOtpVerifyLimit: vi.fn(),
  recordVerificationResult: vi.fn(),
  trustedClientIp: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mocks.isEnabled,
}))

vi.mock('@/lib/otp-security', () => ({
  checkOtpVerifyLimit: mocks.checkOtpVerifyLimit,
  recordVerificationResult: mocks.recordVerificationResult,
}))

vi.mock('@/lib/request-ip', () => ({
  trustedClientIp: mocks.trustedClientIp,
}))

const TEST_IP = '8.8.4.4'
const TEST_UA = 'Vitest Verify Failed'
const PHONE = '+27823035070'

function verifyFailedRequest(params: {
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
} = {}) {
  const body = params.rawBody ?? (params.body === undefined ? undefined : JSON.stringify(params.body))
  return new NextRequest('http://localhost/api/security/otp/verify-failed', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': TEST_UA,
      'x-forwarded-for': '10.0.0.1, 8.8.4.4',
      ...params.headers,
    },
    body,
  })
}

async function postVerifyFailed(params: {
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
} = {}) {
  const { POST } = await import('@/app/api/security/otp/verify-failed/route')
  return POST(verifyFailedRequest(params))
}

describe('POST /api/security/otp/verify-failed', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnabled.mockResolvedValue(true)
    mocks.checkOtpVerifyLimit.mockResolvedValue({ ok: true, challengeId: 'otp_123' })
    mocks.recordVerificationResult.mockResolvedValue(undefined)
    mocks.trustedClientIp.mockReturnValue(TEST_IP)
  })

  it.each([
    ['valid telemetry', { phoneE164: PHONE }],
    ['missing phone', {}],
    ['empty phone', { phoneE164: '   ' }],
    ['non-string phone', { phoneE164: 12345 }],
    ['malformed JSON', undefined],
  ])('always returns generic ok response to avoid enumeration for %s', async (_label, body) => {
    const response =
      body === undefined
        ? await postVerifyFailed({ rawBody: '{not-json' })
        : await postVerifyFailed({ body })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it.each([
    [{ ok: false, reason: 'rate_limited' as const }],
    [{ ok: false, reason: 'limiter_unavailable' as const }],
  ])('rate-limits verify-failed telemetry before recording failure for %s', async (limitResult) => {
    mocks.checkOtpVerifyLimit.mockResolvedValueOnce(limitResult)

    const response = await postVerifyFailed({ body: { phoneE164: PHONE } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.recordVerificationResult).not.toHaveBeenCalled()
  })

  it.each([
    ['missing phone', {}],
    ['empty phone', { phoneE164: '   ' }],
    ['non-string phone', { phoneE164: 12345 }],
  ])('does not call services for %s input', async (_label, body) => {
    const response = await postVerifyFailed({ body })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.isEnabled).not.toHaveBeenCalled()
    expect(mocks.trustedClientIp).not.toHaveBeenCalled()
    expect(mocks.checkOtpVerifyLimit).not.toHaveBeenCalled()
    expect(mocks.recordVerificationResult).not.toHaveBeenCalled()
  })

  it('does not record telemetry when no recent active challenge exists', async () => {
    mocks.checkOtpVerifyLimit.mockResolvedValueOnce({ ok: false, reason: 'no_active_challenge' })

    const response = await postVerifyFailed({ body: { phoneE164: PHONE } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.recordVerificationResult).not.toHaveBeenCalled()
  })

  it('records client_telemetry source without accepting or sending a code field', async () => {
    const response = await postVerifyFailed({
      body: {
        phoneE164: ` ${PHONE} `,
        code: '123456',
        token: 'should-not-forward',
        ip: '1.2.3.4',
      },
    })

    expect(response.status).toBe(200)
    expect(mocks.trustedClientIp).toHaveBeenCalledWith(expect.any(NextRequest))
    expect(mocks.checkOtpVerifyLimit).toHaveBeenCalledWith({
      phoneE164: PHONE,
      ip: TEST_IP,
      ua: TEST_UA,
    })
    expect(mocks.recordVerificationResult).toHaveBeenCalledWith({
      phoneE164: PHONE,
      success: false,
      source: 'client_telemetry',
    })
    const serializedCalls = JSON.stringify(mocks.recordVerificationResult.mock.calls)
    expect(serializedCalls).not.toContain('123456')
    expect(serializedCalls).not.toContain('should-not-forward')
    expect(serializedCalls).not.toContain('1.2.3.4')
  })

  it('flag off does nothing except generic ok', async () => {
    mocks.isEnabled.mockResolvedValueOnce(false)

    const response = await postVerifyFailed({ body: { phoneE164: PHONE } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.trustedClientIp).not.toHaveBeenCalled()
    expect(mocks.checkOtpVerifyLimit).not.toHaveBeenCalled()
    expect(mocks.recordVerificationResult).not.toHaveBeenCalled()
  })

  it('preserves generic ok when security service calls throw', async () => {
    mocks.checkOtpVerifyLimit.mockRejectedValueOnce(new Error('limiter down'))

    const response = await postVerifyFailed({ body: { phoneE164: PHONE } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.recordVerificationResult).not.toHaveBeenCalled()
  })
})

describe('customer verify page telemetry', () => {
  it('posts only phoneE164 after a failed Supabase verify attempt', () => {
    const source = readFileSync(join(process.cwd(), 'app/(auth)/verify/page.tsx'), 'utf8')
    const telemetryFetch = source.match(
      /fetch\('\/api\/security\/otp\/verify-failed'[\s\S]*?\}\)\.catch\(\(\) => undefined\)/,
    )?.[0]

    expect(telemetryFetch).toBeDefined()
    expect(telemetryFetch).toContain('JSON.stringify({ phoneE164: phone })')
    expect(telemetryFetch).not.toContain('code')
    expect(telemetryFetch).not.toContain('token')
  })
})

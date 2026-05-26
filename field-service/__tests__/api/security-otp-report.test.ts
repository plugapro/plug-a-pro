import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  reportUnrequestedOtp: vi.fn(),
  checkOtpReportLimit: vi.fn(),
  trustedClientIp: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mocks.isEnabled,
}))

vi.mock('@/lib/otp-security', () => ({
  reportUnrequestedOtp: mocks.reportUnrequestedOtp,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkOtpReportLimit: mocks.checkOtpReportLimit,
}))

vi.mock('@/lib/request-ip', () => ({
  trustedClientIp: mocks.trustedClientIp,
}))

const TEST_IP = '8.8.8.8'
const TEST_UA = 'Vitest OTP Report'

afterEach(() => {
  vi.unstubAllGlobals()
})

function reportRequest(params: {
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
} = {}) {
  const body = params.rawBody ?? (params.body === undefined ? undefined : JSON.stringify(params.body))
  return new NextRequest('http://localhost/api/security/otp/report', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': TEST_UA,
      'x-forwarded-for': '10.0.0.1, 8.8.8.8',
      ...params.headers,
    },
    body,
  })
}

async function postReport(params: {
  body?: unknown
  rawBody?: string
  headers?: Record<string, string>
} = {}) {
  const { POST } = await import('@/app/api/security/otp/report/route')
  return POST(reportRequest(params))
}

describe('POST /api/security/otp/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnabled.mockResolvedValue(true)
    mocks.checkOtpReportLimit.mockResolvedValue({ ok: true })
    mocks.reportUnrequestedOtp.mockResolvedValue({ ok: true })
    mocks.trustedClientIp.mockReturnValue(TEST_IP)
  })

  it.each([
    ['valid', { token: 'valid-token' }],
    ['invalid', { token: 'invalid-token' }],
    ['expired', { token: 'expired-token' }],
    ['reused', { token: 'reused-token' }],
    ['missing', {}],
    ['non-string', { token: 12345 }],
  ])('returns generic success for %s token input', async (_label, body) => {
    const response = await postReport({ body })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it('returns generic success for malformed JSON token input', async () => {
    const response = await postReport({ rawBody: '{not-json' })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })

  it.each([
    [{ code: 'ip_limit' as const, retryAfterMs: 60_000 }],
    [{ code: 'limiter_unavailable' as const, retryAfterMs: 60_000 }],
  ])('rate-limits before calling reportUnrequestedOtp for %s', async (limitResult) => {
    mocks.checkOtpReportLimit.mockResolvedValueOnce({
      ok: false,
      ...limitResult,
    })

    const response = await postReport({ body: { token: 'report-token' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.reportUnrequestedOtp).not.toHaveBeenCalled()
  })

  it('calls reportUnrequestedOtp with PWA_LINK, trusted IP, and user-agent', async () => {
    const response = await postReport({
      body: { token: 'report-token', ip: '1.2.3.4' },
    })

    expect(response.status).toBe(200)
    expect(mocks.trustedClientIp).toHaveBeenCalledWith(expect.any(NextRequest))
    expect(mocks.checkOtpReportLimit).toHaveBeenCalledWith({
      ip: TEST_IP,
      ua: TEST_UA,
    })
    expect(mocks.reportUnrequestedOtp).toHaveBeenCalledWith({
      token: 'report-token',
      sourceChannel: 'PWA_LINK',
      ip: TEST_IP,
      ua: TEST_UA,
    })
    expect(JSON.stringify(mocks.reportUnrequestedOtp.mock.calls[0]?.[0])).not.toContain('1.2.3.4')
  })

  it('when the report flag is off, returns generic success without limiter or service calls', async () => {
    mocks.isEnabled.mockResolvedValueOnce(false)

    const response = await postReport({ body: { token: 'report-token' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.trustedClientIp).not.toHaveBeenCalled()
    expect(mocks.checkOtpReportLimit).not.toHaveBeenCalled()
    expect(mocks.reportUnrequestedOtp).not.toHaveBeenCalled()
  })

  it('returns generic success when reportUnrequestedOtp throws', async () => {
    mocks.reportUnrequestedOtp.mockRejectedValueOnce(new Error('service unavailable'))

    const response = await postReport({ body: { token: 'report-token' } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
  })
})

describe('GET /security/otp/report', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders without calling reportUnrequestedOtp server-side', async () => {
    const { default: ReportPage } = await import('@/app/security/otp/report/page')

    const element = await ReportPage({
      searchParams: Promise.resolve({ token: 'report-token' }),
    })
    const html = renderToString(element)

    expect(html).toContain('Verification attempt blocked')
    expect(html).toContain('Your Plug A Pro account is protected')
    expect(mocks.reportUnrequestedOtp).not.toHaveBeenCalled()
  })

  it('includes a client form that posts the token to the report API', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })))
    vi.stubGlobal('fetch', fetchMock)
    const { REPORT_API_PATH, ReportClient, submitOtpReport } = await import(
      '@/app/security/otp/report/report-client'
    )

    const html = renderToString(createElement(ReportClient, { token: 'report-token' }))
    expect(html).toContain(`action="${REPORT_API_PATH}"`)
    expect(html).toContain('name="token"')
    expect(html).toContain('value="report-token"')

    await submitOtpReport('report-token')

    expect(fetchMock).toHaveBeenCalledWith(REPORT_API_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'report-token' }),
    })
  })
})

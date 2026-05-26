import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  checkOtpVerifyLimit: vi.fn(),
  recordAuditLog: vi.fn(),
  isEnabled: vi.fn(),
  issueGate: vi.fn(),
  db: {
    provider: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    providerApplication: {
      findFirst: vi.fn(),
    },
  },
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/auth', () => ({ createServiceClient: mocks.createServiceClient }))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/rate-limit', () => ({ checkOtpVerifyLimit: mocks.checkOtpVerifyLimit }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mocks.recordAuditLog }))
vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/auth-session-gate', () => ({
  issueAuthSessionWithSecurityGate: mocks.issueGate,
}))

const PROVIDER = {
  id: 'prov_123',
  userId: 'user_123',
  phone: '+27821234567',
  active: true,
  verified: true,
  status: 'ACTIVE',
  name: 'Provider One',
}

const USER = {
  id: 'user_123',
  phone: '27821234567',
  user_metadata: {},
}

async function postVerify(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/auth/provider/verify-code/route')
  return POST(
    new NextRequest('http://localhost/api/auth/provider/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/auth/provider/verify-code security gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mocks.checkOtpVerifyLimit.mockResolvedValue({ ok: true })
    mocks.recordAuditLog.mockResolvedValue(undefined)
    mocks.isEnabled.mockResolvedValue(true)
    mocks.createClient.mockReturnValue({
      auth: {
        verifyOtp: vi.fn().mockResolvedValue({
          data: {
            user: USER,
            session: { access_token: 'provider-session-token', expires_in: 7200 },
          },
          error: null,
        }),
      },
    })
    mocks.db.providerApplication.findFirst.mockResolvedValue(null)
    mocks.db.provider.findMany.mockResolvedValue([PROVIDER])
    mocks.db.provider.update.mockResolvedValue(PROVIDER)
    mocks.createServiceClient.mockReturnValue({
      auth: {
        admin: {
          updateUserById: vi.fn().mockResolvedValue({ data: {}, error: null }),
        },
      },
    })
    mocks.issueGate.mockResolvedValue({
      ok: true,
      setCookie:
        'sb-access-token=provider-session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600',
    })
  })

  it('issues the provider session cookie returned by the shared gate', async () => {
    const response = await postVerify({
      phone: '0821234567',
      code: '123456',
      traceId: 'trace-provider-ok',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      code: 'OK',
      traceId: 'trace-provider-ok',
      providerId: PROVIDER.id,
    })
    expect(response.headers.get('Set-Cookie')).toBe(
      'sb-access-token=provider-session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600',
    )
    expect(mocks.issueGate).toHaveBeenCalledWith({
      accessToken: 'provider-session-token',
      phoneE164: '+27821234567',
      userId: USER.id,
      maxAge: 7200,
      sourceRoute: '/api/auth/provider/verify-code',
    })
  })

  it('skips the OTP security gate and issues a session cookie when otp reporting is disabled', async () => {
    mocks.isEnabled.mockResolvedValueOnce(false)

    const response = await postVerify({
      phone: '0821234567',
      code: '123456',
      traceId: 'trace-provider-flag-off',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      ok: true,
      code: 'OK',
      traceId: 'trace-provider-flag-off',
      providerId: PROVIDER.id,
    })
    expect(response.headers.get('Set-Cookie')).toBe(
      'sb-access-token=provider-session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200',
    )
    expect(mocks.isEnabled).toHaveBeenCalledWith('security.otp.report', { userId: USER.id })
    expect(mocks.issueGate).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope and clears any existing session cookie when the gate returns LOCKED', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'LOCKED',
      metadata: { code: 'security_gate_unavailable' },
    })

    const response = await postVerify({
      phone: '0821234567',
      code: '123456',
      traceId: 'trace-provider-locked',
    })
    const body = await response.json()

    expect(response.status).toBe(423)
    expect(body).toMatchObject({
      ok: false,
      code: 'ACCOUNT_LOCKED',
      // Provider portal must surface calm copy, not the generic "Something went
      // wrong" fallback. Regression caught on production retest 2026-05-26
      // when the OTP migration hadn't landed and the gate's fail-closed
      // response flowed through workerVerifyMessageForCode's default branch.
      message: "We couldn't complete sign in securely. Please try again in a few minutes or request a new code.",
      traceId: 'trace-provider-locked',
      error: {
        code: 'ACCOUNT_LOCKED',
        reason: "We couldn't complete sign in securely. Please try again in a few minutes or request a new code.",
        traceId: 'trace-provider-locked',
        step: 'Worker portal verify-code',
      },
    })
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('sb-access-token=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).not.toContain('sb-access-token=provider-session-token')
  })

  it('returns checkpoint metadata, clears full session, and sets only the pending cookie when step-up is required', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'STEP_UP_REQUIRED',
      pendingStepUpCookie: 'pap-step-up-token=pending; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    })

    const response = await postVerify({
      phone: '0821234567',
      code: '123456',
      traceId: 'trace-provider-step-up',
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      code: 'STEP_UP_REQUIRED',
      traceId: 'trace-provider-step-up',
      redirectTo: '/security/checkpoint',
    })
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('sb-access-token=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('pap-step-up-token=pending')
    expect(setCookie).not.toContain('sb-access-token=provider-session-token')
  })
})

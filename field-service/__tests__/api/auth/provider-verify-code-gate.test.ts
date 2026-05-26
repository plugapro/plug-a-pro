import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn(),
  checkOtpVerifyLimit: vi.fn(),
  recordAuditLog: vi.fn(),
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

  it('preserves the provider error envelope when the gate returns LOCKED', async () => {
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
      traceId: 'trace-provider-locked',
      error: {
        code: 'ACCOUNT_LOCKED',
        traceId: 'trace-provider-locked',
        step: 'Worker portal verify-code',
      },
    })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('returns checkpoint metadata and only the pending cookie when step-up is required', async () => {
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
    expect(response.headers.get('Set-Cookie')).toBe(
      'pap-step-up-token=pending; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    )
  })
})

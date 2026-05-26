import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getSession: vi.fn(),
  issueGate: vi.fn(),
  db: {
    adminUser: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/auth', () => ({ getSession: mocks.getSession }))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/auth-session-gate', () => ({
  issueAuthSessionWithSecurityGate: mocks.issueGate,
}))

const USER = {
  id: 'user_123',
  phone: '27821234567',
  email: null,
}

async function postSession(body: Record<string, unknown>) {
  const { POST } = await import('@/app/api/auth/session/route')
  return POST(
    new NextRequest('http://localhost/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/auth/session security gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: USER },
          error: null,
        }),
      },
    })
    mocks.db.adminUser.findFirst.mockResolvedValue(null)
    mocks.issueGate.mockResolvedValue({
      ok: true,
      setCookie: 'sb-access-token=session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600',
    })
  })

  it('issues the session cookie returned by the shared gate after Supabase verifies the token', async () => {
    const response = await postSession({ accessToken: 'session-token', expiresIn: 7200 })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ userId: USER.id, adminAccess: false, adminRole: null })
    expect(response.headers.get('Set-Cookie')).toBe(
      'sb-access-token=session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=3600',
    )
    expect(mocks.issueGate).toHaveBeenCalledWith({
      accessToken: 'session-token',
      phoneE164: '+27821234567',
      userId: USER.id,
      maxAge: 7200,
      sourceRoute: '/api/auth/session',
    })
  })

  it('returns locked and clears any existing session cookie when the shared gate fails closed', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'LOCKED',
      metadata: { code: 'security_gate_unavailable' },
    })

    const response = await postSession({ accessToken: 'session-token', expiresIn: 7200 })
    const body = await response.json()

    expect(response.status).toBe(423)
    expect(body).toEqual({ locked: true, code: 'security_gate_unavailable' })
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('sb-access-token=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).not.toContain('sb-access-token=session-token')
  })

  it('returns checkpoint redirect metadata, clears full session, and sets only the pending step-up cookie', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'STEP_UP_REQUIRED',
      pendingStepUpCookie: 'pap-step-up-token=pending; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    })

    const response = await postSession({ accessToken: 'session-token', expiresIn: 7200 })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ stepUpRequired: true, redirectTo: '/security/checkpoint' })
    const setCookie = response.headers.get('Set-Cookie') ?? ''
    expect(setCookie).toContain('sb-access-token=')
    expect(setCookie).toContain('Max-Age=0')
    expect(setCookie).toContain('pap-step-up-token=pending')
    expect(setCookie).not.toContain('sb-access-token=session-token')
  })

  it('issues an admin session without the OTP gate when the Supabase user has no phone', async () => {
    mocks.createClient.mockReturnValueOnce({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: 'admin_user_123',
              phone: null,
              email: 'admin@example.com',
            },
          },
          error: null,
        }),
      },
    })
    mocks.db.adminUser.findFirst.mockResolvedValueOnce({
      id: 'admin-row-1',
      userId: 'admin_user_123',
      email: 'admin@example.com',
      role: 'OWNER',
      active: true,
      acceptedAt: new Date('2026-05-26T10:00:00.000Z'),
    })

    const response = await postSession({
      accessToken: 'admin-session-token',
      expiresIn: 7200,
      requireAdmin: true,
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      userId: 'admin_user_123',
      adminAccess: true,
      adminRole: 'owner',
    })
    expect(response.headers.get('Set-Cookie')).toBe(
      'sb-access-token=admin-session-token; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200',
    )
    expect(mocks.issueGate).not.toHaveBeenCalled()
  })
})

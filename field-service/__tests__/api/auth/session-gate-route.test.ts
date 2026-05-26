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

  it('returns locked without any session cookie when the shared gate fails closed', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'LOCKED',
      metadata: { code: 'security_gate_unavailable' },
    })

    const response = await postSession({ accessToken: 'session-token', expiresIn: 7200 })
    const body = await response.json()

    expect(response.status).toBe(423)
    expect(body).toEqual({ locked: true, code: 'security_gate_unavailable' })
    expect(response.headers.get('Set-Cookie')).toBeNull()
  })

  it('returns checkpoint redirect metadata and only the pending step-up cookie', async () => {
    mocks.issueGate.mockResolvedValueOnce({
      ok: false,
      reason: 'STEP_UP_REQUIRED',
      pendingStepUpCookie: 'pap-step-up-token=pending; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    })

    const response = await postSession({ accessToken: 'session-token', expiresIn: 7200 })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ stepUpRequired: true, redirectTo: '/security/checkpoint' })
    expect(response.headers.get('Set-Cookie')).toBe(
      'pap-step-up-token=pending; HttpOnly; SameSite=Lax; Path=/; Max-Age=600',
    )
  })
})

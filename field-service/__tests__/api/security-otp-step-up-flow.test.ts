import { Buffer } from 'node:buffer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { STEP_UP_COOKIE_NAME } from '@/lib/otp-security-crypto'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  recordAuditLog: vi.fn(),
  completeStepUp: vi.fn(),
  cookies: vi.fn(),
  state: {
    pendingCookie: null as string | null,
  },
  db: {
    adminUser: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    accountSecurityState: {
      findUnique: vi.fn(),
    },
    otpChallenge: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/db', () => ({ db: mocks.db }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mocks.recordAuditLog }))
vi.mock('@/lib/otp-security', () => ({ completeStepUp: mocks.completeStepUp }))
vi.mock('next/headers', () => ({ cookies: mocks.cookies }))

const PHONE = '+27821234567'
const USER_ID = 'user_otp_step_up'
const ORIGINAL_ENV = { ...process.env }

function stepUpKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64url')
}

function postSession(accessToken: string) {
  return import('@/app/api/auth/session/route').then(({ POST }) =>
    POST(
      new NextRequest('https://app.plugapro.co.za/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken, expiresIn: 7200 }),
      }),
    ),
  )
}

function pendingStepUpCookieFrom(response: Response): string {
  const setCookie = response.headers.get('Set-Cookie') ?? ''
  const match = setCookie.match(/(?:^|,\s*)pap-step-up-token=([^;]+)/)
  if (!match) throw new Error(`Missing ${STEP_UP_COOKIE_NAME}: ${setCookie}`)
  return match[1]!
}

describe('OTP step-up browser flow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T10:00:00.000Z'))
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      NEXT_PUBLIC_SUPABASE_URL: 'https://supabase.test',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      OTP_HASH_PEPPER: 'step-up-flow-test-pepper',
      STEP_UP_COOKIE_KEY: stepUpKey(7),
    }
    mocks.state.pendingCookie = null
    mocks.createClient.mockReturnValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: {
              id: USER_ID,
              phone: PHONE,
              email: null,
            },
          },
          error: null,
        }),
      },
    })
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === STEP_UP_COOKIE_NAME && mocks.state.pendingCookie
          ? { name, value: mocks.state.pendingCookie }
          : undefined,
      ),
    })
    mocks.completeStepUp.mockResolvedValue({ ok: true })
    mocks.db.adminUser.findFirst.mockResolvedValue(null)
  })

  it('lets an expired-lock re-OTP reach checkpoint and complete ack into a full session', async () => {
    mocks.db.accountSecurityState.findUnique
      .mockResolvedValueOnce({
        lockedUntil: new Date('2026-05-26T10:05:00.000Z'),
        stepUpRequired: true,
      })
      .mockResolvedValueOnce({
        lockedUntil: new Date('2026-05-26T09:59:00.000Z'),
        stepUpRequired: true,
      })

    const locked = await postSession('locked-access-token')
    expect(locked.status).toBe(423)

    const checkpoint = await postSession('step-up-access-token')
    const checkpointBody = await checkpoint.json()

    expect(checkpoint.status).toBe(200)
    expect(checkpointBody).toEqual({
      stepUpRequired: true,
      redirectTo: '/security/checkpoint',
    })
    expect(checkpoint.headers.get('Set-Cookie')).toContain('pap-step-up-token=')
    expect(checkpoint.headers.get('Set-Cookie')).not.toContain('sb-access-token=step-up-access-token')

    const { proxy } = await import('../../proxy')
    const checkpointProxy = await proxy(new NextRequest('https://app.plugapro.co.za/security/checkpoint'))
    const ackProxy = await proxy(new NextRequest('https://app.plugapro.co.za/api/security/otp/step-up/ack'))

    expect(checkpointProxy.status).toBe(200)
    expect(checkpointProxy.headers.get('location')).toBeNull()
    expect(ackProxy.status).toBe(200)
    expect(ackProxy.headers.get('location')).toBeNull()

    mocks.state.pendingCookie = pendingStepUpCookieFrom(checkpoint)
    const { POST: postAck } = await import('@/app/api/security/otp/step-up/ack/route')
    const ack = await postAck()
    const ackBody = await ack.json()

    expect(ack.status).toBe(200)
    expect(ackBody).toEqual({ ok: true })
    expect(mocks.completeStepUp).toHaveBeenCalledWith(PHONE, USER_ID)
    expect(ack.headers.get('Set-Cookie')).toContain('sb-access-token=step-up-access-token')
    expect(ack.headers.get('Set-Cookie')).toContain('pap-step-up-token=;')
  })
})

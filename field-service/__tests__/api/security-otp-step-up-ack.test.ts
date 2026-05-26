import { Buffer } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encryptPendingStepUpCookie, type PendingStepUpPayload } from '@/lib/otp-security-crypto'

const mocks = vi.hoisted(() => ({
  state: {
    pendingCookie: null as string | null,
  },
  cookies: vi.fn(),
  completeStepUp: vi.fn(),
}))

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}))

vi.mock('@/lib/otp-security', () => ({
  completeStepUp: mocks.completeStepUp,
}))

const PHONE = '+27821234567'
const USER_ID = 'user_123'
const ORIGINAL_ENV = { ...process.env }

function stepUpKey(fill: number): string {
  return Buffer.alloc(32, fill).toString('base64url')
}

function payload(overrides: Partial<PendingStepUpPayload> = {}): PendingStepUpPayload {
  return {
    accessToken: 'supabase-access-token',
    userId: USER_ID,
    phoneE164: PHONE,
    maxAge: 7200,
    sourceRoute: '/api/auth/session',
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    ...overrides,
  }
}

async function postAck() {
  const { POST } = await import('@/app/api/security/otp/step-up/ack/route')
  return POST()
}

function setPendingCookie(token: string | null) {
  mocks.state.pendingCookie = token
}

function setCookieHeader(response: Response): string {
  return response.headers.get('Set-Cookie') ?? ''
}

describe('POST /api/security/otp/step-up/ack', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-26T10:00:00.000Z'))
    vi.clearAllMocks()
    process.env = {
      ...ORIGINAL_ENV,
      NODE_ENV: 'test',
      OTP_HASH_PEPPER: 'step-up-ack-test-pepper',
      STEP_UP_COOKIE_KEY: stepUpKey(9),
    }
    mocks.completeStepUp.mockResolvedValue(undefined)
    mocks.cookies.mockResolvedValue({
      get: vi.fn((name: string) =>
        name === 'pap-step-up-token' && mocks.state.pendingCookie
          ? { name, value: mocks.state.pendingCookie }
          : undefined,
      ),
    })
    setPendingCookie(null)
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...ORIGINAL_ENV }
  })

  it.each([
    ['missing cookie', null],
    ['invalid cookie', 'not-a-valid-token'],
    [
      'expired cookie',
      () =>
        encryptPendingStepUpCookie(
          payload({ expiresAt: new Date(Date.now() - 1000).toISOString() }),
        ),
    ],
  ])('rejects %s generically and clears the pending cookie', async (_name, token) => {
    setPendingCookie(typeof token === 'function' ? token() : token)

    const response = await postAck()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ ok: false, restartSignIn: true })
    expect(setCookieHeader(response)).toContain('pap-step-up-token=;')
    expect(setCookieHeader(response)).toContain('Max-Age=0')
    expect(mocks.completeStepUp).not.toHaveBeenCalled()
  })

  it('completes step-up, issues sb-access-token, and clears pap-step-up-token', async () => {
    setPendingCookie(encryptPendingStepUpCookie(payload()))

    const response = await postAck()
    const body = await response.json()
    const setCookie = setCookieHeader(response)

    expect(response.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(JSON.stringify(body)).not.toContain('supabase-access-token')
    expect(mocks.completeStepUp).toHaveBeenCalledWith(PHONE, USER_ID)
    expect(setCookie).toContain('sb-access-token=supabase-access-token')
    expect(setCookie).toContain('Max-Age=7200')
    expect(setCookie).toContain('pap-step-up-token=;')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('replay after ack follows the cleared-cookie response path without durable replay state', async () => {
    setPendingCookie(encryptPendingStepUpCookie(payload()))
    const first = await postAck()
    expect(first.status).toBe(200)
    expect(setCookieHeader(first)).toContain('pap-step-up-token=;')

    setPendingCookie(null)
    const replay = await postAck()
    const body = await replay.json()

    expect(replay.status).toBe(401)
    expect(body).toEqual({ ok: false, restartSignIn: true })
    expect(setCookieHeader(replay)).toContain('pap-step-up-token=;')
    expect(mocks.completeStepUp).toHaveBeenCalledTimes(1)
  })
})

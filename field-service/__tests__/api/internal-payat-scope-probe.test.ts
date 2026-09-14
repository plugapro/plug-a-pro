import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()

function probeRequest(params: Record<string, string> = {}, authHeader: string | null = 'Bearer cron-secret') {
  const url = new URL('http://localhost/api/internal/payat-scope-probe')
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const { NextRequest } = require('next/server') as typeof import('next/server')
  return new NextRequest(url, { headers: authHeader ? { authorization: authHeader } : {} })
}

function tokenResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function run(params: Record<string, string> = {}, authHeader: string | null = 'Bearer cron-secret') {
  const { GET } = await import('@/app/api/internal/payat-scope-probe/route')
  return GET(probeRequest(params, authHeader))
}

describe('GET /api/internal/payat-scope-probe', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', mockFetch)
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    vi.stubEnv('PAYAT_TOKEN_URL', 'https://go.payat.co.za/yapi/oauth/token')
    vi.stubEnv('PAYAT_CLIENT_ID', 'client-id')
    vi.stubEnv('PAYAT_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/yapi')
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'merchant-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('rejects a request without the cron secret', async () => {
    const response = await run({}, null)
    expect(response.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('requests rtp:read alongside the create scope by default, out of band', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse({ access_token: 'opaque', expires_in: 300, scope: 'rtp:create:single rtp:read' }))

    const body = await (await run()).json()

    const [, init] = mockFetch.mock.calls[0]!
    const sent = new URLSearchParams(init.body as string)
    expect(sent.get('grant_type')).toBe('client_credentials')
    expect(sent.get('scope')).toBe('rtp:create:single rtp:read')
    expect(body.token).toMatchObject({ ok: true, httpStatus: 200, grantedScope: 'rtp:create:single rtp:read' })
  })

  it('never returns the access token itself', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse({ access_token: 'super-secret-token', expires_in: 300, scope: 'rtp:read' }))

    const text = JSON.stringify(await (await run()).json())

    expect(text).not.toContain('super-secret-token')
  })

  it('falls back to the JWT scope claim when the response body omits scope', async () => {
    const payload = Buffer.from(JSON.stringify({ scope: 'rtp:read', sub: 'client-id' })).toString('base64url')
    mockFetch.mockResolvedValueOnce(tokenResponse({ access_token: `h.${payload}.sig`, expires_in: 300 }))

    const body = await (await run()).json()

    expect(body.token.grantedScope).toBe('rtp:read')
    expect(JSON.stringify(body)).not.toContain(payload)
  })

  it('surfaces an invalid_scope rejection verbatim', async () => {
    mockFetch.mockResolvedValueOnce(tokenResponse({ error: 'invalid_scope', error_description: 'rtp:read not granted' }, 400))

    const body = await (await run()).json()

    expect(body.token.ok).toBe(false)
    expect(body.token.httpStatus).toBe(400)
    expect(body.token.error).toContain('invalid_scope')
  })

  it('reads an RTP with the probe token and returns lifecycle fields without customer PII', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse({ access_token: 'probe-token', expires_in: 300, scope: 'rtp:read' }))
      .mockResolvedValueOnce(tokenResponse({
        accountState: 'PAYMENT_COMPLETED',
        amount: 10000,
        amountPaid: 10000,
        clientReferenceNumber: 'intent-abc123',
        dateTimePaid: '2026-08-01T10:00:00Z',
        dateTimeExpire: '2026-08-04T10:00:00Z',
        customerNameSurname: 'Moses Ntshalintshali',
        customerMobileNumber: '+27700000000',
        customerEmail: 'someone@example.com',
        paymentLink: 'https://payat.example/pay/xyz',
      }))

    const body = await (await run({ account: '83103429129986' })).json()

    const [readUrl, readInit] = mockFetch.mock.calls[1]!
    expect(String(readUrl)).toBe('https://go.payat.co.za/yapi/integrator/rtp/read/merchant-1/83103429129986')
    expect((readInit.headers as Record<string, string>).Authorization).toBe('Bearer probe-token')

    expect(body.read).toMatchObject({
      ok: true,
      accountState: 'PAYMENT_COMPLETED',
      amount: 10000,
      amountPaid: 10000,
      clientReferenceNumber: 'intent-abc123',
    })
    const text = JSON.stringify(body)
    expect(text).not.toContain('Moses')
    expect(text).not.toContain('+27700000000')
    expect(text).not.toContain('example.com')
    expect(text).not.toContain('payat.example')
    expect(text).not.toContain('83103429129986') // account is masked in the echo
  })

  it('returns only the HTTP status when the read is refused or missing', async () => {
    mockFetch
      .mockResolvedValueOnce(tokenResponse({ access_token: 'probe-token', expires_in: 300 }))
      .mockResolvedValueOnce(new Response('{"error":"forbidden","detail":"maybe sensitive"}', { status: 403 }))

    const body = await (await run({ account: '83103429129986' })).json()

    expect(body.read).toEqual({ ok: false, httpStatus: 403 })
    expect(JSON.stringify(body)).not.toContain('maybe sensitive')
  })

  it('rejects a malformed account before any Pay@ call is made', async () => {
    const response = await run({ account: 'not-a-number' })
    expect(response.status).toBe(400)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

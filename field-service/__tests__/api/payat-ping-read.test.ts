import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRequireAdminApi, mockReadPayatSingleRtp } = vi.hoisted(() => ({
  mockRequireAdminApi: vi.fn(),
  mockReadPayatSingleRtp: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAdminApi: mockRequireAdminApi }))
vi.mock('@/lib/payat/read', () => ({ readPayatSingleRtp: mockReadPayatSingleRtp }))

function pingRequest(query: string) {
  return new NextRequest(`http://localhost/api/debug/payat-ping${query}`, {
    headers: { 'x-payat-diag-key': 'diag-key' },
  })
}

describe('GET /api/debug/payat-ping?read=… (rtp/read shape check)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_DIAG_KEY', 'diag-key')
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'merchant-abc')
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/yapi/v1')
    mockRequireAdminApi.mockResolvedValue(null)
  })

  it('returns the parsed read fields and the raw accountState string', async () => {
    mockReadPayatSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      accountState: 'PAYMENT_COMPLETED',
      internalStatus: 'PAID',
      amountCents: 10_700,
      amountPaidCents: 10_700,
      paidAt: new Date('2026-07-17T14:38:00Z'),
      expiresAt: new Date('2026-07-18T12:29:00Z'),
    })

    const { GET } = await import('@/app/api/debug/payat-ping/route')
    const res = await GET(pingRequest('?read=12345678901234'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockReadPayatSingleRtp).toHaveBeenCalledWith('12345678901234')
    expect(body.read).toMatchObject({
      ok: true,
      accountState: 'PAYMENT_COMPLETED',
      internalStatus: 'PAID',
      amountCents: 10_700,
      amountPaidCents: 10_700,
    })
    // Diagnostic only: no raw body, no merchant identifier, no PII.
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain('merchant-abc')
    expect(body.read).not.toHaveProperty('raw')
    expect(body.read).not.toHaveProperty('body')
    // The supplied lookup key is echoed masked, never in full.
    expect(body.read.clientAccountNumber).not.toBe('12345678901234')
  })

  it('reports a failed read by error name and status only, never the message', async () => {
    const { PayatApiError } = await import('@/lib/payat/payment')
    mockReadPayatSingleRtp.mockRejectedValue(
      new PayatApiError('rtp_read_failed', 403, 'insufficient_scope for merchant-abc'),
    )

    const { GET } = await import('@/app/api/debug/payat-ping/route')
    const res = await GET(pingRequest('?read=12345678901234'))
    const body = await res.json()

    expect(body.read).toMatchObject({ ok: false, errorName: 'PayatApiError', httpStatus: 403 })
    expect(JSON.stringify(body)).not.toContain('insufficient_scope')
  })

  it('does not create an RTP when the read branch is used', async () => {
    mockReadPayatSingleRtp.mockResolvedValue({
      clientAccountNumber: '12345678901234',
      accountState: 'PAYMENT_OUTSTANDING',
      internalStatus: 'SENT',
      amountCents: 10_000,
      amountPaidCents: 0,
      paidAt: null,
      expiresAt: null,
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { GET } = await import('@/app/api/debug/payat-ping/route')
    await GET(pingRequest('?read=12345678901234'))

    // The read branch short-circuits before the token + rtp/create diagnostic.
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still requires the admin gate', async () => {
    const { NextResponse } = await import('next/server')
    mockRequireAdminApi.mockResolvedValue(NextResponse.json({ error: 'unauthorized' }, { status: 401 }))

    const { GET } = await import('@/app/api/debug/payat-ping/route')
    const res = await GET(pingRequest('?read=12345678901234'))

    expect(res.status).toBe(401)
    expect(mockReadPayatSingleRtp).not.toHaveBeenCalled()
  })
})

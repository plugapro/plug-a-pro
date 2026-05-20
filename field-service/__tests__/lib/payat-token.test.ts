import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('Pay@ token service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_CLIENT_ID', 'client-id')
    vi.stubEnv('PAYAT_CLIENT_SECRET', 'client-secret')
    vi.stubEnv('PAYAT_TOKEN_URL', 'https://go.payat.co.za/oauth/token')
  })

  it('fetches and caches an OAuth token until the buffered expiry', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
    })
    vi.stubGlobal('fetch', fetchMock)
    vi.setSystemTime(new Date('2026-05-12T10:00:00.000Z'))

    const { getPayatToken } = await import('@/lib/payat/token')

    await expect(getPayatToken()).resolves.toBe('token-1')
    await expect(getPayatToken()).resolves.toBe('token-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://go.payat.co.za/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    )
    expect(fetchMock.mock.calls[0][1].body.toString()).toBe(
      'grant_type=client_credentials&client_id=client-id&client_secret=client-secret',
    )
  })

  it('fetches a fresh token after invalidation', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-1', expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'token-2', expires_in: 3600 }),
      })
    vi.stubGlobal('fetch', fetchMock)

    const { getPayatToken, invalidatePayatToken } = await import('@/lib/payat/token')

    await expect(getPayatToken()).resolves.toBe('token-1')
    invalidatePayatToken()
    await expect(getPayatToken()).resolves.toBe('token-2')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails fast when OAuth credentials are missing', async () => {
    vi.stubEnv('PAYAT_CLIENT_SECRET', '')

    const { getPayatToken } = await import('@/lib/payat/token')

    await expect(getPayatToken()).rejects.toThrow(
      'PAYAT_CLIENT_SECRET must be set',
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('throws PayatTokenError(fetch_failed) when fetch throws before an HTTP response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network down')))
    const { getPayatToken } = await import('@/lib/payat/token')

    await expect(getPayatToken()).rejects.toMatchObject({
      name: 'PayatTokenError',
      stage: 'fetch_failed',
      status: undefined,
    })
  })

  it('throws PayatTokenError(invalid_response) when token JSON is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError('Unexpected token')
      },
    }))
    const { getPayatToken } = await import('@/lib/payat/token')

    await expect(getPayatToken()).rejects.toMatchObject({
      name: 'PayatTokenError',
      stage: 'invalid_response',
    })
  })
})

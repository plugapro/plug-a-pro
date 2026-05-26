import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveToken, mockDecryptIdentifier, mockDb } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockDecryptIdentifier: vi.fn(),
  mockDb: {
    providerSensitiveDataAccessLog: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../../lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))
vi.mock('../../lib/identity-verification/crypto', () => ({
  decryptIdentifier: mockDecryptIdentifier,
}))
vi.mock('../../lib/db', () => ({ db: mockDb }))

describe('provider liveness redirect route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      livenessSessionUrlEncrypted: 'encrypted-url',
      livenessSessionExpiresAt: new Date(Date.now() + 60_000),
    })
    mockDecryptIdentifier.mockReturnValue('https://vendor.example/session/123?token=secret')
    mockDb.providerSensitiveDataAccessLog.create.mockResolvedValue({ id: 'log-1' })
  })

  it('redirects to the decrypted vendor session with no-referrer and no-store headers', async () => {
    const { GET } = await import('../../app/provider/verify/[token]/liveness/route')

    const response = await GET(new Request('http://localhost/provider/verify/token/liveness'), {
      params: Promise.resolve({ token: 'token' }),
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('https://vendor.example/session/123?token=secret')
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer')
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mockDb.providerSensitiveDataAccessLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        verificationId: 'ver-1',
        actorId: 'provider-1',
        actorRole: 'provider',
        accessType: 'SIGNED_URL_ISSUED',
      }),
    })
  })

  it('redirects expired vendor sessions to the expired page without decrypting', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      providerId: 'provider-1',
      livenessSessionUrlEncrypted: 'encrypted-url',
      livenessSessionExpiresAt: new Date(Date.now() - 60_000),
    })
    const { GET } = await import('../../app/provider/verify/[token]/liveness/route')

    const response = await GET(new Request('http://localhost/provider/verify/token/liveness'), {
      params: Promise.resolve({ token: 'token' }),
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/provider/verify/token/liveness/expired')
    expect(mockDecryptIdentifier).not.toHaveBeenCalled()
    expect(mockDb.providerSensitiveDataAccessLog.create).not.toHaveBeenCalled()
  })
})

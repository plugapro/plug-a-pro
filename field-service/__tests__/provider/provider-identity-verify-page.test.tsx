import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockResolveToken, mockDb } = vi.hoisted(() => ({
  mockResolveToken: vi.fn(),
  mockDb: {
    providerIdentityDocument: {
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/provider-verification-token', () => ({
  resolveProviderVerificationToken: mockResolveToken,
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

describe('/provider/verify/[token] page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.providerIdentityDocument.findMany.mockResolvedValue([])
  })

  it('renders the expired-link page instead of crashing when token lookup fails', async () => {
    mockResolveToken.mockRejectedValue(new Error('database lookup unavailable'))
    const Page = (await import('@/app/provider/verify/[token]/page')).default

    const html = renderToStaticMarkup(
      await Page({ params: Promise.resolve({ token: 'bad-token' }) }),
    )

    expect(html).toContain('Verification link unavailable')
    expect(mockDb.providerIdentityDocument.findMany).not.toHaveBeenCalled()
  })

  it('renders upload feedback from query params on the verification page', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      status: 'AWAITING_DOCUMENT',
      identityBasis: 'SA_ID',
    })
    const Page = (await import('@/app/provider/verify/[token]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ token: 'token-1' }),
        searchParams: Promise.resolve({ upload_error: 'Could not store this file.' }),
      }),
    )

    expect(html).toContain('Could not store this file.')
  })

  it('renders missing-file feedback instead of relying on a server-action error page', async () => {
    mockResolveToken.mockResolvedValue({
      id: 'ver-1',
      status: 'AWAITING_SELFIE',
      identityBasis: 'SA_ID',
    })
    const Page = (await import('@/app/provider/verify/[token]/page')).default

    const html = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ token: 'token-1' }),
        searchParams: Promise.resolve({ missing: 'selfie' }),
      }),
    )

    expect(html).toContain('Please upload your selfie photo before continuing.')
  })
})

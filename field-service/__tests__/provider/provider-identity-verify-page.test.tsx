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
})

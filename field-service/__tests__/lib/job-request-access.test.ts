import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

describe('job request access tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.plugapro.co.za'
  })

  it('reuses an active token when it is still valid', async () => {
    const { db } = await import('@/lib/db')
    const expiresAt = new Date('2030-01-01T00:00:00Z')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      customerAccessToken: 'existing-token',
      customerAccessTokenExpiresAt: expiresAt,
      customerAccessTokenRevokedAt: null,
    })

    const { ensureJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await ensureJobRequestAccessToken('jr_1')

    expect(result).toEqual({ token: 'existing-token', expiresAt })
    expect(db.jobRequest.update).not.toHaveBeenCalled()
  })

  it('rotates a token when it is expired and builds a direct ticket URL', async () => {
    const { db } = await import('@/lib/db')
    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      customerAccessToken: 'expired-token',
      customerAccessTokenExpiresAt: new Date('2020-01-01T00:00:00Z'),
      customerAccessTokenRevokedAt: null,
    })
    ;(db.jobRequest.update as any).mockResolvedValue({})

    const { getJobRequestAccessUrl } = await import('@/lib/job-request-access')
    const url = await getJobRequestAccessUrl('jr_2')

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/requests\/access\//)
    expect(db.jobRequest.update).toHaveBeenCalledOnce()
  })
})

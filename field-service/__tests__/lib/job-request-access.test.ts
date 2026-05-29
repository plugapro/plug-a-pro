import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
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
    expect(db.jobRequest.updateMany).not.toHaveBeenCalled()
  })

  it('rotates a token when it is expired and builds a direct ticket URL', async () => {
    const { db } = await import('@/lib/db')
    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      customerAccessToken: 'expired-token',
      customerAccessTokenExpiresAt: new Date('2020-01-01T00:00:00Z'),
      customerAccessTokenRevokedAt: null,
    })
    ;(db.jobRequest.updateMany as any).mockResolvedValue({ count: 1 })

    const { getJobRequestAccessUrl } = await import('@/lib/job-request-access')
    const url = await getJobRequestAccessUrl('jr_2')

    expect(url).toMatch(/^https:\/\/app\.plugapro\.co\.za\/requests\/access\//)
    expect(db.jobRequest.updateMany).toHaveBeenCalledOnce()
  })

  it('adds handoff view to ticket URLs without changing the token path', async () => {
    const { db } = await import('@/lib/db')
    const expiresAt = new Date('2030-01-01T00:00:00Z')

    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      customerAccessToken: 'existing-token',
      customerAccessTokenExpiresAt: expiresAt,
      customerAccessTokenRevokedAt: null,
    })

    const { getJobRequestAccessUrl } = await import('@/lib/job-request-access')
    const url = await getJobRequestAccessUrl('jr_1', 'shortlist')

    expect(url).toBe('https://app.plugapro.co.za/requests/access/existing-token?view=shortlist')
  })
})

// ─── G1 regression: safeForPreview enforcement ────────────────────────────────
// The token-page attachment query MUST filter on safeForPreview: true so that
// attachments flagged as not safe for preview are never included in the customer
// access token page response (pre-acceptance context).
describe('resolveJobRequestAccessToken - safeForPreview enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('requests only safeForPreview=true attachments in the token query', async () => {
    const { db } = await import('@/lib/db')

    ;(db.jobRequest.findUnique as any).mockResolvedValue(null)

    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    await resolveJobRequestAccessToken('some-token')

    expect(db.jobRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { customerAccessToken: 'some-token' },
        select: expect.objectContaining({
          assignmentMode: true,
          latestDispatchDecisionId: true,
          attachments: expect.objectContaining({
            where: expect.objectContaining({
              safeForPreview: true,
            }),
          }),
        }),
      }),
    )
  })

  it('returns active status and includes only safeForPreview attachments', async () => {
    const { db } = await import('@/lib/db')
    const expiresAt = new Date('2030-01-01T00:00:00Z')

    const safeAttachment = { id: 'att-safe', label: 'customer_photo', safeForPreview: true, caption: null, createdAt: new Date() }
    // The unsafe attachment should never appear because the DB query filters it out
    ;(db.jobRequest.findUnique as any).mockResolvedValue({
      id: 'jr-1',
      customerAccessToken: 'valid-token',
      customerAccessTokenExpiresAt: expiresAt,
      customerAccessTokenRevokedAt: null,
      customer: { id: 'cust-1', userId: 'user-1', name: 'Alice', phone: '+27820000001' },
      address: null,
      attachments: [safeAttachment],
      leads: [],
      match: null,
    })

    const { resolveJobRequestAccessToken } = await import('@/lib/job-request-access')
    const result = await resolveJobRequestAccessToken('valid-token')

    expect(result.status).toBe('active')
    expect(result.jobRequest?.attachments).toEqual([safeAttachment])
    // The unsafe one is absent because the query never returns it
    expect(result.jobRequest?.attachments.some((a: any) => a.safeForPreview === false)).toBe(false)
  })
})

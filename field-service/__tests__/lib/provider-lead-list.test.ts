import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    provider: { findUnique: vi.fn() },
    lead: { findMany: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({
  db: mockDb,
}))

describe('provider lead list', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.provider.findUnique.mockResolvedValue({ isTestUser: false })
  })

  it('fetches only preview-safe address fields and truncates descriptions before rendering', async () => {
    const sensitiveTail = 'Gate code 1234. Unit 7. Customer phone +27821234567.'
    mockDb.lead.findMany.mockResolvedValue([
      {
        id: 'lead-1',
        status: 'SENT',
        sentAt: new Date('2026-04-29T10:00:00.000Z'),
        expiresAt: new Date('2026-04-29T11:00:00.000Z'),
        jobRequest: {
          category: 'Plumbing',
          description: `${'Preview sentence. '.repeat(14)}${sensitiveTail}`,
          address: { suburb: 'Sandton', city: 'Johannesburg' },
        },
      },
    ])

    const { getProviderLeadListForProvider } = await import('../../lib/provider-lead-list')
    const result = await getProviderLeadListForProvider('provider-1')

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        providerId: 'provider-1',
        isTestLead: false,
      }),
      select: expect.objectContaining({
        jobRequest: {
          select: expect.objectContaining({
            address: {
              select: {
                suburb: true,
                city: true,
              },
            },
          }),
        },
      }),
    }))
    expect(result[0]).toMatchObject({
      category: 'Plumbing',
      area: 'Sandton, Johannesburg',
    })
    expect(result[0].shortDescription?.length).toBeLessThanOrEqual(183)
    expect(result[0].shortDescription).toContain('...')
    expect(JSON.stringify(result)).not.toContain(sensitiveTail)
    expect(JSON.stringify(result)).not.toContain('+27821234567')
  })

  it('shows only test leads to internal test providers', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ isTestUser: true })
    mockDb.lead.findMany.mockResolvedValue([])

    const { getProviderLeadListForProvider } = await import('../../lib/provider-lead-list')
    await getProviderLeadListForProvider('provider-test')

    expect(mockDb.lead.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        providerId: 'provider-test',
        isTestLead: true,
      }),
    }))
  })
})

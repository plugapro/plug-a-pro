import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequireProviderApi, mockPromptCustomersForNewProviderAvailability, mockDb } = vi.hoisted(() => ({
  mockRequireProviderApi: vi.fn(),
  mockPromptCustomersForNewProviderAvailability: vi.fn(),
  mockDb: {
    provider: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    providerLiveStatus: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}))

vi.mock('@/lib/auth', () => ({
  providerAuthWhere: (session: { id: string; phone: string | null }) => ({
    OR: [
      { userId: session.id },
      ...(session.phone ? [{ phone: session.phone, userId: null }] : []),
    ],
  }),
  requireProviderApi: mockRequireProviderApi,
}))

vi.mock('@/lib/db', () => ({
  db: mockDb,
}))

vi.mock('@/lib/matching/customer-recontact', () => ({
  promptCustomersForNewProviderAvailability: mockPromptCustomersForNewProviderAvailability,
}))

describe('POST /api/provider/heartbeat authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireProviderApi.mockResolvedValue({
      id: 'auth-user-1',
      role: 'provider',
      providerId: 'forged-provider-id',
      phone: '+27820000000',
    })
    mockDb.provider.findFirst.mockResolvedValue({ id: 'own-provider-id' })
    mockDb.providerLiveStatus.findUnique.mockResolvedValue(null)
    mockDb.providerLiveStatus.upsert.mockResolvedValue({})
    mockDb.provider.update.mockResolvedValue({})
    mockPromptCustomersForNewProviderAvailability.mockResolvedValue(undefined)
  })

  it('updates the provider resolved by authenticated userId, not metadata providerId', async () => {
    const { POST } = await import('@/app/api/provider/heartbeat/route')

    const res = await POST(new Request('http://localhost/api/provider/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ availabilityMode: 'ONLINE', lat: -26.1, lng: 28.1 }),
    }))

    expect(res.status).toBe(204)
    expect(mockDb.provider.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { userId: 'auth-user-1' },
          { phone: '+27820000000', userId: null },
        ],
      },
      select: { id: true },
    })
    expect(mockDb.provider.findFirst).not.toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'forged-provider-id' }),
      }),
    )
    expect(mockDb.providerLiveStatus.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerId: 'own-provider-id' },
        create: expect.objectContaining({ providerId: 'own-provider-id' }),
      }),
    )
    expect(mockDb.provider.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'own-provider-id' },
      }),
    )
    expect(mockPromptCustomersForNewProviderAvailability).toHaveBeenCalledWith('own-provider-id')
  })

  it('rejects the heartbeat when the authenticated user has no provider row', async () => {
    mockDb.provider.findFirst.mockResolvedValue(null)

    const { POST } = await import('@/app/api/provider/heartbeat/route')
    const res = await POST(new Request('http://localhost/api/provider/heartbeat', {
      method: 'POST',
      body: JSON.stringify({ availabilityMode: 'ONLINE' }),
    }))

    expect(res.status).toBe(401)
    expect(mockDb.providerLiveStatus.upsert).not.toHaveBeenCalled()
  })
})

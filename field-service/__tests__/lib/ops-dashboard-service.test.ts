import { describe, expect, it, vi } from 'vitest'

import { getOpsDashboardSnapshot } from '@/lib/ops-dashboard/service'

function emptyModel() {
  return {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
  }
}

function makeDashboardClient() {
  const manualVerificationRows = [
    {
      id: 'ver_manual_1',
      status: 'NEEDS_MANUAL_REVIEW',
      channel: 'PWA',
      assuranceLevel: 'HIGH',
      identityBasis: 'SA_ID',
      createdAt: new Date('2026-06-01T08:00:00.000Z'),
      updatedAt: new Date('2026-06-01T08:15:00.000Z'),
      provider: { id: 'prov_1', name: 'Thabo Electric', phone: '+27820000001', kycStatus: 'SUBMITTED' },
      providerApplication: null,
      _count: { documents: 2 },
    },
    {
      id: 'ver_manual_2',
      status: 'NEEDS_MANUAL_REVIEW',
      channel: 'WHATSAPP',
      assuranceLevel: 'LOW',
      identityBasis: 'PASSPORT',
      createdAt: new Date('2026-06-01T09:00:00.000Z'),
      updatedAt: new Date('2026-06-01T09:10:00.000Z'),
      provider: null,
      providerApplication: { id: 'app_1', name: 'Naledi Plumbing', phone: '+27820000002', status: 'PENDING' },
      _count: { documents: 1 },
    },
  ]

  return {
    jobRequest: emptyModel(),
    job: emptyModel(),
    payment: {
      ...emptyModel(),
      aggregate: vi.fn(async () => ({ _sum: { amount: 0 } })),
    },
    dispute: emptyModel(),
    quote: emptyModel(),
    match: emptyModel(),
    booking: emptyModel(),
    providerApplication: emptyModel(),
    providerIdentityVerification: {
      count: vi.fn(async () => manualVerificationRows.length),
      findMany: vi.fn(async () => manualVerificationRows),
    },
    opsQueueAssignment: {
      findMany: vi.fn(async () => []),
    },
    $queryRaw: vi.fn(async () => []),
  }
}

describe('ops dashboard service', () => {
  it('surfaces identity verifications that need manual review as an operator queue', async () => {
    const client = makeDashboardClient()

    const snapshot = await getOpsDashboardSnapshot({
      client: client as never,
      actorId: 'admin_1',
      searchParams: new URLSearchParams('range=today'),
    })

    const cards = snapshot.queues.data?.cards ?? []
    const identityCard = cards.find((card) => card.key === 'identityVerification')
    const previews = snapshot.queues.data?.previews as Record<string, unknown[]> | undefined

    expect(snapshot.queues.ok).toBe(true)
    expect(identityCard).toMatchObject({
      title: 'Identity verifications',
      href: '/admin/verifications?status=NEEDS_MANUAL_REVIEW',
      health: {
        openCount: 2,
        unclaimedCount: 2,
      },
    })
    expect(previews?.identityVerification).toHaveLength(2)
    expect(client.providerIdentityVerification.count).toHaveBeenCalledWith({
      where: { status: 'NEEDS_MANUAL_REVIEW' },
    })
  })
})

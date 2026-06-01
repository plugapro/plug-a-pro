import { describe, expect, it, vi } from 'vitest'

import { getOpsDashboardSnapshot } from '@/lib/ops-dashboard/service'

function emptyModel() {
  return {
    count: vi.fn(async () => 0),
    findMany: vi.fn(async () => []),
  }
}

function makeManualVerificationRow(index: number) {
  const createdHour = String(8 + index).padStart(2, '0')
  const updatedMinute = String(10 + index).padStart(2, '0')

  return {
    id: `ver_manual_${index}`,
    status: 'NEEDS_MANUAL_REVIEW',
    channel: index % 2 === 0 ? 'WHATSAPP' : 'PWA',
    assuranceLevel: index % 2 === 0 ? 'LOW' : 'HIGH',
    identityBasis: index % 2 === 0 ? 'PASSPORT' : 'SA_ID',
    createdAt: new Date(`2026-06-01T${createdHour}:00:00.000Z`),
    updatedAt: new Date(`2026-06-01T09:${updatedMinute}:00.000Z`),
    provider:
      index % 2 === 0
        ? null
        : { id: `prov_${index}`, name: 'Thabo Electric', phone: '+27820000001', kycStatus: 'SUBMITTED' },
    providerApplication:
      index % 2 === 0
        ? { id: `app_${index}`, name: 'Naledi Plumbing', phone: '+27820000002', status: 'PENDING' }
        : null,
    _count: { documents: index % 2 === 0 ? 1 : 2 },
  }
}

function makeDashboardClient(options: { manualVerificationRows?: ReturnType<typeof makeManualVerificationRow>[] } = {}) {
  const manualVerificationRows = options.manualVerificationRows ?? [
    makeManualVerificationRow(1),
    makeManualVerificationRow(2),
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
      findMany: vi.fn(async (args?: { take?: number }) => (
        typeof args?.take === 'number'
          ? manualVerificationRows.slice(0, args.take)
          : manualVerificationRows.map((row) => ({ id: row.id, updatedAt: row.updatedAt }))
      )),
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

  it('computes identity verification health from the whole queue instead of the preview limit', async () => {
    const manualVerificationRows = Array.from({ length: 8 }, (_, index) => makeManualVerificationRow(index + 1))
    const client = makeDashboardClient({ manualVerificationRows })

    const snapshot = await getOpsDashboardSnapshot({
      client: client as never,
      actorId: 'admin_1',
      searchParams: new URLSearchParams('range=today'),
    })

    const cards = snapshot.queues.data?.cards ?? []
    const identityCard = cards.find((card) => card.key === 'identityVerification')
    const previews = snapshot.queues.data?.previews as Record<string, unknown[]> | undefined

    expect(identityCard?.health).toMatchObject({
      openCount: 8,
      unclaimedCount: 8,
    })
    expect(previews?.identityVerification).toHaveLength(6)
  })
})

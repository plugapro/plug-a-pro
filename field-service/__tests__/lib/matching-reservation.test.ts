import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reserveBestProviderAtomically, releaseProviderCapacity } from '../../lib/matching/reservation'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    assignmentHold: { findFirst: vi.fn(), create: vi.fn() },
    matchAttempt: { create: vi.fn() },
    dispatchDecision: { create: vi.fn() },
    jobRequest: { findUnique: vi.fn(), update: vi.fn() },
    providerCapacity: { findUnique: vi.fn(), upsert: vi.fn(), updateMany: vi.fn() },
  },
}))

vi.mock('../../lib/db', () => ({ db: mockDb }))

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeCandidate(id = 'provider-1') {
  return {
    id,
    name: 'Alice',
    phone: '+27821234567',
    skills: ['electrical'],
    serviceAreas: ['sandton'],
    maxTravelMinutes: 60,
    reliabilityScore: 0.9,
    averageRating: 4.5,
    active: true,
    verified: true,
    availableNow: true,
    lastKnownLat: -26.1,
    lastKnownLng: 28.05,
    isOnline: true,
    liveLocationLat: null,
    liveLocationLng: null,
    lastHeartbeatAt: new Date(),
    scoreBase: 0.8,
    fromPool: true,
  }
}

function makeJobRequest() {
  return {
    id: 'job-1',
    status: 'OPEN',
    category: 'electrical',
    assignmentMode: 'AUTO_ASSIGN',
    address: { suburb: 'Sandton', regionKey: 'gauteng', provinceKey: 'GP' },
  }
}

// Simulates the transaction callback pattern used by the reservation module
function setupTransactionSuccess(overrides: {
  locked?: { id: string }[]
  existingHold?: { id: string } | null
  capacity?: { activeHolds: number; maxConcurrent: number } | null
  jobStatus?: string
} = {}) {
  const locked = overrides.locked ?? [{ id: 'provider-1' }]
  const existingHold = overrides.existingHold ?? null
  const capacity = overrides.capacity ?? null
  const jobStatus = overrides.jobStatus ?? 'OPEN'

  const txMock = {
    $queryRaw: vi.fn().mockResolvedValue(locked),
    assignmentHold: {
      findFirst: vi.fn().mockResolvedValue(existingHold),
      create: vi.fn().mockResolvedValue({
        id: 'hold-1',
        jobRequestId: 'job-1',
        providerId: 'provider-1',
        status: 'ACTIVE',
        offeredAt: new Date(),
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    },
    matchAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt-1' }) },
    dispatchDecision: { create: vi.fn().mockResolvedValue({ id: 'decision-1' }) },
    jobRequest: {
      findUnique: vi.fn().mockResolvedValue({ status: jobStatus }),
      update: vi.fn().mockResolvedValue({}),
    },
    providerCapacity: {
      findUnique: vi.fn().mockResolvedValue(capacity),
      upsert: vi.fn().mockResolvedValue({}),
    },
  }

  mockDb.$transaction.mockImplementation(async (callback: (tx: typeof txMock) => unknown) =>
    callback(txMock as any)
  )

  return txMock
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('reserveBestProviderAtomically', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns ok:true and the hold on successful reservation', async () => {
    setupTransactionSuccess()

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.hold.id).toBe('hold-1')
      expect(result.provider.id).toBe('provider-1')
    }
  })

  it('returns PROVIDER_LOCKED when SELECT FOR UPDATE SKIP LOCKED returns empty', async () => {
    setupTransactionSuccess({ locked: [] })

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('PROVIDER_LOCKED')
    }
  })

  it('returns ALREADY_HELD when provider already has an active hold', async () => {
    setupTransactionSuccess({ existingHold: { id: 'existing-hold' } })

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('ALREADY_HELD')
    }
  })

  it('returns AT_CAPACITY when provider is at max concurrent holds', async () => {
    setupTransactionSuccess({ capacity: { activeHolds: 2, maxConcurrent: 2 } })

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('AT_CAPACITY')
    }
  })

  it('returns JOB_NO_LONGER_OPEN when job status changed mid-transaction', async () => {
    setupTransactionSuccess({ jobStatus: 'MATCHING' })

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('JOB_NO_LONGER_OPEN')
    }
  })

  it('returns TRANSACTION_FAILED when the transaction throws', async () => {
    mockDb.$transaction.mockRejectedValue(new Error('deadlock detected'))

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('TRANSACTION_FAILED')
    }
  })

  it('allows reservation when provider has capacity below max', async () => {
    setupTransactionSuccess({ capacity: { activeHolds: 1, maxConcurrent: 2 } })

    const result = await reserveBestProviderAtomically({
      candidate: makeCandidate(),
      jobRequest: makeJobRequest() as any,
    })

    expect(result.ok).toBe(true)
  })

  // ── Concurrency simulation ──────────────────────────────────────────────────

  it('concurrent reservations for same job: exactly one succeeds when one locks the row', async () => {
    let lockGranted = false

    // Two concurrent reservation calls share an in-memory "lock"
    mockDb.$transaction.mockImplementation(async (callback: (tx: any) => unknown) => {
      if (lockGranted) {
        // Simulate SKIP LOCKED — row already locked by the first transaction
        return callback({
          $queryRaw: vi.fn().mockResolvedValue([]),
          assignmentHold: { findFirst: vi.fn(), create: vi.fn() },
          matchAttempt: { create: vi.fn() },
          dispatchDecision: { create: vi.fn() },
          jobRequest: { findUnique: vi.fn(), update: vi.fn() },
          providerCapacity: { findUnique: vi.fn(), upsert: vi.fn() },
        })
      }
      lockGranted = true
      return callback({
        $queryRaw: vi.fn().mockResolvedValue([{ id: 'provider-1' }]),
        assignmentHold: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({
            id: 'hold-1',
            jobRequestId: 'job-1',
            providerId: 'provider-1',
            status: 'ACTIVE',
            offeredAt: new Date(),
            expiresAt: new Date(Date.now() + 15 * 60_000),
          }),
        },
        matchAttempt: { create: vi.fn().mockResolvedValue({ id: 'attempt-1' }) },
        dispatchDecision: { create: vi.fn().mockResolvedValue({ id: 'decision-1' }) },
        jobRequest: {
          findUnique: vi.fn().mockResolvedValue({ status: 'OPEN' }),
          update: vi.fn().mockResolvedValue({}),
        },
        providerCapacity: {
          findUnique: vi.fn().mockResolvedValue(null),
          upsert: vi.fn().mockResolvedValue({}),
        },
      })
    })

    const candidate = makeCandidate()
    const jobRequest = makeJobRequest() as any

    const [r1, r2] = await Promise.all([
      reserveBestProviderAtomically({ candidate, jobRequest }),
      reserveBestProviderAtomically({ candidate, jobRequest }),
    ])

    const successes = [r1, r2].filter((r) => r.ok)
    const failures = [r1, r2].filter((r) => !r.ok)

    expect(successes).toHaveLength(1)
    expect(failures).toHaveLength(1)
    expect((failures[0] as any).reason).toBe('PROVIDER_LOCKED')
  })
})

// ── releaseProviderCapacity ───────────────────────────────────────────────────

describe('releaseProviderCapacity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(mockDb as any).providerCapacity = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
  })

  it('decrements activeHolds for the given provider', async () => {
    await releaseProviderCapacity('provider-1')

    expect((mockDb as any).providerCapacity.updateMany).toHaveBeenCalledWith({
      where: { providerId: 'provider-1', activeHolds: { gt: 0 } },
      data: expect.objectContaining({ activeHolds: { decrement: 1 } }),
    })
  })

  it('does not throw when provider has no capacity row', async () => {
    ;(mockDb as any).providerCapacity.updateMany.mockResolvedValue({ count: 0 })

    await expect(releaseProviderCapacity('provider-unknown')).resolves.not.toThrow()
  })
})

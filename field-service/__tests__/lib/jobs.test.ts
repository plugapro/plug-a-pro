// ─── Job lifecycle state machine tests ───────────────────────────────────────
// Tests the VALID_TRANSITIONS map and transition logic without hitting the DB.
// The state machine export is the pure function; DB side effects are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoist shared fixtures so they are available inside vi.mock factories ─────

const { mockJob } = vi.hoisted(() => ({
  mockJob: {
    id: 'job_1',
    bookingId: 'booking_1',
    providerId: 'provider_1',
    status: 'SCHEDULED' as const,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    booking: {
      matchId: 'match_1',
      bookingId: 'booking_1',
      match: {
        jobRequest: {
          // id + customer.id added so triggerSideEffects can resolve the
          // customer-tracker URL (getJobRequestAccessUrl) and the completion
          // sign-off URL (getJobCompletionUrl) — both are required by the
          // production type signature on triggerSideEffects in lib/jobs.ts.
          id: 'jr_1',
          category: 'Plumbing',
          customer: { id: 'cust_1', name: 'Alice Smith', phone: '+27821234567' },
          address: { street: '1 Main St', suburb: 'Sandton', city: 'Johannesburg' },
        },
      },
    },
    provider: { name: 'Bob Jones' },
  },
}))

vi.mock('@/lib/db', () => ({
  db: {
    job: {
      findUnique: vi.fn().mockResolvedValue(mockJob),
      update: vi.fn().mockResolvedValue(mockJob),
    },
    jobStatusEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockImplementation(async (fn) => fn({
      job: { update: vi.fn().mockResolvedValue(mockJob), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      jobStatusEvent: { create: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    })),
    booking: {
      findUnique: vi.fn().mockResolvedValue({ matchId: 'match_1' }),
      update: vi.fn().mockResolvedValue({}),
    },
    // jobRequest read by triggerSideEffects → getJobRequestAccessUrl →
    // ensureJobRequestAccessToken. Returning a row with a usable token
    // short-circuits the updateMany write path.
    jobRequest: {
      findUnique: vi.fn().mockResolvedValue({
        customerAccessToken: 'jra_test_token',
        customerAccessTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        customerAccessTokenRevokedAt: null,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    rating: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    // openCase('FIELD_EXCEPTION') fires for FAILED/CALLBACK_REQUIRED
    // transitions (fire-and-forget at lib/jobs.ts:124). The call is wrapped
    // in .catch() so a missing mock cannot reject the transition itself,
    // but stubbing it cleans up the test log noise.
    case: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'case_1' }),
    },
  },
}))

vi.mock('@/lib/whatsapp', () => ({
  sendProviderOnTheWay: vi.fn().mockResolvedValue(undefined),
  sendProviderArrived: vi.fn().mockResolvedValue(undefined),
  sendJobCompleted: vi.fn().mockResolvedValue(undefined),
  sendText: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { transitionJob } from '@/lib/jobs'
import { db } from '@/lib/db'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('transitionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows SCHEDULED → EN_ROUTE', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'SCHEDULED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'EN_ROUTE', actorId: 'provider_1', actorRole: 'provider' })
    ).resolves.toBeUndefined()
  })

  it('allows SCHEDULED → CALLBACK_REQUIRED', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'SCHEDULED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'CALLBACK_REQUIRED', actorId: 'admin_1', actorRole: 'admin' })
    ).resolves.toBeUndefined()
  })

  it('rejects SCHEDULED → STARTED (invalid transition)', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'SCHEDULED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'STARTED', actorId: 'provider_1', actorRole: 'provider' })
    ).rejects.toThrow(/Invalid job transition/)
  })

  it('rejects transitions from COMPLETED (terminal)', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'COMPLETED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'STARTED', actorId: 'provider_1', actorRole: 'provider' })
    ).rejects.toThrow(/Invalid job transition/)
  })

  it('throws if job not found', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    await expect(
      transitionJob({ jobId: 'missing', toStatus: 'EN_ROUTE', actorId: 'provider_1', actorRole: 'provider' })
    ).rejects.toThrow(/Job not found/)
  })

  it('includes actorId and actorRole in status event', async () => {
    const txJobUpdate = vi.fn().mockResolvedValue(mockJob)
    const txEventCreate = vi.fn().mockResolvedValue({})
    const txAuditCreate = vi.fn().mockResolvedValue({})

    ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(async (fn) =>
      fn({
        job: { update: txJobUpdate, updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
        jobStatusEvent: { create: txEventCreate },
        auditLog: { create: txAuditCreate },
      })
    )
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'EN_ROUTE',
    })

    await transitionJob({
      jobId: 'job_1',
      toStatus: 'ARRIVED',
      actorId: 'provider_1',
      actorRole: 'provider',
      notes: 'On site',
    })

    expect(txEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: 'job_1',
        fromStatus: 'EN_ROUTE',
        toStatus: 'ARRIVED',
        actorId: 'provider_1',
        actorRole: 'provider',
        notes: 'On site',
      }),
    })
  })
})

// ─── Valid transitions coverage ───────────────────────────────────────────────

describe('VALID_TRANSITIONS coverage', () => {
  const validPaths: Array<[string, string]> = [
    ['EN_ROUTE', 'ARRIVED'],
    ['ARRIVED', 'STARTED'],
    ['STARTED', 'PAUSED'],
    ['STARTED', 'AWAITING_APPROVAL'],
    ['STARTED', 'PENDING_COMPLETION_CONFIRMATION'],
    ['STARTED', 'FAILED'],
    ['PAUSED', 'STARTED'],
    ['AWAITING_APPROVAL', 'STARTED'],
    ['AWAITING_APPROVAL', 'PENDING_COMPLETION_CONFIRMATION'],
    ['PENDING_COMPLETION_CONFIRMATION', 'COMPLETED'],
    ['SCHEDULED', 'CANCELLED'],
    ['CALLBACK_REQUIRED', 'SCHEDULED'],
  ]

  for (const [from, to] of validPaths) {
    it(`allows ${from} → ${to}`, async () => {
      ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ...mockJob,
        status: from,
      })
      ;(db.$transaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined)

      await expect(
        transitionJob({ jobId: 'job_1', toStatus: to as never, actorId: 'actor', actorRole: 'admin' })
      ).resolves.not.toThrow()
    })
  }
})

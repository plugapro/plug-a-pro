// ─── Job lifecycle state machine tests ───────────────────────────────────────
// Tests the VALID_TRANSITIONS map and transition logic without hitting the DB.
// The state machine export is the pure function; DB side effects are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Hoist shared fixtures so they are available inside vi.mock factories ─────

const { mockJob } = vi.hoisted(() => ({
  mockJob: {
    id: 'job_1',
    bookingId: 'booking_1',
    technicianId: 'tech_1',
    status: 'ASSIGNED' as const,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    booking: {
      businessId: 'biz_1',
      bookingId: 'booking_1',
      customer: { name: 'Alice Smith', phone: '+27821234567' },
      service: { name: 'Electrical Inspection' },
      address: { street: '1 Main St', suburb: 'Sandton', city: 'Johannesburg' },
    },
    technician: { name: 'Bob Jones' },
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
      job: { update: vi.fn().mockResolvedValue(mockJob) },
      jobStatusEvent: { create: vi.fn().mockResolvedValue({}) },
    })),
    booking: {
      findUnique: vi.fn().mockResolvedValue({ totalAmount: 500 }),
      update: vi.fn().mockResolvedValue({}),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    slot: {
      findFirst: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue({}),
    },
    rating: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTechnicianOnTheWay: vi.fn().mockResolvedValue(undefined),
  sendTechnicianArrived: vi.fn().mockResolvedValue(undefined),
  sendJobCompleted: vi.fn().mockResolvedValue(undefined),
}))

// ─── Import after mocks ───────────────────────────────────────────────────────

import { transitionJob } from '@/lib/jobs'
import { db } from '@/lib/db'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('transitionJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('allows ASSIGNED → EN_ROUTE', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'ASSIGNED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'EN_ROUTE', actorId: 'tech_1', actorRole: 'technician' })
    ).resolves.toBeUndefined()
  })

  it('allows ASSIGNED → CALLBACK_REQUIRED', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'ASSIGNED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'CALLBACK_REQUIRED', actorId: 'admin_1', actorRole: 'admin' })
    ).resolves.toBeUndefined()
  })

  it('rejects ASSIGNED → COMPLETED (invalid transition)', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'ASSIGNED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'COMPLETED', actorId: 'tech_1', actorRole: 'technician' })
    ).rejects.toThrow(/Invalid job transition/)
  })

  it('rejects transitions from COMPLETED (terminal)', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'COMPLETED',
    })

    await expect(
      transitionJob({ jobId: 'job_1', toStatus: 'STARTED', actorId: 'tech_1', actorRole: 'technician' })
    ).rejects.toThrow(/Invalid job transition/)
  })

  it('throws if job not found', async () => {
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    await expect(
      transitionJob({ jobId: 'missing', toStatus: 'EN_ROUTE', actorId: 'tech_1', actorRole: 'technician' })
    ).rejects.toThrow(/Job not found/)
  })

  it('includes actorId and actorRole in status event', async () => {
    const txJobUpdate = vi.fn().mockResolvedValue(mockJob)
    const txEventCreate = vi.fn().mockResolvedValue({})

    ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementationOnce(async (fn) =>
      fn({ job: { update: txJobUpdate }, jobStatusEvent: { create: txEventCreate } })
    )
    ;(db.job.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...mockJob,
      status: 'EN_ROUTE',
    })

    await transitionJob({
      jobId: 'job_1',
      toStatus: 'ARRIVED',
      actorId: 'tech_1',
      actorRole: 'technician',
      notes: 'On site',
    })

    expect(txEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: 'job_1',
        fromStatus: 'EN_ROUTE',
        toStatus: 'ARRIVED',
        actorId: 'tech_1',
        actorRole: 'technician',
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
    ['STARTED', 'COMPLETED'],
    ['STARTED', 'FAILED'],
    ['PAUSED', 'STARTED'],
    ['AWAITING_APPROVAL', 'STARTED'],
    ['AWAITING_APPROVAL', 'COMPLETED'],
    ['CALLBACK_REQUIRED', 'ASSIGNED'],
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

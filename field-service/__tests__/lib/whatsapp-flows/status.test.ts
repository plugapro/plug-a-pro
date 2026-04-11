import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer:   { findUnique: vi.fn() },
    jobRequest: { findMany: vi.fn(), findUnique: vi.fn() },
    extraWork:  { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText:    vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList:    vi.fn().mockResolvedValue(undefined),
  sendCtaUrl:  vi.fn().mockResolvedValue(undefined),
}))

import { handleStatusFlow } from '@/lib/whatsapp-flows/status'
import { db } from '@/lib/db'
import * as wa from '@/lib/whatsapp-interactive'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PHONE = '+27600000001'
const APP_URL = 'https://app.plugapro.co.za'

function makeCtx(overrides: Partial<Parameters<typeof handleStatusFlow>[0]> = {}) {
  return {
    phone: PHONE,
    flow:  'status' as const,
    step:  'status_show' as const,
    data:  {},
    reply: { type: 'text' as const, text: 'status', id: undefined },
    ...overrides,
  }
}

function makeJobRequest(overrides: Record<string, unknown> = {}) {
  return {
    id:        'jr_abc123',
    customerId: 'cust_1',
    category:  'Plumbing',
    status:    'OPEN',
    createdAt: new Date('2026-04-10T10:00:00Z'),
    match:     null,
    ...overrides,
  }
}

function makeJobRequestWithJob(jobStatus: string) {
  return makeJobRequest({
    match: {
      booking: {
        job: { id: 'job_1', status: jobStatus, bookingId: 'bk_1' },
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_APP_URL = APP_URL
})

// ─── Customer not found ───────────────────────────────────────────────────────

describe('handleStatusFlow — no customer', () => {
  it('sends "no requests found" and returns welcome', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue(null)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find"),
      expect.any(Array),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('welcome')
  })
})

// ─── No job requests ─────────────────────────────────────────────────────────

describe('handleStatusFlow — customer exists, no requests', () => {
  it('sends "no requests yet" and returns welcome', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([])

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("don't have any job requests"),
      expect.any(Array),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('welcome')
  })
})

// ─── Single active request ────────────────────────────────────────────────────

describe('handleStatusFlow — single active request (no job)', () => {
  it('sends CTA with correct tracking URL and returns done', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Plumbing'),
      'View Request',
      `${APP_URL}/requests/jr_abc123`,
      expect.any(Object)
    )
    expect(result.nextStep).toBe('done')
  })

  it('shows provider-language status label (not "technician")', async () => {
    const jr = makeJobRequestWithJob('SCHEDULED')
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    await handleStatusFlow(makeCtx())

    const call = vi.mocked(wa.sendCtaUrl).mock.calls[0]
    expect(call[1]).toContain('Provider scheduled')
    expect(call[1]).not.toContain('Worker scheduled')
    expect(call[1]).not.toContain('technician')
  })
})

// ─── activeJob null-safety fix ────────────────────────────────────────────────

describe('handleStatusFlow — completed job shows request-level status', () => {
  it.each(['COMPLETED', 'FAILED', 'CANCELLED'] as const)(
    'job.status=%s → falls back to request status label',
    async (jobStatus) => {
      const jr = makeJobRequest({ status: 'OPEN', match: { booking: { job: { id: 'job_1', status: jobStatus } } } })
      vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
      vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
      vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

      await handleStatusFlow(makeCtx())

      const call = vi.mocked(wa.sendCtaUrl).mock.calls[0]
      // Should show "Finding a provider" (OPEN label), not "Job completed/failed/cancelled"
      expect(call[1]).toContain('Finding a provider')
    }
  )

  it('does NOT trigger extra-work approval for a COMPLETED job', async () => {
    const jr = makeJobRequestWithJob('COMPLETED')
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    await handleStatusFlow(makeCtx())

    // extraWork.findFirst must never be called for a terminal job
    expect(db.extraWork.findFirst).not.toHaveBeenCalled()
  })
})

// ─── Multiple active requests — disambiguation ────────────────────────────────

describe('handleStatusFlow — multiple active requests', () => {
  it('sends disambiguation list and returns status_pick', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      makeJobRequest({ id: 'jr_1', category: 'Plumbing',   status: 'OPEN',     createdAt: new Date('2026-04-10') }),
      makeJobRequest({ id: 'jr_2', category: 'Electrical', status: 'MATCHING', createdAt: new Date('2026-04-09') }),
    ] as never)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendList).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('2 active requests'),
      expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'status_req_jr_1', title: 'Plumbing' }),
            expect.objectContaining({ id: 'status_req_jr_2', title: 'Electrical' }),
          ]),
        }),
      ]),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('status_pick')
  })

  it('filters out terminal requests from the disambiguation list', async () => {
    const activeJr = makeJobRequest({ id: 'jr_1', category: 'Plumbing', status: 'OPEN' })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      activeJr,
      makeJobRequest({ id: 'jr_2', category: 'Old job', status: 'CANCELLED' }),
    ] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(activeJr as never)

    // Only 1 active → no disambiguation, goes straight to CTA
    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendList).not.toHaveBeenCalled()
    expect(wa.sendCtaUrl).toHaveBeenCalled()
    expect(result.nextStep).toBe('done')
  })
})

// ─── Disambiguation pick ──────────────────────────────────────────────────────

describe('handleStatusFlow — status_pick step', () => {
  it('resolves the chosen request and shows its status', async () => {
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(
      makeJobRequest({ id: 'jr_2', category: 'Electrical', status: 'MATCHING' }) as never
    )

    const result = await handleStatusFlow(
      makeCtx({
        step:  'status_pick',
        reply: { type: 'interactive', id: 'status_req_jr_2', text: 'Electrical' },
      })
    )

    expect(db.jobRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'jr_2' } })
    )
    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Electrical'),
      'View Request',
      `${APP_URL}/requests/jr_2`,
      expect.any(Object)
    )
    expect(result.nextStep).toBe('done')
  })
})

// ─── Extra work approval ──────────────────────────────────────────────────────

describe('handleStatusFlow — extra work approval', () => {
  it('sends approval CTA with correct URL when extra work is PENDING', async () => {
    const jr = makeJobRequestWithJob('AWAITING_APPROVAL')
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(db.extraWork.findFirst).mockResolvedValue({
      id:            'ew_1',
      jobId:         'job_1',
      description:   'Replace tap washer',
      amount:        150,
      approvalToken: 'tok_xyz',
      status:        'PENDING',
    } as never)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Replace tap washer'),
      'Review & Approve',
      `${APP_URL}/approve/tok_xyz`
    )
    expect(result.nextStep).toBe('done')
  })
})

// ─── Missing app URL fallback ─────────────────────────────────────────────────

describe('handleStatusFlow — missing NEXT_PUBLIC_APP_URL', () => {
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it('sends text-only fallback when appUrl is empty', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    const result = await handleStatusFlow(makeCtx())

    // Must NOT send a CTA with a relative path
    expect(wa.sendCtaUrl).not.toHaveBeenCalled()
    // Must send a buttons fallback instead
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('support@plugapro.co.za'),
      expect.any(Array),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('done')
  })
})

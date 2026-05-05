import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer:   { findUnique: vi.fn() },
    jobRequest: { findMany: vi.fn(), findUnique: vi.fn() },
    extraWork:  { findFirst: vi.fn() },
    lead:       { findMany: vi.fn() },
    providerShortlist: { findFirst: vi.fn() },
    dispatchDecision: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText:    vi.fn().mockResolvedValue(undefined),
  sendButtons: vi.fn().mockResolvedValue(undefined),
  sendList:    vi.fn().mockResolvedValue(undefined),
  sendCtaUrl:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn(async (jobRequestId: string) => `https://app.plugapro.co.za/requests/access/${jobRequestId}`),
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
    requestRef: 'PAP-ABC123',
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
  vi.mocked(db.lead.findMany).mockResolvedValue([])
  vi.mocked(db.providerShortlist.findFirst).mockResolvedValue(null)
  vi.mocked(db.dispatchDecision.findFirst).mockResolvedValue(null)
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
  it('sends a CTA tracking link and returns done', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Request PAP-ABC123'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_abc123`
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

  it('shows explicit pending matching copy when lead summary is empty', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(db.lead.findMany).mockResolvedValue([])

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('still checking suitable providers'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_abc123`
    )
    expect(result.nextStep).toBe('done')
  })

  it('shows explicit no providers copy when latest dispatch decision is NO_MATCH', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(db.dispatchDecision.findFirst).mockResolvedValue({ status: 'NO_MATCH' } as never)

    await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("haven't found suitable available providers"),
      'Refresh status',
      `${APP_URL}/requests/access/jr_abc123`
    )
  })

  it('falls back to request-level waiting state if lead summary lookup fails', async () => {
    const jr = makeJobRequest({ status: 'OPEN' })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(db.lead.findMany).mockRejectedValue(new Error('temporary lead index outage'))

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('still checking suitable providers'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_abc123`
    )
    expect(result.nextStep).toBe('done')
  })

  it('shows validation-pending copy for PENDING_VALIDATION status', async () => {
    const jr = makeJobRequest({ status: 'PENDING_VALIDATION' })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    const result = await handleStatusFlow(makeCtx())

    const body: string =
      vi.mocked(wa.sendCtaUrl).mock.calls[0]?.[1] ??
      vi.mocked(wa.sendButtons).mock.calls[0]?.[1] ?? ''
    expect(body).toContain('Request PAP-ABC123')
    expect(body).toContain('Checking your request')
    expect(result.nextStep).toBe('done')
  })

  it('falls back to the customer latest request when the pinned request is from another customer', async () => {
    const stale = makeJobRequest({ id: 'jr_other', customerId: 'other_customer' })
    const latest = makeJobRequest({
      id: 'jr_latest',
      requestRef: 'PAP-LATEST',
      status: 'OPEN',
      category: 'Plumbing',
      createdAt: new Date('2026-04-11T10:00:00Z'),
    })

    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([latest] as never)
    vi.mocked(db.jobRequest.findUnique)
      .mockResolvedValueOnce(stale as never)
      .mockResolvedValueOnce(latest as never)

    await handleStatusFlow(
      makeCtx({
        step: 'status_show',
        data: { jobRequestId: 'jr_other', customerId: 'cust_1' },
      })
    )

    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Request PAP-LATEST'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_latest`
    )
  })

  it('rejects a stale pinned request that belongs to another customer', async () => {
    const jr = makeJobRequest({ customerId: 'other_customer' })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValueOnce([] as never)

    await handleStatusFlow(
      makeCtx({
        step: 'status_show',
        data: { jobRequestId: 'jr_other', customerId: 'cust_1' },
      })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('That request could not be loaded for this account.'),
      expect.any(Array)
    )
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

describe('handleStatusFlow — My Requests list', () => {
  it('sends recent request list and returns status_pick', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      makeJobRequest({ id: 'jr_1', category: 'Plumbing',   status: 'OPEN',     createdAt: new Date('2026-04-10') }),
      makeJobRequest({ id: 'jr_2', category: 'Electrical', status: 'MATCHING', createdAt: new Date('2026-04-09') }),
    ] as never)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendList).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Here are your recent requests'),
      expect.arrayContaining([
        expect.objectContaining({
          rows: expect.arrayContaining([
            expect.objectContaining({ id: 'status_req_jr_1', description: expect.stringContaining('Plumbing') }),
            expect.objectContaining({ id: 'status_req_jr_2', description: expect.stringContaining('Electrical') }),
          ]),
        }),
      ]),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('status_pick')
  })

  it('uses distinct picker labels for requests in the same category', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      makeJobRequest({ id: 'jr_1', requestRef: 'PAP-PAINT1', category: 'Painting', status: 'OPEN', createdAt: new Date('2026-04-12T08:31:00Z') }),
      makeJobRequest({ id: 'jr_2', requestRef: 'PAP-PAINT2', category: 'Painting', status: 'OPEN', createdAt: new Date('2026-04-02T08:31:00Z') }),
      makeJobRequest({ id: 'jr_3', requestRef: 'PAP-DIY333', category: 'DIY & Assembly', status: 'PENDING_VALIDATION', createdAt: new Date('2026-03-31T08:31:00Z') }),
    ] as never)

    await handleStatusFlow(makeCtx())

    const sections = vi.mocked(wa.sendList).mock.calls[0]?.[2] ?? []
    const rows = sections[0]?.rows ?? []

    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'status_req_jr_1', title: expect.stringContaining('PAP-PAINT1') }),
        expect.objectContaining({ id: 'status_req_jr_2', title: expect.stringContaining('PAP-PAINT2') }),
      ])
    )
    expect(rows[0].description).not.toBe(rows[1].description)
  })

  it('includes terminal requests after active requests in the recent list', async () => {
    const activeJr = makeJobRequest({ id: 'jr_1', category: 'Plumbing', status: 'OPEN' })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      activeJr,
      makeJobRequest({ id: 'jr_2', category: 'Old job', status: 'CANCELLED' }),
    ] as never)

    const result = await handleStatusFlow(makeCtx())

    const rows = vi.mocked(wa.sendList).mock.calls[0]?.[2]?.[0]?.rows ?? []
    expect(rows[0]).toEqual(expect.objectContaining({ id: 'status_req_jr_1' }))
    expect(rows[1]).toEqual(expect.objectContaining({ id: 'status_req_jr_2' }))
    expect(result.nextStep).toBe('status_pick')
  })

  it('falls back to buttons when the disambiguation list send fails', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      makeJobRequest({ id: 'jr_1', category: 'Painting', status: 'OPEN', createdAt: new Date('2026-04-12') }),
      makeJobRequest({ id: 'jr_2', category: 'Electrical', status: 'MATCHING', createdAt: new Date('2026-04-09') }),
    ] as never)
    vi.mocked(wa.sendList).mockRejectedValueOnce(new Error('Meta rejected list payload'))

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Here are your recent requests'),
      expect.arrayContaining([
        expect.objectContaining({ id: 'status_req_jr_1' }),
        expect.objectContaining({ id: 'status_req_jr_2' }),
        expect.objectContaining({ id: 'book' }),
      ]),
      expect.any(Object)
    )
    expect(result.nextStep).toBe('status_pick')
  })

  it('falls back to a text request list when list and button picker sends both fail', async () => {
    const latest = makeJobRequest({ id: 'jr_1', category: 'Painting', status: 'OPEN', createdAt: new Date('2026-04-12') })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([
      latest,
      makeJobRequest({ id: 'jr_2', category: 'Electrical', status: 'MATCHING', createdAt: new Date('2026-04-09') }),
    ] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(latest as never)
    vi.mocked(wa.sendList).mockRejectedValueOnce(new Error('Meta rejected list payload'))
    ;(wa.sendButtons as any).mockRejectedValueOnce(new Error('Meta rejected button payload'))
    ;(wa.sendButtons as any).mockResolvedValue(undefined)

    const result = await handleStatusFlow(makeCtx())

    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Reply with the request reference you want to track')
    )
    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Reply with the request reference you want to track')
    )
    expect(result.nextStep).toBe('status_pick')
  })
})

// ─── Disambiguation pick ──────────────────────────────────────────────────────

describe('handleStatusFlow — status_pick step', () => {
  it('resolves the chosen request and shows its status', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(
      makeJobRequest({ id: 'jr_2', requestRef: 'PAP-ELEC2', category: 'Electrical', status: 'MATCHING' }) as never
    )

    const result = await handleStatusFlow(
      makeCtx({
        step:  'status_pick',
        reply: { type: 'list_reply', id: 'status_req_jr_2', text: 'Electrical' },
      })
    )

    expect(db.jobRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'jr_2' } })
    )
    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Request PAP-ELEC2'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_2`
    )
    expect(result.nextStep).toBe('done')
  })
})

describe('handleStatusFlow — refresh status', () => {
  it('refreshes a specific request when the button carries the request id', async () => {
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(
      makeJobRequest({ id: 'jr_refresh', requestRef: 'PAP-REFRESH', category: 'Appliances', status: 'OPEN' }) as never
    )

    const result = await handleStatusFlow(
      makeCtx({
        reply: { type: 'button_reply' as const, id: 'status_refresh_jr_refresh', text: 'Refresh status' },
      })
    )

    expect(db.jobRequest.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'jr_refresh' } })
    )
    expect(wa.sendCtaUrl).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Request PAP-REFRESH'),
      'Refresh status',
      `${APP_URL}/requests/access/jr_refresh`
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

  it('sends status buttons without tracking link when appUrl is empty', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)

    const result = await handleStatusFlow(makeCtx())

    // Must NOT use sendCtaUrl
    expect(wa.sendCtaUrl).not.toHaveBeenCalled()
    // Must send buttons with status info but no tracking URL
    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Request PAP-ABC123'),
      expect.any(Array),
      expect.any(Object)
    )
    const body: string = vi.mocked(wa.sendButtons).mock.calls[0][1]
    expect(body).not.toContain('🔗')
    expect(result.nextStep).toBe('done')
  })
})

describe('handleStatusFlow — send fallback resilience', () => {
  it('falls back to text when the status CTA send fails', async () => {
    const jr = makeJobRequest()
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([jr] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(jr as never)
    vi.mocked(wa.sendCtaUrl).mockRejectedValueOnce(new Error('Meta rejected CTA payload'))

    const result = await handleStatusFlow(makeCtx())

    // Fallback no longer includes raw URL (UAT-006: security improvement)
    expect(wa.sendText).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining('Tap Track My Request to refresh')
    )
    expect(result.nextStep).toBe('done')
  })
})

describe('handleStatusFlow — resilience for invalid disambiguation id', () => {
  it('handles a stale status_pick id by asking the user to choose from current requests', async () => {
    const latest = makeJobRequest({ id: 'jr_latest', category: 'Electrical', status: 'OPEN', createdAt: new Date('2026-04-12') })
    vi.mocked(db.customer.findUnique).mockResolvedValue({ id: 'cust_1', phone: PHONE } as never)
    vi.mocked(db.jobRequest.findMany).mockResolvedValue([latest] as never)
    vi.mocked(db.jobRequest.findUnique).mockResolvedValue(null)

    const result = await handleStatusFlow(
      makeCtx({
        step:  'status_pick',
        reply: { type: 'list_reply', id: 'status_req_missing', text: 'Electrical' },
      })
    )

    expect(wa.sendButtons).toHaveBeenCalledWith(
      PHONE,
      expect.stringContaining("couldn't find that request"),
      expect.any(Array),
    )
    expect(result.nextStep).toBe('done')
  })
})

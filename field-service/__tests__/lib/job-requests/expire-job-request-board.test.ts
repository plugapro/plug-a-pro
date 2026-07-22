import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ─────────────────────────────────────────────────────────────
const { mockDb, mockSendText } = vi.hoisted(() => ({
  mockDb: {
    $transaction: vi.fn(),
    jobRequest: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    lead: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
  mockSendText: vi.fn(),
}))

vi.mock('../../../lib/db', () => ({ db: mockDb }))
vi.mock('../../../lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
}))

import { expireOpenJobRequest } from '../../../lib/job-requests/expire-job-request'

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeJobRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    status: 'OPEN',
    address: { suburb: 'Sandton' },
    ...overrides,
  }
}

function makeBoardLead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-board-1',
    jobRequestId: 'job-1',
    providerId: 'provider-1',
    origin: 'BOARD',
    status: 'INTERESTED',
    provider: { id: 'provider-1', phone: '+27821234567' },
    ...overrides,
  }
}

function makePushLead(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'lead-push-1',
    jobRequestId: 'job-1',
    providerId: 'provider-2',
    origin: 'PUSH',
    status: 'EXPIRED',
    provider: { id: 'provider-2', phone: '+27837654321' },
    ...overrides,
  }
}

// Collects every delete/deleteMany call across every model on the fake client
// so tests can assert, in one place, that none were ever invoked.
function assertNoDeletes() {
  expect(mockDb.jobRequest.delete).not.toHaveBeenCalled()
  expect(mockDb.jobRequest.deleteMany).not.toHaveBeenCalled()
  expect(mockDb.lead.delete).not.toHaveBeenCalled()
  expect(mockDb.lead.deleteMany).not.toHaveBeenCalled()
}

describe('expireOpenJobRequest — board lead close-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.$transaction.mockImplementation(async (callback: (tx: typeof mockDb) => unknown) =>
      callback(mockDb as any)
    )
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest())
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])
    mockDb.lead.updateMany.mockResolvedValue({ count: 1 })
    mockSendText.mockResolvedValue(undefined)
  })

  it('flips open BOARD-origin leads to EXPIRED with expiredAt set', async () => {
    await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jobRequestId: 'job-1',
          origin: 'BOARD',
          status: { in: ['VIEWED', 'INTERESTED', 'SHORTLISTED'] },
        },
        data: expect.objectContaining({
          status: 'EXPIRED',
          expiredAt: expect.any(Date),
        }),
      }),
    )
  })

  it('does not touch PUSH-origin leads (they are out of scope for this close-out)', async () => {
    mockDb.lead.findMany.mockResolvedValue([makePushLead()])

    await expireOpenJobRequest('job-1', 'max_age_exceeded')

    const updateManyCall = mockDb.lead.updateMany.mock.calls[0]?.[0]
    expect(updateManyCall?.where?.origin).toBe('BOARD')
  })

  it('sends a courteous best-effort notification to each affected board provider after the transaction commits', async () => {
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])

    await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('That job in Sandton is no longer available'),
      expect.anything(),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('more jobs are on your board'),
      expect.anything(),
    )
  })

  it('swallows notify failures without throwing or blocking expiry', async () => {
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])
    mockSendText.mockRejectedValue(new Error('whatsapp down'))

    const result = await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(result.transitioned).toBe(true)
  })

  it('sends nothing when there are no open board leads to close out', async () => {
    mockDb.lead.findMany.mockResolvedValue([])

    await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('still transitions the job request status to EXPIRED (existing behaviour preserved)', async () => {
    const result = await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(result.transitioned).toBe(true)
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    )
  })

  it('never deletes any row on any model — additive close-out only', async () => {
    await expireOpenJobRequest('job-1', 'max_age_exceeded')
    assertNoDeletes()
  })

  it('never deletes any row on any model even when the notify send fails', async () => {
    mockSendText.mockRejectedValue(new Error('whatsapp down'))
    await expireOpenJobRequest('job-1', 'max_age_exceeded')
    assertNoDeletes()
  })

  it('does not run the board lead close-out when the job was already EXPIRED/CANCELLED (guard preserved)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'EXPIRED' }))

    const result = await expireOpenJobRequest('job-1', 'max_age_exceeded')

    expect(result.transitioned).toBe(false)
    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
    assertNoDeletes()
  })

  // I1/C2 close-out interaction: true cap-3 keeps a job board-visible through
  // SHORTLIST_READY. expireOpenJobRequest's default guard only ever accepts
  // OPEN/MATCHING; SHORTLIST_READY is ONLY accepted when a caller explicitly
  // passes `{ includeShortlistReady: true }`. That opt-in exists because
  // widening the guard unconditionally is NOT a no-op for every caller: the
  // queue-exhaustion terminator in matching/service.ts (offerNextRankedCandidate,
  // reached from both the direct exhaustion path and rejectAssignmentOffer /
  // expireAssignmentOffer) can run against a job that is already
  // SHORTLIST_READY with a live, PUBLISHED shortlist the customer is actively
  // choosing from - unconditionally expiring it there would kill a shortlist
  // that was never actually deadline-exhausted. Only cron/match-leads step 1h
  // is safe to widen, because its query is itself deadline-gated
  // (`expiresAt: { not: null, lte: now }`) - a job only reaches that call site
  // once its own deadline has genuinely passed. See the file-header comment in
  // lib/job-requests/expire-job-request.ts for the full reachability writeup.
  it('with includeShortlistReady:true, transitions a SHORTLIST_READY job to EXPIRED and closes out its open board leads (I1/C2)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'SHORTLIST_READY' }))
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])

    const result = await expireOpenJobRequest('job-1', 'max_age_exceeded', { includeShortlistReady: true })

    expect(result.transitioned).toBe(true)
    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'EXPIRED' }),
      }),
    )
    expect(mockDb.lead.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          jobRequestId: 'job-1',
          origin: 'BOARD',
          status: { in: ['VIEWED', 'INTERESTED', 'SHORTLISTED'] },
        },
        data: expect.objectContaining({ status: 'EXPIRED', expiredAt: expect.any(Date) }),
      }),
    )
  })

  it('never deletes any row when expiring a SHORTLIST_READY job with includeShortlistReady:true (I1/C2)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'SHORTLIST_READY' }))
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])
    await expireOpenJobRequest('job-1', 'max_age_exceeded', { includeShortlistReady: true })
    assertNoDeletes()
  })

  // C2 (re-review fix): WITHOUT the opt-in, a SHORTLIST_READY job must be a
  // strict no-op - this is the default behaviour every non-cron caller relies
  // on (orchestrator's dispatch-time guard, service.ts's queue-exhaustion
  // terminator reached via offerNextRankedCandidate / rejectAssignmentOffer /
  // expireAssignmentOffer). Without this guard, a queue-exhaustion tick could
  // expire a job while its customer is actively looking at a live,
  // PUBLISHED shortlist.
  it('WITHOUT includeShortlistReady, a SHORTLIST_READY job is a strict no-op (C2)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'SHORTLIST_READY' }))
    mockDb.lead.findMany.mockResolvedValue([makeBoardLead()])

    const result = await expireOpenJobRequest('job-1', 'quick_match_queue_exhausted')

    expect(result.transitioned).toBe(false)
    expect(mockDb.jobRequest.update).not.toHaveBeenCalled()
    expect(mockDb.lead.updateMany).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
    assertNoDeletes()
  })

  it('WITHOUT includeShortlistReady, a SHORTLIST_READY job is a no-op even when options is explicitly {} (C2)', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'SHORTLIST_READY' }))

    const result = await expireOpenJobRequest('job-1', 'quick_match_queue_exhausted', {})

    expect(result.transitioned).toBe(false)
    assertNoDeletes()
  })
})

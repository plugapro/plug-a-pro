import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockJobRequest,
  mockAssignmentHold,
  mockOrchestrateMatch,
  mockSendText,
  mockGetProviderCandidates,
} = vi.hoisted(() => ({
  mockJobRequest: { findUnique: vi.fn(), update: vi.fn() },
  mockAssignmentHold: { findFirst: vi.fn() },
  mockOrchestrateMatch: vi.fn(),
  mockSendText: vi.fn(),
  mockGetProviderCandidates: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    jobRequest: mockJobRequest,
    assignmentHold: mockAssignmentHold,
  },
}))
vi.mock('@/lib/matching/orchestrator', () => ({ orchestrateMatch: mockOrchestrateMatch }))
vi.mock('@/lib/whatsapp', () => ({ sendText: mockSendText }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mockSendText, sendCtaUrl: vi.fn() }))
vi.mock('@/lib/review-first', () => ({ getProviderCandidatesForCustomerReview: mockGetProviderCandidates }))

const BASE_REQUEST = {
  id: 'jr-1',
  customerId: 'cust-1',
  status: 'PENDING_VALIDATION',
  assignmentMode: 'OPS_REVIEW',
  category: 'Plumbing',
  customer: { phone: '+27821234567' },
}

describe('selectCustomerRequestMatchingMode', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockJobRequest.update.mockResolvedValue({})
    mockOrchestrateMatch.mockResolvedValue(undefined)
    mockSendText.mockResolvedValue(undefined)
    mockGetProviderCandidates.mockResolvedValue({
      candidates: [{ providerId: 'provider-1', name: 'Lovemore' }],
    })
    mockAssignmentHold.findFirst.mockResolvedValue(null)
  })

  it('selecting quick_match transitions status to OPEN and triggers orchestrateMatch', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'quick_match',
    })

    expect(result.status).toBe('matching_started')
    expect(mockJobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'OPEN', assignmentMode: 'AUTO_ASSIGN' }),
      }),
    )
    expect(mockOrchestrateMatch).toHaveBeenCalledTimes(1)
    expect(mockOrchestrateMatch).toHaveBeenCalledWith('jr-1', expect.objectContaining({ triggeredBy: 'manual' }))
  })

  it('providers are NOT contacted when request is still PENDING_VALIDATION before mode is selected', async () => {
    // Simulates the post-submission state — no mode chosen yet, orchestration must not fire.
    // This is the "deferred contact" invariant from criterion 1.
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)

    // Mode has NOT been selected yet — orchestrateMatch must be zero calls up to this point.
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()

    // Now customer selects quick_match — orchestration fires.
    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    await selectCustomerRequestMatchingMode({ requestId: 'jr-1', customerId: 'cust-1', mode: 'quick_match' })

    expect(mockOrchestrateMatch).toHaveBeenCalledTimes(1)
  })

  it('returns already_in_progress (no-op) when same mode is already active via a hold', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, status: 'MATCHING', assignmentMode: 'AUTO_ASSIGN' })
    mockAssignmentHold.findFirst.mockResolvedValue({ id: 'hold-1' })

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'quick_match',
    })

    expect(result.status).toBe('already_in_progress')
    expect(mockJobRequest.update).not.toHaveBeenCalled()
    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('throws REQUEST_NOT_EDITABLE when customer tries to switch mode while a hold is active', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, status: 'MATCHING', assignmentMode: 'AUTO_ASSIGN' })
    mockAssignmentHold.findFirst.mockResolvedValue({ id: 'hold-1' })

    const { selectCustomerRequestMatchingMode, RequestMatchingModeError } = await import('@/lib/request-matching-mode')

    await expect(
      selectCustomerRequestMatchingMode({ requestId: 'jr-1', customerId: 'cust-1', mode: 'review_first' }),
    ).rejects.toThrow(RequestMatchingModeError)

    expect(mockOrchestrateMatch).not.toHaveBeenCalled()
  })

  it('throws FORBIDDEN when customerId does not match', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)

    const { selectCustomerRequestMatchingMode, RequestMatchingModeError } = await import('@/lib/request-matching-mode')

    await expect(
      selectCustomerRequestMatchingMode({ requestId: 'jr-1', customerId: 'cust-other', mode: 'quick_match' }),
    ).rejects.toThrow(RequestMatchingModeError)
  })

  it('throws REQUEST_NOT_EDITABLE for a MATCHED request', async () => {
    mockJobRequest.findUnique.mockResolvedValue({ ...BASE_REQUEST, status: 'MATCHED' })

    const { selectCustomerRequestMatchingMode, RequestMatchingModeError } = await import('@/lib/request-matching-mode')

    await expect(
      selectCustomerRequestMatchingMode({ requestId: 'jr-1', customerId: 'cust-1', mode: 'quick_match' }),
    ).rejects.toThrow(RequestMatchingModeError)
  })

  it('sends explicit no-provider copy when quick_match returns NO_MATCH', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockOrchestrateMatch.mockResolvedValue({ status: 'NO_MATCH', filteredOut: [], consideredCount: 0 })

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'quick_match',
    })

    expect(result.status).toBe('matching_started')
    const outbound = mockSendText.mock.calls.at(-1)?.[1] as string
    expect(outbound).toContain('No providers in your area are available right now')
    expect(outbound).toContain("We'll keep trying and notify you")
  })

  it('selecting review_first returns ready only after candidates are generated', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockGetProviderCandidates.mockResolvedValue({
      candidates: [
        { providerId: 'provider-1', name: 'Lovemore' },
        { providerId: 'provider-2', name: 'Jacob' },
      ],
    })

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'review_first',
    })

    expect(result.status).toBe('review_options_ready')
    expect(mockGetProviderCandidates).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'jr-1', customerId: 'cust-1', batch: 1 }),
    )
    const outbound = mockSendText.mock.calls.at(-1)?.[1] as string
    expect(outbound).toContain('We found 2 matching providers')
  })

  it('selecting review_first does not claim ready when no candidates exist', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockGetProviderCandidates.mockResolvedValue({ candidates: [] })

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'review_first',
    })

    expect(result.status).toBe('review_no_candidates')
    const outbound = mockSendText.mock.calls.at(-1)?.[1] as string
    expect(outbound).toContain('could not find matching providers yet')
    expect(outbound).not.toContain('is ready')
  })

  it('selecting review_first exposes matching failure instead of false ready', async () => {
    mockJobRequest.findUnique.mockResolvedValue(BASE_REQUEST)
    mockGetProviderCandidates.mockRejectedValue(new Error('candidate index unavailable'))

    const { selectCustomerRequestMatchingMode } = await import('@/lib/request-matching-mode')
    const result = await selectCustomerRequestMatchingMode({
      requestId: 'jr-1',
      customerId: 'cust-1',
      mode: 'review_first',
    })

    expect(result.status).toBe('review_matching_failed')
    const outbound = mockSendText.mock.calls.at(-1)?.[1] as string
    expect(outbound).toContain('could not be prepared yet')
    expect(outbound).not.toContain('is ready')
  })
})

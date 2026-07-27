import { beforeEach, describe, expect, it, vi } from 'vitest'

// I5 (re-review fix): notifyCustomerNoMatch must send different copy when the
// expiring job had a PUBLISHED ProviderShortlist (a live shortlist the
// customer may still be looking at) vs the genuine no-match case (no
// providers were ever found).
const { mockDb, mockSendText } = vi.hoisted(() => ({
  mockDb: {
    jobRequest: { findUnique: vi.fn(), update: vi.fn() },
    providerShortlist: { findFirst: vi.fn() },
  },
  mockSendText: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: mockSendText,
  sendButtons: vi.fn(),
}))
vi.mock('@/lib/whatsapp', () => ({ sendSlotAvailable: vi.fn() }))
vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.example/ticket'),
}))

import { notifyCustomerNoMatch } from '@/lib/matching/customer-recontact'

function makeJobRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    customerId: 'cust-1',
    category: 'plumbing',
    title: 'Fix leaking tap',
    description: 'Kitchen tap is leaking',
    status: 'EXPIRED',
    requestedWindowStart: null,
    requestedWindowEnd: null,
    requestedArrivalLatest: null,
    estimatedDurationMinutes: null,
    requiredSkillTags: [],
    requiredCertificationCodes: [],
    requiredEquipmentTags: [],
    requiredVehicleTypes: [],
    preferredProviderId: null,
    assignmentMode: 'AUTO_ASSIGN',
    customerAcceptedAmount: null,
    customerAcceptedScope: null,
    autoCreateBookingOnAssignment: false,
    customerNoMatchNotifiedAt: null,
    customerRematchCheckSentAt: null,
    customerRematchCheckRespondedAt: null,
    customerRematchCheckOutcome: null,
    altSlotNegotiationSentAt: null,
    altSlotNegotiationOutcome: null,
    expiresAt: null,
    dispatchDecisions: [],
    customer: { id: 'cust-1', name: 'Thabo', phone: '+27821234567' },
    address: {
      street: '1 Main Rd',
      suburb: 'Sandton',
      city: 'Johannesburg',
      province: 'Gauteng',
      lat: null,
      lng: null,
      locationNodeId: null,
      locationNode: null,
    },
    ...overrides,
  }
}

describe('notifyCustomerNoMatch — I5 shortlist-aware copy', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest())
    mockDb.jobRequest.update.mockResolvedValue({})
    mockDb.providerShortlist.findFirst.mockResolvedValue(null)
    mockSendText.mockResolvedValue(undefined)
  })

  it('sends the closed-shortlist copy when a PUBLISHED ProviderShortlist exists for the job', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue({ id: 'shortlist-1' })

    const result = await notifyCustomerNoMatch('job-1')

    expect(result).toBe(true)
    expect(mockDb.providerShortlist.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { requestId: 'job-1', status: 'PUBLISHED' },
      }),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('Your request has now closed'),
      expect.anything(),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('no longer reserved'),
      expect.anything(),
    )
    expect(mockSendText).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('new request'),
      expect.anything(),
    )
    // Must NOT contain the genuine no-match phrasing.
    const [, sentMessage] = mockSendText.mock.calls[0]
    expect(sentMessage).not.toContain('We were not able to match')
  })

  it('sends the genuine exhausted-no-match copy when there is no PUBLISHED shortlist', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue(null)

    const result = await notifyCustomerNoMatch('job-1')

    expect(result).toBe(true)
    expect(mockSendText).toHaveBeenCalledWith(
      '+27821234567',
      expect.stringContaining('We were not able to match'),
      expect.anything(),
    )
    const [, sentMessage] = mockSendText.mock.calls[0]
    expect(sentMessage).not.toContain('Your request has now closed')
  })

  it('preserves the existing idempotency guard (customerNoMatchNotifiedAt) for the shortlist-closed copy path too', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue({ id: 'shortlist-1' })
    mockDb.jobRequest.findUnique.mockResolvedValue(
      makeJobRequest({ customerNoMatchNotifiedAt: new Date('2026-07-01T00:00:00Z') }),
    )

    const result = await notifyCustomerNoMatch('job-1')

    expect(result).toBe(false)
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('marks customerNoMatchNotifiedAt after sending the shortlist-closed copy', async () => {
    mockDb.providerShortlist.findFirst.mockResolvedValue({ id: 'shortlist-1' })

    await notifyCustomerNoMatch('job-1')

    expect(mockDb.jobRequest.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ customerNoMatchNotifiedAt: expect.any(Date) }),
      }),
    )
  })

  it('does not query for a shortlist or send anything when the job is not EXPIRED', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue(makeJobRequest({ status: 'OPEN' }))

    const result = await notifyCustomerNoMatch('job-1')

    expect(result).toBe(false)
    expect(mockSendText).not.toHaveBeenCalled()
  })
})

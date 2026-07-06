import { beforeEach, describe, expect, it, vi } from 'vitest'

// CJ-09: immediate honest no-supply notice — NEW customer send, so it must be
// flag-gated (customer.no_supply.immediate_notice, default OFF) and
// idempotent per job request.

const {
  mockDb,
  mockIsEnabled,
  mockRecordAuditLog,
  mockAddToServiceAreaWaitlist,
  mockSendText,
} = vi.hoisted(() => ({
  mockDb: {
    auditLog: { findFirst: vi.fn() },
    jobRequest: { findUnique: vi.fn() },
  },
  mockIsEnabled: vi.fn(),
  mockRecordAuditLog: vi.fn(),
  mockAddToServiceAreaWaitlist: vi.fn(),
  mockSendText: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('@/lib/audit', () => ({ recordAuditLog: mockRecordAuditLog }))
vi.mock('@/lib/service-area-guard', () => ({ addToServiceAreaWaitlist: mockAddToServiceAreaWaitlist }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mockSendText }))

import {
  sendNoSupplyImmediateNotice,
  NO_SUPPLY_IMMEDIATE_NOTICE_FLAG,
  NO_SUPPLY_NOTICE_AUDIT_ACTION,
  buildNoSupplyNoticeMessage,
} from '@/lib/matching/no-supply-notice'

const liveJobRequest = {
  id: 'jr-1',
  status: 'OPEN',
  category: 'plumbing',
  title: 'Burst geyser',
  customer: { name: 'Thandi Mokoena', phone: '+27820000001' },
  address: { suburb: 'Ruimsig', city: 'Johannesburg', province: 'Gauteng' },
}

describe('sendNoSupplyImmediateNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
    mockDb.auditLog.findFirst.mockResolvedValue(null)
    mockDb.jobRequest.findUnique.mockResolvedValue(liveJobRequest)
    mockAddToServiceAreaWaitlist.mockResolvedValue(undefined)
    mockSendText.mockResolvedValue('wamid.1')
    mockRecordAuditLog.mockResolvedValue(undefined)
  })

  it('does NOTHING when the flag is off (default) — pre-audit behaviour unchanged', async () => {
    mockIsEnabled.mockResolvedValue(false)

    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' })

    expect(outcome).toEqual({ sent: false, reason: 'FLAG_OFF' })
    expect(mockIsEnabled).toHaveBeenCalledWith(NO_SUPPLY_IMMEDIATE_NOTICE_FLAG)
    expect(mockDb.jobRequest.findUnique).not.toHaveBeenCalled()
    expect(mockSendText).not.toHaveBeenCalled()
    expect(mockAddToServiceAreaWaitlist).not.toHaveBeenCalled()
    expect(mockRecordAuditLog).not.toHaveBeenCalled()
  })

  it('sends the honest notice + waitlist capture + sentinel when the flag is on', async () => {
    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' })

    expect(outcome).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('no *Burst geyser* providers available'),
      expect.objectContaining({
        templateName: 'interactive:job_request_no_supply_notice',
        metadata: expect.objectContaining({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' }),
      }),
    )
    expect(mockAddToServiceAreaWaitlist).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: '+27820000001',
        category: 'plumbing',
        suburb: 'Ruimsig',
        city: 'Johannesburg',
        source: 'whatsapp',
      }),
    )
    expect(mockRecordAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: NO_SUPPLY_NOTICE_AUDIT_ACTION,
        entityType: 'JobRequest',
        entityId: 'jr-1',
      }),
    )
  })

  it('is idempotent: never re-sends once the sentinel exists', async () => {
    mockDb.auditLog.findFirst.mockResolvedValue({ id: 'audit-1' })

    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'STRUCTURAL' })

    expect(outcome).toEqual({ sent: false, reason: 'ALREADY_SENT' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('skips terminal requests — the expiry message owns those', async () => {
    mockDb.jobRequest.findUnique.mockResolvedValue({ ...liveJobRequest, status: 'EXPIRED' })

    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' })

    expect(outcome).toEqual({ sent: false, reason: 'REQUEST_NOT_ACTIVE' })
    expect(mockSendText).not.toHaveBeenCalled()
  })

  it('does not arm the sentinel when the send fails (retry stays possible)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSendText.mockRejectedValue(new Error('meta down'))

    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' })

    expect(outcome).toEqual({ sent: false, reason: 'SEND_FAILED' })
    expect(mockRecordAuditLog).not.toHaveBeenCalled()
  })

  it('still sends the notice when the waitlist capture fails (best-effort)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockAddToServiceAreaWaitlist.mockRejectedValue(new Error('db down'))

    const outcome = await sendNoSupplyImmediateNotice({ jobRequestId: 'jr-1', failureClass: 'EMPTY_POOL' })

    expect(outcome).toEqual({ sent: true })
    expect(mockSendText).toHaveBeenCalled()
  })
})

describe('buildNoSupplyNoticeMessage', () => {
  it('is honest, names the service and area, and keeps the request alive', () => {
    const message = buildNoSupplyNoticeMessage({
      customerName: 'Thandi Mokoena',
      serviceName: 'plumbing',
      area: 'Ruimsig',
    })

    expect(message).toContain('Hi Thandi')
    expect(message).toContain('no *plumbing* providers available')
    expect(message).toContain('*Ruimsig*')
    expect(message).toContain('waitlist')
    expect(message).toContain('keep searching')
  })

  it('degrades gracefully without a name or area', () => {
    const message = buildNoSupplyNoticeMessage({ customerName: null, serviceName: 'plumbing', area: null })

    expect(message).toContain('Hi there')
    expect(message).toContain('in your area')
  })
})

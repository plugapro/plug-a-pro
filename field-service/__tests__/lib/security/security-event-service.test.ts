import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    providerIdentityVerification: {
      findUnique: vi.fn(),
    },
    securityEvent: {
      create: vi.fn(),
    },
  },
}))

vi.mock('../../../lib/db', () => ({ db: mockDb }))

describe('security event service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue(null)
    mockDb.securityEvent.create.mockResolvedValue({ id: 'sec-1' })
  })

  it('rejects security events without a phone, verification or webhook subject', async () => {
    const { raiseSecurityReviewEvent } = await import('../../../lib/security/security-event-service')

    await expect(
      raiseSecurityReviewEvent({
        eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
        severity: 'HIGH',
        sourceChannel: 'SYSTEM',
        metadata: { reasonCode: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION' },
      }),
    ).rejects.toThrow('Security event requires a subject')

    expect(mockDb.securityEvent.create).not.toHaveBeenCalled()
  })

  it('derives phone from a verification subject when the provider has a phone', async () => {
    mockDb.providerIdentityVerification.findUnique.mockResolvedValue({
      id: 'ver-1',
      provider: { phone: '+27711111111' },
      providerApplication: null,
    })
    const { raiseSecurityReviewEvent } = await import('../../../lib/security/security-event-service')

    await raiseSecurityReviewEvent({
      eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      severity: 'HIGH',
      sourceChannel: 'SYSTEM',
      subjectVerificationId: 'ver-1',
      metadata: {
        webhookEventId: 'wh-1',
        vendorKey: 'smile_id',
        reasonCode: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      },
    })

    expect(mockDb.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phoneE164: '+27711111111',
        subjectVerificationId: 'ver-1',
        subjectWebhookEventId: null,
        eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
        severity: 'HIGH',
        sourceChannel: 'SYSTEM',
      }),
    })
  })

  it('allows ambiguous webhook events to be anchored by webhook event id only', async () => {
    const { raiseSecurityReviewEvent } = await import('../../../lib/security/security-event-service')

    await raiseSecurityReviewEvent({
      eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      severity: 'HIGH',
      sourceChannel: 'SYSTEM',
      subjectWebhookEventId: 'wh-ambiguous-1',
      metadata: {
        webhookEventId: 'wh-ambiguous-1',
        vendorKey: 'smile_id',
        vendorReference: 'job-1',
        livenessSessionReference: 'live-2',
        matchedVerificationIds: ['ver-a', 'ver-b'],
        reasonCode: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
      },
    })

    expect(mockDb.securityEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phoneE164: null,
        subjectVerificationId: null,
        subjectWebhookEventId: 'wh-ambiguous-1',
        metadata: expect.objectContaining({
          matchedVerificationIds: ['ver-a', 'ver-b'],
        }),
      }),
    })
  })

  it('rejects PII-like metadata keys before writing', async () => {
    const { raiseSecurityReviewEvent } = await import('../../../lib/security/security-event-service')

    await expect(
      raiseSecurityReviewEvent({
        eventType: 'WEBHOOK_AMBIGUOUS_REFERENCE_RESOLUTION',
        severity: 'HIGH',
        sourceChannel: 'SYSTEM',
        subjectWebhookEventId: 'wh-1',
        metadata: {
          idNumber: '8001015009087',
          idHash: 'abc',
          idLast4: '9087',
          selfieBlobKey: 'private/selfie.jpg',
        },
      }),
    ).rejects.toThrow('Security event metadata contains forbidden key')

    expect(mockDb.securityEvent.create).not.toHaveBeenCalled()
  })
})

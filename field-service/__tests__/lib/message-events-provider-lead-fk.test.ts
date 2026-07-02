// Tier 1 funnel observability — verifies logOutboundMessage populates the
// message_events providerId/leadId FK columns from metadata so provider lead
// offers sent via sendJobOffer (dispatch AND rotation paths) carry linkage.
// Only string values may be written: the columns are FKs, so a numeric or
// object value in metadata must be ignored rather than passed to Prisma.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    customer: { findUnique: vi.fn() },
    messageEvent: { create: vi.fn() },
  },
}))

import { db } from '@/lib/db'
import { logOutboundMessage } from '@/lib/message-events'

const customerFindUnique = vi.mocked(db.customer.findUnique)
const messageEventCreate = vi.mocked(db.messageEvent.create)

// Not in INTERNAL_TEST_PHONE_NUMBERS, so the real cohort helpers treat the
// send as production traffic and the success create path runs.
const PROD_PHONE = '+27000000001'

describe('logOutboundMessage provider/lead FK columns', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    customerFindUnique.mockResolvedValue(null as never)
    messageEventCreate.mockResolvedValue({} as never)
  })

  it('writes providerId and leadId columns when metadata carries string ids', async () => {
    await logOutboundMessage({
      to: PROD_PHONE,
      templateName: 'provider_lead_offer',
      metadata: { providerId: 'p1', leadId: 'l1' },
    })

    expect(messageEventCreate).toHaveBeenCalledTimes(1)
    expect(messageEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'p1',
          leadId: 'l1',
        }),
      }),
    )
  })

  it('leaves providerId and leadId unset when metadata has no such keys', async () => {
    await logOutboundMessage({
      to: PROD_PHONE,
      templateName: 'provider_lead_offer',
      metadata: { jobRequestId: 'jr1' },
    })

    expect(messageEventCreate).toHaveBeenCalledTimes(1)
    const data = messageEventCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(data.providerId).toBeUndefined()
    expect(data.leadId).toBeUndefined()
  })

  it('ignores non-string providerId/leadId values in metadata', async () => {
    await logOutboundMessage({
      to: PROD_PHONE,
      templateName: 'provider_lead_offer',
      metadata: { providerId: 123, leadId: { id: 'l1' } },
    })

    expect(messageEventCreate).toHaveBeenCalledTimes(1)
    const data = messageEventCreate.mock.calls[0][0].data as Record<string, unknown>
    expect(data.providerId).toBeUndefined()
    expect(data.leadId).toBeUndefined()
  })

  it('writes providerId and leadId on the cohort-block FAILED row too', async () => {
    // Test-cohort subject sent to a production phone → cohort mismatch →
    // FAILED row via the block path, which must also carry the FK columns.
    await expect(
      logOutboundMessage({
        to: PROD_PHONE,
        templateName: 'provider_lead_offer',
        isTestEvent: true,
        metadata: { providerId: 'p1', leadId: 'l1' },
      }),
    ).rejects.toThrow('NOTIFICATION_BLOCKED_TEST_COHORT_MISMATCH')

    expect(messageEventCreate).toHaveBeenCalledTimes(1)
    expect(messageEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'p1',
          leadId: 'l1',
          status: 'FAILED',
        }),
      }),
    )
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    providerApplication: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('wamid.approval_1'),
}))

import { db } from '@/lib/db'
import { sendText } from '@/lib/whatsapp-interactive'
import {
  buildProviderApplicationApprovedMessage,
  notifyProviderApplicationApprovedOnce,
} from '@/lib/provider-application-notifications'

const providerApplication = db.providerApplication as unknown as {
  updateMany: ReturnType<typeof vi.fn>
  findUnique: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
}

describe('provider application approval notifications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providerApplication.updateMany.mockResolvedValue({ count: 1 })
    providerApplication.findUnique.mockResolvedValue({
      providerId: 'provider_123',
      provider: {
        wallet: { paidCreditBalance: 2, promoCreditBalance: 3 },
        promoAwards: [{
          creditsAwarded: 3,
          referenceType: 'provider_application',
          referenceId: 'app_123',
        }],
      },
    })
    providerApplication.update.mockResolvedValue({})
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.approval_1')
  })

  it('sends the first approval WhatsApp and marks it sent', async () => {
    const result = await notifyProviderApplicationApprovedOnce({
      applicationId: 'app_123',
      phone: '+27821234567',
      name: 'Jacob Hesser',
    })

    expect(result).toEqual({ status: 'sent', externalId: 'wamid.approval_1' })
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendText).toHaveBeenCalledWith(
      '+27821234567',
      buildProviderApplicationApprovedMessage('Jacob Hesser', {
        starterPromoCreditsAwarded: 3,
        paidCredits: 2,
        promoCredits: 3,
      }),
      {
        templateName: 'provider_application_approved',
        metadata: { providerApplicationId: 'app_123' },
      },
    )
    expect(providerApplication.update).toHaveBeenCalledWith({
      where: { id: 'app_123' },
      data: {
        approvalWhatsappSendStartedAt: null,
        approvalWhatsappSentAt: expect.any(Date),
        approvalWhatsappExternalId: 'wamid.approval_1',
      },
    })
  })

  it('builds approval copy that explains promo starter credits and balance', () => {
    const message = buildProviderApplicationApprovedMessage('Jacob Hesser', {
      starterPromoCreditsAwarded: 3,
      paidCredits: 2,
      promoCredits: 3,
    })

    expect(message).toContain('Starter credits awarded: *3 promo credits*')
    expect(message).toContain('Available balance: *5 credits*')
    expect(message).toContain('Promo: *3* · Purchased: *2*')
    expect(message).toContain('Credits are used when you accept eligible job leads')
  })

  it('builds approval copy with top-up guidance when no starter credits were awarded', () => {
    const message = buildProviderApplicationApprovedMessage('Jacob Hesser', {
      starterPromoCreditsAwarded: 0,
      paidCredits: 0,
      promoCredits: 0,
    })

    expect(message).toContain("Credit balance: *0 credits*. You'll need credits")
    expect(message).not.toContain('Starter credits awarded')
  })

  it('does not send again when the approval WhatsApp was already sent', async () => {
    providerApplication.updateMany.mockResolvedValueOnce({ count: 0 })
    providerApplication.findUnique.mockResolvedValueOnce({
      approvalWhatsappSentAt: new Date('2026-04-28T10:00:00.000Z'),
      approvalWhatsappSendStartedAt: null,
    })

    const result = await notifyProviderApplicationApprovedOnce({
      applicationId: 'app_123',
      phone: '+27821234567',
      name: 'Jacob Hesser',
    })

    expect(result).toEqual({ status: 'skipped', reason: 'already_sent' })
    expect(sendText).not.toHaveBeenCalled()
    expect(providerApplication.update).not.toHaveBeenCalled()
  })

  it('does not send while another approval notification attempt owns the lock', async () => {
    providerApplication.updateMany.mockResolvedValueOnce({ count: 0 })
    providerApplication.findUnique.mockResolvedValueOnce({
      approvalWhatsappSentAt: null,
      approvalWhatsappSendStartedAt: new Date(),
    })

    const result = await notifyProviderApplicationApprovedOnce({
      applicationId: 'app_123',
      phone: '+27821234567',
      name: 'Jacob Hesser',
    })

    expect(result).toEqual({ status: 'skipped', reason: 'send_in_progress' })
    expect(sendText).not.toHaveBeenCalled()
  })

  it('releases the lock when WhatsApp send fails so the approval can be retried', async () => {
    const error = new Error('WhatsApp unavailable')
    ;(sendText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error)

    await expect(
      notifyProviderApplicationApprovedOnce({
        applicationId: 'app_123',
        phone: '+27821234567',
        name: 'Jacob Hesser',
      }),
    ).rejects.toThrow('WhatsApp unavailable')

    expect(providerApplication.updateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'app_123',
        approvalWhatsappSentAt: null,
      },
      data: { approvalWhatsappSendStartedAt: null },
    })
    expect(providerApplication.update).not.toHaveBeenCalled()
  })
})

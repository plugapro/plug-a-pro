import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  sendCtaUrl: vi.fn().mockResolvedValue('wamid.approval_1'),
}))

import { db } from '@/lib/db'
import { sendCtaUrl } from '@/lib/whatsapp-interactive'
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
  afterEach(() => {
    vi.unstubAllEnvs()
  })

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
    ;(sendCtaUrl as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.approval_1')
  })

  it('sends two CTA messages on approval and marks the application sent', async () => {
    vi.stubEnv('APP_PUBLIC_URL', 'https://app.example.com')

    const result = await notifyProviderApplicationApprovedOnce({
      applicationId: 'app_123',
      phone: '+27821234567',
      name: 'Jacob Hesser',
    })

    expect(result).toEqual({ status: 'sent', externalId: 'wamid.approval_1' })
    expect(sendCtaUrl).toHaveBeenCalledTimes(2)

    const { mainBody, termsBody } = buildProviderApplicationApprovedMessage('Jacob Hesser', {
      starterPromoCreditsAwarded: 3,
      paidCredits: 2,
      promoCredits: 3,
    })

    // First CTA: Worker Portal button
    expect(sendCtaUrl).toHaveBeenNthCalledWith(
      1,
      '+27821234567',
      mainBody,
      'Access Worker Portal',
      'https://app.example.com/provider',
      undefined,
      { templateName: 'provider_application_approved', metadata: { providerApplicationId: 'app_123' } },
    )

    // Second CTA: Credits Rules button
    expect(sendCtaUrl).toHaveBeenNthCalledWith(
      2,
      '+27821234567',
      termsBody,
      'View Credits Rules',
      'https://app.example.com/provider/terms/credits',
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

  it('builds voucher CTA approval copy with credits rules (VOUCHER_PILOT)', () => {
    // Auto-award is disabled — message no longer references credit balance or starter credits
    const { mainBody, termsBody } = buildProviderApplicationApprovedMessage('Jacob Hesser')

    expect(mainBody).toContain('redeem your voucher code')
    expect(mainBody).toContain('Reply *REDEEM*')
    expect(mainBody).toContain('No credits are used for previewing or saying you are interested')
    expect(mainBody).toContain('1 credit is used only when a customer selects you')
    expect(mainBody).toContain('You can continue here on WhatsApp')
    expect(mainBody).toContain('Worker Portal')
    expect(termsBody).toContain('Provider credits terms and rules')
    expect(mainBody).not.toContain('Starter credits awarded')
    expect(mainBody).not.toContain('Available credits')
  })

  it('ignores legacy credits parameter and still produces voucher CTA (VOUCHER_PILOT)', () => {
    // _credits param is accepted for call-site compat but unused
    const { mainBody } = buildProviderApplicationApprovedMessage('Jacob Hesser', {
      starterPromoCreditsAwarded: 0,
      paidCredits: 0,
      promoCredits: 0,
    })

    expect(mainBody).toContain('redeem your voucher code')
    expect(mainBody).not.toContain('Starter credits awarded')
    expect(mainBody).not.toContain('Available credits')
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
    expect(sendCtaUrl).not.toHaveBeenCalled()
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
    expect(sendCtaUrl).not.toHaveBeenCalled()
  })

  it('releases the lock when WhatsApp send fails so the approval can be retried', async () => {
    const error = new Error('WhatsApp unavailable')
    ;(sendCtaUrl as ReturnType<typeof vi.fn>).mockRejectedValueOnce(error)

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

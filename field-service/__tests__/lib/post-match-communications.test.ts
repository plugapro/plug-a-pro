import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    lead: { findUnique: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
    customer: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('wamid.customer'),
  sendCtaUrl: vi.fn().mockResolvedValue('wamid.provider'),
  sendButtons: vi.fn().mockResolvedValue('wamid.provider-actions'),
}))

vi.mock('@/lib/provider-lead-access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/provider-lead-access')>('@/lib/provider-lead-access')
  return {
    ...actual,
    getProviderSignedJobHandoverUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token'),
    resolveProviderLeadAccessToken: vi.fn(),
    verifyProviderLeadAccessToken: vi.fn().mockReturnValue({ status: 'active', payload: { scopes: ['contact_customer'] } }),
    providerLeadTokenAllowsScope: vi.fn().mockReturnValue(true),
  }
})

vi.mock('@/lib/customer-provider-handover-access', () => ({
  getCustomerProviderHandoverUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/customer/requests/jr-12345678/provider-handover?token=customer-token'),
}))

vi.mock('@/lib/provider-wallet', () => ({
  PROVIDER_CREDIT_PRICE_ZAR: 50,
  PROVIDER_CREDIT_PRICE_CENTS: 5_000,
  PLUG_A_PRO_CREDIT_VALUE_CENTS: 5_000,
  getProviderWalletBalanceReadOnly: vi.fn().mockResolvedValue({
    providerId: 'provider-1',
    paidCreditBalance: 2,
    promoCreditBalance: 1,
    totalCreditBalance: 3,
    status: 'ACTIVE',
  }),
}))

import { db } from '@/lib/db'
import { sendButtons, sendCtaUrl, sendText } from '@/lib/whatsapp-interactive'
import { getProviderSignedJobHandoverUrlByLeadId, resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
import { getCustomerProviderHandoverUrl } from '@/lib/customer-provider-handover-access'
import {
  buildAcceptedLeadContactUrl,
  buildAcceptedLeadContactUrlForProvider,
  notifyPostMatchAcceptance,
} from '@/lib/post-match-communications'

const mockLead = {
  id: 'lead-1',
  providerId: 'provider-1',
  jobRequestId: 'jr-12345678',
  status: 'ACCEPTED',
  provider: { id: 'provider-1', name: 'Jacob Hesser', phone: '+27770000001' },
  unlock: { id: 'unlock-1', creditsCharged: 1, unlockedAt: new Date('2026-04-29T10:00:00.000Z') },
  jobRequest: {
    id: 'jr-12345678',
    category: 'Plumbing',
    customer: { id: 'cust-1', name: 'Stephanie Nkosi', phone: '+27820000001' },
    address: { street: '14 Main Road', suburb: 'Bromhof', city: 'Johannesburg', province: 'Gauteng' },
    requestedWindowStart: new Date('2026-04-30T08:00:00.000Z'),
    requestedWindowEnd: new Date('2026-04-30T10:00:00.000Z'),
    requestedArrivalLatest: null,
    match: { id: 'match-1', providerId: 'provider-1', status: 'MATCHED', createdAt: new Date('2026-04-29T10:01:00.000Z') },
  },
}

describe('post-match communications', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLead)
    ;(db.messageEvent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.messageEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust-1' })
    ;(db.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.customer')
    ;(sendCtaUrl as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.provider')
    ;(sendButtons as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.provider-actions')
    ;(getProviderSignedJobHandoverUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue('https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token')
    ;(getCustomerProviderHandoverUrl as ReturnType<typeof vi.fn>).mockResolvedValue('https://app.plugapro.co.za/customer/requests/jr-12345678/provider-handover?token=customer-token')
  })

  it('sends a named customer notification and provider post-acceptance job message', async () => {
    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).not.toHaveBeenCalled()
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('Jacob Hesser from Plug A Pro'),
      'WhatsApp Provider',
      'https://wa.me/27770000001',
      expect.objectContaining({ footer: 'Chat directly with your provider.' }),
      expect.objectContaining({
        templateName: 'post_match_customer_provider_accepted',
        metadata: expect.objectContaining({ leadId: 'lead-1', matchId: 'match-1' }),
      }),
    )
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('1 credit used.'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      expect.any(Object),
      expect.objectContaining({
        templateName: 'post_match_provider_job_accepted',
        metadata: expect.objectContaining({ leadId: 'lead-1' }),
      }),
    )
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Remaining credits: 3 credits (Starter/onboarding: 1 · Purchased: 2).'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      expect.any(Object),
      expect.any(Object),
    )
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer contact:\nStephanie Nkosi\n+27820000001'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      expect.any(Object),
      expect.any(Object),
    )
    expect(sendButtons).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer contact is released'),
      [{ id: 'post_match_contact:lead-1', title: 'Contact Customer' }],
      expect.any(Object),
      expect.objectContaining({
        templateName: 'post_match_provider_next_actions',
        metadata: expect.objectContaining({ leadId: 'lead-1' }),
      }),
    )
  })

  it('does not resend either post-match notification when message events already exist', async () => {
    ;(db.messageEvent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'msg-existing' })

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).not.toHaveBeenCalled()
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('builds a secure accepted-lead customer contact redirect and logs the handover', async () => {
    ;(resolveProviderLeadAccessToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: 'active',
      lead: mockLead,
    })

    const url = await buildAcceptedLeadContactUrl({ leadId: 'lead-1', token: 'signed-token' })

    expect(url).toContain('https://wa.me/27820000001')
    expect(url).toContain('accepted%20your%20Plumbing%20request')
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'match.customer_contact_opened',
        entityId: 'jr-12345678',
      }),
    }))
  })

  it('builds a customer contact redirect only for the accepted provider phone', async () => {
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLead)

    await expect(buildAcceptedLeadContactUrlForProvider({
      leadId: 'lead-1',
      providerPhone: '+27770000001',
    })).resolves.toContain('https://wa.me/27820000001')

    await expect(buildAcceptedLeadContactUrlForProvider({
      leadId: 'lead-1',
      providerPhone: '+27779999999',
    })).resolves.toBeNull()
  })

  it('sends no notifications when the lead is not found', async () => {
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await notifyPostMatchAcceptance({ leadId: 'lead-missing', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).not.toHaveBeenCalled()
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('sends no notifications when providerId does not match the lead', async () => {
    ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...mockLead,
      providerId: 'provider-OTHER',
    })

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).not.toHaveBeenCalled()
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('falls back to sendText for provider message when signed job URL is unavailable', async () => {
    const { getProviderSignedJobHandoverUrlByLeadId } = await import('@/lib/provider-lead-access')
    ;(getProviderSignedJobHandoverUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer contact:\nStephanie Nkosi\n+27820000001'),
      expect.objectContaining({ templateName: 'post_match_provider_job_accepted' }),
    )
  })

  it('falls back to sendText for customer message when handover URL is unavailable', async () => {
    ;(getCustomerProviderHandoverUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('Plumbing'),
      expect.objectContaining({ templateName: 'post_match_customer_provider_accepted' }),
    )
  })

  it('still sends the provider confirmation when the customer notification fails', async () => {
    ;(sendCtaUrl as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('Meta rejected customer message'))
      .mockResolvedValueOnce('wamid.provider')

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result).toEqual({ customerNotified: false, providerNotified: true })
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Lead accepted'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      expect.any(Object),
      expect.objectContaining({ templateName: 'post_match_provider_job_accepted' }),
    )
  })

  it('returns providerNotified false instead of throwing when provider confirmation fails', async () => {
    ;(sendCtaUrl as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce('wamid.customer')
      .mockRejectedValueOnce(new Error('Meta rejected provider message'))

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result).toEqual({ customerNotified: true, providerNotified: false })
    expect(sendButtons).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer contact is released'),
      [{ id: 'post_match_contact:lead-1', title: 'Contact Customer' }],
      expect.any(Object),
      expect.objectContaining({ templateName: 'post_match_provider_next_actions' }),
    )
  })
})

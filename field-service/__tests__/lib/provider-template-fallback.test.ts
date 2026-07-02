// Acceptance hardening Task 4 — provider-facing template-first fallbacks.
//
// Two provider messages were pure session sends with no registered Meta
// template, so outside the 24h window Meta rejected them ("Re-engagement
// message") and the provider never saw them:
//   1. Lead expired notice     — notifyProviderLeadInviteExpired (lib/matching/service.ts)
//   2. Post-match job accepted — provider branch of notifyPostMatchAcceptance
//      (lib/post-match-communications.ts)
//
// Contract (mirrors the proven CUSTOMER branch of notifyPostMatchAcceptance):
//   template-first → on [TEMPLATE_NOT_APPROVED] fall back to session sends
//   ONLY inside the 24h window → outside the window: log/record and skip,
//   never throw, never attempt a doomed freeform send.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    lead: { findUnique: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
    customer: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    inboundWhatsAppMessage: { findFirst: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('wamid.text'),
  sendCtaUrl: vi.fn().mockResolvedValue('wamid.cta'),
  sendButtons: vi.fn().mockResolvedValue('wamid.buttons'),
}))

vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn().mockResolvedValue('wamid.template'),
  sendProviderLeadExpired: vi.fn().mockResolvedValue('wamid.lead-expired'),
  sendProviderJobAcceptedNextSteps: vi.fn().mockResolvedValue('wamid.job-accepted'),
}))

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
  hasSuccessfulMessageForRecipient: vi.fn().mockResolvedValue(false),
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
import { sendProviderJobAcceptedNextSteps, sendProviderLeadExpired } from '@/lib/whatsapp'
import { hasSuccessfulMessageForRecipient } from '@/lib/message-events'
import { notifyProviderLeadInviteExpired } from '@/lib/matching/service'
import { notifyPostMatchAcceptance } from '@/lib/post-match-communications'

function templateNotApprovedError(template: string) {
  return new Error(`[TEMPLATE_NOT_APPROVED] Template "${template}" is not approved or does not exist in Meta Business Manager. Approve it before deploying. code=132000`)
}

const mockHold = {
  id: 'hold-1',
  expiresAt: new Date('2026-06-28T10:00:00.000Z'),
  jobRequestId: 'job-1',
  providerId: 'provider-1',
  provider: { phone: '+27764010810', name: 'Fannie Provider' },
  jobRequest: {
    category: 'Handyman',
    address: { suburb: 'ruimsig', city: 'johannesburg' },
  },
}

const mockLead = {
  id: 'lead-1',
  providerId: 'provider-1',
  jobRequestId: 'jr-12345678',
  status: 'ACCEPTED',
  provider: { id: 'provider-1', name: 'Jacob Hesser', phone: '+27770000001' },
  unlock: { id: 'unlock-1', creditsCharged: 1, unlockedAt: new Date('2026-06-28T10:00:00.000Z') },
  jobRequest: {
    id: 'jr-12345678',
    category: 'Plumbing',
    customer: { id: 'cust-1', name: 'Stephanie Nkosi', phone: '+27820000001' },
    address: { street: '14 Main Road', suburb: 'Bromhof', city: 'Johannesburg', province: 'Gauteng' },
    requestedWindowStart: new Date('2026-06-29T08:00:00.000Z'),
    requestedWindowEnd: new Date('2026-06-29T10:00:00.000Z'),
    requestedArrivalLatest: null,
    match: { id: 'match-1', providerId: 'provider-1', status: 'MATCHED', createdAt: new Date('2026-06-28T10:01:00.000Z') },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockLead)
  ;(db.messageEvent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(db.messageEvent.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(db.customer.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'cust-1' })
  ;(db.auditLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  // Default: OUTSIDE the 24h window (no recent inbound message).
  ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.text')
  ;(sendCtaUrl as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.cta')
  ;(sendButtons as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.buttons')
  ;(sendProviderLeadExpired as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.lead-expired')
  ;(sendProviderJobAcceptedNextSteps as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.job-accepted')
  ;(hasSuccessfulMessageForRecipient as ReturnType<typeof vi.fn>).mockResolvedValue(false)
})

describe('notifyProviderLeadInviteExpired — template-first with window-gated fallback', () => {
  it('sends the provider_lead_expired template and never falls back to freeform on success', async () => {
    await notifyProviderLeadInviteExpired({ hold: mockHold, wasReassigned: true, traceId: 'trace-1' })

    expect(sendProviderLeadExpired).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27764010810',
      firstName: 'Fannie',
      service: 'Handyman',
      area: 'Ruimsig, Johannesburg',
      metadata: expect.objectContaining({
        providerId: 'provider-1',
        jobRequestId: 'job-1',
        assignmentHoldId: 'hold-1',
        wasReassigned: true,
      }),
    }))
    expect(sendText).not.toHaveBeenCalled()
  })

  it('falls back to the freeform lead-expired text when the template is not approved AND the provider is inside the 24h window', async () => {
    ;(sendProviderLeadExpired as ReturnType<typeof vi.fn>).mockRejectedValue(templateNotApprovedError('provider_lead_expired'))
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

    await notifyProviderLeadInviteExpired({ hold: mockHold, wasReassigned: true, traceId: 'trace-1' })

    expect(sendText).toHaveBeenCalledWith(
      '+27764010810',
      expect.stringContaining('Lead expired'),
      expect.objectContaining({
        templateName: 'interactive:lead_expired',
        metadata: expect.objectContaining({ assignmentHoldId: 'hold-1' }),
      }),
    )
  })

  it('sends NOTHING and does not throw when the template is not approved and the provider is outside the 24h window', async () => {
    ;(sendProviderLeadExpired as ReturnType<typeof vi.fn>).mockRejectedValue(templateNotApprovedError('provider_lead_expired'))
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await expect(
      notifyProviderLeadInviteExpired({ hold: mockHold, wasReassigned: false, traceId: 'trace-1' })
    ).resolves.toBeUndefined()

    expect(sendText).not.toHaveBeenCalled()
  })

  it('suppresses a resend when a successful send exists under EITHER template name', async () => {
    ;(hasSuccessfulMessageForRecipient as ReturnType<typeof vi.fn>).mockImplementation(
      async (params: { templateName: string }) => params.templateName === 'interactive:lead_expired'
    )

    await notifyProviderLeadInviteExpired({ hold: mockHold, wasReassigned: true, traceId: 'trace-1' })

    expect(sendProviderLeadExpired).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
  })
})

describe('notifyPostMatchAcceptance — provider branch template-first with window-gated session path', () => {
  it('delivers via the provider_job_accepted_next_steps template; session cta/text unused; next-actions buttons gated on the (closed) window', async () => {
    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result.providerNotified).toBe(true)
    expect(sendProviderJobAcceptedNextSteps).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27770000001',
      firstName: 'Jacob',
      service: 'Plumbing',
      area: 'Bromhof, Johannesburg',
      jobUrl: 'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      metadata: expect.objectContaining({ leadId: 'lead-1', providerId: 'provider-1' }),
    }))
    // Session path must not be used when the template succeeds.
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalledWith('+27770000001', expect.anything(), expect.anything())
    // Reply buttons cannot be templated — outside the window they are skipped.
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('still sends the next-actions buttons when the provider is inside the 24h window', async () => {
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendButtons).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer contact is released'),
      [{ id: 'post_match_contact:lead-1', title: 'Contact Customer' }],
      expect.any(Object),
      expect.objectContaining({ templateName: 'post_match_provider_next_actions' }),
    )
  })

  it('falls back to the session cta path when the template is not approved AND the provider is inside the 24h window', async () => {
    ;(sendProviderJobAcceptedNextSteps as ReturnType<typeof vi.fn>).mockRejectedValue(templateNotApprovedError('provider_job_accepted_next_steps'))
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result.providerNotified).toBe(true)
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Lead accepted'),
      'View job',
      'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      expect.any(Object),
      expect.objectContaining({ templateName: 'post_match_provider_job_accepted' }),
    )
  })

  it('sends NO session messages and records the blocked state when the template is not approved and the provider is outside the 24h window', async () => {
    ;(sendProviderJobAcceptedNextSteps as ReturnType<typeof vi.fn>).mockRejectedValue(templateNotApprovedError('provider_job_accepted_next_steps'))
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result.providerNotified).toBe(false)
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalledWith('+27770000001', expect.anything(), expect.anything())
    expect(sendButtons).not.toHaveBeenCalled()
    expect(db.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        to: '+27770000001',
        status: 'FAILED',
        failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
        templateName: 'post_match_provider_job_accepted',
      }),
    }))
  })
})

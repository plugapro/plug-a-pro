import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    lead: { findUnique: vi.fn() },
    messageEvent: { findFirst: vi.fn(), create: vi.fn() },
    customer: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    inboundWhatsAppMessage: { findFirst: vi.fn() },
    opsQueueAssignment: { upsert: vi.fn() },
  },
}))

vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue('wamid.customer'),
  sendCtaUrl: vi.fn().mockResolvedValue('wamid.provider'),
  sendButtons: vi.fn().mockResolvedValue('wamid.provider-actions'),
}))

vi.mock('@/lib/whatsapp', async () => {
  // Keep the REAL buildCustomerMatchFoundComponents so these tests pin the
  // exact component shape the approved Meta template expects.
  const actual = await vi.importActual<typeof import('@/lib/whatsapp')>('@/lib/whatsapp')
  return {
    buildCustomerMatchFoundComponents: actual.buildCustomerMatchFoundComponents,
    sendTemplate: vi.fn().mockResolvedValue('wamid.template'),
    sendProviderJobAcceptedNextSteps: vi.fn().mockResolvedValue('wamid.provider-template'),
  }
})

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
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
import { sendProviderJobAcceptedNextSteps, sendTemplate } from '@/lib/whatsapp'
import { logOutboundMessage } from '@/lib/message-events'
import { getProviderSignedJobHandoverUrlByLeadId, resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
import { getCustomerProviderHandoverUrl } from '@/lib/customer-provider-handover-access'
import {
  buildAcceptedLeadContactUrl,
  buildAcceptedLeadContactUrlForProvider,
  notifyPostMatchAcceptance,
} from '@/lib/post-match-communications'

function templateNotApprovedError(template: string) {
  return new Error(`[TEMPLATE_NOT_APPROVED] Template "${template}" is not approved or does not exist in Meta Business Manager. Approve it before deploying. code=132000`)
}

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
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.opsQueueAssignment.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'q_1' })
    ;(sendText as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.customer')
    ;(sendCtaUrl as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.provider')
    ;(sendButtons as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.provider-actions')
    ;(sendTemplate as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.template')
    ;(sendProviderJobAcceptedNextSteps as ReturnType<typeof vi.fn>).mockResolvedValue('wamid.provider-template')
    ;(logOutboundMessage as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(getProviderSignedJobHandoverUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue('https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token')
    ;(getCustomerProviderHandoverUrl as ReturnType<typeof vi.fn>).mockResolvedValue('https://app.plugapro.co.za/customer/requests/jr-12345678/provider-handover?token=customer-token')
  })

  it('sends the customer notification via sendTemplate (primary template) and provider post-acceptance job message via the UTILITY template', async () => {
    // Provider inside the 24h window so the (untemplateable) next-actions
    // reply buttons still go out.
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    // Customer notification MUST go via sendTemplate (works outside the 24h window).
    // sendText / sendCtaUrl to the customer phone MUST NOT be called on the happy path.
    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27820000001',
      template: 'post_match_customer_provider_accepted',
      components: expect.arrayContaining([
        expect.objectContaining({
          type: 'body',
          parameters: [
            { type: 'text', text: 'Stephanie' },
            { type: 'text', text: 'Jacob' },
            { type: 'text', text: 'Plumbing' },
          ],
        }),
        expect.objectContaining({
          type: 'button',
          sub_type: 'url',
          index: 0,
          parameters: [{ type: 'text', text: 'jr-12345678' }],
        }),
      ]),
      metadata: expect.objectContaining({ leadId: 'lead-1', matchId: 'match-1', deliveryPath: 'primary_template' }),
    }))
    expect(logOutboundMessage).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27820000001',
      templateName: 'post_match_customer_provider_accepted',
      externalId: 'wamid.template',
      metadata: expect.objectContaining({ deliveryPath: 'primary_template' }),
    }))
    expect(sendText).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything())
    expect(sendCtaUrl).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything())
    // Provider confirmation MUST go via the UTILITY template (works outside the
    // 24h window). The session cta path is reserved for the not-approved fallback.
    expect(sendProviderJobAcceptedNextSteps).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27770000001',
      firstName: 'Jacob',
      service: 'Plumbing',
      area: 'Bromhof, Johannesburg',
      jobUrl: 'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
      metadata: expect.objectContaining({ leadId: 'lead-1', deliveryPath: 'primary_template' }),
    }))
    expect(sendCtaUrl).not.toHaveBeenCalled()
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

    expect(sendTemplate).not.toHaveBeenCalled()
    expect(sendProviderJobAcceptedNextSteps).not.toHaveBeenCalled()
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

    expect(sendTemplate).not.toHaveBeenCalled()
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

    expect(sendTemplate).not.toHaveBeenCalled()
    expect(sendText).not.toHaveBeenCalled()
    expect(sendCtaUrl).not.toHaveBeenCalled()
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('falls back to sendText for provider message when signed job URL is unavailable (inside the 24h window)', async () => {
    const { getProviderSignedJobHandoverUrlByLeadId } = await import('@/lib/provider-lead-access')
    ;(getProviderSignedJobHandoverUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    // The template needs the signed URL for its button, so without one the send
    // drops to the session path — which is only allowed inside the 24h window.
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendProviderJobAcceptedNextSteps).not.toHaveBeenCalled()
    expect(sendText).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Customer details:\nStephanie Nkosi\n+27820000001'),
      expect.objectContaining({ templateName: 'post_match_provider_job_accepted' }),
    )
  })

  it('records the blocked state instead of a doomed session send when the signed job URL is unavailable outside the 24h window', async () => {
    const { getProviderSignedJobHandoverUrlByLeadId } = await import('@/lib/provider-lead-access')
    ;(getProviderSignedJobHandoverUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result.providerNotified).toBe(false)
    expect(sendText).not.toHaveBeenCalledWith('+27770000001', expect.anything(), expect.anything())
    expect(db.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        to: '+27770000001',
        status: 'FAILED',
        failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
        templateName: 'post_match_provider_job_accepted',
      }),
    }))
  })

  it('still notifies the customer via sendTemplate when the rich handover URL is unavailable', async () => {
    // Handover URL is only used by the inside-window text fallback; the primary
    // template path is independent of it and works regardless of the URL.
    ;(getCustomerProviderHandoverUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null)

    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27820000001',
      template: 'post_match_customer_provider_accepted',
    }))
    expect(sendText).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything())
  })

  it('still sends the provider confirmation when the customer template send fails', async () => {
    // Generic (non-TEMPLATE_NOT_APPROVED) send error on the customer template.
    ;(sendTemplate as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Meta rejected customer message'))

    const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(result).toEqual({ customerNotified: false, providerNotified: true })
    expect(sendProviderJobAcceptedNextSteps).toHaveBeenCalledWith(expect.objectContaining({
      to: '+27770000001',
      jobUrl: 'https://app.plugapro.co.za/provider/jobs/jr-12345678/handover?token=signed-token',
    }))
  })

  it('returns providerNotified false instead of throwing when provider confirmation fails', async () => {
    // Customer template succeeds; provider template rejects with a generic
    // (non-approval) error, so there is no session fallback.
    ;(sendProviderJobAcceptedNextSteps as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Meta rejected provider message'))
    // Inside the window so the next-actions buttons are still attempted.
    ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

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

  // ─── Regression: 24h-window failure (the JR-B Ishmael bug) ──────────────────
  // The primary post_match_customer_provider_accepted template is not yet
  // approved at Meta. The legacy code path sent a free-form interactive message
  // to the customer, which Meta rejected with "Re-engagement message" whenever
  // the customer's last inbound was >24h old. The fix is a template-first chain
  // that falls back to free-form ONLY inside the 24h window.

  describe('customer 24h-window fallback chain', () => {
    it('falls through to customer_match_found when the primary template is not approved', async () => {
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockResolvedValueOnce('wamid.fallback-template')

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(true)
      expect(sendTemplate).toHaveBeenNthCalledWith(2, expect.objectContaining({
        to: '+27820000001',
        template: 'customer_match_found',
        components: expect.arrayContaining([
          expect.objectContaining({
            type: 'body',
            // Approved template order: {{1}} customer, {{2}} service, {{3}} provider.
            // Sending only two params fails Meta 132000 (the matched-not-told bug).
            parameters: [
              { type: 'text', text: 'Stephanie' },
              { type: 'text', text: 'Plumbing' },
              { type: 'text', text: 'Jacob' },
            ],
          }),
          expect.objectContaining({
            type: 'button',
            sub_type: 'url',
            index: 0,
            parameters: [{ type: 'text', text: 'jr-12345678' }],
          }),
        ]),
        metadata: expect.objectContaining({ deliveryPath: 'fallback_template' }),
      }))
      expect(sendText).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything())
    })

    it('uses the rich interactive message ONLY when inside the 24h window', async () => {
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockRejectedValueOnce(templateNotApprovedError('customer_match_found'))
      ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(true)
      expect(sendCtaUrl).toHaveBeenCalledWith(
        '+27820000001',
        expect.stringContaining('has accepted your *Plumbing* request'),
        'WhatsApp Provider',
        'https://wa.me/27770000001',
        expect.objectContaining({ footer: 'Chat directly with your provider.' }),
        expect.objectContaining({ templateName: 'post_match_customer_provider_accepted' }),
      )
    })

    it('does NOT send any free-form message when outside the 24h window (the JR-B bug)', async () => {
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockRejectedValueOnce(templateNotApprovedError('customer_match_found'))
      ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(false)
      expect(sendText).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything())
      expect(sendCtaUrl).not.toHaveBeenCalledWith('+27820000001', expect.anything(), expect.anything(), expect.anything(), expect.anything(), expect.anything())
      expect(db.messageEvent.create).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          to: '+27820000001',
          status: 'FAILED',
          failureReason: 'NO_ACTIVE_WHATSAPP_SERVICE_WINDOW',
          templateName: 'post_match_customer_provider_accepted',
        }),
      }))
      // CJ-03 backstop: the matched-not-told case must reach ops same-day via
      // a durable CUSTOMER_NOTIFY_FAILED ops-queue item.
      expect(db.opsQueueAssignment.upsert).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          queueType_entityId: { queueType: 'CUSTOMER_NOTIFY_FAILED', entityId: 'jr-12345678' },
        },
        create: { queueType: 'CUSTOMER_NOTIFY_FAILED', entityId: 'jr-12345678' },
      }))
    })

    it('does NOT enqueue a CUSTOMER_NOTIFY_FAILED ops item when the customer notification succeeds', async () => {
      await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(db.opsQueueAssignment.upsert).not.toHaveBeenCalled()
    })

    it('does NOT enqueue a CUSTOMER_NOTIFY_FAILED ops item for test leads', async () => {
      ;(db.lead.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ ...mockLead, isTestLead: true })
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockRejectedValueOnce(templateNotApprovedError('customer_match_found'))
      ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(false)
      expect(db.opsQueueAssignment.upsert).not.toHaveBeenCalled()
    })

    it('never lets an ops-queue write failure break the post-match flow', async () => {
      ;(db.opsQueueAssignment.upsert as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db down'))
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockRejectedValueOnce(templateNotApprovedError('customer_match_found'))
      ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(false)
      expect(result.providerNotified).toBe(true)
    })

    it('falls back to plain sendText when inside the 24h window and the rich handover URL is unavailable', async () => {
      ;(sendTemplate as ReturnType<typeof vi.fn>)
        .mockRejectedValueOnce(templateNotApprovedError('post_match_customer_provider_accepted'))
        .mockRejectedValueOnce(templateNotApprovedError('customer_match_found'))
      ;(db.inboundWhatsAppMessage.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'inb-recent' })
      ;(getCustomerProviderHandoverUrl as ReturnType<typeof vi.fn>).mockResolvedValue(null)

      const result = await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

      expect(result.customerNotified).toBe(true)
      expect(sendText).toHaveBeenCalledWith(
        '+27820000001',
        expect.stringContaining('has accepted your *Plumbing* request'),
        expect.objectContaining({ templateName: 'post_match_customer_provider_accepted' }),
      )
    })
  })
})

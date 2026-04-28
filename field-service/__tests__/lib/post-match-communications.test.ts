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
    getProviderLeadAccessUrlByLeadId: vi.fn().mockResolvedValue('https://app.plugapro.co.za/leads/access/signed-token'),
    resolveProviderLeadAccessToken: vi.fn(),
  }
})

import { db } from '@/lib/db'
import { sendButtons, sendCtaUrl, sendText } from '@/lib/whatsapp-interactive'
import { getProviderLeadAccessUrlByLeadId, resolveProviderLeadAccessToken } from '@/lib/provider-lead-access'
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
  jobRequest: {
    id: 'jr-12345678',
    category: 'Plumbing',
    customer: { id: 'cust-1', name: 'Stephanie Nkosi', phone: '+27820000001' },
    address: { street: '14 Main Road', suburb: 'Bromhof', city: 'Johannesburg', province: 'Gauteng' },
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
    ;(getProviderLeadAccessUrlByLeadId as ReturnType<typeof vi.fn>).mockResolvedValue('https://app.plugapro.co.za/leads/access/signed-token')
  })

  it('sends a named customer notification and provider post-acceptance job message', async () => {
    await notifyPostMatchAcceptance({ leadId: 'lead-1', providerId: 'provider-1', matchId: 'match-1' })

    expect(sendText).toHaveBeenCalledWith(
      '+27820000001',
      expect.stringContaining('Jacob Hesser from Plug A Pro'),
      expect.objectContaining({
        templateName: 'post_match_customer_provider_accepted',
        metadata: expect.objectContaining({ leadId: 'lead-1', matchId: 'match-1' }),
      }),
    )
    expect(sendText).not.toHaveBeenCalledWith('+27820000001', expect.stringContaining('A provider has accepted'), expect.anything())
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Your client *Stephanie* has been notified'),
      'View Job',
      'https://app.plugapro.co.za/leads/access/signed-token',
      expect.any(Object),
      expect.objectContaining({
        templateName: 'post_match_provider_job_accepted',
        metadata: expect.objectContaining({ leadId: 'lead-1' }),
      }),
    )
    expect(sendCtaUrl).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('Address: *14 Main Road, Bromhof, Johannesburg, Gauteng*'),
      'View Job',
      'https://app.plugapro.co.za/leads/access/signed-token',
      expect.any(Object),
      expect.any(Object),
    )
    expect(sendButtons).toHaveBeenCalledWith(
      '+27770000001',
      expect.stringContaining('contact the customer shortly'),
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
})

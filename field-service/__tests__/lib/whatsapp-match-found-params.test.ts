import { beforeEach, describe, expect, it, vi } from 'vitest'

// The APPROVED customer_match_found template at Meta has THREE body params:
//   {{1}} customer first name, {{2}} service label, {{3}} provider first name
// The code used to send only two (provider, service), so Meta rejected every
// send with error 132000 (param count mismatch) — customers were matched but
// never told (prod errors through 2026-07-01, same class as the JR-B bug).

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    jobRequest: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: dbMock }))

vi.mock('@/lib/whatsapp-policy', () => ({
  canSend: vi.fn().mockResolvedValue({ allowed: true }),
}))

vi.mock('@/lib/message-events', () => ({
  logOutboundMessage: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/internal-test-cohort', () => ({
  isCohortMismatch: vi.fn().mockReturnValue(false),
  isInternalTestPhone: vi.fn().mockReturnValue(false),
}))

import { sendCustomerMatchFoundNotification } from '@/lib/whatsapp'

describe('sendCustomerMatchFoundNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dbMock.jobRequest.updateMany.mockResolvedValue({ count: 1 })
    process.env.WHATSAPP_ACCESS_TOKEN = 'token'
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'phone-id'
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: 'wamid.test' }] }),
    }) as never
  })

  it('sends the three body params the approved template expects: customer, service, provider', async () => {
    await sendCustomerMatchFoundNotification({
      customerPhone: '+27820000001',
      customerName: 'Stephanie Nkosi',
      providerName: 'Jacob Hesser',
      serviceName: 'Plumbing',
      jobRequestId: 'jr-123',
    })

    expect(global.fetch).toHaveBeenCalledOnce()
    const payload = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    expect(payload.template.name).toBe('customer_match_found')
    const body = payload.template.components.find((c: { type: string }) => c.type === 'body')
    expect(body.parameters).toEqual([
      { type: 'text', text: 'Stephanie' },
      { type: 'text', text: 'Plumbing' },
      { type: 'text', text: 'Jacob' },
    ])
    const button = payload.template.components.find((c: { type: string }) => c.type === 'button')
    expect(button.parameters).toEqual([{ type: 'text', text: 'jr-123' }])
  })

  it('treats the "WhatsApp Customer" onboarding placeholder as no name - never greets "Hi WhatsApp"', async () => {
    await sendCustomerMatchFoundNotification({
      customerPhone: '+27820000001',
      customerName: 'WhatsApp Customer',
      providerName: 'Jacob Hesser',
      serviceName: 'Plumbing',
      jobRequestId: 'jr-123',
    })

    const payload = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    const body = payload.template.components.find((c: { type: string }) => c.type === 'body')
    expect(body.parameters[0]).toEqual({ type: 'text', text: 'there' })
  })

  it('falls back to a friendly greeting when the customer name is missing', async () => {
    await sendCustomerMatchFoundNotification({
      customerPhone: '+27820000001',
      customerName: null,
      providerName: 'Jacob Hesser',
      serviceName: 'Plumbing',
      jobRequestId: 'jr-123',
    })

    const payload = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body)
    const body = payload.template.components.find((c: { type: string }) => c.type === 'body')
    expect(body.parameters[0]).toEqual({ type: 'text', text: 'there' })
  })
})

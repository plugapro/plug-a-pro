// ─── Webhook security tests ───────────────────────────────────────────────────
// Tests Meta HMAC signature verification and payment webhook idempotency.
// Kept in a separate file to prevent vi.mock() hoisting conflicts with
// the existing webhooks.test.ts module-level mocks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'
import { NextRequest } from 'next/server'

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

vi.mock('@/lib/db', () => ({
  db: {
    booking: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    payment: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    messageEvent: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    inboundWhatsAppMessage: {
      create: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
  },
}))

vi.mock('@/lib/payments', () => ({
  verifyWebhookSignature: vi.fn().mockReturnValue(true),
  parseWebhookEvent: vi.fn().mockReturnValue({
    type: 'payment.success',
    bookingId: 'booking-001',
    pspReference: 'psp-ref-001',
    amountCents: 50000,
    currency: 'ZAR',
  }),
  handlePaymentSuccess: vi.fn().mockResolvedValue(undefined),
  handlePaymentFailed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/whatsapp', async () => {
  // verifyMetaSignature and verifyWebhookChallenge are pure crypto helpers that
  // now live in webhook-auth.ts. vi.importActual() resolves that lightweight
  // module without pulling in the full whatsapp.ts dependency graph.
  const { verifyMetaSignature, verifyWebhookChallenge } = await vi.importActual<
    typeof import('@/lib/webhook-auth')
  >('@/lib/webhook-auth')
  const { db } = await import('@/lib/db')

  async function processWebhookEvent(payload: { object: string; entry?: Array<{ id: string; changes?: Array<{ value: { messaging_product?: string; statuses?: Array<{ id: string; status: string; timestamp: string; recipient_id: string; conversation?: unknown; pricing?: unknown; errors?: Array<{ message: string }> }>; messages?: unknown[] }; field: string }> }> }): Promise<void> {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value
        for (const status of value.statuses ?? []) {
          await db.messageEvent.updateMany({
            where: { externalId: status.id },
            data: {
              status:
                status.status === 'delivered'
                  ? 'DELIVERED'
                  : status.status === 'read'
                  ? 'READ'
                  : status.status === 'failed'
                  ? 'FAILED'
                  : undefined,
              deliveredAt: status.status === 'delivered' ? new Date() : undefined,
              readAt: status.status === 'read' ? new Date() : undefined,
              failureReason: status.errors?.[0]?.message,
            },
          })
        }
      }
    }
  }

  return {
    verifyMetaSignature,
    verifyWebhookChallenge,
    processWebhookEvent,
    // Stub all exports that make real HTTP calls to Meta's API
    sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
    sendWhatsAppMessage: vi.fn().mockResolvedValue(undefined),
    sendTemplate: vi.fn().mockResolvedValue(undefined),
    sendText: vi.fn().mockResolvedValue(undefined),
    sendProviderOnTheWay: vi.fn().mockResolvedValue(undefined),
    sendJobOffer: vi.fn().mockResolvedValue(undefined),
    sendJobCompleted: vi.fn().mockResolvedValue(undefined),
    sendQuoteReady: vi.fn().mockResolvedValue(undefined),
    sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
    sendAdminNewApplication: vi.fn().mockResolvedValue(undefined),
    sendCustomerMatchFoundNotification: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/job-request-access', () => ({
  getJobRequestAccessUrl: vi.fn().mockResolvedValue('https://app.plugapro.co.za/requests/access/test-token'),
  ensureJobRequestAccessToken: vi.fn().mockResolvedValue({ token: 'test-token', expiresAt: new Date(Date.now() + 86400000) }),
  resolveJobRequestAccessToken: vi.fn(),
  resolveJobRequestAccessScope: vi.fn(),
}))

vi.mock('@/lib/whatsapp-bot', () => ({
  processInboundMessage: vi.fn().mockResolvedValue(undefined),
}))

// ─── Meta signature verification ─────────────────────────────────────────────

import { verifyMetaSignature } from '@/lib/webhook-auth'

function makeMetaSig(body: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex')
}

describe('verifyMetaSignature', () => {
  const SECRET = 'whatsapp-app-secret-for-test'

  beforeEach(() => {
    process.env.WHATSAPP_APP_SECRET = SECRET
  })

  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET
  })

  it('returns false when WHATSAPP_APP_SECRET is not set', () => {
    delete process.env.WHATSAPP_APP_SECRET
    expect(verifyMetaSignature('body', makeMetaSig('body', SECRET))).toBe(false)
  })

  it('returns false for empty signature', () => {
    expect(verifyMetaSignature('body', '')).toBe(false)
  })

  it('returns false for a completely wrong signature', () => {
    expect(verifyMetaSignature('body', 'sha256=deadbeef')).toBe(false)
  })

  it('returns false when sha256= prefix is missing', () => {
    const raw = createHmac('sha256', SECRET).update('body').digest('hex')
    expect(verifyMetaSignature('body', raw)).toBe(false)
  })

  it('returns true for a valid HMAC-SHA256 signature', () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    expect(verifyMetaSignature(body, makeMetaSig(body, SECRET))).toBe(true)
  })

  it('returns false when body is tampered after signing', () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    const sig = makeMetaSig(body, SECRET)
    expect(verifyMetaSignature(body + 'tampered', sig)).toBe(false)
  })
})

// ─── WhatsApp POST webhook — signature enforcement ────────────────────────────

describe('POST /api/webhooks/whatsapp — signature required', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.WHATSAPP_APP_SECRET = 'test-secret'
  })

  afterEach(() => {
    delete process.env.WHATSAPP_APP_SECRET
  })

  it('rejects request with missing X-Hub-Signature-256 header (403)', async () => {
    const { POST } = await import('../../app/api/webhooks/whatsapp/route')
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    const req = new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('rejects request with wrong signature (403)', async () => {
    const { POST } = await import('../../app/api/webhooks/whatsapp/route')
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    const req = new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': 'sha256=badhash',
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(403)
  })

  it('accepts request with valid HMAC-SHA256 signature (200)', async () => {
    const { POST } = await import('../../app/api/webhooks/whatsapp/route')
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    const sig = makeMetaSig(body, 'test-secret')
    const req = new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': sig,
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
  })

  it('skips processing duplicate inbound WAMID and only increments duplicate counter', async () => {
    const { db } = await import('@/lib/db')
    const { processInboundMessage } = await import('@/lib/whatsapp-bot')
    const duplicateError = Object.assign(new Error('P2002 unique key violation'), { code: 'P2002' })
    ;(db.inboundWhatsAppMessage.create as any).mockRejectedValueOnce(duplicateError)

    const { POST } = await import('../../app/api/webhooks/whatsapp/route')
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'entry-id',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'meta-phone' },
            messages: [{
              from: '+27821234567',
              id: 'wamid.dup-1',
              type: 'text',
              text: { body: 'ops status' },
              timestamp: String(Date.now()),
            }],
          },
          field: 'messages',
        }],
      }],
    }
    const raw = JSON.stringify(payload)
    const sig = makeMetaSig(raw, 'test-secret')

    const req = new NextRequest('http://localhost/api/webhooks/whatsapp', {
      method: 'POST',
      body: raw,
      headers: {
        'Content-Type': 'application/json',
        'x-hub-signature-256': sig,
      },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(db.inboundWhatsAppMessage.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { externalId: 'wamid.dup-1' },
        data: expect.objectContaining({
          duplicateCount: { increment: 1 },
        }),
      }),
    )
    expect(processInboundMessage).not.toHaveBeenCalled()
  })
})

// ─── Payments webhook — idempotency guard ────────────────────────────────────

describe('POST /api/webhooks/payments — idempotency', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends WhatsApp confirmation on first delivery (booking not yet SCHEDULED)', async () => {
    const { db } = await import('@/lib/db')
    // Idempotency check — payment not yet PAID (first delivery)
    ;(db.payment.findUnique as any).mockResolvedValueOnce({ status: 'PENDING' })
    // Full booking for WhatsApp message
    ;(db.booking.findUnique as any).mockResolvedValueOnce({
      id: 'booking-001',
      status: 'SCHEDULED',
      scheduledDate: new Date('2026-05-01'),
      scheduledWindow: '09:00–12:00',
      match: {
        jobRequest: {
          id: 'jr-001',
          category: 'Plumbing',
          customer: { name: 'Alice', phone: '+27821234567' },
        },
      },
    })

    const { POST } = await import('../../app/api/webhooks/payments/route')
    const req = new NextRequest('http://localhost/api/webhooks/payments', {
      method: 'POST',
      body: '{"type":"payment.success"}',
      headers: { 'Content-Type': 'application/json', 'x-signature': 'valid' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const { sendBookingConfirmation } = await import('@/lib/whatsapp')
    expect(sendBookingConfirmation).toHaveBeenCalledOnce()
    expect(sendBookingConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        bookingUrl: expect.stringContaining('/requests/access/'),
      }),
    )
  })

  it('skips WhatsApp confirmation on duplicate delivery (booking already SCHEDULED)', async () => {
    const { db } = await import('@/lib/db')
    // Idempotency check — payment already PAID from a prior webhook delivery
    ;(db.payment.findUnique as any).mockResolvedValueOnce({ status: 'PAID' })

    const { POST } = await import('../../app/api/webhooks/payments/route')
    const req = new NextRequest('http://localhost/api/webhooks/payments', {
      method: 'POST',
      body: '{"type":"payment.success"}',
      headers: { 'Content-Type': 'application/json', 'x-signature': 'valid' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const { sendBookingConfirmation } = await import('@/lib/whatsapp')
    expect(sendBookingConfirmation).not.toHaveBeenCalled()
  })

  it('does not leak raw handler errors in the webhook response body', async () => {
    const { handlePaymentSuccess } = await import('@/lib/payments')
    ;(handlePaymentSuccess as any).mockRejectedValueOnce(new Error('database timeout: internal stack'))

    const { db } = await import('@/lib/db')
    ;(db.payment.findUnique as any).mockResolvedValueOnce({ status: 'PENDING' })

    const { POST } = await import('../../app/api/webhooks/payments/route')
    const req = new NextRequest('http://localhost/api/webhooks/payments', {
      method: 'POST',
      body: '{"type":"payment.success"}',
      headers: { 'Content-Type': 'application/json', 'x-signature': 'valid' },
    })

    const res = await POST(req)
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body).toEqual({ status: 'error' })
    expect(JSON.stringify(body)).not.toContain('database timeout')
  })
})

// Note: WhatsApp sender → provider mapping tests live in
// __tests__/lib/whatsapp-identity.test.ts (sender mismatch and unknown-sender
// cases are covered by the 'returns unknown for a new number' and
// 'returns provider for an approved active provider number' tests there).

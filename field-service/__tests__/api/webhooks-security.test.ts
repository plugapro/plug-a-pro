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
      update: vi.fn().mockResolvedValue({}),
    },
    messageEvent: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
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

vi.mock('@/lib/whatsapp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp')>()
  return {
    ...actual,
    sendBookingConfirmation: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/whatsapp-bot', () => ({
  processInboundMessage: vi.fn().mockResolvedValue(undefined),
}))

// ─── Meta signature verification ─────────────────────────────────────────────

import { verifyMetaSignature } from '@/lib/whatsapp'

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
})

// ─── Payments webhook — idempotency guard ────────────────────────────────────

describe('POST /api/webhooks/payments — idempotency', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends WhatsApp confirmation on first delivery (booking not yet SCHEDULED)', async () => {
    const { db } = await import('@/lib/db')
    ;(db.booking.findUnique as any)
      // First call: idempotency check — not yet SCHEDULED
      .mockResolvedValueOnce({ status: 'PENDING' })
      // Second call: full booking for WhatsApp message
      .mockResolvedValueOnce({
        id: 'booking-001',
        status: 'SCHEDULED',
        scheduledDate: new Date('2026-05-01'),
        scheduledWindow: '09:00–12:00',
        match: {
          jobRequest: {
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
  })

  it('skips WhatsApp confirmation on duplicate delivery (booking already SCHEDULED)', async () => {
    const { db } = await import('@/lib/db')
    // Idempotency check — already SCHEDULED from a prior webhook delivery
    ;(db.booking.findUnique as any).mockResolvedValueOnce({ status: 'SCHEDULED' })

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
    ;(db.booking.findUnique as any).mockResolvedValueOnce({ status: 'PENDING' })

    const { POST } = await import('../../app/api/webhooks/payments/route')
    const req = new NextRequest('http://localhost/api/webhooks/payments', {
      method: 'POST',
      body: '{"type":"payment.success"}',
      headers: { 'Content-Type': 'application/json', 'x-signature': 'valid' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toEqual({ status: 'error' })
    expect(JSON.stringify(body)).not.toContain('database timeout')
  })
})

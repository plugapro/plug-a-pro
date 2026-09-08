// ─── VodaPay notify webhook tests ─────────────────────────────────────────────
// Route: app/api/webhooks/vodapay/route.ts (Task 17).
//
// Mirrors the generic PSP webhook route's post-verification flow, so these
// tests mock the same seams (@/lib/payments handlers, the shared
// webhook-guards) plus the VodaPay-specific provider (verifyWebhook,
// parseWebhookEvent) instead of the generic verifyWebhookSignature/
// parseWebhookEvent. No DB connections - all external dependencies are mocked.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { PaymentEvent } from '@/lib/payments'

// ─── Mocks (hoisted) ──────────────────────────────────────────────────────────

const verifyWebhookMock = vi.fn(() => true)
const parseWebhookEventMock = vi.fn<() => PaymentEvent>(() => ({
  type: 'payment.success',
  bookingId: 'bk1',
  pspReference: 'psp-1',
  amount: 15000,
  currency: 'ZAR',
  raw: {},
}))

vi.mock('@/lib/payments/providers/vodapay', () => ({
  VodapayCashierProvider: class {
    verifyWebhook = verifyWebhookMock
    parseWebhookEvent = parseWebhookEventMock
  },
}))

vi.mock('@/lib/payments', () => ({
  handlePaymentSuccess: vi.fn().mockResolvedValue(undefined),
  handlePaymentFailed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/payments/webhook-guards', () => ({
  guardPaymentSuccessWebhook: vi.fn().mockResolvedValue({ outcome: 'proceed' }),
}))

vi.mock('@/lib/payment-confirmation', () => ({
  sendPaidBookingConfirmation: vi.fn().mockResolvedValue({ sent: true, outcome: 'sent' }),
}))

function makeRequest(body: string, headers: Record<string, string> = {}) {
  return new NextRequest('https://app.test/api/webhooks/vodapay', {
    method: 'POST',
    headers: { Signature: 'algorithm=RSA256,signature=x', 'Request-Time': 'T1', ...headers },
    body,
  })
}

describe('POST /api/webhooks/vodapay', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    verifyWebhookMock.mockReturnValue(true)
    parseWebhookEventMock.mockReturnValue({
      type: 'payment.success',
      bookingId: 'bk1',
      pspReference: 'psp-1',
      amount: 15000,
      currency: 'ZAR',
      raw: {},
    })
  })

  it('acks SUCCESS and calls handlePaymentSuccess for a valid payment.success notify', async () => {
    const { guardPaymentSuccessWebhook } = await import('@/lib/payments/webhook-guards')
    ;(guardPaymentSuccessWebhook as any).mockResolvedValueOnce({ outcome: 'proceed' })

    const { POST } = await import('@/app/api/webhooks/vodapay/route')
    const req = makeRequest('{"paymentRequestId":"bk1.0"}')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { resultCode: 'SUCCESS', resultStatus: 'S' } })

    const { handlePaymentSuccess } = await import('@/lib/payments')
    expect(handlePaymentSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.success', bookingId: 'bk1' }),
    )
  })

  it('returns 401 and never calls a payment handler when the signature is invalid', async () => {
    verifyWebhookMock.mockReturnValue(false)

    const { POST } = await import('@/app/api/webhooks/vodapay/route')
    const req = makeRequest('{"paymentRequestId":"bk1.0"}')
    const res = await POST(req)

    expect(res.status).toBe(401)

    const { handlePaymentSuccess, handlePaymentFailed } = await import('@/lib/payments')
    expect(handlePaymentSuccess).not.toHaveBeenCalled()
    expect(handlePaymentFailed).not.toHaveBeenCalled()
  })

  it('acks and warns (does not call a payment handler) for an unknown bookingId', async () => {
    const { guardPaymentSuccessWebhook } = await import('@/lib/payments/webhook-guards')
    ;(guardPaymentSuccessWebhook as any).mockResolvedValueOnce({ outcome: 'unknown_booking' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { POST } = await import('@/app/api/webhooks/vodapay/route')
    const req = makeRequest('{"paymentRequestId":"bk-does-not-exist.0"}')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { resultCode: 'SUCCESS', resultStatus: 'S' } })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown bookingId'))

    const { handlePaymentSuccess } = await import('@/lib/payments')
    expect(handlePaymentSuccess).not.toHaveBeenCalled()

    warnSpy.mockRestore()
  })

  it('calls handlePaymentFailed for a payment.failed notify', async () => {
    parseWebhookEventMock.mockReturnValue({
      type: 'payment.failed',
      bookingId: 'bk1',
      pspReference: 'psp-1',
      amount: 15000,
      currency: 'ZAR',
      raw: {},
    })

    const { POST } = await import('@/app/api/webhooks/vodapay/route')
    const req = makeRequest('{"paymentRequestId":"bk1.0","result":{"resultStatus":"F"}}')
    const res = await POST(req)

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { resultCode: 'SUCCESS', resultStatus: 'S' } })

    const { handlePaymentFailed } = await import('@/lib/payments')
    expect(handlePaymentFailed).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'payment.failed', bookingId: 'bk1' }),
    )

    const { guardPaymentSuccessWebhook } = await import('@/lib/payments/webhook-guards')
    expect(guardPaymentSuccessWebhook).not.toHaveBeenCalled()
  })
})

import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb, mockPayCashier, mockRefundPayment } = vi.hoisted(() => ({
  mockDb: {
    payment: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
  mockPayCashier: vi.fn(),
  mockRefundPayment: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/vodapay/client', () => ({
  payCashier: mockPayCashier,
  refundPayment: mockRefundPayment,
}))

import { VodapayCashierProvider } from '@/lib/payments/providers/vodapay'
import { buildSignaturePayload, signRequest } from '@/lib/vodapay/signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string

beforeEach(() => {
  process.env.VODAPAY_PLATFORM_PUBLIC_KEY = PUB
  process.env.VODAPAY_CLIENT_ID = 'C1'
})

describe('VodapayCashierProvider', () => {
  // The real PaymentEvent shape (lib/payments.ts) is
  // { type, bookingId, pspReference, amount, currency, raw } — NOT the
  // paymentId/amount/currency/raw shape sketched in the task brief. payCashier()
  // sets paymentRequestId = "<bookingId>.<attempt>" (see the I-4 describe block
  // below), so the notify body's paymentRequestId maps back to
  // PaymentEvent.bookingId (substring before the first '.') and its paymentId
  // maps to PaymentEvent.pspReference.
  it('parseWebhookEvent maps a SUCCESS notify to payment.success', () => {
    const body = JSON.stringify({
      paymentId: 'P1', paymentRequestId: 'pay_row_1',
      paymentAmount: { currency: 'ZAR', value: '15000' },
      paymentTime: '2026-09-07T12:00:00Z',
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(evt).toMatchObject({
      type: 'payment.success',
      bookingId: 'pay_row_1',
      pspReference: 'P1',
      amount: 15000,
      currency: 'ZAR',
    })
  })

  it('parseWebhookEvent maps a non-S resultStatus to payment.failed', () => {
    const body = JSON.stringify({
      paymentId: 'P2', paymentRequestId: 'pay_row_2',
      paymentAmount: { currency: 'ZAR', value: '5000' },
      result: { resultCode: 'FAIL', resultStatus: 'F' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(evt).toMatchObject({
      type: 'payment.failed',
      bookingId: 'pay_row_2',
      pspReference: 'P2',
      amount: 5000,
    })
  })

  it('verifyWebhook accepts a platform-signed body and rejects tampering', () => {
    const body = '{"paymentId":"P1"}'
    const payload = buildSignaturePayload({
      method: 'POST', path: '/api/webhooks/vodapay', clientId: 'C1',
      requestTime: 'T1', body,
    })
    const sig = signRequest(payload, PRIV)
    const header = `algorithm=RSA256,signature=${encodeURIComponent(sig)}`
    const p = new VodapayCashierProvider()
    expect(p.verifyWebhook(body, `${header}|T1`)).toBe(true)
    expect(p.verifyWebhook(body + 'x', `${header}|T1`)).toBe(false)
  })

  it('verifyWebhook rejects a signature with no packed request-time', () => {
    const p = new VodapayCashierProvider()
    expect(p.verifyWebhook('{}', 'algorithm=RSA256,signature=abc')).toBe(false)
  })

  it('verifyWebhook rejects when the platform public key is not configured', () => {
    delete process.env.VODAPAY_PLATFORM_PUBLIC_KEY
    const body = '{"paymentId":"P1"}'
    const payload = buildSignaturePayload({
      method: 'POST', path: '/api/webhooks/vodapay', clientId: 'C1',
      requestTime: 'T1', body,
    })
    const sig = signRequest(payload, PRIV)
    const header = `algorithm=RSA256,signature=${encodeURIComponent(sig)}`
    const p = new VodapayCashierProvider()
    expect(p.verifyWebhook(body, `${header}|T1`)).toBe(false)
  })
})

// ─── I-4: retryable paymentRequestId ───────────────────────────────────────────
// A VodaPay checkout's paymentExpiryTime is ~30 min. Reusing the same
// paymentRequestId on a retry (failed attempt, expired session, customer
// re-clicking a stale link) can never mint a new payable session at VodaPay
// ("dead payment"). createCheckout mints "<bookingId>.<n>", where n advances
// each time a checkout is re-initiated for a booking that already has one.
describe('VodapayCashierProvider.createCheckout — retryable paymentRequestId', () => {
  const CHECKOUT_PARAMS = {
    bookingId: 'ckbooking0001abc',
    amount: 45000,
    currency: 'ZAR',
    description: 'plumbing booking',
    successUrl: 'https://app.example/bookings/ckbooking0001abc',
    cancelUrl: 'https://app.example/quotes',
    notifyUrl: 'https://app.example/api/webhooks/payments',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
    mockDb.payment.update.mockResolvedValue({})
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_1', redirectUrl: 'https://vodapay.example/pay' })
  })

  it('mints "<bookingId>.0" on the first checkout for a booking (no pspCheckoutId yet)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ pspCheckoutId: null, metadata: {} })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.0' }),
    )
  })

  it('mints a fresh, incremented id when a checkout is re-initiated after a previous session exists (failure/expiry retry)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      pspCheckoutId: 'vp_prev_session', // an earlier attempt already minted a (now dead) session
      metadata: { vodapayAttempt: 0 },
    })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.1' }),
    )
  })

  it('keeps advancing across repeated retries', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      pspCheckoutId: 'vp_prev_session',
      metadata: { vodapayAttempt: 3 },
    })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.4' }),
    )
  })

  it('persists the new attempt number onto Payment.metadata (preserving unrelated keys) before contacting VodaPay', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      pspCheckoutId: 'vp_prev_session',
      metadata: { vodapayAttempt: 0, unrelatedKey: 'keep-me' },
    })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockDb.payment.update).toHaveBeenCalledWith({
      where: { bookingId: 'ckbooking0001abc' },
      data: { metadata: { vodapayAttempt: 1, unrelatedKey: 'keep-me' } },
    })
    // Written before payCashier is contacted, so the counter survives even if
    // payCashier throws.
    expect(mockDb.payment.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockPayCashier.mock.invocationCallOrder[0],
    )
  })

  it('webhook event still maps back to the booking for a first-attempt id', () => {
    mockDb.payment.findUnique.mockResolvedValue({ pspCheckoutId: null, metadata: {} })
    const body = JSON.stringify({
      paymentId: 'vp_1', paymentRequestId: 'ckbooking0001abc.0',
      paymentAmount: { currency: 'ZAR', value: '45000' },
      result: { resultStatus: 'S' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(evt.bookingId).toBe('ckbooking0001abc')
  })

  it('webhook event still maps back to the booking for a retried (incremented) id', () => {
    const body = JSON.stringify({
      paymentId: 'vp_2', paymentRequestId: 'ckbooking0001abc.4',
      paymentAmount: { currency: 'ZAR', value: '45000' },
      result: { resultStatus: 'S' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(evt.bookingId).toBe('ckbooking0001abc')
  })
})

// ─── I-2: deterministic refundRequestId ────────────────────────────────────────
// refundRequestId is VodaPay's merchant idempotency key. issueRefund() has no
// REFUNDED pre-check, so a retried refund call must resolve to the SAME
// refund request at VodaPay (a no-op there), not mint a new, real refund.
describe('VodapayCashierProvider.createRefund — deterministic refundRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRefundPayment.mockResolvedValue({ refundId: 'refund-1' })
  })

  it('derives refundRequestId only from pspReference (no Date.now()/random suffix)', async () => {
    await new VodapayCashierProvider().createRefund('vp_payment_1', 10000)

    expect(mockRefundPayment).toHaveBeenCalledWith({
      paymentId: 'vp_payment_1',
      refundRequestId: 'rf_vp_payment_1',
      amountCents: 10000,
    })
  })

  it('a retried createRefund call for the same pspReference produces the SAME refundRequestId', async () => {
    const provider = new VodapayCashierProvider()
    await provider.createRefund('vp_payment_1', 10000)
    await provider.createRefund('vp_payment_1', 10000) // simulated retry (e.g. after a timeout)

    const ids = mockRefundPayment.mock.calls.map((call) => (call[0] as { refundRequestId: string }).refundRequestId)
    expect(ids).toEqual(['rf_vp_payment_1', 'rf_vp_payment_1'])
  })
})

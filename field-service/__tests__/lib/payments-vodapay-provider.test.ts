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

import { VodapayCashierProvider, extractVodapayAttempt } from '@/lib/payments/providers/vodapay'
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

const CHECKOUT_PARAMS = {
  bookingId: 'ckbooking0001abc',
  amount: 45000,
  currency: 'ZAR',
  description: 'plumbing booking',
  successUrl: 'https://app.example/bookings/ckbooking0001abc',
  cancelUrl: 'https://app.example/quotes',
  notifyUrl: 'https://app.example/api/webhooks/payments',
}

// ─── I-4 (residual 1+2): atomic, retry-safe paymentRequestId ─────────────────
// A VodaPay checkout's paymentExpiryTime is ~30 min. Reusing the same
// paymentRequestId on a retry (failed attempt, expired session, customer
// re-clicking a stale link) can never mint a new payable session at VodaPay
// ("dead payment"). createCheckout mints "<bookingId>.<n>" via a single
// atomic `{ increment: 1 }` UPDATE on Payment.vodapayAttempt - never a
// separate read-then-write - so the counter can't be lost on a throw
// (residual 1) and can't race under concurrent initiations (residual 2).
describe('VodapayCashierProvider.createCheckout — atomic paymentRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_1', redirectUrl: 'https://vodapay.example/pay' })
  })

  it('mints "<bookingId>.0" on the very first checkout for a booking (no existing session)', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ status: 'PENDING', checkoutUrl: null, pspCheckoutId: null })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.0' }),
    )
  })

  it('increments via a single atomic { increment: 1 } update, not a read-then-write', async () => {
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })

    await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    expect(mockDb.payment.update).toHaveBeenCalledTimes(1)
    expect(mockDb.payment.update).toHaveBeenCalledWith({
      where: { bookingId: 'ckbooking0001abc' },
      data: { vodapayAttempt: { increment: 1 } },
      select: { vodapayAttempt: true },
    })
  })

  it('mints "<bookingId>.<n>" from the post-increment counter on a forced (failure-driven) retry', async () => {
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 4 })

    await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.3' }),
    )
  })

  it('residual 1: a throw from payCashier does not roll back the already-persisted counter', async () => {
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockRejectedValueOnce(new Error('network timeout'))

    await expect(
      new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true }),
    ).rejects.toThrow('network timeout')

    // The increment already happened (and was awaited) BEFORE payCashier was
    // ever called - unlike the old pspCheckoutId-gated scheme, a retry after
    // this throw reads a counter that has already advanced, so it can never
    // recompute the same ".0" id again.
    expect(mockDb.payment.update).toHaveBeenCalledOnce()
    expect(mockDb.payment.update.mock.invocationCallOrder[0]).toBeLessThan(
      mockPayCashier.mock.invocationCallOrder[0],
    )
  })

  it('webhook event still maps back to the booking for a first-attempt id', () => {
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

// ─── NEW-2a: reuse an existing unexpired session instead of re-minting ───────
// "Two payable sessions, one charge silently dropped" hazard: a duplicate/
// racing checkout initiation (e.g. a re-run quote-approval call) must hand
// back the SAME session, not open a second live one. Only the failure-driven
// retry path (which explicitly knows the previous session died - a
// payment.failed notify was just received for it) sets forceNewSession: true
// to bypass this reuse check.
describe('VodapayCashierProvider.createCheckout — session reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
  })

  it('reuses an existing PENDING session with a checkoutUrl instead of minting a new one', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      checkoutUrl: 'https://vodapay.example/pay/existing',
      pspCheckoutId: 'vp_existing',
    })

    const session = await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(session).toEqual({ id: 'vp_existing', url: 'https://vodapay.example/pay/existing' })
    expect(mockPayCashier).not.toHaveBeenCalled()
    expect(mockDb.payment.update).not.toHaveBeenCalled() // counter not advanced - no new mint happened
  })

  it('mints fresh when no checkoutUrl/pspCheckoutId is on the row yet', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ status: 'PENDING', checkoutUrl: null, pspCheckoutId: null })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledOnce()
  })

  it('forceNewSession bypasses reuse and mints fresh even when a live session already exists', async () => {
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 2 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    const session = await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    expect(session).toEqual({ id: 'vp_new', url: 'https://vodapay.example/pay/new' })
    // forceNewSession skips the reuse-check read entirely.
    expect(mockDb.payment.findUnique).not.toHaveBeenCalled()
  })

  it('NEW-4: falls back to minting fresh and logs a warning when the reuse-check lookup throws', async () => {
    mockDb.payment.findUnique.mockRejectedValue(new Error('db timeout'))
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const session = await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(session).toEqual({ id: 'vp_new', url: 'https://vodapay.example/pay/new' })
    expect(mockPayCashier).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('reusable checkout session'),
      expect.objectContaining({ bookingId: 'ckbooking0001abc' }),
    )
    warnSpy.mockRestore()
  })
})

// ─── NEW-3: parseWebhookEvent exposes the attempt for staleness detection ────
describe('VodapayCashierProvider.parseWebhookEvent — attempt exposure', () => {
  it('exposes the 0-based attempt index on event.raw for a dotted paymentRequestId', () => {
    const body = JSON.stringify({
      paymentId: 'P1', paymentRequestId: 'ckbooking0001abc.2',
      paymentAmount: { currency: 'ZAR', value: '45000' },
      result: { resultStatus: 'F' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(extractVodapayAttempt(evt.raw)).toBe(2)
  })

  it('exposes null when paymentRequestId has no dot (legacy/defensive shape)', () => {
    const body = JSON.stringify({
      paymentId: 'P1', paymentRequestId: 'pay_row_1',
      paymentAmount: { currency: 'ZAR', value: '45000' },
      result: { resultStatus: 'F' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(extractVodapayAttempt(evt.raw)).toBeNull()
  })
})

describe('extractVodapayAttempt', () => {
  it('returns null for non-VodaPay raw payloads', () => {
    expect(extractVodapayAttempt({})).toBeNull()
    expect(extractVodapayAttempt(null)).toBeNull()
    expect(extractVodapayAttempt(undefined)).toBeNull()
    expect(extractVodapayAttempt('not-an-object')).toBeNull()
    expect(extractVodapayAttempt({ vodapayAttempt: 'not-a-number' })).toBeNull()
  })

  it('returns the numeric attempt when present', () => {
    expect(extractVodapayAttempt({ vodapayAttempt: 3 })).toBe(3)
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

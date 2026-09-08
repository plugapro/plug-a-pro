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
//
// Every successful mint also persists an expiry marker (round 3, see the
// next describe block) via its own findUnique+update pair - tests that don't
// care about that write use a single mockResolvedValue() covering any number
// of findUnique/update calls (the extra fields each call doesn't need are
// harmless on a plain object mock).
describe('VodapayCashierProvider.createCheckout — atomic paymentRequestId', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_1', redirectUrl: 'https://vodapay.example/pay' })
    // No live reusable session and no pre-existing metadata, by default.
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING', checkoutUrl: null, pspCheckoutId: null, metadata: {},
    })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
  })

  it('mints "<bookingId>.0" on the very first checkout for a booking (no existing session)', async () => {
    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.0' }),
    )
  })

  it('increments the attempt counter via a single atomic { increment: 1 } update, not a read-then-write', async () => {
    await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    // The FIRST update call is always the atomic attempt increment (the
    // second, from persistVodapayExpiryMarker, is asserted separately below).
    expect(mockDb.payment.update.mock.calls[0]).toEqual([{
      where: { bookingId: 'ckbooking0001abc' },
      data: { vodapayAttempt: { increment: 1 } },
      select: { vodapayAttempt: true },
    }])
  })

  it('mints "<bookingId>.<n>" from the post-increment counter on a forced (failure-driven) retry', async () => {
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 4 })

    await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.3' }),
    )
  })

  it('residual 1: a throw from payCashier does not roll back the already-persisted counter', async () => {
    mockPayCashier.mockRejectedValueOnce(new Error('network timeout'))

    await expect(
      new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true }),
    ).rejects.toThrow('network timeout')

    // forceNewSession skips the reuse-check read, and payCashier threw before
    // the expiry-marker write could run - so the attempt increment is the
    // ONLY update call. It already happened (and was awaited) BEFORE
    // payCashier was ever called, so a retry after this throw reads a
    // counter that has already advanced and can never recompute ".0" again.
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

// ─── NEW-2a + round-3 defects 1/2: expiry-aware, provider-scoped reuse ───────
// "Two payable sessions, one charge silently dropped" hazard: a duplicate/
// racing checkout initiation (e.g. a re-run quote-approval call) must hand
// back the SAME session, not open a second live one. Only the failure-driven
// retry path (which explicitly knows the previous session died - a
// payment.failed notify was just received for it) sets forceNewSession: true
// to bypass this reuse check.
//
// Round 3: reuse additionally requires metadata.vodapayExpiresAt to be
// present AND still in the future (2 min safety margin) - not just a
// non-null checkoutUrl/pspCheckoutId, which never expire on their own and
// which a Peach-minted row can ALSO carry (during a mid-flight flag flip).
const FUTURE_ISO = new Date(Date.now() + 20 * 60_000).toISOString() // well beyond the 2 min margin
const PAST_ISO = new Date(Date.now() - 60_000).toISOString() // already expired

describe('VodapayCashierProvider.createCheckout — session reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.example'
  })

  it('reuses an existing PENDING session with a checkoutUrl AND a live (future) expiry marker', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      checkoutUrl: 'https://vodapay.example/pay/existing',
      pspCheckoutId: 'vp_existing',
      metadata: { vodapayExpiresAt: FUTURE_ISO },
    })

    const session = await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(session).toEqual({ id: 'vp_existing', url: 'https://vodapay.example/pay/existing' })
    expect(mockPayCashier).not.toHaveBeenCalled()
    expect(mockDb.payment.update).not.toHaveBeenCalled() // counter not advanced - no new mint happened
  })

  it('mints fresh when no checkoutUrl/pspCheckoutId is on the row yet', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ status: 'PENDING', checkoutUrl: null, pspCheckoutId: null, metadata: {} })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledOnce()
  })

  // Round 3 defect 1: an expiry marker in the past must NOT be reused, even
  // though checkoutUrl/pspCheckoutId are still populated - the customer
  // abandoned this session and no payment.failed notify ever arrives for it.
  it('defect 1: an EXPIRED VodaPay session (past vodapayExpiresAt) is not reused - mints fresh with an advanced attempt', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      checkoutUrl: 'https://vodapay.example/pay/dead',
      pspCheckoutId: 'vp_dead',
      metadata: { vodapayExpiresAt: PAST_ISO },
    })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 2 }) // one prior mint already happened
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    const session = await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledWith(
      expect.objectContaining({ paymentRequestId: 'ckbooking0001abc.1' }), // advanced, not ".0" again
    )
    expect(session).toEqual({ id: 'vp_new', url: 'https://vodapay.example/pay/new' })
  })

  // Round 3 defect 2: during a flag flip a booking's row can carry a live
  // PEACH session (checkoutUrl/pspCheckoutId set) with pspProvider already
  // re-stamped to 'vodapay'. Only this provider ever writes
  // metadata.vodapayExpiresAt, so a Peach-minted row never has it - the
  // missing marker alone must force a fresh, self-consistent VodaPay mint,
  // never a reuse of the foreign Peach session.
  it('defect 2: a Peach-shaped row (live checkoutUrl, no vodapayExpiresAt marker) is not reused - mints a fresh VodaPay session', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING',
      checkoutUrl: 'https://secure.peachpayments.com/api/v1/paymentWidgets.js?checkoutId=peach_123',
      pspCheckoutId: 'peach_123',
      metadata: {}, // no vodapayExpiresAt key at all
    })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    const session = await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    expect(mockPayCashier).toHaveBeenCalledOnce()
    // The returned session is VodaPay's own, self-consistent one - never the
    // foreign Peach id/url (the outer lib/payments.ts#createCheckout() then
    // overwrites Payment.pspCheckoutId/checkoutUrl with exactly this,
    // completing the self-consistent row).
    expect(session).toEqual({ id: 'vp_new', url: 'https://vodapay.example/pay/new' })
  })

  it('metadata preservation: an unrelated existing metadata key survives the expiry-marker write', async () => {
    mockDb.payment.findUnique.mockResolvedValue({
      status: 'PENDING', checkoutUrl: null, pspCheckoutId: null,
      metadata: { unrelatedKey: 'keep-me' },
    })
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 1 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    await new VodapayCashierProvider().createCheckout(CHECKOUT_PARAMS)

    // Second update call is persistVodapayExpiryMarker's write.
    const [marker] = mockDb.payment.update.mock.calls[1]
    expect(marker.data.metadata).toEqual({
      unrelatedKey: 'keep-me',
      vodapayExpiresAt: expect.any(String),
    })
  })

  it('forceNewSession bypasses reuse and mints fresh even when a live session already exists', async () => {
    mockDb.payment.findUnique.mockResolvedValue({ metadata: {} }) // only read by persistVodapayExpiryMarker now
    mockDb.payment.update.mockResolvedValue({ vodapayAttempt: 2 })
    mockPayCashier.mockResolvedValue({ paymentId: 'vp_new', redirectUrl: 'https://vodapay.example/pay/new' })

    const session = await new VodapayCashierProvider().createCheckout({ ...CHECKOUT_PARAMS, forceNewSession: true })

    expect(session).toEqual({ id: 'vp_new', url: 'https://vodapay.example/pay/new' })
    expect(mockPayCashier).toHaveBeenCalledOnce()
    // forceNewSession skips the reuse-check read; the ONE findUnique call
    // that does happen is persistVodapayExpiryMarker's own metadata read.
    expect(mockDb.payment.findUnique).toHaveBeenCalledOnce()
    expect(mockDb.payment.findUnique).toHaveBeenCalledWith({
      where: { bookingId: 'ckbooking0001abc' },
      select: { metadata: true },
    })
  })

  it('NEW-4: falls back to minting fresh and logs a warning when the reuse-check lookup throws', async () => {
    mockDb.payment.findUnique
      .mockRejectedValueOnce(new Error('db timeout')) // the reuse-check read
      .mockResolvedValue({ metadata: {} }) // persistVodapayExpiryMarker's own read
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

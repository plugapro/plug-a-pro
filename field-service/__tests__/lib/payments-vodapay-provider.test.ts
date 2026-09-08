import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
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
  // sets paymentRequestId = the booking id (stable correlation key), so the
  // notify body's paymentRequestId maps back to PaymentEvent.bookingId and its
  // paymentId maps to PaymentEvent.pspReference.
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

import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyToken, payCashier, VodapayApiError } from '@/lib/vodapay/client'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const TEST_PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const TEST_PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string

const ENV = {
  VODAPAY_CLIENT_ID: 'C1', VODAPAY_MERCHANT_ID: 'M1',
  VODAPAY_API_BASE: 'https://sandbox.example',
  VODAPAY_PRIVATE_KEY: TEST_PRIV, VODAPAY_PLATFORM_PUBLIC_KEY: TEST_PUB,
}
beforeEach(() => { Object.assign(process.env, ENV) })

function okFetch(result: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(result), { status: 200 }))
}

describe('applyToken', () => {
  it('returns token + customerId on SUCCESS', async () => {
    const fetchImpl = okFetch({
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
      accessToken: 'tok', customerId: 'u1',
    })
    const out = await applyToken('code1', { fetchImpl })
    expect(out).toMatchObject({ accessToken: 'tok', customerId: 'u1' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://sandbox.example/v2/authorizations/applyToken')
    expect((init!.headers as Record<string, string>)['Client-Id']).toBe('C1')
    expect((init!.headers as Record<string, string>)['Signature']).toMatch(/^algorithm=RSA256/)
  })
  it('throws VodapayApiError on failure resultStatus', async () => {
    const fetchImpl = okFetch({ result: { resultCode: 'AUTH_FAIL', resultStatus: 'F' } })
    await expect(applyToken('bad', { fetchImpl })).rejects.toBeInstanceOf(VodapayApiError)
  })
})

describe('payCashier', () => {
  it('extracts redirect url', async () => {
    const fetchImpl = okFetch({
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
      paymentId: 'P9', redirectActionForm: { redirectUrl: 'https://pay/checkout' },
    })
    const out = await payCashier({
      paymentRequestId: 'pr1', amountCents: 15000,
      notifyUrl: 'https://app/n', redirectUrl: 'https://app/r',
      orderDescription: 'Job', expiryIso: '2026-09-07T13:00:00Z',
    }, { fetchImpl })
    expect(out).toEqual({ paymentId: 'P9', redirectUrl: 'https://pay/checkout' })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect(body.paymentAmount).toEqual({ currency: 'ZAR', value: '15000' })
    expect(body.productCode).toBe('CASHIER_PAYMENT')
  })
})

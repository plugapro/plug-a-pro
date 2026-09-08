import { generateKeyPairSync } from 'node:crypto'
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { applyToken, payCashier, VodapayApiError } from '@/lib/vodapay/client'
import { buildSignaturePayload, signRequest } from '@/lib/vodapay/signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const TEST_PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const TEST_PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string

const ENV = {
  VODAPAY_CLIENT_ID: 'C1', VODAPAY_MERCHANT_ID: 'M1',
  VODAPAY_API_BASE: 'https://sandbox.example',
  VODAPAY_PRIVATE_KEY: TEST_PRIV, VODAPAY_PLATFORM_PUBLIC_KEY: TEST_PUB,
}
beforeEach(() => { Object.assign(process.env, ENV) })
afterEach(() => { delete process.env.VODAPAY_VERIFY_RESPONSES })

const RESPONSE_TIME = '2026-09-08T10:00:00.000Z'

/** Signs a response body the way the platform is expected to (see client.ts). */
function signedResponse(path: string, result: unknown) {
  const body = JSON.stringify(result)
  const signature = signRequest(
    buildSignaturePayload({
      method: 'POST', path, clientId: ENV.VODAPAY_CLIENT_ID, requestTime: RESPONSE_TIME, body,
    }),
    TEST_PRIV,
  )
  return new Response(body, {
    status: 200,
    headers: {
      'Response-Time': RESPONSE_TIME,
      Signature: `algorithm=RSA256, keyVersion=1, signature=${encodeURIComponent(signature)}`,
    },
  })
}

function okFetch(result: unknown, path = '/v2/authorizations/applyToken') {
  return vi.fn<typeof fetch>(async () => signedResponse(path, result))
}

function unsignedFetch(result: unknown) {
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

describe('platform response signature verification', () => {
  const OK = { result: { resultCode: 'SUCCESS', resultStatus: 'S' }, accessToken: 'tok', customerId: 'u1' }

  it('rejects an unsigned response while verification is on (default)', async () => {
    const fetchImpl = unsignedFetch(OK)
    await expect(applyToken('code1', { fetchImpl })).rejects.toMatchObject({
      resultCode: 'RESPONSE_SIGNATURE_MISSING',
    })
  })

  it('rejects a tampered body whose signature no longer matches', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const good = signedResponse('/v2/authorizations/applyToken', OK)
      // Same signature header, different body — exactly the MITM case TLS alone
      // would not catch if the transport were terminated by an attacker.
      return new Response(JSON.stringify({ ...OK, customerId: 'attacker' }), {
        status: 200,
        headers: good.headers,
      })
    })
    await expect(applyToken('code1', { fetchImpl })).rejects.toMatchObject({
      resultCode: 'RESPONSE_SIGNATURE_INVALID',
    })
  })

  it('accepts a correctly signed response', async () => {
    const out = await applyToken('code1', { fetchImpl: okFetch(OK) })
    expect(out).toMatchObject({ accessToken: 'tok', customerId: 'u1' })
  })

  it('accepts an unsigned response only when the toggle is explicitly off', async () => {
    process.env.VODAPAY_VERIFY_RESPONSES = 'false'
    const out = await applyToken('code1', { fetchImpl: unsignedFetch(OK) })
    expect(out).toMatchObject({ accessToken: 'tok', customerId: 'u1' })
  })

  it('raises a VodapayApiError (not a SyntaxError) on a non-JSON body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      const body = '<html>gateway error</html>'
      const signature = signRequest(
        buildSignaturePayload({
          method: 'POST', path: '/v2/authorizations/applyToken',
          clientId: ENV.VODAPAY_CLIENT_ID, requestTime: RESPONSE_TIME, body,
        }),
        TEST_PRIV,
      )
      return new Response(body, {
        status: 502,
        headers: {
          'Response-Time': RESPONSE_TIME,
          Signature: `algorithm=RSA256, keyVersion=1, signature=${encodeURIComponent(signature)}`,
        },
      })
    })
    await expect(applyToken('code1', { fetchImpl })).rejects.toBeInstanceOf(VodapayApiError)
  })
})

describe('payCashier', () => {
  it('extracts redirect url', async () => {
    const fetchImpl = okFetch({
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
      paymentId: 'P9', redirectActionForm: { redirectUrl: 'https://pay/checkout' },
    }, '/v2/payments/pay')
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

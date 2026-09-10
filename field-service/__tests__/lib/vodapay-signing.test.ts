import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSignaturePayload, parseSignatureHeader, signRequest, verifySignature,
} from '@/lib/vodapay/signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string

describe('vodapay signing', () => {
  const payload = buildSignaturePayload({
    method: 'POST', path: '/v2/payments/pay', clientId: 'C1',
    requestTime: '2026-09-07T12:00:00+02:00', body: '{"a":1}',
  })
  it('payload shape', () => {
    expect(payload).toBe('POST /v2/payments/pay\nC1.2026-09-07T12:00:00+02:00.{"a":1}')
  })
  it('sign/verify round-trip', () => {
    const sig = signRequest(payload, priv)
    expect(verifySignature(payload, sig, pub)).toBe(true)
  })
  it('tamper fails', () => {
    const sig = signRequest(payload, priv)
    expect(verifySignature(payload + 'x', sig, pub)).toBe(false)
  })
  it('parses signature header', () => {
    const sig = signRequest(payload, priv)
    const header = `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(sig)}`
    expect(parseSignatureHeader(header)).toEqual({ algorithm: 'RSA256', signature: sig })
  })
  it('bad header → null', () => {
    expect(parseSignatureHeader('nope')).toBeNull()
    expect(parseSignatureHeader(null)).toBeNull()
  })
})

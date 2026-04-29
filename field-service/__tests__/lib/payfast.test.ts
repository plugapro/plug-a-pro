import { createHash } from 'crypto'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  generateSignature,
  buildCheckoutPayload,
  verifyItn,
  parseItnAmountCents,
  type PayfastConfig,
  type PayfastItnPayload,
} from '../../lib/payfast'

// ─── Test helpers ─────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<PayfastConfig> = {}): PayfastConfig {
  return {
    merchantId: 'test-merchant-id',
    merchantKey: 'test-merchant-key',
    passphrase: 'test-passphrase',
    sandbox: true,
    notifyUrl: 'https://app.example.com/api/webhooks/payfast',
    returnUrl: 'https://app.example.com/provider/credits?topup=success',
    cancelUrl: 'https://app.example.com/provider/credits?topup=cancelled',
    ...overrides,
  }
}

function makeIntent() {
  return {
    id: 'clxintent0001',
    amountCents: 10_000,
    creditsToIssue: 5,
    paymentMethod: 'PAYFAST_CARD',
  }
}

function makeProvider() {
  return {
    name: 'Johannes Dlamini',
    email: 'johannes@example.com',
    phone: '+27821234567',
  }
}

/**
 * Re-compute the expected MD5 using the same algorithm as the adapter
 * so tests verify the correct output without trusting the adapter internally.
 */
function computeExpectedSignature(
  params: Record<string, string>,
  passphrase: string,
): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value !== '' && value != null) {
      parts.push(`${key}=${encodeURIComponent(value).replace(/%20/g, '+')}`)
    }
  }
  if (passphrase !== '') {
    parts.push(`passphrase=${encodeURIComponent(passphrase).replace(/%20/g, '+')}`)
  }
  return createHash('md5').update(parts.join('&')).digest('hex')
}

// ─── generateSignature ────────────────────────────────────────────────────────

describe('generateSignature', () => {
  it('produces the expected MD5 for a known set of parameters and passphrase', () => {
    const params = {
      merchant_id: '10000100',
      merchant_key: '46f0cd694581a',
      return_url: 'https://www.example.com/success',
      cancel_url: 'https://www.example.com/cancel',
      notify_url: 'https://www.example.com/notify',
      m_payment_id: 'ord-123',
      amount: '100.00',
      item_name: 'Test+Product',
    }
    const passphrase = 'jt7NOE43FZPn'

    const result = generateSignature(params, passphrase)
    const expected = computeExpectedSignature(params, passphrase)

    expect(result).toBe(expected)
    expect(result).toMatch(/^[0-9a-f]{32}$/)
  })

  it('produces a different hash when passphrase is empty vs set', () => {
    const params = { merchant_id: '100', amount: '100.00', item_name: 'Test' }
    const withPassphrase = generateSignature(params, 'secret')
    const withoutPassphrase = generateSignature(params, '')
    expect(withPassphrase).not.toBe(withoutPassphrase)
  })

  it('produces a different hash when parameter order changes', () => {
    const paramsA = { a: 'alpha', b: 'beta' }
    const paramsB = { b: 'beta', a: 'alpha' }
    // JavaScript objects preserve insertion order in modern engines.
    expect(generateSignature(paramsA, '')).not.toBe(generateSignature(paramsB, ''))
  })

  it('skips empty-string values in the hash input', () => {
    const withEmpty = generateSignature({ a: 'alpha', b: '' }, '')
    const withoutEmpty = generateSignature({ a: 'alpha' }, '')
    expect(withEmpty).toBe(withoutEmpty)
  })
})

// ─── buildCheckoutPayload ─────────────────────────────────────────────────────

describe('buildCheckoutPayload', () => {
  it('includes all required Payfast fields', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(makeIntent(), makeProvider(), config)

    expect(payload.fields.merchant_id).toBe(config.merchantId)
    expect(payload.fields.return_url).toBe(config.returnUrl)
    expect(payload.fields.cancel_url).toBe(config.cancelUrl)
    expect(payload.fields.notify_url).toBe(config.notifyUrl)
    expect(payload.fields.m_payment_id).toBe('clxintent0001')
    expect(payload.fields.amount).toBeDefined()
    expect(payload.fields.item_name).toBeDefined()
    expect(payload.fields.signature).toBeDefined()
  })

  it('formats the amount as a two-decimal string', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(makeIntent(), makeProvider(), config)
    expect(payload.fields.amount).toBe('100.00')
  })

  it('formats R200 correctly', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(
      { ...makeIntent(), amountCents: 20_000, creditsToIssue: 10 },
      makeProvider(),
      config,
    )
    expect(payload.fields.amount).toBe('200.00')
  })

  it('formats R500 correctly', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(
      { ...makeIntent(), amountCents: 50_000, creditsToIssue: 25 },
      makeProvider(),
      config,
    )
    expect(payload.fields.amount).toBe('500.00')
  })

  it('does NOT include merchant_key in the form fields', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(makeIntent(), makeProvider(), config)
    expect(payload.fields.merchant_key).toBeUndefined()
  })

  it('uses Payfast sandbox URL when sandbox=true', () => {
    const payload = buildCheckoutPayload(makeIntent(), makeProvider(), makeConfig({ sandbox: true }))
    expect(payload.action).toContain('sandbox.payfast.co.za')
  })

  it('uses Payfast live URL when sandbox=false', () => {
    const payload = buildCheckoutPayload(makeIntent(), makeProvider(), makeConfig({ sandbox: false }))
    expect(payload.action).toContain('www.payfast.co.za')
  })

  it('sets m_payment_id equal to the intent id', () => {
    const config = makeConfig()
    const intent = makeIntent()
    const payload = buildCheckoutPayload(intent, makeProvider(), config)
    expect(payload.fields.m_payment_id).toBe(intent.id)
  })

  it('maps PAYFAST_CARD to "cc"', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload({ ...makeIntent(), paymentMethod: 'PAYFAST_CARD' }, makeProvider(), config)
    expect(payload.fields.payment_method).toBe('cc')
  })

  it('maps PAYFAST_EFT to "eft"', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload({ ...makeIntent(), paymentMethod: 'PAYFAST_EFT' }, makeProvider(), config)
    expect(payload.fields.payment_method).toBe('eft')
  })

  it('maps PAYFAST_SCODE to "sc"', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload({ ...makeIntent(), paymentMethod: 'PAYFAST_SCODE' }, makeProvider(), config)
    expect(payload.fields.payment_method).toBe('sc')
  })

  it('includes provider first and last name when present', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(makeIntent(), { name: 'Johannes Dlamini' }, config)
    expect(payload.fields.name_first).toBe('Johannes')
    expect(payload.fields.name_last).toBe('Dlamini')
  })

  it('omits name fields when provider name is absent', () => {
    const config = makeConfig()
    const payload = buildCheckoutPayload(makeIntent(), {}, config)
    expect(payload.fields.name_first).toBeUndefined()
    expect(payload.fields.name_last).toBeUndefined()
  })
})

// ─── verifyItn ────────────────────────────────────────────────────────────────

describe('verifyItn', () => {
  const PAYFAST_LIVE_IP = '197.97.145.144'
  const UNKNOWN_IP = '1.2.3.4'

  function buildValidItn(params: Partial<PayfastItnPayload> = {}): PayfastItnPayload {
    const config = makeConfig({ sandbox: false })
    const base: Omit<PayfastItnPayload, 'signature'> = {
      m_payment_id: 'clxintent0001',
      pf_payment_id: 'pf-12345',
      payment_status: 'COMPLETE',
      item_name: 'Plug-A-Pro Credits',
      amount_gross: '100.00',
      amount_fee: '5.00',
      amount_net: '95.00',
      ...params,
    }
    const signature = generateSignature(
      base as Record<string, string>,
      config.passphrase,
    )
    return { ...base, signature } as PayfastItnPayload
  }

  it('returns valid for a correctly signed COMPLETE payload from a known Payfast IP', () => {
    const config = makeConfig({ sandbox: false })
    const itn = buildValidItn()
    const result = verifyItn(itn, PAYFAST_LIVE_IP, config)
    expect(result).toEqual({ valid: true })
  })

  it('returns invalid for a mismatched signature', () => {
    const config = makeConfig({ sandbox: false })
    const itn = buildValidItn()
    const result = verifyItn({ ...itn, signature: 'badhash' }, PAYFAST_LIVE_IP, config)
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('signature') })
  })

  it('returns invalid for an unrecognised source IP', () => {
    const config = makeConfig({ sandbox: false })
    const itn = buildValidItn()
    const result = verifyItn(itn, UNKNOWN_IP, config)
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('allowlist') })
  })

  it('returns invalid when remote IP is null', () => {
    const config = makeConfig({ sandbox: false })
    const itn = buildValidItn()
    const result = verifyItn(itn, null, config)
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('determined') })
  })

  it('skips IP validation in sandbox mode', () => {
    const config = makeConfig({ sandbox: true })
    const itn = buildValidItn()
    // In sandbox mode any IP (or no IP) is acceptable — only the signature matters.
    const result = verifyItn(itn, UNKNOWN_IP, config)
    expect(result).toEqual({ valid: true })
  })

  it('returns invalid for payment_status !== COMPLETE', () => {
    const config = makeConfig({ sandbox: false })
    const itn = buildValidItn({ payment_status: 'FAILED' })
    const result = verifyItn(itn, PAYFAST_LIVE_IP, config)
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('COMPLETE') })
  })

  it('returns invalid when signature field is absent', () => {
    const config = makeConfig({ sandbox: false })
    const { signature: _sig, ...itnWithoutSig } = buildValidItn()
    const result = verifyItn(itnWithoutSig as PayfastItnPayload, PAYFAST_LIVE_IP, config)
    expect(result).toMatchObject({ valid: false, reason: expect.stringContaining('missing') })
  })

  it('handles extra unknown fields in ITN payload gracefully', () => {
    const config = makeConfig({ sandbox: false })
    // Build ITN with extra fields that Payfast might add in future.
    const base: Omit<PayfastItnPayload, 'signature'> = {
      m_payment_id: 'clxintent0001',
      pf_payment_id: 'pf-99',
      payment_status: 'COMPLETE',
      item_name: 'Test',
      amount_gross: '100.00',
      amount_fee: '5.00',
      amount_net: '95.00',
      some_new_field: 'some_value',
    }
    const signature = generateSignature(base as Record<string, string>, config.passphrase)
    const itn = { ...base, signature } as PayfastItnPayload
    const result = verifyItn(itn, PAYFAST_LIVE_IP, config)
    expect(result).toEqual({ valid: true })
  })
})

// ─── parseItnAmountCents ──────────────────────────────────────────────────────

describe('parseItnAmountCents', () => {
  it('converts "100.00" to 10000', () => {
    expect(parseItnAmountCents('100.00')).toBe(10_000)
  })

  it('converts "200.00" to 20000', () => {
    expect(parseItnAmountCents('200.00')).toBe(20_000)
  })

  it('rounds correctly for floating point edge cases', () => {
    // 0.1 + 0.2 = 0.30000000000000004 in float — Math.round handles this.
    expect(parseItnAmountCents('0.30')).toBe(30)
  })

  it('returns NaN for undefined', () => {
    expect(parseItnAmountCents(undefined)).toBeNaN()
  })

  it('returns NaN for non-numeric strings', () => {
    expect(parseItnAmountCents('not-a-number')).toBeNaN()
  })
})

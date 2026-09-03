import { createHmac } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const {
  mockDb,
  mockCreditProviderWalletFromPayatWebhook,
  mockIsEnabled,
  mockReconcilePayatIntent,
} = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  mockCreditProviderWalletFromPayatWebhook: vi.fn(),
  mockIsEnabled: vi.fn(),
  mockReconcilePayatIntent: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))

vi.mock('@/lib/provider-credit-gateway-itn', () => ({
  creditProviderWalletFromPayatWebhook: mockCreditProviderWalletFromPayatWebhook,
}))

vi.mock('@/lib/flags', () => ({
  isEnabled: mockIsEnabled,
}))

vi.mock('@/lib/payat/reconcile', () => ({
  reconcilePayatIntent: mockReconcilePayatIntent,
}))

function sign(body: string) {
  return createHmac('sha256', 'webhook-secret').update(body).digest('hex')
}

function signBase64(body: string) {
  return createHmac('sha256', 'webhook-secret').update(body).digest('base64')
}

function request(payload: Record<string, unknown>, signature = sign(JSON.stringify(payload))) {
  const body = JSON.stringify(payload)
  return new NextRequest('http://localhost/api/payat/webhook', {
    method: 'POST',
    body,
    headers: {
      'Content-Type': 'application/json',
      'x-payat-signature': signature,
    },
  })
}

describe('POST /api/payat/webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PAYAT_WEBHOOK_SECRET', 'webhook-secret')
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })
    mockDb.paymentIntent.findFirst.mockResolvedValue(null)
    mockDb.paymentIntent.update.mockResolvedValue({})
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 1 })
    mockCreditProviderWalletFromPayatWebhook.mockResolvedValue({
      credited: true,
      ledgerEntryId: 'ledger-1',
    })
    // Default to legacy behaviour unless a test opts into the doorbell path.
    mockIsEnabled.mockResolvedValue(false)
  })

  it('rejects invalid signatures without touching the wallet', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }, 'bad'))

    expect(res.status).toBe(401)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('accepts base64 signatures and sha256-prefixed signatures', async () => {
    const payload = { reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }
    const body = JSON.stringify(payload)
    const signature = `sha256=${signBase64(body)}`
    const req = new NextRequest('http://localhost/api/payat/webhook', {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/json',
        'x-payat-signature': signature,
      },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('marks a matching paid Pay@ intent and credits the wallet exactly once', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: { id: 'intent-payat-1', status: 'PENDING_PAYMENT' },
      data: expect.objectContaining({
        status: 'ITN_RECEIVED',
        itnPaymentStatus: 'PAID',
        itnAmountCents: 10_000,
        gatewayReference: null,
        paidAt: expect.any(Date),
      }),
    })
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('ignores duplicate already credited webhooks without double-crediting', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'CREDITED',
      creditedAt: new Date('2026-05-12T10:00:00.000Z'),
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'COMPLETED', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('acknowledges unknown references so Pay@ does not retry forever', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'missing-intent', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('credits wallet when Pay@ sends clientReferenceNumber instead of reference', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(
      request({ clientReferenceNumber: 'intent-payat-1', status: 'PAID', amount: 10_000 }),
    )

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'intent-payat-1' } }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('rejects an underpaid cent amount instead of treating it as rands (no unit heuristic)', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')
    // A signed webhook reporting amount=100 (cents) against a 10000-cent intent is
    // an R1 underpayment. The old rand-conversion heuristic would have multiplied
    // it to 10000 cents and credited a full R100 top-up. Now it must be a mismatch.
    const res = await POST(
      request({ clientReferenceNumber: 'intent-payat-1', status: 'PAID', amount: 100 }),
    )

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ rejected: 'amount_mismatch' })

    // Intent is marked FAILED, the wallet is NOT credited.
    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'intent-payat-1' },
        data: expect.objectContaining({ status: 'FAILED', itnAmountCents: 100 }),
      }),
    )
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('falls back to paymentReference lookup when clientReferenceNumber is absent', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)
    mockDb.paymentIntent.findFirst.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ sends reference = paymentReference (e.g. PAT-ABCDEF) without clientReferenceNumber
    const res = await POST(
      request({ reference: 'PAT-ABCDEF', status: 'PAID', amount: 10_000 }),
    )

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentReference: 'PAT-ABCDEF', paymentMethod: 'PAYAT' }),
      }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('C-1: ignores a PAID webhook for an intent already marked FAILED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ITN_RECEIVED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('C-1: ignores a COMPLETED webhook for an intent already marked FAILED', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'COMPLETED', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ITN_RECEIVED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-4: CANCELLED webhook marks intent FAILED; subsequent PAID does not credit wallet', async () => {
    const { POST } = await import('@/app/api/payat/webhook/route')

    // First: CANCELLED arrives and marks the intent FAILED via updateMany
    const cancelRes = await POST(request({ reference: 'intent-payat-1', status: 'CANCELLED', amount: 10_000 }))
    expect(cancelRes.status).toBe(200)
    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )

    // Simulate DB now returning the intent as FAILED
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'FAILED',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: null,
    })

    // Delayed PAID arrives - must be ignored
    const paidRes = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))
    expect(paidRes.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-5: rejects base64 signature that decodes to wrong byte length', async () => {
    // "not-32-bytes" base64-encodes to a 9-byte buffer - not a valid SHA-256 HMAC
    const shortBase64 = Buffer.from('not-32-bytes').toString('base64')
    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }, shortBase64))
    expect(res.status).toBe(401)
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('T-6: skips secondary paymentReference lookup when clientReferenceNumber is present (even non-UUID)', async () => {
    // clientReferenceNumber is present so usedClientRef=true - secondary findFirst must not fire
    mockDb.paymentIntent.findUnique.mockResolvedValue(null)

    const { POST } = await import('@/app/api/payat/webhook/route')
    const res = await POST(request({ clientReferenceNumber: 'PAT-NOT-A-UUID', status: 'PAID', amount: 10_000 }))

    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.findFirst).not.toHaveBeenCalled()
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('C-2: uses payAtAmountCents from metadata for amount comparison when fee is present', async () => {
    // Intent was created with a R7 counter fee: amountCents=10000, payAtAmountCents=10700
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: { payAtAmountCents: 10_700 },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ reports the fee-inclusive amount - should match
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_700 }))
    expect(res.status).toBe(200)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
  })

  it('C-2: rejects payment when amount matches credit value but not the fee-inclusive payAtAmountCents', async () => {
    mockDb.paymentIntent.findUnique.mockResolvedValue({
      id: 'intent-payat-1',
      amountCents: 10_000,
      providerId: 'provider-1',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
      paymentMethod: 'PAYAT',
      metadata: { payAtAmountCents: 10_700 },
    })

    const { POST } = await import('@/app/api/payat/webhook/route')
    // Pay@ reports 10000 but we expected 10700 - amount mismatch, mark FAILED
    const res = await POST(request({ reference: 'intent-payat-1', status: 'PAID', amount: 10_000 }))
    expect(res.status).toBe(200)
    expect(mockDb.paymentIntent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    )
    expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  describe('doorbell mode (payments.payat.readback_verification)', () => {
    it('ignores a webhook-claimed amount and credits from the Pay@ read instead', async () => {
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({ action: 'credited', ledgerEntryId: 'led-1' })

      const { POST } = await import('@/app/api/payat/webhook/route')
      // Webhook lies: claims R1 paid against an R100 (10000-cent) intent.
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 100 }),
      )

      expect(res.status).toBe(200)
      // The decision came from the read, not the payload.
      expect(mockReconcilePayatIntent).toHaveBeenCalledWith('intent-1')
      expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
      expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
    })

    it('returns 200 without crediting when the read says the payment is not complete', async () => {
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'SENT' })

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ received: true })
      expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
    })

    it('falls back to legacy payload-trusting behaviour when the flag is off', async () => {
      mockIsEnabled.mockResolvedValue(false)

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockReconcilePayatIntent).not.toHaveBeenCalled()
    })

    it('does NOT ack-and-drop a sourceReference-only webhook the read-back cannot resolve', async () => {
      // Doorbell mode resolves by primary key only, so a Pay@ notification
      // carrying reference/sourceReference yields "intent not found". Acking
      // that with a 200 loses the payment: Pay@ never retries. It must fall
      // through to the legacy paymentReference lookup, which credits today.
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({ action: 'skipped', reason: 'intent not found' })
      mockDb.paymentIntent.findUnique.mockResolvedValue(null)
      mockDb.paymentIntent.findFirst.mockResolvedValue({
        id: 'intent-payat-1',
        amountCents: 10_000,
        providerId: 'provider-1',
        status: 'PENDING_PAYMENT',
        creditedAt: null,
        paymentMethod: 'PAYAT',
        metadata: null,
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ sourceReference: 'PAT-ABCDEF', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockDb.paymentIntent.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ paymentReference: 'PAT-ABCDEF', paymentMethod: 'PAYAT' }),
        }),
      )
      expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.webhook_readback_fallthrough"')
      )
      warnSpy.mockRestore()
    })

    it('falls through to the legacy path for a pre-migration intent with no clientAccountNumber', async () => {
      // Every intent created before this deploy has a null clientAccountNumber
      // and can never be read back. The sweep cannot rescue them either (it
      // filters clientAccountNumber: { not: null }), so dropping them here
      // would be permanent.
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({
        action: 'skipped',
        reason: 'no clientAccountNumber',
      })
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-payat-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('intent-payat-1')
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"no clientAccountNumber"')
      )
      warnSpy.mockRestore()
    })

    it('still acks a benign already-credited skip without touching the legacy path', async () => {
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({ action: 'skipped', reason: 'already credited' })

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockDb.paymentIntent.findUnique).not.toHaveBeenCalled()
      expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
    })

    it('still acks the concurrent-race loser without touching the legacy path', async () => {
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({
        action: 'skipped',
        reason: 'already credited (concurrent call)',
      })

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockDb.paymentIntent.findUnique).not.toHaveBeenCalled()
      expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
    })

    it('acks an indeterminate read without crediting or touching the legacy path', async () => {
      mockIsEnabled.mockResolvedValue(true)
      mockReconcilePayatIntent.mockResolvedValue({
        action: 'indeterminate',
        internalStatus: 'FAILED',
        expectedAmountCents: 10_700,
        amountPaidCents: 5_000,
      })

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }),
      )

      expect(res.status).toBe(200)
      expect(mockDb.paymentIntent.findUnique).not.toHaveBeenCalled()
      expect(mockCreditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
    })

    it('rejects an unsigned request before the flag or reconcile path is ever consulted', async () => {
      mockIsEnabled.mockResolvedValue(true)

      const { POST } = await import('@/app/api/payat/webhook/route')
      const res = await POST(
        request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 }, 'bad-signature'),
      )

      expect(res.status).toBe(401)
      expect(mockReconcilePayatIntent).not.toHaveBeenCalled()
    })

    it('propagates a Pay@ read failure so the route errors and Pay@ retries, instead of swallowing it', async () => {
      mockIsEnabled.mockResolvedValue(true)
      const readError = new Error('Pay@ read failed: 403 missing rtp:read scope')
      mockReconcilePayatIntent.mockRejectedValue(readError)
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { POST } = await import('@/app/api/payat/webhook/route')
      await expect(
        POST(request({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10_000 })),
      ).rejects.toThrow(readError)

      // A structured log is emitted before the throw - event, intent id, and the
      // error *name* only. Never the message/stack (may carry Pay@ response
      // content) and never the merchant identifier or provider PII.
      const logged = consoleErrorSpy.mock.calls.find(([arg]) =>
        typeof arg === 'string' && arg.includes('payat.webhook_reconcile_failed'),
      )
      expect(logged).toBeDefined()
      const parsed = JSON.parse(logged![0] as string)
      expect(parsed).toMatchObject({
        event: 'payat.webhook_reconcile_failed',
        intentId: 'intent-1',
        errorName: 'Error',
      })
      expect(JSON.stringify(parsed)).not.toContain('rtp:read')
      expect(JSON.stringify(parsed)).not.toContain('missing')

      consoleErrorSpy.mockRestore()
    })
  })
})

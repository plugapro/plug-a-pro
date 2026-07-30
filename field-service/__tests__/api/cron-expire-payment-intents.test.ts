import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    paymentIntent: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
const mockCreditProviderWalletFromPayatWebhook = vi.fn()
vi.mock('@/lib/provider-credit-gateway-itn', () => ({
  creditProviderWalletFromPayatWebhook: mockCreditProviderWalletFromPayatWebhook,
}))
const mockIsEnabled = vi.fn()
vi.mock('@/lib/flags', () => ({ isEnabled: mockIsEnabled }))
const mockReconcilePayatIntent = vi.fn()
vi.mock('@/lib/payat/reconcile', () => ({
  reconcilePayatIntent: mockReconcilePayatIntent,
}))

function cronRequest(authHeader?: string) {
  return new Request('http://localhost/api/cron/expire-payment-intents', {
    method: 'GET',
    headers: authHeader ? { authorization: authHeader } : {},
  })
}

describe('GET /api/cron/expire-payment-intents', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('CRON_SECRET', 'cron-secret')
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 3 })
    mockDb.paymentIntent.findMany.mockResolvedValue([])
    mockCreditProviderWalletFromPayatWebhook.mockResolvedValue({
      credited: true,
      ledgerEntryId: 'ledger-1',
    })
    // Reconcile sweep is OFF by default so existing (pre-amendment) tests
    // exercise the unchanged behaviour.
    mockIsEnabled.mockResolvedValue(false)
    mockReconcilePayatIntent.mockReset()
  })

  it('rejects requests without an authorization header', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest())

    expect(res.status).toBe(401)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
  })

  it('rejects requests with a wrong bearer token', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer wrong-secret'))

    expect(res.status).toBe(401)
    expect(mockDb.paymentIntent.updateMany).not.toHaveBeenCalled()
  })

  it('returns the count of expired intents on success', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatReconciled: 0,
      payatReconcileSkipped: 0,
      silentExpiries: 0,
      payatDeferred: 0,
      payatItnRecovered: 0,
      payatItnSkipped: 0,
      payatItnFailed: 0,
    })
  })

  it('queries with the correct updateMany predicate targeting only lapsed PENDING_PAYMENT intents', async () => {
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    await GET(cronRequest('Bearer cron-secret'))

    expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
      where: {
        status: 'PENDING_PAYMENT',
        expiresAt: { lt: expect.any(Date), not: null },
      },
      data: { status: 'EXPIRED' },
    })
  })

  it('returns zero expired when nothing has lapsed', async () => {
    mockDb.paymentIntent.updateMany.mockResolvedValue({ count: 0 })
    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ expired: 0 })
  })

  it('retries eligible PAYAT ITN_RECEIVED intents and counts recovery outcomes', async () => {
    mockDb.paymentIntent.findMany.mockResolvedValue([
      { id: 'payat-intent-1' },
      { id: 'payat-intent-2' },
    ])
    mockCreditProviderWalletFromPayatWebhook
      .mockResolvedValueOnce({ credited: true, ledgerEntryId: 'ledger-1' })
      .mockResolvedValueOnce({ credited: false, reason: 'already credited (concurrent call)' })

    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatItnRecovered: 1,
      payatItnSkipped: 1,
      payatItnFailed: 0,
    })
    expect(mockDb.paymentIntent.findMany).toHaveBeenCalledWith({
      where: {
        paymentMethod: 'PAYAT',
        status: 'ITN_RECEIVED',
        creditedAt: null,
        itnPaymentStatus: { in: ['PAID', 'COMPLETED'] },
        itnReceivedAt: { not: null },
      },
      select: { id: true },
      orderBy: { itnReceivedAt: 'asc' },
      take: 25,
    })
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledTimes(2)
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('payat-intent-1')
    expect(mockCreditProviderWalletFromPayatWebhook).toHaveBeenCalledWith('payat-intent-2')
  })

  it('counts recovery failures when PAYAT ITN recovery throws', async () => {
    mockDb.paymentIntent.findMany.mockResolvedValue([{ id: 'payat-intent-1' }])
    mockCreditProviderWalletFromPayatWebhook.mockRejectedValue(new Error('temporary outage'))

    const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
    const res = await GET(cronRequest('Bearer cron-secret'))

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      expired: 3,
      payatItnRecovered: 0,
      payatItnSkipped: 0,
      payatItnFailed: 1,
    })
  })

  describe('payat reconcile sweep (payments.payat.reconcile_sweep)', () => {
    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(true)
    })

    it('credits a paid-but-unnotified intent instead of expiring it', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-1', createdAt: new Date() }]) // due-for-expiry sweep
        .mockResolvedValueOnce([]) // ITN recovery batch
      mockReconcilePayatIntent.mockResolvedValue({ action: 'credited', ledgerEntryId: 'led-1' })

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(mockReconcilePayatIntent).toHaveBeenCalledWith('intent-1')
      expect(body.payatReconciled).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(body.payatDeferred).toBe(0)
    })

    it('counts an intent that expires unpaid as a silent expiry', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-2', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'SENT' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.silentExpiries).toBe(1)
      expect(body.payatDeferred).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.silent_expiry"')
      )
      errorSpy.mockRestore()
    })

    it('defers a recently-created intent still PENDING at Pay@ instead of expiring it', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-recent', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          id: { notIn: ['intent-pending-recent'] },
        },
        data: { status: 'EXPIRED' },
      })
    })

    it('stops deferring and expires a still-PENDING intent once it is older than 7 days, logging a distinct event', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-stale', createdAt: eightDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(0)
      // The updateMany predicate must not exclude this intent - it is
      // allowed to expire.
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
        },
        data: { status: 'EXPIRED' },
      })
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.reconcile_defer_timeout"')
      )
      errorSpy.mockRestore()
    })

    it('logs the skip reason without treating it as an error or failure', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-skip', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'skipped', reason: 'already credited' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatReconcileSkipped).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"already credited"')
      )
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('payat.reconcile_skipped'))
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('does not abort the sweep when reconcilePayatIntent throws for one intent', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([
          { id: 'intent-throws', createdAt: new Date() },
          { id: 'intent-3', createdAt: new Date() },
        ])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent
        .mockRejectedValueOnce(new Error('network read failed'))
        .mockResolvedValueOnce({ action: 'credited', ledgerEntryId: 'led-2' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(mockReconcilePayatIntent).toHaveBeenCalledTimes(2)
      expect(body.payatReconcileSkipped).toBe(1)
      expect(body.payatReconciled).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorName":"Error"')
      )
      errorSpy.mockRestore()
    })

    it('does not run the reconcile sweep when the flag is off', async () => {
      mockIsEnabled.mockResolvedValue(false)

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      await GET(cronRequest('Bearer cron-secret'))

      expect(mockReconcilePayatIntent).not.toHaveBeenCalled()
    })
  })
})

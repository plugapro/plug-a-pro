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
      payatReconcileFailed: 0,
      silentExpiries: 0,
      payatDeferred: 0,
      payatDeferTimeouts: 0,
      payatIndeterminate: 0,
      payatIndeterminateExpiries: 0,
      payatReadFailureExpiries: 0,
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
    const DAY_MS = 24 * 60 * 60 * 1000

    beforeEach(() => {
      mockIsEnabled.mockResolvedValue(true)
    })

    it('queries the reconcile batch ordered by expiresAt ascending, capped at 50', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([]) // due-for-expiry sweep
        .mockResolvedValueOnce([]) // ITN recovery batch

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      await GET(cronRequest('Bearer cron-secret'))

      expect(mockDb.paymentIntent.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          paymentMethod: 'PAYAT',
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          clientAccountNumber: { not: null },
        },
        select: { id: true, createdAt: true },
        orderBy: { expiresAt: 'asc' },
        take: 50,
      })
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
      expect(body.payatDeferTimeouts).toBe(0)
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
      expect(body.payatDeferTimeouts).toBe(0)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.silent_expiry"')
      )
      errorSpy.mockRestore()
    })

    it('defers a just-created intent still PENDING at Pay@ instead of expiring it', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-recent', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(body.payatDeferTimeouts).toBe(0)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          id: { notIn: ['intent-pending-recent'] },
        },
        data: { status: 'EXPIRED' },
      })
    })

    it('still defers a PENDING intent ~6 days old (inside the 7-day bound)', async () => {
      const sixDaysAgo = new Date(Date.now() - 6 * DAY_MS)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-6d', createdAt: sixDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(1)
      expect(body.payatDeferTimeouts).toBe(0)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          id: { notIn: ['intent-pending-6d'] },
        },
        data: { status: 'EXPIRED' },
      })
    })

    it('stops deferring a PENDING intent just past the 7-day bound (7 days + 1 minute old)', async () => {
      const justOverSevenDays = new Date(Date.now() - (7 * DAY_MS + 60 * 1000))
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-boundary', createdAt: justOverSevenDays }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(0)
      expect(body.payatDeferTimeouts).toBe(1)
      expect(body.silentExpiries).toBe(0)
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
        expect.stringContaining('"event":"payat.deferred_expiry"')
      )
      errorSpy.mockRestore()
    })

    it('stops deferring and expires a still-PENDING intent well past the 7-day bound, logging a distinct event, counted as payatDeferTimeouts not silentExpiries', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-pending-stale', createdAt: eightDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'PENDING' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatDeferred).toBe(0)
      expect(body.payatDeferTimeouts).toBe(1)
      expect(body.silentExpiries).toBe(0)
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
        expect.stringContaining('"event":"payat.deferred_expiry"')
      )
      errorSpy.mockRestore()
    })

    it('does NOT expire an intent Pay@ reports PAID with an unconfirmable amount', async () => {
      // The money-losing shape: Pay@ says PAID but the amount does not confirm
      // (e.g. reported in rands). Expiring is irreversible - EXPIRED is not
      // creditable - so this must defer, and must NOT be logged as a silent
      // expiry, which asserts no payment was found.
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-paid-unconfirmed', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({
        action: 'indeterminate',
        internalStatus: 'PAID',
        expectedAmountCents: 35_000,
        amountPaidCents: 350,
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatIndeterminate).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(body.payatDeferred).toBe(0)
      expect(body.payatIndeterminateExpiries).toBe(0)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          id: { notIn: ['intent-paid-unconfirmed'] },
        },
        data: { status: 'EXPIRED' },
      })
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.indeterminate_state"')
      )
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.silent_expiry"')
      )
      errorSpy.mockRestore()
    })

    it.each(['FAILED', 'UNKNOWN'] as const)(
      'does NOT expire an intent whose Pay@ state is %s (real money may have reached a till)',
      async (internalStatus) => {
        mockDb.paymentIntent.findMany
          .mockResolvedValueOnce([{ id: `intent-${internalStatus}`, createdAt: new Date() }])
          .mockResolvedValueOnce([])
        mockReconcilePayatIntent.mockResolvedValue({
          action: 'indeterminate',
          internalStatus,
          expectedAmountCents: 10_700,
          amountPaidCents: 5_000,
        })
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

        const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
        const res = await GET(cronRequest('Bearer cron-secret'))
        const body = await res.json()

        expect(body.payatIndeterminate).toBe(1)
        expect(body.silentExpiries).toBe(0)
        expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
          where: {
            status: 'PENDING_PAYMENT',
            expiresAt: { lt: expect.any(Date), not: null },
            id: { notIn: [`intent-${internalStatus}`] },
          },
          data: { status: 'EXPIRED' },
        })
        errorSpy.mockRestore()
      },
    )

    it('stops deferring an indeterminate intent past the 7-day bound, with its own event', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-indeterminate-stale', createdAt: eightDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({
        action: 'indeterminate',
        internalStatus: 'FAILED',
        expectedAmountCents: 10_700,
        amountPaidCents: 5_000,
      })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatIndeterminate).toBe(0)
      expect(body.payatIndeterminateExpiries).toBe(1)
      expect(body.silentExpiries).toBe(0)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
        },
        data: { status: 'EXPIRED' },
      })
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.indeterminate_expiry"')
      )
      errorSpy.mockRestore()
    })

    it('emits a distinct event when a throwing read gives up past the 7-day bound', async () => {
      // The sustained-403 rollout shape: rtp:read is never granted, so on day 7
      // intents start being permanently expired. Without its own event that is
      // indistinguishable from a transient failure that retries next hour.
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-403-stale', createdAt: eightDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockRejectedValue(new Error('403 insufficient scope'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatReconcileFailed).toBe(1)
      expect(body.payatReadFailureExpiries).toBe(1)
      const logged = errorSpy.mock.calls.find(([arg]) =>
        typeof arg === 'string' && arg.includes('payat.read_failure_expiry'),
      )
      expect(logged).toBeDefined()
      // Error NAME only - never the message, which can carry Pay@ content.
      expect(JSON.parse(logged![0] as string)).toMatchObject({
        event: 'payat.read_failure_expiry',
        intentId: 'intent-403-stale',
        errorName: 'Error',
      })
      expect(logged![0] as string).not.toContain('insufficient scope')
      errorSpy.mockRestore()
    })

    it('does not count a deferred read failure as a read-failure expiry', async () => {
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-403-recent', createdAt: new Date() }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockRejectedValue(new Error('403 insufficient scope'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatReconcileFailed).toBe(1)
      expect(body.payatReadFailureExpiries).toBe(0)
      expect(errorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('payat.read_failure_expiry')
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
      expect(body.payatReconcileFailed).toBe(0)
      expect(body.silentExpiries).toBe(0)
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('"reason":"already credited"')
      )
      expect(errorSpy).not.toHaveBeenCalledWith(expect.stringContaining('payat.reconcile_skipped'))
      errorSpy.mockRestore()
      warnSpy.mockRestore()
    })

    it('defers (does not expire) a recent intent when reconcilePayatIntent throws, and counts it as failed not skipped', async () => {
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
      expect(body.payatReconcileSkipped).toBe(0)
      expect(body.payatReconcileFailed).toBe(1)
      expect(body.payatReconciled).toBe(1)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"errorName":"Error"')
      )
      // A throw means we don't know whether the provider paid - the intent
      // must not be expired this run (money-losing direction is never OK).
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          id: { notIn: ['intent-throws'] },
        },
        data: { status: 'EXPIRED' },
      })
      errorSpy.mockRestore()
    })

    it('does not defer a throw for an intent older than the 7-day bound', async () => {
      const eightDaysAgo = new Date(Date.now() - 8 * DAY_MS)
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce([{ id: 'intent-throws-stale', createdAt: eightDaysAgo }])
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockRejectedValue(new Error('network read failed'))
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      const res = await GET(cronRequest('Bearer cron-secret'))
      const body = await res.json()

      expect(body.payatReconcileFailed).toBe(1)
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
        },
        data: { status: 'EXPIRED' },
      })
      errorSpy.mockRestore()
    })

    it('protects un-swept PAYAT intents from expiring when the batch cap is hit', async () => {
      const dueBatch = Array.from({ length: 50 }, (_, i) => ({
        id: `intent-batch-${i}`,
        createdAt: new Date(),
      }))
      mockDb.paymentIntent.findMany
        .mockResolvedValueOnce(dueBatch)
        .mockResolvedValueOnce([])
      mockReconcilePayatIntent.mockResolvedValue({ action: 'not_paid', internalStatus: 'SENT' })
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      const { GET } = await import('@/app/api/cron/expire-payment-intents/route')
      await GET(cronRequest('Bearer cron-secret'))

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('"event":"payat.reconcile_batch_saturated"')
      )
      expect(mockDb.paymentIntent.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: expect.any(Date), not: null },
          NOT: {
            OR: [
              { id: { in: [] } },
              {
                paymentMethod: 'PAYAT',
                clientAccountNumber: { not: null },
                id: { notIn: dueBatch.map((i) => i.id) },
              },
            ],
          },
        },
        data: { status: 'EXPIRED' },
      })
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

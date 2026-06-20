import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Hoisted Sentry mocks. These represent the @sentry/nextjs surface area
// the log module is allowed to touch.
const sentryMocks = vi.hoisted(() => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  withScope: vi.fn((callback: (scope: { setTag: (k: string, v: unknown) => void; setContext: (k: string, v: unknown) => void; setLevel: (l: string) => void }) => void) => {
    const scope = {
      setTag: vi.fn(),
      setContext: vi.fn(),
      setLevel: vi.fn(),
    }
    callback(scope)
    return scope
  }),
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: sentryMocks.captureException,
  captureMessage: sentryMocks.captureMessage,
  withScope: sentryMocks.withScope,
}))

describe('identity-verification log — Sentry sink (opt-in)', () => {
  const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  beforeEach(() => {
    vi.clearAllMocks()
    consoleInfo.mockClear()
    consoleError.mockClear()
    // Default: no DSN configured → sink is OFF.
    vi.stubEnv('SENTRY_DSN', '')
    vi.stubEnv('NEXT_PUBLIC_SENTRY_DSN', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('when SENTRY_DSN is not set (default / opt-OUT)', () => {
    it('logIdentityVerificationEvent only writes to console.info', async () => {
      const { logIdentityVerificationEvent } = await import(
        '../../../lib/identity-verification/log'
      )

      logIdentityVerificationEvent('vendor.callback.received', {
        verificationId: 'ver-1',
        providerId: 'prov-1',
      })

      expect(consoleInfo).toHaveBeenCalledTimes(1)
      expect(sentryMocks.captureException).not.toHaveBeenCalled()
      expect(sentryMocks.captureMessage).not.toHaveBeenCalled()
    })

    it('logIdentityVerificationError only writes to console.error', async () => {
      const { logIdentityVerificationError } = await import(
        '../../../lib/identity-verification/log'
      )

      logIdentityVerificationError(
        'vendor.callback.parse_failed',
        new Error('bad payload'),
        { verificationId: 'ver-1' },
      )

      expect(consoleError).toHaveBeenCalledTimes(1)
      expect(sentryMocks.captureException).not.toHaveBeenCalled()
    })
  })

  describe('when SENTRY_DSN is set (opt-IN)', () => {
    beforeEach(() => {
      vi.stubEnv('SENTRY_DSN', 'https://example@o0.ingest.sentry.io/0')
    })

    it('logIdentityVerificationError forwards the error to Sentry with verification tags', async () => {
      const { logIdentityVerificationError } = await import(
        '../../../lib/identity-verification/log'
      )

      const err = new Error('vendor 5xx')
      logIdentityVerificationError('vendor.submit.failed', err, {
        verificationId: 'ver-42',
        providerId: 'prov-7',
        vendor: 'didit',
        action: 'submit',
        unrelated: 'ignored-in-tags',
      })

      // Console regression — must still log.
      expect(consoleError).toHaveBeenCalledTimes(1)

      // Sentry should have received the error.
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1)
      expect(sentryMocks.captureException).toHaveBeenCalledWith(err)

      // withScope ran exactly once and tagged verification metadata.
      expect(sentryMocks.withScope).toHaveBeenCalledTimes(1)
      const scopeCallback = sentryMocks.withScope.mock.calls[0]?.[0] as undefined | ((s: unknown) => void)
      expect(typeof scopeCallback).toBe('function')

      // Re-run the callback against a probe scope to assert tag wiring.
      const probe = {
        setTag: vi.fn(),
        setContext: vi.fn(),
        setLevel: vi.fn(),
      }
      scopeCallback?.(probe)

      const tagKeys = probe.setTag.mock.calls.map((c) => c[0])
      expect(tagKeys).toEqual(expect.arrayContaining(['event', 'verificationId', 'providerId', 'vendor', 'action']))

      const tagMap = Object.fromEntries(probe.setTag.mock.calls)
      expect(tagMap.event).toBe('vendor.submit.failed')
      expect(tagMap.verificationId).toBe('ver-42')
      expect(tagMap.providerId).toBe('prov-7')
      expect(tagMap.vendor).toBe('didit')
      expect(tagMap.action).toBe('submit')

      // Full context (including non-tagged keys) should be on the event for grep.
      expect(probe.setContext).toHaveBeenCalledWith(
        'identity_verification',
        expect.objectContaining({
          event: 'vendor.submit.failed',
          verificationId: 'ver-42',
          unrelated: 'ignored-in-tags',
        }),
      )
    })

    it('logIdentityVerificationEvent does NOT call captureException (info-level only)', async () => {
      const { logIdentityVerificationEvent } = await import(
        '../../../lib/identity-verification/log'
      )

      logIdentityVerificationEvent('vendor.callback.received', {
        verificationId: 'ver-1',
        vendor: 'smile_id',
      })

      expect(consoleInfo).toHaveBeenCalledTimes(1)
      expect(sentryMocks.captureException).not.toHaveBeenCalled()
    })

    it('swallows Sentry errors so the KYC code path never breaks', async () => {
      sentryMocks.withScope.mockImplementationOnce(() => {
        throw new Error('Sentry transport down')
      })

      const { logIdentityVerificationError } = await import(
        '../../../lib/identity-verification/log'
      )

      // Must NOT throw — this would block KYC submission.
      expect(() =>
        logIdentityVerificationError('vendor.submit.failed', new Error('x'), {
          verificationId: 'ver-1',
        }),
      ).not.toThrow()

      // Console error path still ran.
      expect(consoleError).toHaveBeenCalled()
    })

    it('falls back to captureMessage when the thrown value is not an Error', async () => {
      const { logIdentityVerificationError } = await import(
        '../../../lib/identity-verification/log'
      )

      logIdentityVerificationError(
        'vendor.submit.failed',
        'non-error-value', // e.g. a stringified reject reason
        { verificationId: 'ver-9' },
      )

      expect(sentryMocks.captureException).not.toHaveBeenCalled()
      expect(sentryMocks.captureMessage).toHaveBeenCalledTimes(1)
      expect(sentryMocks.captureMessage).toHaveBeenCalledWith(
        expect.stringContaining('vendor.submit.failed'),
        'error',
      )
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  sendText: vi.fn(),
  bookKycFeeForVerifiedProvider: vi.fn(),
  kycFeeOutcomeSentence: vi.fn(),
  logIdentityVerificationError: vi.fn(),
  logIdentityVerificationEvent: vi.fn(),
  dbFindUnique: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mocks.sendText }))
vi.mock('@/lib/kyc-fee/booking', () => ({
  bookKycFeeForVerifiedProvider: mocks.bookKycFeeForVerifiedProvider,
}))
vi.mock('@/lib/kyc-fee/messaging', () => ({
  kycFeeOutcomeSentence: mocks.kycFeeOutcomeSentence,
}))
vi.mock('@/lib/identity-verification/log', () => ({
  logIdentityVerificationError: mocks.logIdentityVerificationError,
  logIdentityVerificationEvent: mocks.logIdentityVerificationEvent,
}))
vi.mock('@/lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findUnique: mocks.dbFindUnique,
    },
  },
}))
vi.mock('@/lib/provider-verification-token', () => ({
  issueProviderVerificationToken: vi.fn().mockResolvedValue({ token: 'token' }),
}))
vi.mock('@/lib/provider-credit-copy', () => ({
  getPublicAppUrl: vi.fn((path: string) => `https://plug.test${path}`),
}))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: vi.fn(),
  toVendorKey: (v: string | null | undefined) => v ?? null,
}))

import { transitionIdentityVerification } from '../../../lib/identity-verification/orchestrator'

// Flush all pending microtasks and macrotasks so void-fire-and-forget
// notifications have a chance to settle before assertions.
async function flushAsync() {
  // Multiple rounds to drain nested promises (db fetch → sendText)
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setImmediate(resolve))
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FakeClientOptions = {
  fromStatus?: string
  hasTransaction?: boolean
}

function makeFakeClient(options: FakeClientOptions = {}) {
  const fromStatus = options.fromStatus ?? 'NEEDS_MANUAL_REVIEW'
  const state = {
    verification: {
      id: 'ver_1',
      providerId: 'prov_1',
      status: fromStatus,
      decision: null as string | null,
    },
    events: [] as unknown[],
  }

  const base = {
    state,
    providerIdentityVerification: {
      // Return a shallow copy so mutations via .update() don't retroactively
      // change what `current` holds (the orchestrator checks current.status
      // !== input.toStatus after the update).
      findUnique: vi.fn(async () => ({ ...state.verification })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.verification, data)
        return { ...state.verification }
      }),
    },
    providerVerificationEvent: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.events.push(data)
        return data
      }),
    },
    provider: {
      update: vi.fn(async () => ({ id: 'prov_1' })),
    },
  }

  // A "root" client has $transaction; an interactive-tx client does not.
  if (options.hasTransaction) {
    return { ...base, $transaction: vi.fn() }
  }
  return base
}

const passInput = {
  verificationId: 'ver_1',
  toStatus: 'PASSED' as const,
  decision: 'PASS' as const,
}

const failInput = {
  verificationId: 'ver_1',
  toStatus: 'FAILED' as const,
  decision: 'FAIL' as const,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('KYC fee hook — transitionIdentityVerification wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.isEnabled.mockResolvedValue(true)
    mocks.bookKycFeeForVerifiedProvider.mockResolvedValue({ outcome: 'ACCRUED' })
    mocks.kycFeeOutcomeSentence.mockResolvedValue(null)
    mocks.sendText.mockResolvedValue('msg_1')
    mocks.dbFindUnique.mockResolvedValue({
      provider: { id: 'prov_1', phone: '+27711111111' },
    })
  })

  // -------------------------------------------------------------------------
  // Case a: TX client — booking called with that client; rethrows on error
  // -------------------------------------------------------------------------

  it('(a) passes the tx client as 2nd arg to booking when client has no $transaction', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: false })
    await transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1])
    expect(mocks.bookKycFeeForVerifiedProvider).toHaveBeenCalledTimes(1)
    const [, bookingClient] = mocks.bookKycFeeForVerifiedProvider.mock.calls[0]
    expect(bookingClient).toBe(client)
  })

  it('(a) rethrows booking error when inside a caller tx (no $transaction)', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: false })
    const bookingError = new Error('DB write failed')
    mocks.bookKycFeeForVerifiedProvider.mockRejectedValue(bookingError)
    await expect(
      transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1]),
    ).rejects.toThrow('DB write failed')
    expect(mocks.logIdentityVerificationError).toHaveBeenCalledWith(
      'verify.kyc_fee_booking.failed',
      bookingError,
      expect.objectContaining({ verificationId: 'ver_1', providerId: 'prov_1' }),
    )
  })

  // -------------------------------------------------------------------------
  // Case b: Root client — booking called with undefined; swallows error
  // -------------------------------------------------------------------------

  it('(b) passes undefined as 2nd arg to booking when client has $transaction (root)', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: true })
    await transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1])
    expect(mocks.bookKycFeeForVerifiedProvider).toHaveBeenCalledTimes(1)
    const [, bookingClient] = mocks.bookKycFeeForVerifiedProvider.mock.calls[0]
    expect(bookingClient).toBeUndefined()
  })

  it('(b) swallows booking error on root client so the transition itself succeeds', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: true })
    mocks.bookKycFeeForVerifiedProvider.mockRejectedValue(new Error('transient error'))
    await expect(
      transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1]),
    ).resolves.not.toThrow()
    expect(mocks.logIdentityVerificationError).toHaveBeenCalledWith(
      'verify.kyc_fee_booking.failed',
      expect.any(Error),
      expect.any(Object),
    )
  })

  // -------------------------------------------------------------------------
  // Case c: PASSED notification — skipped for tx client, fired for root client
  // -------------------------------------------------------------------------

  it('(c) does NOT fire notifyTerminalVerificationStatus for PASSED when inside a caller tx', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: false })
    await transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1])
    // Give void/async microtasks a chance to settle
    await flushAsync()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('(c) fires notifyTerminalVerificationStatus for PASSED on root client', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: true })
    await transitionIdentityVerification(passInput, client as Parameters<typeof transitionIdentityVerification>[1])
    await flushAsync()
    expect(mocks.sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('verification is complete'),
    )
  })

  // -------------------------------------------------------------------------
  // Case d: FAILED notification still fires even when inside a caller tx
  // -------------------------------------------------------------------------

  it('(d) fires notifyTerminalVerificationStatus for FAILED even inside a caller tx', async () => {
    const client = makeFakeClient({ fromStatus: 'NEEDS_MANUAL_REVIEW', hasTransaction: false })
    await transitionIdentityVerification(failInput, client as Parameters<typeof transitionIdentityVerification>[1])
    await flushAsync()
    expect(mocks.sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('could not approve'),
    )
  })
})

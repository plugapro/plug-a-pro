import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedVerificationResult, VerificationVendorAdapter } from '../../../lib/identity-verification/vendors/types'

// Heavy dynamic imports under full-suite parallel load can exceed the
// default 5s testTimeout. Bump per-file (validated 2026-06-08).
vi.setConfig({ testTimeout: 15_000 })

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  getAdapter: vi.fn(),
  issueProviderVerificationToken: vi.fn(),
  getPublicAppUrl: vi.fn(),
  sendText: vi.fn(),
  dbFindUnique: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/provider-verification-token', () => ({
  issueProviderVerificationToken: mocks.issueProviderVerificationToken,
}))
vi.mock('@/lib/provider-credit-copy', () => ({ getPublicAppUrl: mocks.getPublicAppUrl }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mocks.sendText }))
vi.mock('@/lib/db', () => ({
  db: {
    providerIdentityVerification: {
      findUnique: mocks.dbFindUnique,
    },
  },
}))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: mocks.getAdapter,
  toVendorKey: (value: string | null | undefined) => {
    if (
      value === 'smile_id' ||
      value === 'didit' ||
      value === 'thisisme' ||
      value === 'datanamix' ||
      value === 'omnicheck' ||
      value === 'manual' ||
      value === 'mock'
    ) {
      return value
    }
    return null
  },
}))

import {
  applyVendorVerdict,
  notifyTerminalVerificationStatus,
  resolveIdentityVerificationConsentVendorForSubject,
  submitVerificationForAutomation,
} from '../../../lib/identity-verification/orchestrator'

describe('provider identity verification orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_ENC_KEY', '12345678901234567890123456789012')
    mocks.issueProviderVerificationToken.mockResolvedValue({ token: 'signed-token' })
    mocks.getPublicAppUrl.mockImplementation((path: string) => `https://plug.test${path}`)
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation' ||
      key === 'provider.identity.verification.pilot_allowlist_required'
    ))
  })

  it('preserves manual-review fallback when automation is disabled', async () => {
    mocks.isEnabled.mockResolvedValue(false)
    const client = makeClient()
    mocks.getAdapter.mockReturnValue(manualAdapter())

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(client.state.verification).toMatchObject({
      status: 'NEEDS_MANUAL_REVIEW',
      decision: 'MANUAL_REVIEW',
      failureReasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED',
      sourceCheckProvider: 'manual',
      vendorReference: 'manual:ver_1',
    })
  })

  it('falls back to manual when pilot gate is required and provider is not in the allowlist', async () => {
    const client = makeClient()
    client.providerIdentityVerificationPilotAllowlist.findFirst = vi.fn(async () => null) as unknown as typeof client.providerIdentityVerificationPilotAllowlist.findFirst
    mocks.getAdapter.mockReturnValue(manualAdapter())

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(client.state.verification).toMatchObject({
      sourceCheckProvider: 'manual',
      vendorReference: 'manual:ver_1',
    })
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).toHaveBeenCalledTimes(1)
  })

  it('skips the allowlist check and routes to the active vendor when the pilot gate is disabled (GA mode)', async () => {
    mocks.isEnabled.mockImplementation(async (key: string) => (
      // pilot_allowlist_required intentionally NOT in this set — GA mode.
      key === 'provider.identity.verification.automation'
    ))
    const client = makeClient()
    client.providerIdentityVerificationPilotAllowlist.findFirst = vi.fn(async () => null) as unknown as typeof client.providerIdentityVerificationPilotAllowlist.findFirst
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:job_ga',
      immediateResult: vendorResult({ livenessVerified: true, confidence: 0.97 }),
      expectsWebhook: false,
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('PASSED')
    expect(client.state.verification.sourceCheckProvider).toBe('mock')
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })

  it('routes to the active vendor in GA mode even when the provider happens to be allowlisted', async () => {
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation'
    ))
    const client = makeClient() // default mock: allowlist findFirst returns a match
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:job_ga_allowlisted',
      immediateResult: vendorResult({ livenessVerified: true, confidence: 0.96 }),
      expectsWebhook: false,
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('PASSED')
    expect(client.state.verification.sourceCheckProvider).toBe('mock')
    // Even though the allowlist would return a match, the GA-mode flag should
    // skip the query entirely — verifies we don't waste a DB roundtrip when the
    // gate is bypassed.
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })

  it('exposes the active vendor in the consent-vendor display path when pilot gate is disabled', async () => {
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation' ||
      key === 'provider.identity.vendor.didit'
    ))
    const client = makeClient()
    client.providerIdentityVerificationPilotAllowlist.findFirst = vi.fn(async () => null) as unknown as typeof client.providerIdentityVerificationPilotAllowlist.findFirst
    client.verificationVendorConfig.findMany = vi.fn(async () => [{
      vendorKey: 'didit',
      active: true,
      confidenceThreshold: 0.85,
      livenessRequired: true,
      configJson: { displayName: 'Didit' },
    }]) as unknown as typeof client.verificationVendorConfig.findMany
    client.verificationVendorConfig.findUnique = vi.fn(async () => ({
      vendorKey: 'didit',
      configJson: { displayName: 'Didit' },
    })) as unknown as typeof client.verificationVendorConfig.findUnique

    const consent = await resolveIdentityVerificationConsentVendorForSubject({ providerId: 'prov_ga' }, client)

    expect(consent.vendorKey).toBe('didit')
    expect(consent.vendorDisplayName).toBe('Didit')
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })

  it('passes a high-confidence vendor result when liveness is already verified', async () => {
    const client = makeClient()
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:job_1',
      immediateResult: vendorResult({ livenessVerified: true, confidence: 0.98 }),
      expectsWebhook: false,
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('PASSED')
    expect(client.state.verification.status).toBe('PASSED')
    expect(client.state.verification.assuranceLevel).toBe('HIGH')
    expect(client.provider.update).toHaveBeenCalledWith({
      where: { id: 'prov_1' },
      data: { kycStatus: 'VERIFIED' },
    })
  })

  it('creates a secure liveness session when a sync PASS still needs liveness', async () => {
    const expiresAt = new Date('2026-05-26T12:30:00.000Z')
    const client = makeClient({ livenessRequired: true })
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:job_2',
      immediateResult: vendorResult({ livenessVerified: false, confidence: 0.98 }),
      expectsWebhook: true,
      liveness: {
        vendorReference: 'mock:live_2',
        sessionUrl: 'https://vendor.test/session/secret',
        expiresAt,
      },
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result).toMatchObject({
      status: 'AWAITING_LIVENESS',
      livenessUrl: 'https://plug.test/provider/verify/signed-token/liveness',
      livenessSessionExpiresAt: expiresAt,
    })
    expect(client.state.verification.livenessSessionReference).toBe('mock:live_2')
    // The vendor URL carries session material, so it is encrypted before persistence.
    expect(client.state.verification.livenessSessionUrlEncrypted).not.toContain('vendor.test')
  })

  it('reuses an existing PWA token instead of rotating the active verification link', async () => {
    const expiresAt = new Date('2026-05-26T12:30:00.000Z')
    const client = makeClient({ livenessRequired: true })
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:job_2',
      immediateResult: vendorResult({ livenessVerified: false, confidence: 0.98 }),
      expectsWebhook: true,
      liveness: {
        vendorReference: 'mock:live_2',
        sessionUrl: 'https://vendor.test/session/secret',
        expiresAt,
      },
    }))

    const result = await submitVerificationForAutomation('ver_1', client, { existingToken: 'current-token' })

    expect(mocks.issueProviderVerificationToken).not.toHaveBeenCalled()
    expect(result.livenessUrl).toBe('https://plug.test/provider/verify/current-token/liveness')
  })

  it('requires consent for the active external vendor before sharing identity data', async () => {
    const client = makeClient({ consentVendorKey: 'manual' })
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:unused',
      expectsWebhook: false,
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(mocks.getAdapter).not.toHaveBeenCalled()
    expect(client.state.verification.failureReasonCode).toBe('PROVIDER_CONSENT_REQUIRED')
  })

  it('uses Didit as the consent vendor display fallback when configJson has no displayName', async () => {
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation' ||
      key === 'provider.identity.verification.pilot_allowlist_required' ||
      key === 'provider.identity.vendor.didit'
    ))
    const client = makeClient()
    client.verificationVendorConfig.findMany = vi.fn(async () => [{
      vendorKey: 'didit',
      active: true,
      confidenceThreshold: 0.85,
      livenessRequired: true,
    }]) as unknown as typeof client.verificationVendorConfig.findMany
    client.verificationVendorConfig.findUnique = vi.fn(async () => ({
      vendorKey: 'didit',
      confidenceThreshold: 0.85,
      livenessRequired: true,
      configJson: null,
    })) as unknown as typeof client.verificationVendorConfig.findUnique

    const consentVendor = await resolveIdentityVerificationConsentVendorForSubject({ providerId: 'prov_1' }, client)

    expect(consentVendor).toEqual({
      vendorKey: 'didit',
      vendorDisplayName: 'Didit',
    })
  })

  it('routes to manual review if the configured adapter cannot be loaded safely', async () => {
    const client = makeClient()
    mocks.getAdapter.mockImplementationOnce(() => {
      throw new Error('Mock verification provider cannot be used in production')
    })

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(client.state.verification.failureReasonCode).toBe('PROVIDER_UNAVAILABLE')
  })

  it('can refresh an expired liveness session without invalidating the current PWA token', async () => {
    const expiresAt = new Date('2026-05-26T12:30:00.000Z')
    const client = makeClient({
      status: 'AWAITING_LIVENESS',
      sourceCheckProvider: 'mock',
      vendorReference: 'mock:old-job',
      livenessRequired: true,
      livenessSessionExpiresAt: new Date('2026-05-26T10:30:00.000Z'),
    })
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:new-job',
      expectsWebhook: true,
      liveness: {
        vendorReference: 'mock:new-live',
        sessionUrl: 'https://vendor.test/session/new-secret',
        expiresAt,
      },
    }))

    const result = await submitVerificationForAutomation('ver_1', client, {
      existingToken: 'current-token',
      refreshExpiredLiveness: true,
    })

    expect(mocks.issueProviderVerificationToken).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      status: 'AWAITING_LIVENESS',
      livenessUrl: 'https://plug.test/provider/verify/current-token/liveness',
    })
    expect(client.state.verification.vendorReference).toBe('mock:new-job')
    expect(client.state.verification.livenessSessionReference).toBe('mock:new-live')
  })

  it('freezes vendor verdicts into manual review when the incident flag is active', async () => {
    const client = makeClient({
      status: 'PROCESSING',
      sourceCheckProvider: 'mock',
      vendorReference: 'mock:job_3',
    })
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.freeze_vendor_verdicts'
    ))

    const result = await applyVendorVerdict(
      'ver_1',
      vendorResult({ livenessVerified: true, confidence: 0.99 }),
      'webhook',
      client,
    )

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(client.state.verification).toMatchObject({
      status: 'NEEDS_MANUAL_REVIEW',
      decision: 'MANUAL_REVIEW',
      failureReasonCode: 'VENDOR_VERDICT_FROZEN',
    })
  })

  it('cancels the orphaned vendor job when optimistic stamp loses the race with liveness in flight', async () => {
    const expiresAt = new Date('2026-05-26T12:30:00.000Z')
    const client = makeClient({ livenessRequired: true })
    // Force the stamp updateMany to return count=0 to simulate the loser branch.
    client.providerIdentityVerification.updateMany = vi.fn(async () => ({ count: 0 })) as unknown as typeof client.providerIdentityVerification.updateMany
    const cancelSpy = vi.fn(async () => ({ supported: true, vendorAcknowledged: true }))
    mocks.getAdapter.mockReturnValue({
      vendorKey: 'mock',
      submitDocumentCheck: vi.fn(async () => ({
        vendorReference: 'mock:orphan-job',
        immediateResult: undefined,
        expectsWebhook: true,
      })),
      createLivenessSession: vi.fn(async () => ({
        vendorReference: 'mock:orphan-live',
        sessionUrl: 'https://vendor.test/session/orphan',
        expiresAt,
      })),
      parseWebhook: vi.fn(),
      cancelVerificationJob: cancelSpy,
    } as unknown as VerificationVendorAdapter)

    await submitVerificationForAutomation('ver_1', client)

    // Best-effort cancel runs via void/Promise - wait a microtask tick.
    await new Promise((resolve) => setImmediate(resolve))

    expect(cancelSpy).toHaveBeenCalledWith({
      verificationId: 'ver_1',
      vendorReference: 'mock:orphan-job',
      livenessSessionReference: 'mock:orphan-live',
      reason: 'ORCHESTRATOR_CONTENTION_ORPHAN',
    })
    // The contention event must still have been recorded.
    expect(client.state.events.some((event) => {
      const e = event as { reasonCode?: string }
      return e.reasonCode === 'ORCHESTRATOR_CONTENTION'
    })).toBe(true)
  })

  it('does not call cancel on contention loss when no liveness session was minted', async () => {
    const client = makeClient({ livenessRequired: false })
    client.providerIdentityVerification.updateMany = vi.fn(async () => ({ count: 0 })) as unknown as typeof client.providerIdentityVerification.updateMany
    const cancelSpy = vi.fn(async () => ({ supported: true, vendorAcknowledged: true }))
    mocks.getAdapter.mockReturnValue({
      vendorKey: 'mock',
      submitDocumentCheck: vi.fn(async () => ({
        vendorReference: 'mock:orphan-job-2',
        immediateResult: undefined,
        expectsWebhook: true,
      })),
      parseWebhook: vi.fn(),
      cancelVerificationJob: cancelSpy,
    } as unknown as VerificationVendorAdapter)

    await submitVerificationForAutomation('ver_1', client)
    await new Promise((resolve) => setImmediate(resolve))

    expect(cancelSpy).not.toHaveBeenCalled()
  })

  it('fails closed when liveness automation is degraded', async () => {
    const client = makeClient({ livenessRequired: true })
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation' ||
      key === 'provider.identity.verification.pilot_allowlist_required' ||
      key === 'provider.identity.verification.liveness.degraded_kill_switch'
    ))
    mocks.getAdapter.mockReturnValue(vendorAdapter({
      vendorReference: 'mock:unused',
      expectsWebhook: false,
    }))

    const result = await submitVerificationForAutomation('ver_1', client)

    expect(result.status).toBe('NEEDS_MANUAL_REVIEW')
    expect(mocks.getAdapter).not.toHaveBeenCalled()
    expect(client.state.verification.failureReasonCode).toBe('PROVIDER_LIVENESS_UNAVAILABLE')
  })
})

describe('notifyTerminalVerificationStatus', () => {
  beforeEach(() => {
    mocks.sendText.mockReset()
    mocks.dbFindUnique.mockReset()
    mocks.sendText.mockResolvedValue('msg_1')
    mocks.dbFindUnique.mockResolvedValue({ provider: { phone: '+27711111111' } })
  })

  it('sends the completion message on PASSED', async () => {
    await notifyTerminalVerificationStatus('ver_1', 'PASSED')
    expect(mocks.sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('verification is complete'),
    )
  })

  it('sends the review-team message on NEEDS_MANUAL_REVIEW', async () => {
    await notifyTerminalVerificationStatus('ver_1', 'NEEDS_MANUAL_REVIEW')
    expect(mocks.sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('review team'),
    )
  })

  it('sends the support-contact message on FAILED', async () => {
    await notifyTerminalVerificationStatus('ver_1', 'FAILED')
    expect(mocks.sendText).toHaveBeenCalledWith(
      '+27711111111',
      expect.stringContaining('could not approve'),
    )
  })

  it('skips non-terminal statuses without sending', async () => {
    await notifyTerminalVerificationStatus('ver_1', 'PROCESSING')
    expect(mocks.dbFindUnique).not.toHaveBeenCalled()
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('skips silently when the provider has no phone on file', async () => {
    mocks.dbFindUnique.mockResolvedValueOnce({ provider: { phone: null } })
    await notifyTerminalVerificationStatus('ver_1', 'PASSED')
    expect(mocks.sendText).not.toHaveBeenCalled()
  })

  it('swallows send failures so a flaky WhatsApp API does not break the state transition', async () => {
    mocks.sendText.mockRejectedValueOnce(new Error('WhatsApp API 500'))
    await expect(notifyTerminalVerificationStatus('ver_1', 'PASSED')).resolves.toBeUndefined()
  })
})

function makeClient(options: {
  status?: string
  sourceCheckProvider?: string | null
  vendorReference?: string | null
  livenessRequired?: boolean
  livenessSessionExpiresAt?: Date | null
  consentVendorKey?: string | null
} = {}) {
  const state = {
    verification: {
      id: 'ver_1',
      providerId: 'prov_1',
      providerApplicationId: null,
      status: options.status ?? 'SUBMITTED',
      decision: null as string | null,
      failureReasonCode: null as string | null,
      sourceCheckProvider: options.sourceCheckProvider ?? null,
      vendorReference: options.vendorReference ?? null,
      livenessSessionReference: null,
      livenessSessionUrlEncrypted: null,
      livenessSessionExpiresAt: options.livenessSessionExpiresAt ?? null,
      consentVendorKey: options.consentVendorKey ?? 'mock',
      identityBasis: 'SA_ID',
      issuingCountry: 'ZA',
      identifierHash: 'hash_1',
      identifierLast4: '1234',
      identifierEncrypted: null,
      assuranceLevel: 'LOW',
      documents: [{
        id: 'doc_1',
        documentKind: 'ID_FRONT',
        blobKey: 'identity/doc_1.jpg',
        mimeType: 'image/jpeg',
        sha256: 'sha256-doc',
      }],
    },
    events: [] as unknown[],
    accessLogs: [] as unknown[],
  }
  const client = {
    state,
    providerIdentityVerification: {
      findUniqueOrThrow: vi.fn(async () => state.verification),
      findUnique: vi.fn(async () => state.verification),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.verification, data)
        return { count: 1 }
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.verification, data)
        return state.verification
      }),
    },
    providerVerificationEvent: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.events.push(data)
        return data
      }),
    },
    provider: {
      findUnique: vi.fn(async () => ({ kycStatus: 'NOT_STARTED' as const })),
      update: vi.fn(async () => ({ id: 'prov_1' })),
    },
    providerSensitiveDataAccessLog: {
      create: vi.fn(async ({ data }: { data: unknown }) => {
        state.accessLogs.push(data)
        return data
      }),
    },
    providerIdentityVerificationPilotAllowlist: {
      findFirst: vi.fn(async () => ({ id: 'allow_1' })),
    },
    verificationVendorConfig: {
      findMany: vi.fn(async () => [{
        vendorKey: 'mock',
        active: true,
        confidenceThreshold: 0.9,
        livenessRequired: options.livenessRequired ?? false,
      }]),
      findUnique: vi.fn(async () => ({
        vendorKey: 'mock',
        confidenceThreshold: 0.9,
        livenessRequired: options.livenessRequired ?? false,
      })),
    },
  }
  return client as typeof client & Parameters<typeof submitVerificationForAutomation>[1]
}

function manualAdapter(): VerificationVendorAdapter {
  return vendorAdapter({
    vendorReference: 'manual:ver_1',
    immediateResult: {
      decision: 'MANUAL_REVIEW',
      confidence: null,
      documentConfidence: null,
      livenessScore: null,
      selfieMatchScore: null,
      livenessVerified: null,
      riskFlags: [],
      reasonCode: 'MANUAL_REVIEW_PROVIDER_SELECTED',
      vendorReference: 'manual:ver_1',
      expiresAt: null,
    },
    expectsWebhook: false,
  }, 'manual')
}

function vendorAdapter(
  submitResult: {
    vendorReference: string
    immediateResult?: NormalizedVerificationResult
    expectsWebhook: boolean
    liveness?: { vendorReference: string; sessionUrl: string; expiresAt: Date }
  },
  vendorKey: VerificationVendorAdapter['vendorKey'] = 'mock',
): VerificationVendorAdapter {
  return {
    vendorKey,
    submitDocumentCheck: vi.fn(async () => ({
      vendorReference: submitResult.vendorReference,
      immediateResult: submitResult.immediateResult,
      expectsWebhook: submitResult.expectsWebhook,
    })),
    createLivenessSession: submitResult.liveness
      ? vi.fn(async () => submitResult.liveness!)
      : undefined,
    parseWebhook: vi.fn(),
    cancelVerificationJob: vi.fn(),
  } as unknown as VerificationVendorAdapter
}

function vendorResult(overrides: Partial<NormalizedVerificationResult>): NormalizedVerificationResult {
  return {
    decision: 'PASS',
    confidence: 0.95,
    documentConfidence: 0.96,
    livenessScore: 0.97,
    selfieMatchScore: 0.98,
    livenessVerified: true,
    riskFlags: [],
    reasonCode: null,
    vendorReference: 'mock:job_1',
    expiresAt: null,
    ...overrides,
  }
}

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NormalizedVerificationResult, VerificationVendorAdapter } from '../../../lib/identity-verification/vendors/types'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  getAdapter: vi.fn(),
  issueProviderVerificationToken: vi.fn(),
  getPublicAppUrl: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/provider-verification-token', () => ({
  issueProviderVerificationToken: mocks.issueProviderVerificationToken,
}))
vi.mock('@/lib/provider-credit-copy', () => ({ getPublicAppUrl: mocks.getPublicAppUrl }))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: mocks.getAdapter,
  toVendorKey: (value: string | null | undefined) => {
    if (
      value === 'smile_id' ||
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
  submitVerificationForAutomation,
} from '../../../lib/identity-verification/orchestrator'

describe('provider identity verification orchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_ENC_KEY', '12345678901234567890123456789012')
    mocks.issueProviderVerificationToken.mockResolvedValue({ token: 'signed-token' })
    mocks.getPublicAppUrl.mockImplementation((path: string) => `https://plug.test${path}`)
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation'
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

  it('fails closed when liveness automation is degraded', async () => {
    const client = makeClient({ livenessRequired: true })
    mocks.isEnabled.mockImplementation(async (key: string) => (
      key === 'provider.identity.verification.automation' ||
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

function makeClient(options: {
  status?: string
  sourceCheckProvider?: string | null
  vendorReference?: string | null
  livenessRequired?: boolean
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
      livenessSessionExpiresAt: null,
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

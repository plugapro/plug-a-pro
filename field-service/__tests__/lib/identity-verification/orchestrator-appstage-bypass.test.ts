/**
 * Task 2.1: Pilot allowlist bypass for application-stage subjects when quality
 * gate v2 is ON.
 *
 * Gate logic (unchanged):
 *   1. automation flag ON
 *   2. pilot_allowlist_required flag — when ON AND subject is application-stage
 *      AND quality gate v2 is ON → skip allowlist lookup (this test suite)
 *   3. exactly one active verificationVendorConfig row
 *   4. vendor flag ON
 *
 * Post-approval subjects (with providerId) must still require an allowlist row
 * even when the quality gate is ON.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  isQualityGateV2Enabled: vi.fn(),
  toVendorKey: vi.fn((v: string | null | undefined) => {
    if (
      v === 'didit' || v === 'smile_id' || v === 'thisisme' ||
      v === 'datanamix' || v === 'omnicheck' || v === 'manual' || v === 'mock'
    ) return v
    return null
  }),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/provider-onboarding/quality-gate', () => ({
  isQualityGateV2Enabled: mocks.isQualityGateV2Enabled,
}))
vi.mock('@/lib/identity-verification/vendors/registry', () => ({
  getAdapter: vi.fn(),
  toVendorKey: mocks.toVendorKey,
}))
// Stub unused transitive deps so the module loads cleanly.
vi.mock('@/lib/provider-verification-token', () => ({
  issueProviderVerificationToken: vi.fn(),
}))
vi.mock('@/lib/provider-credit-copy', () => ({
  getPublicAppUrl: vi.fn((path: string) => `https://plug.test${path}`),
}))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: vi.fn() }))
vi.mock('@/lib/db', () => ({ db: {} }))

import {
  resolveIdentityVerificationConsentVendor,
  resolveIdentityVerificationConsentVendorForSubject,
} from '../../../lib/identity-verification/orchestrator'

// ---------------------------------------------------------------------------
// Helper: minimal DB client mock (no allowlist row by default)
// ---------------------------------------------------------------------------
function makeClient(opts: {
  allowlistRow?: { id: string } | null
} = {}) {
  return {
    providerIdentityVerificationPilotAllowlist: {
      findFirst: vi.fn(async () => opts.allowlistRow ?? null),
    },
    verificationVendorConfig: {
      findMany: vi.fn(async () => [{
        vendorKey: 'didit',
        active: true,
        confidenceThreshold: 0.85,
        livenessRequired: true,
        configJson: { displayName: 'Didit' },
      }]),
      findUnique: vi.fn(async () => ({
        vendorKey: 'didit',
        configJson: { displayName: 'Didit' },
      })),
    },
  }
}

// Flags: automation ON, pilot_allowlist_required ON, didit vendor flag ON.
function withFullFlags() {
  mocks.isEnabled.mockImplementation(async (key: string) => (
    key === 'provider.identity.verification.automation' ||
    key === 'provider.identity.verification.pilot_allowlist_required' ||
    key === 'provider.identity.vendor.didit'
  ))
}

describe('resolveActiveVendorConfig — application-stage allowlist bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_ENC_KEY', '12345678901234567890123456789012')
  })

  it('resolves didit WITHOUT an allowlist row when subject is application-stage (providerApplicationDraftId) and gate is ON', async () => {
    withFullFlags()
    mocks.isQualityGateV2Enabled.mockResolvedValue(true)
    const client = makeClient() // no allowlist row

    const consent = await resolveIdentityVerificationConsentVendorForSubject(
      { providerApplicationDraftId: 'd1' },
      // Minimal mock — only the models resolveActiveVendorConfig touches.
      client as unknown as Parameters<typeof resolveIdentityVerificationConsentVendorForSubject>[1],
    )

    expect(consent.vendorKey).toBe('didit')
    expect(consent.vendorDisplayName).toBe('Didit')
    // Allowlist must NOT have been queried — bypass skips it entirely.
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })

  it('resolves didit WITHOUT an allowlist row when subject is application-stage (providerApplicationId only) and gate is ON', async () => {
    withFullFlags()
    mocks.isQualityGateV2Enabled.mockResolvedValue(true)
    const client = makeClient() // no allowlist row

    const consent = await resolveIdentityVerificationConsentVendorForSubject(
      { providerApplicationId: 'app1' },
      // Minimal mock — only the models resolveActiveVendorConfig touches.
      client as unknown as Parameters<typeof resolveIdentityVerificationConsentVendorForSubject>[1],
    )

    expect(consent.vendorKey).toBe('didit')
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })

  it('falls back to manual for post-approval subject (providerId) even when gate is ON and no allowlist row', async () => {
    withFullFlags()
    mocks.isQualityGateV2Enabled.mockResolvedValue(true)
    const client = makeClient() // no allowlist row

    const consent = await resolveIdentityVerificationConsentVendorForSubject(
      { providerId: 'p1' },
      // Minimal mock — only the models resolveActiveVendorConfig touches.
      client as unknown as Parameters<typeof resolveIdentityVerificationConsentVendorForSubject>[1],
    )

    expect(consent.vendorKey).toBe('manual')
    // Allowlist was queried — post-approval still needs it.
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).toHaveBeenCalledTimes(1)
  })

  it('falls back to manual for application-stage subject when gate is OFF and no allowlist row', async () => {
    withFullFlags()
    mocks.isQualityGateV2Enabled.mockResolvedValue(false) // gate OFF
    const client = makeClient() // no allowlist row

    const consent = await resolveIdentityVerificationConsentVendorForSubject(
      { providerApplicationDraftId: 'd1' },
      // Minimal mock — only the models resolveActiveVendorConfig touches.
      client as unknown as Parameters<typeof resolveIdentityVerificationConsentVendorForSubject>[1],
    )

    expect(consent.vendorKey).toBe('manual')
    // Gate is OFF so allowlist check still runs.
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// resolveIdentityVerificationConsentVendor (non-ForSubject variant)
// Verifies that providerApplicationDraftId is threaded from the DB snapshot
// through to resolveActiveVendorConfig so the allowlist bypass fires correctly.
// ---------------------------------------------------------------------------
describe('resolveIdentityVerificationConsentVendor — draft-anchored verification bypass', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('IDENTITY_ENC_KEY', '12345678901234567890123456789012')
  })

  it('resolves didit via the non-ForSubject variant when the verification row has providerApplicationDraftId set and providerId is null', async () => {
    withFullFlags()
    mocks.isQualityGateV2Enabled.mockResolvedValue(true)

    // Build a client that includes both the snapshot loader (findUniqueOrThrow)
    // and the models that resolveActiveVendorConfig touches.
    const snapshotRow = {
      id: 'ver_draft_1',
      providerId: null,
      providerApplicationId: null,
      providerApplicationDraftId: 'draft_1',
      documents: [],
    }
    const client = {
      providerIdentityVerification: {
        findUniqueOrThrow: vi.fn(async () => snapshotRow),
      },
      providerIdentityVerificationPilotAllowlist: {
        findFirst: vi.fn(async () => null),
      },
      verificationVendorConfig: {
        findMany: vi.fn(async () => [{
          vendorKey: 'didit',
          active: true,
          confidenceThreshold: 0.85,
          livenessRequired: true,
          configJson: { displayName: 'Didit' },
        }]),
        findUnique: vi.fn(async () => ({
          vendorKey: 'didit',
          configJson: { displayName: 'Didit' },
        })),
      },
    }

    const consent = await resolveIdentityVerificationConsentVendor(
      'ver_draft_1',
      client as unknown as Parameters<typeof resolveIdentityVerificationConsentVendor>[1],
    )

    expect(consent.vendorKey).toBe('didit')
    expect(consent.vendorDisplayName).toBe('Didit')
    // The bypass must fire — allowlist must NOT have been queried.
    expect(client.providerIdentityVerificationPilotAllowlist.findFirst).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateEnabled } = vi.hoisted(() => ({ gateEnabled: vi.fn() }))
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))

import { submitProviderApplication } from '@/lib/provider-applications-submit'
// Build a minimal fake tx client that returns no existing application, so the
// only reason to reject is the quality gate.
function fakeClient() {
  return {
    providerApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    provider: { findFirst: vi.fn().mockResolvedValue(null) },
    // add just enough of the methods submitProviderApplication touches
  } as any // TODO: type the Prisma tx stub once mock helpers are centralised
}

describe('submitProviderApplication quality gate', () => {
  beforeEach(() => gateEnabled.mockReset())

  it('rejects when gate ON and <3 evidence photos', async () => {
    gateEnabled.mockResolvedValue(true)
    await expect(
      submitProviderApplication(fakeClient(), { name: 'X', phone: '+2782', skills: ['painting'], evidenceFileUrls: ['a', 'b'] } as any, { source: 'web' } as any), // TODO: type the input payload once types are stabilised
    ).rejects.toThrow('QUALITY_GATE_EVIDENCE')
  })

  // Depends on 'plumbing' being in the high-risk set (lib/service-category-policy.ts).
  it('rejects when gate ON, high-risk skill, no certification', async () => {
    gateEnabled.mockResolvedValue(true)
    await expect(
      submitProviderApplication(fakeClient(), { name: 'X', phone: '+2782', skills: ['plumbing'], evidenceFileUrls: ['a', 'b', 'c'] } as any, { source: 'web' } as any), // TODO: type the input payload once types are stabilised
    ).rejects.toThrow('QUALITY_GATE_CERTIFICATION')
  })

  it('passes the gate when OFF regardless of evidence', async () => {
    gateEnabled.mockResolvedValue(false)
    const client = fakeClient()
    // create() resolves to a minimal application; assert it is reached
    client.providerApplication.create.mockResolvedValue({ id: 'app-1' })
    await submitProviderApplication(client, { name: 'X', phone: '+2782', skills: ['plumbing'], evidenceFileUrls: [] } as any, { source: 'web' } as any).catch(() => {}) // TODO: type the input payload once types are stabilised
    expect(gateEnabled).toHaveBeenCalled()
    expect(client.providerApplication.create).toHaveBeenCalled()
  })
})

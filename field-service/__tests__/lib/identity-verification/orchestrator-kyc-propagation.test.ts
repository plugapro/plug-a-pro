import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KycStatus } from '@prisma/client'
import type { VerificationDecision, VerificationStatus } from '../../../lib/identity-verification/types'

const mocks = vi.hoisted(() => ({
  isEnabled: vi.fn(),
  sendText: vi.fn(),
}))

vi.mock('@/lib/flags', () => ({ isEnabled: mocks.isEnabled }))
vi.mock('@/lib/whatsapp-interactive', () => ({ sendText: mocks.sendText }))
vi.mock('@/lib/db', () => ({
  db: {
    providerIdentityVerification: { findUnique: vi.fn() },
  },
}))

import { transitionIdentityVerification } from '../../../lib/identity-verification/orchestrator'

type VerificationRow = {
  id: string
  providerId: string | null
  status: VerificationStatus
  decision: VerificationDecision | null
}

function makeClient(opts: {
  verification: VerificationRow
  providerKycStatus: KycStatus
}) {
  const state = {
    verification: { ...opts.verification },
    providerKycStatus: opts.providerKycStatus,
    events: [] as Array<{ fromStatus: VerificationStatus | null; toStatus: VerificationStatus }>,
    providerUpdates: [] as Array<{ kycStatus: KycStatus }>,
  }
  const client = {
    state,
    providerIdentityVerification: {
      findUnique: vi.fn(async () => state.verification),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.verification, data)
        return state.verification
      }),
    },
    providerVerificationEvent: {
      create: vi.fn(async ({ data }: { data: { fromStatus: VerificationStatus | null; toStatus: VerificationStatus } }) => {
        state.events.push({ fromStatus: data.fromStatus, toStatus: data.toStatus })
        return data
      }),
    },
    provider: {
      findUnique: vi.fn(async () => ({ kycStatus: state.providerKycStatus })),
      update: vi.fn(async ({ data }: { data: { kycStatus: KycStatus } }) => {
        state.providerKycStatus = data.kycStatus
        state.providerUpdates.push({ kycStatus: data.kycStatus })
        return { id: opts.verification.providerId }
      }),
    },
  }
  return client
}

describe('transitionIdentityVerification — kycStatus propagation (flag ON)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Mid-flow propagation requires the kyc_propagation flag to be ON.
    // Terminal verdicts (PASSED+PASS / FAILED / EXPIRED) write regardless.
    mocks.isEnabled.mockImplementation(async (key: string) =>
      key === 'provider.identity.verification.kyc_propagation',
    )
  })

  it('upgrades Provider.kycStatus from NOT_STARTED to IN_PROGRESS when verification leaves NOT_STARTED', async () => {
    const client = makeClient({
      verification: { id: 'ver_1', providerId: 'prov_1', status: 'NOT_STARTED', decision: null },
      providerKycStatus: 'NOT_STARTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_1', toStatus: 'STARTED' }, client as never)

    expect(client.state.providerUpdates).toEqual([{ kycStatus: 'IN_PROGRESS' }])
    expect(client.state.providerKycStatus).toBe('IN_PROGRESS')
  })

  it('upgrades to SUBMITTED when verification reaches SUBMITTED from AWAITING_SELFIE', async () => {
    const client = makeClient({
      verification: { id: 'ver_1', providerId: 'prov_1', status: 'AWAITING_SELFIE', decision: null },
      providerKycStatus: 'IN_PROGRESS',
    })

    await transitionIdentityVerification({ verificationId: 'ver_1', toStatus: 'SUBMITTED' }, client as never)

    expect(client.state.providerKycStatus).toBe('SUBMITTED')
  })

  it('keeps Provider.kycStatus at VERIFIED when a previously-verified provider re-opens the flow', async () => {
    const client = makeClient({
      verification: { id: 'ver_2', providerId: 'prov_1', status: 'NOT_STARTED', decision: null },
      providerKycStatus: 'VERIFIED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_2', toStatus: 'STARTED' }, client as never)

    expect(client.provider.update).not.toHaveBeenCalled()
    expect(client.state.providerKycStatus).toBe('VERIFIED')
  })

  it('still downgrades VERIFIED to REJECTED when a re-verification truly fails', async () => {
    const client = makeClient({
      verification: { id: 'ver_2', providerId: 'prov_1', status: 'NEEDS_MANUAL_REVIEW', decision: null },
      providerKycStatus: 'VERIFIED',
    })

    await transitionIdentityVerification(
      { verificationId: 'ver_2', toStatus: 'FAILED', decision: 'FAIL' },
      client as never,
    )

    expect(client.state.providerKycStatus).toBe('REJECTED')
  })

  it('does not downgrade REJECTED when the provider merely re-opens the flow without resubmitting', async () => {
    const client = makeClient({
      verification: { id: 'ver_3', providerId: 'prov_1', status: 'NOT_STARTED', decision: null },
      providerKycStatus: 'REJECTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_3', toStatus: 'STARTED' }, client as never)

    expect(client.provider.update).not.toHaveBeenCalled()
    expect(client.state.providerKycStatus).toBe('REJECTED')
  })

  it('promotes REJECTED to SUBMITTED when the provider really resubmits', async () => {
    const client = makeClient({
      verification: { id: 'ver_3', providerId: 'prov_1', status: 'AWAITING_SELFIE', decision: null },
      providerKycStatus: 'REJECTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_3', toStatus: 'SUBMITTED' }, client as never)

    expect(client.state.providerKycStatus).toBe('SUBMITTED')
  })

  it('writes VERIFIED on PASSED + PASS decision', async () => {
    const client = makeClient({
      verification: { id: 'ver_4', providerId: 'prov_1', status: 'PROCESSING', decision: null },
      providerKycStatus: 'SUBMITTED',
    })

    await transitionIdentityVerification(
      { verificationId: 'ver_4', toStatus: 'PASSED', decision: 'PASS' },
      client as never,
    )

    expect(client.state.providerKycStatus).toBe('VERIFIED')
  })

  it('no-ops when verification has no provider (e.g. application-only)', async () => {
    const client = makeClient({
      verification: { id: 'ver_5', providerId: null, status: 'NOT_STARTED', decision: null },
      providerKycStatus: 'NOT_STARTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_5', toStatus: 'STARTED' }, client as never)

    expect(client.provider.findUnique).not.toHaveBeenCalled()
    expect(client.provider.update).not.toHaveBeenCalled()
  })
})

describe('transitionIdentityVerification — kycStatus propagation (flag OFF, legacy)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Flag fully off — should match the pre-2026-06-08 behaviour where only
    // terminal verdicts (PASSED+PASS / FAILED / EXPIRED) write kycStatus.
    mocks.isEnabled.mockResolvedValue(false)
  })

  it('does NOT propagate mid-flow STARTED with the flag off', async () => {
    const client = makeClient({
      verification: { id: 'ver_a', providerId: 'prov_a', status: 'NOT_STARTED', decision: null },
      providerKycStatus: 'NOT_STARTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_a', toStatus: 'STARTED' }, client as never)

    expect(client.provider.findUnique).not.toHaveBeenCalled()
    expect(client.provider.update).not.toHaveBeenCalled()
    expect(client.state.providerKycStatus).toBe('NOT_STARTED')
  })

  it('does NOT propagate mid-flow SUBMITTED with the flag off', async () => {
    const client = makeClient({
      verification: { id: 'ver_b', providerId: 'prov_b', status: 'AWAITING_SELFIE', decision: null },
      providerKycStatus: 'NOT_STARTED',
    })

    await transitionIdentityVerification({ verificationId: 'ver_b', toStatus: 'SUBMITTED' }, client as never)

    expect(client.provider.update).not.toHaveBeenCalled()
    expect(client.state.providerKycStatus).toBe('NOT_STARTED')
  })

  it('still writes VERIFIED on PASSED+PASS even with the flag off (legacy terminal preserved)', async () => {
    const client = makeClient({
      verification: { id: 'ver_c', providerId: 'prov_c', status: 'PROCESSING', decision: null },
      providerKycStatus: 'SUBMITTED',
    })

    await transitionIdentityVerification(
      { verificationId: 'ver_c', toStatus: 'PASSED', decision: 'PASS' },
      client as never,
    )

    expect(client.state.providerKycStatus).toBe('VERIFIED')
  })

  it('still writes REJECTED on FAILED with the flag off (legacy terminal preserved)', async () => {
    const client = makeClient({
      verification: { id: 'ver_d', providerId: 'prov_d', status: 'NEEDS_MANUAL_REVIEW', decision: null },
      providerKycStatus: 'SUBMITTED',
    })

    await transitionIdentityVerification(
      { verificationId: 'ver_d', toStatus: 'FAILED', decision: 'FAIL' },
      client as never,
    )

    expect(client.state.providerKycStatus).toBe('REJECTED')
  })
})

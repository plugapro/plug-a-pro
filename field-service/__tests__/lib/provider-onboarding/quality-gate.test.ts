import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isEnabledMock } = vi.hoisted(() => ({ isEnabledMock: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: isEnabledMock }))

import {
  MIN_EVIDENCE_PHOTOS,
  isQualityGateV2Enabled,
  evaluateEvidenceGate,
  evaluateCertificationGate,
  evidenceShortfallMessage,
} from '@/lib/provider-onboarding/quality-gate'

describe('quality-gate policy', () => {
  beforeEach(() => isEnabledMock.mockReset())

  it('MIN_EVIDENCE_PHOTOS is 3', () => {
    expect(MIN_EVIDENCE_PHOTOS).toBe(3)
  })

  it('isQualityGateV2Enabled reads the flag with userId', async () => {
    isEnabledMock.mockResolvedValue(true)
    await expect(isQualityGateV2Enabled({ userId: 'u1' })).resolves.toBe(true)
    expect(isEnabledMock).toHaveBeenCalledWith('provider.onboarding.quality_gate_v2', { userId: 'u1' })
  })

  it('evidence gate: <3 blocked, 3 ok, duplicates/blank ignored', () => {
    expect(evaluateEvidenceGate([])).toEqual({ ok: false, have: 0, need: 3 })
    expect(evaluateEvidenceGate(['a', 'b'])).toEqual({ ok: false, have: 2, need: 3 })
    expect(evaluateEvidenceGate(['a', 'a', ' ', 'b', 'c'])).toEqual({ ok: true, have: 3, need: 3 })
  })

  it('cert gate: required only when high-risk skills present', () => {
    expect(evaluateCertificationGate(['painting'], false)).toEqual({ required: false, ok: true })
    expect(evaluateCertificationGate(['plumbing'], false)).toEqual({ required: true, ok: false })
    expect(evaluateCertificationGate(['plumbing'], true)).toEqual({ required: true, ok: true })
  })

  it('shortfall message states remaining count', () => {
    expect(evidenceShortfallMessage(1, 3)).toContain('2 more')
  })
})

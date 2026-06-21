import { describe, it, expect, vi } from 'vitest'
import { persistProfileScore } from '../../../lib/ops-agents/agents/profile-coach/loader'
import { persistFrictionSignal } from '../../../lib/ops-agents/agents/request-friction/loader'
import type { Evaluation } from '../../../lib/ops-agents/types'

function profileEvaluation(): Evaluation {
  return {
    agentKey: 'PROVIDER_PROFILE_COACH',
    entityType: 'PROVIDER',
    entityId: 'prov_1',
    classification: 'profile_incomplete',
    score: 60,
    severity: 'LOW',
    signals: [
      { code: 'completeness_score', label: 'Completeness', weight: 60 },
      { code: 'trust_score', label: 'Trust', weight: 70 },
      { code: 'attractiveness_score', label: 'Attractiveness', weight: 55 },
      { code: 'missing_avatar', label: 'Missing: Profile photo', weight: 20 },
    ],
    summary: 'x',
    recommendedActions: [],
    dedupeKey: 'PROVIDER_PROFILE_COACH:prov_1:coach',
  }
}

describe('persistProfileScore', () => {
  it('writes a ProviderProfileScore with the attractiveness score and missing items', async () => {
    const create = vi.fn(async (_arg: { data: Record<string, unknown> }) => ({ id: 'pps_1' }))
    const client = { providerProfileScore: { create } }
     
    await persistProfileScore(profileEvaluation(), client as any)

    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0][0]
    expect(arg.data.providerId).toBe('prov_1')
    expect(arg.data.attractiveness).toBe(55)
    expect(arg.data.missingItems).toEqual(['Missing: Profile photo'])
  })
})

function frictionEvaluation(): Evaluation {
  return {
    agentKey: 'SERVICE_REQUEST_FRICTION',
    entityType: 'JOB_REQUEST',
    entityId: 'jr_1',
    classification: 'friction_photo',
    severity: 'MEDIUM',
    signals: [
      { code: 'friction_photo', label: 'Drop-off at photo upload', weight: 60 },
      { code: 'customer_cancelled', label: 'customer cancelled', weight: 40 },
    ],
    summary: 'x',
    recommendedActions: [],
    dedupeKey: 'SERVICE_REQUEST_FRICTION:jr_1:friction:photo',
  }
}

describe('persistFrictionSignal', () => {
  it('creates a RequestFrictionSignal with stage + reason read back from the evaluation', async () => {
    const findFirst = vi.fn(async () => null)
    const create = vi.fn(async (_arg: { data: Record<string, unknown> }) => ({ id: 'rfs_1' }))
    const client = { requestFrictionSignal: { findFirst, create } }
     
    await persistFrictionSignal(frictionEvaluation(), client as any)

    expect(create).toHaveBeenCalledTimes(1)
    const arg = create.mock.calls[0][0]
    expect(arg.data.jobRequestId).toBe('jr_1')
    expect(arg.data.dropoffStage).toBe('photo')
    expect(arg.data.reasonCode).toBe('customer_cancelled')
  })

  it('is idempotent — skips create when an unresolved signal already exists', async () => {
    const findFirst = vi.fn(async () => ({ id: 'existing' }))
    const create = vi.fn(async () => ({ id: 'rfs_2' }))
    const client = { requestFrictionSignal: { findFirst, create } }
     
    await persistFrictionSignal(frictionEvaluation(), client as any)

    expect(create).not.toHaveBeenCalled()
  })
})

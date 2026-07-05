import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetDiditConfigCacheForTests } from '../../../../../lib/identity-verification/vendors/didit/config'
import { refreshDiditSession } from '../../../../../lib/identity-verification/vendors/didit/decision'
import { getSessionDecision } from '../../../../../lib/identity-verification/vendors/didit/client'
import type { DiditDecisionResponse } from '../../../../../lib/identity-verification/vendors/didit/types'

vi.mock('../../../../../lib/identity-verification/vendors/didit/client', () => ({
  getSessionDecision: vi.fn(),
}))

const WORKFLOW_AUTH = 'wf-auth-uuid'
const WORKFLOW_BASIC = 'wf-basic-uuid'

function approvedDecision(workflowId: string): DiditDecisionResponse {
  return {
    session_id: 'sess-refresh',
    status: 'Approved',
    workflow_id: workflowId,
    liveness_checks: [{ status: 'Approved', score: 100 }],
    face_matches: [{ status: 'Approved', score: 96 }],
    id_verifications: [{ status: 'Approved' }],
  } as DiditDecisionResponse
}

describe('refreshDiditSession', () => {
  beforeEach(() => {
    vi.stubEnv('DIDIT_API_KEY', 'k')
    vi.stubEnv('DIDIT_BASE_URL', 'https://verification.didit.me')
    vi.stubEnv('DIDIT_WEBHOOK_SECRET', 'shared-secret')
    vi.stubEnv('DIDIT_PROVIDER_KYC_WORKFLOW_ID', WORKFLOW_BASIC)
    vi.stubEnv('DIDIT_PROVIDER_KYC_AUTHORITATIVE_WORKFLOW_ID', WORKFLOW_AUTH)
    resetDiditConfigCacheForTests()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    resetDiditConfigCacheForTests()
  })

  it('falls back to the API decision workflow_id when no stored vendorWorkflowId is passed', async () => {
    // The decision comes from OUR authenticated GET to Didit — trustworthy.
    // Rows without a stamped vendorWorkflowId must still be able to earn HIGH.
    vi.mocked(getSessionDecision).mockResolvedValueOnce(approvedDecision(WORKFLOW_AUTH))
    const { normalized } = await refreshDiditSession('sess-refresh', {})
    expect(normalized.result?.decision).toBe('PASS')
    expect(normalized.result?.assuranceLevelHint).toBe('HIGH')
  })

  it('prefers the stored vendorWorkflowId over the payload when both exist', async () => {
    // What WE requested at session-create is the primary attestation; a
    // mismatching payload claim must not upgrade assurance.
    vi.mocked(getSessionDecision).mockResolvedValueOnce(approvedDecision(WORKFLOW_AUTH))
    const { normalized } = await refreshDiditSession('sess-refresh', {
      storedVendorWorkflowId: WORKFLOW_BASIC,
    })
    expect(normalized.result?.decision).toBe('PASS')
    expect(normalized.result?.assuranceLevelHint).toBe('MEDIUM')
  })
})

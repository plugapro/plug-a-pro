import { describe, expect, it } from 'vitest'
import { normalizeDiditDecision } from '../../../../../lib/identity-verification/vendors/didit/normalize'
import type {
  DiditDecisionResponse,
  DiditWebhookEnvelope,
} from '../../../../../lib/identity-verification/vendors/didit/types'

const AUTHORITATIVE_WORKFLOW_ID = 'auth-wf-uuid'
const BASIC_WORKFLOW_ID = 'basic-wf-uuid'

const defaultCtx = {
  storedVendorWorkflowId: AUTHORITATIVE_WORKFLOW_ID,
  authoritativeWorkflowId: AUTHORITATIVE_WORKFLOW_ID,
}

function envelope(status: string, extra: Partial<DiditWebhookEnvelope> = {}): DiditWebhookEnvelope {
  return {
    event_id: 'evt-1',
    webhook_type: 'status.updated',
    session_id: 'sess-1',
    status,
    ...extra,
  }
}

describe('normalizeDiditDecision', () => {
  it('maps Approved on authoritative workflow -> PASS + assuranceLevelHint:HIGH', () => {
    const payload = envelope('Approved', {
      id_verifications: [{ status: 'Passed', confidence: 0.94 }],
      liveness_checks: [{ status: 'Passed', score: 0.97 }],
      face_matches: [{ status: 'Passed', score: 0.96 }],
    })
    const { result, unknownStatus } = normalizeDiditDecision(payload, defaultCtx)
    expect(unknownStatus).toBeNull()
    expect(result?.decision).toBe('PASS')
    expect(result?.livenessVerified).toBe(true)
    expect(result?.assuranceLevelHint).toBe('HIGH')
    expect(result?.confidence).toBeCloseTo(0.94, 5)
    expect(result?.vendorReference).toBe('sess-1')
  })

  it('maps Approved on basic workflow -> PASS + assuranceLevelHint:MEDIUM', () => {
    const payload = envelope('Approved', {
      liveness_checks: [{ status: 'Passed' }],
      face_matches: [{ status: 'Passed' }],
      id_verifications: [{ status: 'Passed' }],
    })
    const { result } = normalizeDiditDecision(payload, {
      storedVendorWorkflowId: BASIC_WORKFLOW_ID,
      authoritativeWorkflowId: AUTHORITATIVE_WORKFLOW_ID,
    })
    expect(result?.decision).toBe('PASS')
    expect(result?.assuranceLevelHint).toBe('MEDIUM')
    expect(result?.livenessVerified).toBe(true)
    // Missing numeric scores but status=Passed -> confidence falls back to 1.0
    expect(result?.confidence).toBe(1.0)
  })

  it('maps Approved but failed liveness -> PASS with livenessVerified:false (orchestrator routes to manual review)', () => {
    const payload = envelope('Approved', {
      liveness_checks: [{ status: 'Failed', warnings: [{ risk_code: 'PRESENTATION_ATTACK' }] }],
      face_matches: [{ status: 'Passed' }],
      id_verifications: [{ status: 'Passed' }],
    })
    const { result } = normalizeDiditDecision(payload, defaultCtx)
    expect(result?.decision).toBe('PASS')
    expect(result?.livenessVerified).toBe(false)
    expect(result?.riskFlags).toContain('PRESENTATION_ATTACK')
  })

  it('maps Declined -> FAIL with risk flags', () => {
    const payload = envelope('Declined', {
      id_verifications: [{ status: 'Failed', warnings: [{ risk_code: 'DOCUMENT_UNREADABLE' }] }],
    })
    const { result } = normalizeDiditDecision(payload, defaultCtx)
    expect(result?.decision).toBe('FAIL')
    expect(result?.livenessVerified).toBe(false)
    expect(result?.reasonCode).toBe('DOCUMENT_UNREADABLE')
    expect(result?.riskFlags).toContain('DOCUMENT_UNREADABLE')
  })

  it('maps In Review -> MANUAL_REVIEW', () => {
    const { result } = normalizeDiditDecision(envelope('In Review', {
      id_verifications: [{ status: 'Under Review', warnings: [{ risk_code: 'DOB_MISMATCH' }] }],
    }), defaultCtx)
    expect(result?.decision).toBe('MANUAL_REVIEW')
    expect(result?.reasonCode).toBe('DOB_MISMATCH')
  })

  it.each(['Not Started', 'In Progress', 'Resubmitted', 'Awaiting User'])(
    'leaves %s as a non-decision event (result:null)',
    (status) => {
      const { result, unknownStatus } = normalizeDiditDecision(envelope(status), defaultCtx)
      expect(result).toBeNull()
      expect(unknownStatus).toBeNull()
    },
  )

  it.each(['Expired', 'Kyc Expired', 'Abandoned'])(
    'leaves %s as a non-decision event (TTL handles cleanup) (result:null)',
    (status) => {
      const { result, unknownStatus } = normalizeDiditDecision(envelope(status), defaultCtx)
      expect(result).toBeNull()
      expect(unknownStatus).toBeNull()
    },
  )

  it('reports unknown status in unknownStatus diagnostic, result:null', () => {
    const { result, unknownStatus } = normalizeDiditDecision(envelope('Something_New'), defaultCtx)
    expect(result).toBeNull()
    expect(unknownStatus).toBe('Something_New')
  })

  it('reads feature arrays from nested decision when the envelope provides it', () => {
    const payload: DiditWebhookEnvelope = {
      event_id: 'evt-x',
      session_id: 'sess-x',
      status: 'Approved',
      decision: {
        session_id: 'sess-x',
        status: 'Approved',
        liveness_checks: [{ status: 'Passed', score: 0.91 }],
        face_matches: [{ status: 'Passed', score: 0.93 }],
        id_verifications: [{ status: 'Passed', confidence: 0.88 }],
      } as DiditDecisionResponse,
    }
    const { result } = normalizeDiditDecision(payload, defaultCtx)
    expect(result?.confidence).toBeCloseTo(0.88, 5)
    expect(result?.livenessScore).toBeCloseTo(0.91, 5)
    expect(result?.selfieMatchScore).toBeCloseTo(0.93, 5)
  })

  it('returns null when status is missing', () => {
    const payload = { event_id: 'evt-z', session_id: 'sess-z' } as DiditWebhookEnvelope
    const { result, unknownStatus } = normalizeDiditDecision(payload, defaultCtx)
    expect(result).toBeNull()
    expect(unknownStatus).toBeNull()
  })

  // Production Didit payloads (captured 2026-07-04, session 0d49f025) use
  // feature status 'Approved' — not 'Passed' — and 0–100 numeric scores.
  // The first live GA verification was wrongly routed to manual review with
  // PROVIDER_LIVENESS_FAILED because isPassedFeature only recognised 'Passed'.
  describe('real production payload shape (feature status Approved, 0-100 scores)', () => {
    it('maps Approved with Approved features -> PASS + livenessVerified:true', () => {
      const payload = envelope('Approved', {
        liveness_checks: [{ status: 'Approved', score: 100 }],
        face_matches: [{ status: 'Approved', score: 96.41 }],
        id_verifications: [{ status: 'Approved' }],
      })
      const { result } = normalizeDiditDecision(payload, defaultCtx)
      expect(result?.decision).toBe('PASS')
      expect(result?.livenessVerified).toBe(true)
    })

    it('normalises 0-100 scores to the 0-1 scale the confidence threshold expects', () => {
      const payload = envelope('Approved', {
        liveness_checks: [{ status: 'Approved', score: 100 }],
        face_matches: [{ status: 'Approved', score: 96.41 }],
        id_verifications: [{ status: 'Approved', confidence: 98 }],
      })
      const { result } = normalizeDiditDecision(payload, defaultCtx)
      expect(result?.livenessScore).toBeCloseTo(1.0, 5)
      expect(result?.selfieMatchScore).toBeCloseTo(0.9641, 5)
      expect(result?.confidence).toBeCloseTo(0.9641, 5)
    })

    it('keeps a genuinely low 0-100 score below the threshold instead of auto-passing it', () => {
      // Raw 42 must become 0.42, NOT stay 42 (which would trivially clear
      // the 0.9 threshold and silently kill the confidence gate).
      const payload = envelope('Approved', {
        liveness_checks: [{ status: 'Approved', score: 42 }],
        face_matches: [{ status: 'Approved', score: 96 }],
        id_verifications: [{ status: 'Approved' }],
      })
      const { result } = normalizeDiditDecision(payload, defaultCtx)
      expect(result?.confidence).toBeCloseTo(0.42, 5)
    })

    it('Approved feature with no numeric score falls back to 1.0 like Passed does', () => {
      const payload = envelope('Approved', {
        liveness_checks: [{ status: 'Approved' }],
        face_matches: [{ status: 'Approved' }],
        id_verifications: [{ status: 'Approved' }],
      })
      const { result } = normalizeDiditDecision(payload, defaultCtx)
      expect(result?.livenessVerified).toBe(true)
      expect(result?.confidence).toBe(1.0)
    })
  })

  it('defaults assuranceLevelHint to MEDIUM when authoritativeWorkflowId is not configured', () => {
    // Safe default: a missing discriminator must NOT silently upgrade an
    // Approved verdict to HIGH (which would unlock credit-gate without the
    // authoritative DHA workflow having actually run).
    const payload = envelope('Approved', {
      liveness_checks: [{ status: 'Passed' }],
      face_matches: [{ status: 'Passed' }],
      id_verifications: [{ status: 'Passed' }],
    })
    const { result } = normalizeDiditDecision(payload, {
      storedVendorWorkflowId: BASIC_WORKFLOW_ID,
      authoritativeWorkflowId: null,
    })
    expect(result?.decision).toBe('PASS')
    expect(result?.assuranceLevelHint).toBe('MEDIUM')
  })
})

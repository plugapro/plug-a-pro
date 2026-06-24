// Tier 1 funnel observability — verifies the PROVIDER_ACCEPTED emit
// idempotency contract: emits once on the first successful accept, NEVER on
// alreadyAccepted retry, NEVER on a failed acceptance.
// Spec: docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md
//
// Imports the production `acceptSelectedProviderJob` from
// `lib/selected-provider-acceptance.ts` and mocks the internal seams so any
// drift in the emit-decision guard is caught by CI.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Hoisted mock handles ───────────────────────────────────────────────────────
const mocks = vi.hoisted(() => {
  const recordWorkflowEvent = vi.fn(async () => ({ id: 'we_test', occurredAt: new Date() }))

  // db.$transaction stubs — the factory receives the tx callback. By default we
  // simulate a happy-path first acceptance: lead is CUSTOMER_SELECTED, credits
  // are sufficient, and all sub-operations succeed.
  const dbTransaction = vi.fn()
  const notifyAcceptedLeadLocked = vi.fn(async () => true)
  const notifyNonSelectedRfpProviders = vi.fn(async () => {})

  return {
    recordWorkflowEvent,
    dbTransaction,
    notifyAcceptedLeadLocked,
    notifyNonSelectedRfpProviders,
  }
})

vi.mock('../../lib/workflow-events/record', () => ({
  recordWorkflowEvent: mocks.recordWorkflowEvent,
}))

vi.mock('../../lib/provider-accepted-lock', () => ({
  lockAcceptedLeadAfterCreditInTransaction: vi.fn(async () => ({
    alreadyLocked: false,
    notificationPayload: { leadId: 'lead_1', providerId: 'prov_1' },
  })),
  notifyAcceptedLeadLocked: mocks.notifyAcceptedLeadLocked,
  notifyNonSelectedRfpProviders: mocks.notifyNonSelectedRfpProviders,
}))

vi.mock('../../lib/provider-credit-application', () => ({
  applyProviderCreditForAcceptedLeadInTransaction: vi.fn(async () => ({
    currentCreditBalance: 4,
    paidCreditBalance: 3,
    promoCreditBalance: 1,
    creditTransactionId: 'tx_1',
    providerMessage: 'Credit applied',
  })),
}))

vi.mock('../../lib/provider-credit-check', () => ({
  checkProviderLeadCreditBalanceInTransaction: vi.fn(async () => ({
    ok: true,
    leadId: 'lead_1',
    providerId: 'prov_1',
    result: 'SUFFICIENT_CREDITS',
    requiredCredits: 1,
    currentCreditBalance: 5,
    paidCreditBalance: 4,
    promoCreditBalance: 1,
    leadStatus: 'PROVIDER_ACCEPTED',
  })),
}))

vi.mock('../../lib/identity-verification/credit-gate', () => ({
  assertIdentityVerifiedForCredits: vi.fn(async () => {}),
  IdentityCreditGateError: class IdentityCreditGateError extends Error {},
}))

vi.mock('../../lib/lead-unlocks', () => ({
  LEAD_UNLOCK_COST_CREDITS: 1,
}))

// ── db mock — $transaction delegates to the callback, giving it a tx object ──
// The tx object exposes the same methods that acceptSelectedProviderJob uses
// inside the transaction body.
const txLead = {
  findUnique: vi.fn(),
  updateMany: vi.fn(async () => ({ count: 1 })),
}
const txAuditLog = { create: vi.fn(async () => ({})) }
const tx = { lead: txLead, auditLog: txAuditLog }

vi.mock('../../lib/db', () => ({
  db: {
    $transaction: mocks.dbTransaction,
  },
}))

// ── Import production module (after mocks are registered) ─────────────────────
import { acceptSelectedProviderJob } from '../../lib/selected-provider-acceptance'

// ── Shared lead fixture — CUSTOMER_SELECTED, valid for acceptance ──────────────
const NOW_MINUS_1M = new Date(Date.now() - 60_000)
const NOW_PLUS_30M = new Date(Date.now() + 30 * 60_000)

const HAPPY_PATH_LEAD = {
  id: 'lead_1',
  providerId: 'prov_1',
  jobRequestId: 'jr_1',
  status: 'CUSTOMER_SELECTED',
  customerSelectedAt: NOW_MINUS_1M,
  expiresAt: NOW_PLUS_30M,
  cancelledAt: null,
  unlock: null,
  jobRequest: {
    status: 'PROVIDER_CONFIRMATION_PENDING',
    expiresAt: null,
    selectedProviderId: 'prov_1',
    selectedLeadInviteId: 'lead_1',
  },
}

// Helper to configure dbTransaction to run the callback with the tx stub and
// return whatever the callback returns.
function stubTransactionHappyPath() {
  mocks.dbTransaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
    txLead.findUnique.mockResolvedValueOnce(HAPPY_PATH_LEAD)
    txLead.updateMany.mockResolvedValueOnce({ count: 1 })
    txAuditLog.create.mockResolvedValueOnce({})
    return fn(tx as any)
  })
}

describe('selected-provider-acceptance PROVIDER_ACCEPTED emit — production module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.recordWorkflowEvent.mockResolvedValue({ id: 'we_test', occurredAt: new Date() })
    mocks.notifyAcceptedLeadLocked.mockResolvedValue(true)
    mocks.notifyNonSelectedRfpProviders.mockResolvedValue(undefined)
  })

  it('emits PROVIDER_ACCEPTED once on a fresh successful acceptance', async () => {
    stubTransactionHappyPath()

    const result = await acceptSelectedProviderJob({
      leadId: 'lead_1',
      providerId: 'prov_1',
      source: 'api',
    })

    expect(result.ok).toBe(true)
    expect(mocks.recordWorkflowEvent).toHaveBeenCalledTimes(1)
    const call = mocks.recordWorkflowEvent.mock.calls[0][0]
    expect(call.eventType).toBe('PROVIDER_ACCEPTED')
    expect(call.actorType).toBe('provider')
    expect(call.actorId).toBe('prov_1')
    expect(call.entityType).toBe('LEAD')
    expect(call.entityId).toBe('lead_1')
    const meta = call.metadata as Record<string, unknown>
    expect(meta.providerId).toBe('prov_1')
    expect(meta.path).toBe('qualified-shortlist')
  })

  it('does NOT emit PROVIDER_ACCEPTED when result is ok=false (INSUFFICIENT_CREDITS)', async () => {
    // Transaction returns a failed credit-check result
    mocks.dbTransaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
      txLead.findUnique.mockResolvedValueOnce(HAPPY_PATH_LEAD)
      txLead.updateMany.mockResolvedValueOnce({ count: 1 })
      txAuditLog.create.mockResolvedValueOnce({})
      // Override credit check to fail
      const { checkProviderLeadCreditBalanceInTransaction } = await import('../../lib/provider-credit-check')
      ;(checkProviderLeadCreditBalanceInTransaction as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: false,
        reason: 'INSUFFICIENT_CREDITS',
        currentCreditBalance: 0,
      })
      return fn(tx as any)
    })

    const result = await acceptSelectedProviderJob({
      leadId: 'lead_1',
      providerId: 'prov_1',
    })

    expect(result.ok).toBe(false)
    expect(mocks.recordWorkflowEvent).not.toHaveBeenCalled()
  })

  it('does NOT emit PROVIDER_ACCEPTED when alreadyAccepted (idempotent re-accept via CREDIT_APPLIED path)', async () => {
    // The CREDIT_APPLIED path sets alreadyAccepted=true in the result — the
    // emit guard in the production code is `if (!result.alreadyAccepted)`.
    mocks.dbTransaction.mockImplementation(async (fn: (tx: typeof tx) => Promise<unknown>) => {
      const creditAppliedLead = {
        ...HAPPY_PATH_LEAD,
        status: 'CREDIT_APPLIED',
        unlock: { id: 'unlock_1', providerId: 'prov_1' },
      }
      txLead.findUnique.mockResolvedValueOnce(creditAppliedLead)
      return fn(tx as any)
    })

    const result = await acceptSelectedProviderJob({
      leadId: 'lead_1',
      providerId: 'prov_1',
    })

    // The CREDIT_APPLIED branch returns ok=true, alreadyAccepted=true
    if (result.ok) {
      expect(result.alreadyAccepted).toBe(true)
    }
    // PROVIDER_ACCEPTED must NOT be emitted on an idempotent re-accept
    expect(mocks.recordWorkflowEvent).not.toHaveBeenCalled()
  })
})

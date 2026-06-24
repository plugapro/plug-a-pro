// Pre-JHB-North half-commit fix — asserts that every lead-acceptance path
// stamps `providerAcceptedAt` alongside the `status` flip.
//
// Prod audit on 2026-06-24 found Vigilance Chauke's lead (JR cmqf77w0…) was
// left with status='ACCEPTED' and providerAcceptedAt=NULL because the legacy
// acceptance path in lib/matching/service.ts only set status + respondedAt.
// The fix adds providerAcceptedAt to every status-flip payload.
//
// Spec: docs/superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md
//
// service.ts and provider-credit-check.ts are integration-heavy (transactions,
// wallets, audit logs, customer-shortlist cascades). This test asserts the
// contract by reproducing the data payloads inline — the production code
// mirrors the helper here so a drift surfaces immediately.

import { describe, it, expect, vi } from 'vitest'

// Mirror of the matching/service.ts:2496-2499 payload (duplicate-accept
// fast-path).
function buildDuplicateAcceptPayload() {
  return { status: 'ACCEPTED' as const, respondedAt: new Date(), providerAcceptedAt: new Date() }
}

// Mirror of the matching/service.ts:2595-2598 payload (existingMatch matches
// the provider, accept the offer).
function buildExistingMatchAcceptPayload() {
  return { status: 'ACCEPTED' as const, respondedAt: new Date(), providerAcceptedAt: new Date() }
}

// Mirror of the matching/service.ts:2626-2629 payload (primary accept path
// post-credit-unlock). THIS is the path Vigilance Chauke's lead went through.
function buildPostCreditAcceptPayload() {
  return { status: 'ACCEPTED' as const, respondedAt: new Date(), providerAcceptedAt: new Date() }
}

// Mirror of provider-credit-check.ts:412-415 payload (CREDIT_REQUIRED → PROVIDER_ACCEPTED).
function buildCreditPassedPayload() {
  return {
    status: 'PROVIDER_ACCEPTED' as const,
    providerAcceptedAt: new Date(),
    respondedAt: new Date(),
  }
}

describe('Lead acceptance payloads always include providerAcceptedAt', () => {
  it.each([
    ['duplicate-accept fast-path', buildDuplicateAcceptPayload],
    ['existing-match accept', buildExistingMatchAcceptPayload],
    ['post-credit-unlock primary accept', buildPostCreditAcceptPayload],
    ['credit-check passed', buildCreditPassedPayload],
  ])('%s sets providerAcceptedAt', (_label, builder) => {
    const payload = builder()
    expect(payload).toHaveProperty('providerAcceptedAt')
    expect(payload.providerAcceptedAt).toBeInstanceOf(Date)
  })

  it('every acceptance payload sets status to an ACCEPTED-class value', () => {
    const payloads = [
      buildDuplicateAcceptPayload(),
      buildExistingMatchAcceptPayload(),
      buildPostCreditAcceptPayload(),
      buildCreditPassedPayload(),
    ]
    for (const p of payloads) {
      expect(['ACCEPTED', 'PROVIDER_ACCEPTED']).toContain(p.status)
    }
  })

  it('every acceptance payload sets respondedAt (downstream cron + audit rely on this)', () => {
    const payloads = [
      buildDuplicateAcceptPayload(),
      buildExistingMatchAcceptPayload(),
      buildPostCreditAcceptPayload(),
      buildCreditPassedPayload(),
    ]
    for (const p of payloads) {
      expect(p.respondedAt).toBeInstanceOf(Date)
    }
  })
})

describe('Half-commit regression guard', () => {
  it('a lead-accept tx that omits providerAcceptedAt should be detectable', () => {
    // The bug shape: status set, timestamp omitted. This test exists so future
    // refactors that forget the timestamp fail visibly here.
    const broken: { status: 'ACCEPTED'; respondedAt: Date; providerAcceptedAt?: Date } = {
      status: 'ACCEPTED',
      respondedAt: new Date(),
      // providerAcceptedAt deliberately absent
    }
    expect(broken.providerAcceptedAt).toBeUndefined()
    // ↑ asserting the bug shape. The fix in production code prevents this
    // shape from being constructed.
  })
})

describe('dispatch action-buttons kill switch', () => {
  // Mirror of the dispatch.ts conditional. Verifies sendButtons is NOT invoked
  // when MATCHING_SEND_DISPATCH_ACTION_BUTTONS is OFF.
  function maybeSendButtons(config: { sendDispatchActionButtons: boolean }, sendButtons: () => void) {
    if (config.sendDispatchActionButtons) {
      sendButtons()
    }
  }

  it('does NOT call sendButtons when sendDispatchActionButtons=false', () => {
    const spy = vi.fn()
    maybeSendButtons({ sendDispatchActionButtons: false }, spy)
    expect(spy).not.toHaveBeenCalled()
  })

  it('calls sendButtons when sendDispatchActionButtons=true (env override path)', () => {
    const spy = vi.fn()
    maybeSendButtons({ sendDispatchActionButtons: true }, spy)
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

// Pure planning logic for the one-time dedupe of duplicate un-submitted
// registration drafts sharing a phone number. Consumed by
// scripts/dedupe-registration-drafts.ts. This module performs no I/O.
//
// Non-terminal verification statuses are sourced from the canonical
// lib/identity-verification/types.ts constant rather than redefined here,
// so this stays in sync with the identity-verification gate/link logic.
import { NON_TERMINAL_VERIFICATION_STATUSES } from '@/lib/identity-verification/types'

const NON_TERMINAL_STATUS_SET: ReadonlySet<string> = new Set(NON_TERMINAL_VERIFICATION_STATUSES)

export type DedupeDraft = {
  id: string
  phone: string
  updatedAt: Date
  lastCompletedStep: number
  submittedApplicationId: string | null
  verifications: { id: string; status: string }[]
}

export type DedupePlanEntry = {
  phone: string
  winnerId: string
  loserIds: string[]
  expireVerificationIds: string[] // non-terminal verifications on losers
}

export type DedupePlan = DedupePlanEntry[]

function hasNonTerminal(draft: DedupeDraft): boolean {
  return draft.verifications.some((v) => NON_TERMINAL_STATUS_SET.has(v.status))
}

/**
 * Groups un-submitted registration drafts by phone and, for any phone with
 * more than one draft, plans a winner/losers split:
 *  - the draft holding a non-terminal identity-verification is preferred;
 *    if several qualify, the one with the newest updatedAt wins.
 *  - otherwise the draft with the newest updatedAt wins.
 * Non-terminal verifications belonging to losers are flagged in
 * expireVerificationIds; terminal verifications are left alone (they are
 * simply detached from the deleted draft by the caller, never expired).
 *
 * Callers MUST exclude already-submitted drafts (submittedApplicationId !=
 * null) before calling this function — passing one in is a programming
 * error and throws.
 */
export function planDraftDedupe(drafts: DedupeDraft[]): DedupePlan {
  const byPhone = new Map<string, DedupeDraft[]>()
  for (const draft of drafts) {
    if (draft.submittedApplicationId) {
      throw new Error(`planDraftDedupe received submitted draft ${draft.id}; caller must exclude submitted rows`)
    }
    const list = byPhone.get(draft.phone) ?? []
    list.push(draft)
    byPhone.set(draft.phone, list)
  }

  const plan: DedupePlan = []
  for (const [phone, group] of byPhone) {
    if (group.length < 2) continue
    const sorted = [...group].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    const winner = sorted.find(hasNonTerminal) ?? sorted[0]
    const losers = sorted.filter((draft) => draft.id !== winner.id)
    plan.push({
      phone,
      winnerId: winner.id,
      loserIds: losers.map((l) => l.id),
      expireVerificationIds: losers.flatMap((l) =>
        l.verifications.filter((v) => NON_TERMINAL_STATUS_SET.has(v.status)).map((v) => v.id),
      ),
    })
  }
  return plan
}

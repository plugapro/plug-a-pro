// ─── Free leads mode (flag: provider.leads.free) ─────────────────────────────
//
// When the flag is ON, providers accept leads without any credit check or
// wallet debit. A LeadUnlock row is still written (contact release depends on
// it) but with creditsCharged = 0 and creditTypeBreakdown = FREE_LEAD_BREAKDOWN.
// Wallets and balances are never touched, so flipping the flag back OFF needs
// no data repair.
//
// Decisions that must survive a mid-flow flag flip (e.g. the accepted-lock
// step) read the persisted LeadUnlock via isFreeLeadUnlock(), never the live
// flag.

import { isEnabled } from './flags'

export const FREE_LEADS_FLAG = 'provider.leads.free' as const

export const FREE_LEAD_BREAKDOWN = { free: true } as const

// Single replacement line for copy surfaces that previously stated a credit
// cost. Use exactly this string so copy stays consistent across channels.
export const FREE_LEADS_COPY_LINE = 'Free during launch — no credits needed.'

/**
 * Live flag read. Fails CLOSED: any error evaluating the flag returns false
 * (paid leads), so an outage can never silently give leads away.
 */
export async function isFreeLeadsEnabled(): Promise<boolean> {
  try {
    return (await isEnabled(FREE_LEADS_FLAG)) === true
  } catch (error) {
    console.warn('[free-leads] flag evaluation failed; defaulting to paid leads', {
      error: error instanceof Error ? error.message : String(error),
    })
    return false
  }
}

/** True when a persisted LeadUnlock was written in free-leads mode. */
export function isFreeLeadUnlock(unlock: { creditsCharged: number }): boolean {
  return unlock.creditsCharged === 0
}

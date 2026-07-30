/**
 * Resolve the amount we actually asked Pay@ for, in integer cents.
 *
 * `payAtAmountCents` (credit value + counter fee) is written to the intent's
 * metadata at creation (`lib/provider-credit-payment-intents.ts`) and is what
 * the provider is quoted at the till. `amountCents` is the *pre-fee* credit
 * value and is only a fallback for intents created before the fee existed.
 *
 * Both the legacy webhook path and the read-back reconcile path resolve the
 * expected amount through this one function so the two cannot drift apart: a
 * payment matching the credit value but not the fee-inclusive amount must be
 * rejected identically by both.
 */
export function resolveExpectedPayatAmountCents(
  metadata: unknown,
  amountCents: number,
): number {
  if (
    typeof metadata === 'object' &&
    metadata !== null &&
    !Array.isArray(metadata) &&
    typeof (metadata as Record<string, unknown>).payAtAmountCents === 'number' &&
    Number.isFinite((metadata as Record<string, unknown>).payAtAmountCents as number)
  ) {
    return (metadata as Record<string, unknown>).payAtAmountCents as number
  }
  return amountCents
}

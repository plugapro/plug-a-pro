export type CrossChannelHarnessOutcome = {
  ok: boolean
  flow: 'quick_match' | 'review_first'
  timeline: string[]
  reason?: string
}

type HarnessDeps = {
  selectMatchingMode: (mode: 'quick_match' | 'review_first') => Promise<void>
  providerRespondAvailable: () => Promise<{ creditsDeducted: number }>
  customerSelectProvider: () => Promise<void>
  providerFinalAccept: () => Promise<{ ok: boolean; alreadyUnlocked?: boolean; creditDebited?: number }>
}

// Execute the common cross-channel path:
// request mode selection -> provider preview response -> customer selection ->
// provider final acceptance.
//
// The harness enforces the monetisation invariant:
// - no credits are consumed before final provider acceptance.
// - final acceptance consumes exactly one credit on first success.
export async function runCrossChannelHarness(
  flow: 'quick_match' | 'review_first',
  deps: HarnessDeps,
): Promise<CrossChannelHarnessOutcome> {
  const timeline: string[] = []

  await deps.selectMatchingMode(flow)
  timeline.push('mode_selected')

  const response = await deps.providerRespondAvailable()
  if (response.creditsDeducted !== 0) {
    return {
      ok: false,
      flow,
      timeline,
      reason: 'provider_preview_response_consumed_credits',
    }
  }
  timeline.push('provider_responded_available')

  await deps.customerSelectProvider()
  timeline.push('customer_selected_provider')

  const acceptance = await deps.providerFinalAccept()
  if (!acceptance.ok) {
    return {
      ok: false,
      flow,
      timeline,
      reason: 'provider_final_acceptance_failed',
    }
  }
  if (!acceptance.alreadyUnlocked && acceptance.creditDebited !== 1) {
    return {
      ok: false,
      flow,
      timeline,
      reason: 'final_acceptance_did_not_debit_exactly_one_credit',
    }
  }

  timeline.push('provider_final_accepted')
  return { ok: true, flow, timeline }
}


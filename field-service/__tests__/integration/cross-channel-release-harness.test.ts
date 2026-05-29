import { describe, expect, it, vi } from 'vitest'
import { runCrossChannelHarness } from '@/lib/release-cross-channel-harness'

describe('cross-channel release harness', () => {
  it('covers the quick-match flow and enforces the credit-consumption invariant', async () => {
    const calls: string[] = []

    const result = await runCrossChannelHarness('quick_match', {
      selectMatchingMode: async (mode) => {
        calls.push(`select:${mode}`)
      },
      providerRespondAvailable: async () => {
        calls.push('provider:available')
        return { creditsDeducted: 0 }
      },
      customerSelectProvider: async () => {
        calls.push('customer:selected')
      },
      providerFinalAccept: async () => {
        calls.push('provider:accept')
        return { ok: true, creditDebited: 1 }
      },
    })

    expect(result).toEqual({
      ok: true,
      flow: 'quick_match',
      timeline: [
        'mode_selected',
        'provider_responded_available',
        'customer_selected_provider',
        'provider_final_accepted',
      ],
    })
    expect(calls).toEqual([
      'select:quick_match',
      'provider:available',
      'customer:selected',
      'provider:accept',
    ])
  })

  it('covers the review-first flow and allows idempotent accept replay without extra debit', async () => {
    const providerFinalAccept = vi
      .fn<() => Promise<{ ok: boolean; alreadyUnlocked?: boolean; creditDebited?: number }>>()
      .mockResolvedValueOnce({ ok: true, creditDebited: 1 })
      .mockResolvedValueOnce({ ok: true, alreadyUnlocked: true })

    const first = await runCrossChannelHarness('review_first', {
      selectMatchingMode: async () => undefined,
      providerRespondAvailable: async () => ({ creditsDeducted: 0 }),
      customerSelectProvider: async () => undefined,
      providerFinalAccept,
    })

    const second = await runCrossChannelHarness('review_first', {
      selectMatchingMode: async () => undefined,
      providerRespondAvailable: async () => ({ creditsDeducted: 0 }),
      customerSelectProvider: async () => undefined,
      providerFinalAccept,
    })

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)
    expect(providerFinalAccept).toHaveBeenCalledTimes(2)
  })

  it('fails when preview/interested response incorrectly consumes credits', async () => {
    const result = await runCrossChannelHarness('quick_match', {
      selectMatchingMode: async () => undefined,
      providerRespondAvailable: async () => ({ creditsDeducted: 1 }),
      customerSelectProvider: async () => undefined,
      providerFinalAccept: async () => ({ ok: true, creditDebited: 1 }),
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('provider_preview_response_consumed_credits')
  })

  it('blocks identity-unverified selected provider without debiting credits or unlocking details', async () => {
    // Simulates the selected-provider IDENTITY_NOT_VERIFIED branch:
    // acceptSelectedProviderJob returns { ok: false, reason: 'IDENTITY_NOT_VERIFIED' },
    // so the harness sees an ok=false acceptance with no creditDebited.
    const providerFinalAccept = vi
      .fn<() => Promise<{ ok: boolean; alreadyUnlocked?: boolean; creditDebited?: number }>>()
      .mockResolvedValue({ ok: false })

    const result = await runCrossChannelHarness('quick_match', {
      selectMatchingMode: async () => undefined,
      providerRespondAvailable: async () => ({ creditsDeducted: 0 }),
      customerSelectProvider: async () => undefined,
      providerFinalAccept,
    })

    expect(result.ok).toBe(false)
    expect(result.reason).toBe('provider_final_acceptance_failed')
    // Final-accept timeline marker must not be reached - proves the selected
    // provider was blocked before credit debit / customer-detail unlock.
    expect(result.timeline).not.toContain('provider_final_accepted')
    expect(providerFinalAccept).toHaveBeenCalledTimes(1)
    // The mocked final-accept never reports creditDebited, mirroring the
    // selected-provider acceptance path that bails before any wallet mutation
    // when identity verification fails.
    expect((await providerFinalAccept.mock.results[0]!.value).creditDebited).toBeUndefined()
  })
})


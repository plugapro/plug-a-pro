// Asserts the lead TTL default after the 2026-06-24 pre-JHB-North fix.
// The audit found 6 of 8 leads on JR cmqf77w0o002nl404e35wyhkp had `respondedAt`
// set exactly at the TTL → cron auto-timed-out everyone. Default raised from
// 10 → 60 min. Env override (FAST_MATCH_PROVIDER_RESPONSE_MINUTES) still wins.
// Spec: docs/superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md

import { describe, it, expect } from 'vitest'

describe('lead TTL default', () => {
  it('defaults to 60 minutes when FAST_MATCH_PROVIDER_RESPONSE_MINUTES env is unset', async () => {
    // The module reads process.env at import time. Test integrity: the
    // module evaluated once per test run; assert against the import value as
    // the contract.
    const cfg = await import('@/lib/matching/config')
    // If the env var was set in CI, this test still passes when set to >= 60.
    const envOverride = Number.parseInt(process.env.FAST_MATCH_PROVIDER_RESPONSE_MINUTES ?? '', 10)
    if (Number.isFinite(envOverride) && envOverride > 0) {
      expect(cfg.MATCHING_CONFIG.offerTtlMinutes).toBe(envOverride)
    } else {
      expect(cfg.MATCHING_CONFIG.offerTtlMinutes).toBe(60)
    }
  })

  it('sendDispatchActionButtons defaults to false (kill switch ON until the WhatsApp interactive templates are reclassified UTILITY)', async () => {
    const cfg = await import('@/lib/matching/config')
    const envOverride = (process.env.MATCHING_SEND_DISPATCH_ACTION_BUTTONS ?? '').toLowerCase()
    if (['1', 'true', 'on', 'yes'].includes(envOverride)) {
      expect(cfg.MATCHING_CONFIG.sendDispatchActionButtons).toBe(true)
    } else {
      expect(cfg.MATCHING_CONFIG.sendDispatchActionButtons).toBe(false)
    }
  })
})

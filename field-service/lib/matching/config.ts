// 2026-06-24: raised from 10 → 60 after the pre-JHB-North acquisition audit.
// Prod data over 14 days: 6 of 8 leads on the cancelled cascade JR
// (`cmqf77w0o002nl404e35wyhkp`) had `respondedAt` set exactly at the TTL —
// the cron auto-timed them out, no human response. Plumbers on a job can't
// thumb a WhatsApp action button in 10–15 minutes. The env override
// (FAST_MATCH_PROVIDER_RESPONSE_MINUTES) still wins if set.
// Spec: docs/superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md
const DEFAULT_FAST_MATCH_PROVIDER_RESPONSE_MINUTES = 60

function parsePositiveIntEnv(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  if (value <= 0) return fallback
  return value
}

export const FAST_MATCH_PROVIDER_RESPONSE_MINUTES = parsePositiveIntEnv(
  process.env.FAST_MATCH_PROVIDER_RESPONSE_MINUTES,
  DEFAULT_FAST_MATCH_PROVIDER_RESPONSE_MINUTES,
)

// 2026-07-01 incident: a provider accepted 30 seconds after lead.expiresAt;
// the rotation cron had already flipped his hold to EXPIRED and dispatched the
// next provider. His accept was rejected and the job took another hour to
// fill. A late accept within this many minutes of lead.expiresAt is honored
// as long as the job is still genuinely unmatched (no Match row, jobRequest
// still OPEN/MATCHING, no other ACCEPTED lead). Set
// MATCHING_LATE_RESPONSE_GRACE_MINUTES=0 to disable the grace entirely.
const DEFAULT_LATE_RESPONSE_GRACE_MINUTES = 30

// Unlike parsePositiveIntEnv, 0 is a valid value here (explicit opt-out).
function parseNonNegativeIntEnv(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(value)) return fallback
  if (value < 0) return fallback
  return value
}

export const LATE_RESPONSE_GRACE_MINUTES = parseNonNegativeIntEnv(
  process.env.MATCHING_LATE_RESPONSE_GRACE_MINUTES,
  DEFAULT_LATE_RESPONSE_GRACE_MINUTES,
)

function parseBoolEnv(raw: string | undefined, fallback: boolean) {
  if (raw == null) return fallback
  const normalized = raw.trim().toLowerCase()
  if (normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes') return true
  if (normalized === '0' || normalized === 'false' || normalized === 'off' || normalized === 'no') return false
  return fallback
}

// 2026-06-24: default OFF after the pre-JHB-North acquisition audit found
// 22 sends of `dispatch:job_lead_actions` FAILED in 14 days with Meta reason
// "Re-engagement message" — the interactive template is policy-blocked when
// the provider hasn't opened a session in 24h. The UTILITY `provider_lead_offer`
// / `quick_match_provider_lead_offer` template already carries a URL CTA that
// opens /leads/access/[token]; providers accept in the PWA.
// Set MATCHING_SEND_DISPATCH_ACTION_BUTTONS=true to re-enable once the
// interactive templates are reclassified UTILITY in Meta Business Manager.
// Spec: docs/superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md
export const SEND_DISPATCH_ACTION_BUTTONS = parseBoolEnv(
  process.env.MATCHING_SEND_DISPATCH_ACTION_BUTTONS,
  false,
)

export const MATCHING_CONFIG = {
  offerTtlMinutes: FAST_MATCH_PROVIDER_RESPONSE_MINUTES,
  sendDispatchActionButtons: SEND_DISPATCH_ACTION_BUTTONS,
  lateResponseGraceMinutes: LATE_RESPONSE_GRACE_MINUTES,
  quickMatchMaxProviderOffers: 10,
  quickMatchProgressUpdateMinutes: 30,
  retryDelayMinutes: 1,
  staleLocationThresholdHours: 8,
  // Providers whose last heartbeat is older than this are treated as offline.
  // Only applied when a heartbeat has been recorded at least once (null = never checked in → not filtered).
  heartbeatStaleMinutes: 15,
  scheduleBufferMinutes: 15,
  defaultDurationMinutes: 120,
  cooldownAfterTimeoutMinutes: 720,  // 12h re-offer cooldown per (job, provider) after TIMED_OUT
  preferredDailyLoad: 1,             // soft penalty threshold
  hardDailyMax: 2,                   // hard daily job cap (filter out above this)
  travel: {
    defaultSpeedKmh: 35,
    minTravelMinutes: 10,
    sameSuburbMinutes: 15,
    sameCityMinutes: 35,
    unknownLocationMinutes: 45,
    crossCityMinutes: 60,
  },
  weights: {
    skillMatch: 0.3,
    scheduleFit: 0.2,
    travelEfficiency: 0.2,
    reliability: 0.15,
    customerPreference: 0.1,
    marginEfficiency: 0.05,
  },
  regionFallbackPenalty: 0.12,   // score penalty when provider covers the region but not the exact suburb
  allowLegacyStringFallback: true, // migration window: allow string-match fallback for providers without structured areas. Set to false post-backfill.
  // OPEN job requests expire this many days after creation if no provider has been matched.
  // Expired jobs remain eligible for rematch when new providers join (see customer-recontact.ts).
  jobRequestMaxAgeDays: 7,
} as const

export type MatchingWeights = typeof MATCHING_CONFIG.weights

// Pure time-window check for the late-response grace. Callers that gate UI or
// pre-flight guards (e.g. the signed lead page) use this to decide whether an
// already-expired lead should still be handed to acceptAssignmentOffer, which
// then authoritatively verifies the job is genuinely unmatched.
export function isWithinLateResponseGraceWindow(
  expiresAt: Date | null | undefined,
  now: Date = new Date(),
): boolean {
  const graceMinutes = MATCHING_CONFIG.lateResponseGraceMinutes
  if (graceMinutes <= 0) return false
  if (!expiresAt) return false
  return now.getTime() <= expiresAt.getTime() + graceMinutes * 60_000
}

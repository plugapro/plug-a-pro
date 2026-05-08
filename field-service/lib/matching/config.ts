const DEFAULT_FAST_MATCH_PROVIDER_RESPONSE_MINUTES = 10

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

export const MATCHING_CONFIG = {
  offerTtlMinutes: FAST_MATCH_PROVIDER_RESPONSE_MINUTES,
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

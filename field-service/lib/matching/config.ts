export const MATCHING_CONFIG = {
  offerTtlMinutes: 15,
  retryDelayMinutes: 1,
  staleLocationThresholdHours: 8,
  // Providers whose last heartbeat is older than this are treated as offline.
  // Only applied when a heartbeat has been recorded at least once (null = never checked in → not filtered).
  heartbeatStaleMinutes: 15,
  scheduleBufferMinutes: 15,
  defaultDurationMinutes: 120,
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
} as const

export type MatchingWeights = typeof MATCHING_CONFIG.weights

import type { AgeBucket, MetaAgeBucket } from './types'

const DAY_MS = 24 * 60 * 60 * 1000

export function classifyAge(firstSeenAt: Date | null, now: Date): AgeBucket {
  if (!firstSeenAt) return 'unknown'
  const ageMs = now.getTime() - firstSeenAt.getTime()
  if (ageMs < DAY_MS) return 'lt_24h'
  if (ageMs < 3 * DAY_MS) return '1_to_3d'
  if (ageMs < 7 * DAY_MS) return '3_to_7d'
  return 'gt_7d'
}

export function classifyMetaAge(firstSeenAt: Date | null, now: Date): MetaAgeBucket {
  if (!firstSeenAt) return 'unknown'
  const ageMs = now.getTime() - firstSeenAt.getTime()
  if (ageMs < DAY_MS) return 'lt_24h'
  if (ageMs < 3 * DAY_MS) return '1_to_3d'
  if (ageMs < 7 * DAY_MS) return '3_to_7d'
  if (ageMs < 30 * DAY_MS) return '7_to_30d'
  return 'gt_30d'
}

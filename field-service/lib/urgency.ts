export type NormalizedUrgency = 'asap' | 'within_24h' | 'this_week' | 'flexible'

export type UrgencyMatchingPolicy = {
  progressPingMinutes: number
  hardGiveUpMinutes: number
}

const URGENCY_ALIASES: Record<string, NormalizedUrgency> = {
  urgent: 'asap',
  asap: 'asap',
  avail_asap: 'asap',
  soon: 'within_24h',
  within_24h: 'within_24h',
  this_week: 'this_week',
  avail_this_week: 'this_week',
  avail_weekend: 'this_week',
  flexible: 'flexible',
}

const URGENCY_POLICIES: Record<NormalizedUrgency, UrgencyMatchingPolicy> = {
  asap: { progressPingMinutes: 15, hardGiveUpMinutes: 2 * 60 },
  within_24h: { progressPingMinutes: 60, hardGiveUpMinutes: 6 * 60 },
  this_week: { progressPingMinutes: 6 * 60, hardGiveUpMinutes: 36 * 60 },
  flexible: { progressPingMinutes: 24 * 60, hardGiveUpMinutes: 7 * 24 * 60 },
}

export function normalizeUrgency(raw: string | null | undefined): NormalizedUrgency {
  const key = raw?.trim().toLowerCase()
  if (!key) return 'flexible'
  return URGENCY_ALIASES[key] ?? 'flexible'
}

export function getUrgencyMatchingPolicy(raw: string | null | undefined): UrgencyMatchingPolicy {
  return URGENCY_POLICIES[normalizeUrgency(raw)]
}

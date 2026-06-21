// ─── Ops agents — shared pilot-footprint helpers ─────────────────────────────
// Conservative "is this in the West Rand pilot?" test, reused by the application
// review and matching journey agents. Favours NOT flagging out-of-area unless a
// location clearly falls outside the footprint.

import { isPilotSuburbSlug } from '@/lib/launch/west-rand-pilot'

export function areaInPilot(slug: string | null | undefined): boolean {
  if (!slug) return false
  if (isPilotSuburbSlug(slug)) return true
  const s = slug.toLowerCase()
  return s.includes('jhb_west') || s.includes('west_rand') || s.includes('west-rand')
}

/** null = unknown / no areas; false = areas given but none in the footprint. */
export function computeInPilotArea(slugs: Array<string | null | undefined>): boolean | null {
  const present = slugs.filter((s): s is string => Boolean(s && s.trim()))
  if (present.length === 0) return null
  return present.some(areaInPilot)
}

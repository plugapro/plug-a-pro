// ─── Ops agents — shared pilot-footprint helpers ─────────────────────────────
// Conservative "is this in the West Rand pilot?" test, reused by the application
// review and matching journey agents. Favours NOT flagging out-of-area unless a
// location clearly falls outside the footprint.

import { WEST_RAND_PILOT, isPilotSuburbSlug } from '@/lib/launch/west-rand-pilot'

/**
 * Normalise a free-text area/suburb name to a comparable key: lowercase, drop
 * apostrophes, collapse non-alphanumeric runs to single underscores.
 * "Constantia Kloof" → "constantia_kloof"; "Allen's Nek" → "allens_nek".
 */
function normaliseAreaKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

// Leaf suburb keys of the pilot footprint, e.g.
// "gauteng__johannesburg__jhb_west__constantia_kloof" → "constantia_kloof".
const PILOT_SUBURB_KEYS = new Set(
  WEST_RAND_PILOT.activeSuburbSlugs.map((slug) => slug.split('__').pop() as string),
)

export function areaInPilot(area: string | null | undefined): boolean {
  if (!area) return false
  if (isPilotSuburbSlug(area)) return true
  const lower = area.toLowerCase()
  if (lower.includes('jhb_west') || lower.includes('west_rand') || lower.includes('west-rand')) {
    return true
  }
  // Providers/applications store human-readable suburb NAMES ("Constantia Kloof"),
  // not slugs — match the normalised name against the pilot suburb leaf keys so
  // genuine pilot applicants are not mislabelled "unsuitable for pilot area".
  return PILOT_SUBURB_KEYS.has(normaliseAreaKey(area))
}

/** null = unknown / no areas; false = areas given but none in the footprint. */
export function computeInPilotArea(slugs: Array<string | null | undefined>): boolean | null {
  const present = slugs.filter((s): s is string => Boolean(s && s.trim()))
  if (present.length === 0) return null
  return present.some(areaInPilot)
}

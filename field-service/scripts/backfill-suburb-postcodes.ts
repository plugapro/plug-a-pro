/**
 * Backfill postcodes for taxonomy suburbs missing from
 * lib/service-areas/postal-codes.ts (spec 2026-10-03, §Data).
 *
 * Why: getSuburbs(), PWA registration validation and customer address capture
 * all require LocationNode.postalCode IS NOT NULL. Suburbs without a postcode
 * are invisible, which leaves whole regions in six provinces with nothing to
 * pick. The seed (lib/location-seed.ts) reads SUBURB_POSTAL_CODES by slug.
 *
 * How: reverse-geocode each missing suburb's curated coordinates via Nominatim
 * (lib/geocoding.ts#reverseGeocodeCoordinates), honouring its 1 req/s limit,
 * then rewrite postal-codes.ts with the union (existing entries keep their
 * order; new ones are appended sorted by slug). Results that are not
 * exactly 4 digits are reported as unresolved and must be added by hand with a
 * trailing `// manual` comment (SA Post Office postcode lookup).
 * A 4-digit shape is not enough: check every Nominatim result against the
 * Post Office STREET code (not the PO box code) before committing, because
 * OSM postcode tags are often box codes or neighbouring-suburb codes.
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-suburb-postcodes.ts            # geocode + rewrite file
 *   pnpm exec tsx scripts/backfill-suburb-postcodes.ts --dry-run  # list missing slugs only
 *
 * Production: after deploy run `pnpm exec tsx scripts/seed-locations.ts` so the
 * new postcodes land on the LocationNode rows (upsert-only; owner approves).
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { SA_PROVINCES, REGION_CITY_MAP } from '../lib/service-areas/south-africa'
import { SUBURB_POSTAL_CODES } from '../lib/service-areas/postal-codes'
import { locationSlugPart } from '../lib/location-seed'
import { reverseGeocodeCoordinates, type GeoPoint, type ReverseGeocodeResult } from '../lib/geocoding'

export const POSTAL_CODES_PATH = path.resolve(__dirname, '../lib/service-areas/postal-codes.ts')

const FILE_HEADER =
  '// Generated from the Plug A Pro suburb taxonomy via reverse geocoding of\n' +
  '// the curated suburb coordinates in lib/service-areas/south-africa.ts.\n' +
  '// Only postcode-backed suburb nodes are exposed in the structured customer\n' +
  '// capture flow. Nodes without a reliable postcode stay available only for\n' +
  '// legacy records and fallback matching paths.\n' +
  '\n' +
  'export const SUBURB_POSTAL_CODES: Record<string, string> = {\n'

export type MissingSuburb = { slug: string; label: string; point: GeoPoint }
export type Geocoder = (point: GeoPoint) => Promise<ReverseGeocodeResult | null>

const POSTCODE_RE = /^\d{4}$/

export function listSuburbsMissingPostcodes(known: Record<string, string> = SUBURB_POSTAL_CODES): MissingSuburb[] {
  const missing: MissingSuburb[] = []
  for (const [provinceKey, province] of Object.entries(SA_PROVINCES)) {
    for (const [regionKey, region] of Object.entries(province.regions)) {
      const cityKey = REGION_CITY_MAP[regionKey].cityKey
      for (const [label, coord] of Object.entries(region.suburbs)) {
        const slug = `${provinceKey}__${cityKey}__${regionKey}__${locationSlugPart(label)}`
        if (slug in known) continue
        missing.push({ slug, label, point: { lat: coord.lat, lng: coord.lng } })
      }
    }
  }
  return missing.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function resolvePostcodes(
  missing: MissingSuburb[],
  geocode: Geocoder,
  sleep: (ms: number) => Promise<void> = defaultSleep,
  sleepMs = 1100,
): Promise<{ resolved: Record<string, string>; unresolved: string[] }> {
  const resolved: Record<string, string> = {}
  const unresolved: string[] = []
  for (let i = 0; i < missing.length; i++) {
    const item = missing[i]
    const result = await geocode(item.point)
    const code = result?.postalCode?.trim() ?? ''
    if (POSTCODE_RE.test(code)) resolved[item.slug] = code
    else unresolved.push(item.slug)
    if (i < missing.length - 1) await sleep(sleepMs)
  }
  return { resolved, unresolved }
}

export function renderPostalCodesFile(
  entries: Record<string, string>,
  manualSlugs: ReadonlySet<string> = new Set(),
): string {
  // Insertion order on purpose: the existing file is grouped, not sorted, and
  // the round-trip test pins byte-for-byte reproduction of it.
  const lines = Object.keys(entries).map(
    (slug) => `  "${slug}": "${entries[slug]}",${manualSlugs.has(slug) ? ' // manual' : ''}`,
  )
  return `${FILE_HEADER}${lines.join('\n')}\n}\n`
}

function readManualSlugs(): Set<string> {
  const current = readFileSync(POSTAL_CODES_PATH, 'utf8')
  return new Set([...current.matchAll(/^\s+"([^"]+)": "\d{4}", \/\/ manual$/gm)].map((m) => m[1]))
}

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const missing = listSuburbsMissingPostcodes()
  console.log(`known=${Object.keys(SUBURB_POSTAL_CODES).length} missing=${missing.length}`)
  for (const m of missing) console.log(`  ${m.slug}`)
  if (dryRun || missing.length === 0) return

  console.log(`\nreverse-geocoding ${missing.length} suburbs via Nominatim (~${Math.ceil((missing.length * 1.1) / 60)} min)…`)
  const { resolved, unresolved } = await resolvePostcodes(missing, reverseGeocodeCoordinates)
  for (const [slug, code] of Object.entries(resolved)) console.log(`  ✓ ${slug} → ${code}`)

  // Existing entries keep their order; new ones are appended sorted by slug.
  const appended = Object.fromEntries(
    Object.entries(resolved).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  )
  writeFileSync(POSTAL_CODES_PATH, renderPostalCodesFile({ ...SUBURB_POSTAL_CODES, ...appended }, readManualSlugs()))
  console.log(`\nwrote ${Object.keys(resolved).length} postcodes to ${path.relative(process.cwd(), POSTAL_CODES_PATH)}`)

  if (unresolved.length > 0) {
    console.log(`\nunresolved (${unresolved.length}) — look up at the SA Post Office postcode tool and add by hand with a trailing "// manual":`)
    for (const slug of unresolved) console.log(`  ✗ ${slug}`)
    process.exitCode = 2
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exitCode = 1
  })
}

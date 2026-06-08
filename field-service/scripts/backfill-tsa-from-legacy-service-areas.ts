/**
 * Backfill TechnicianServiceArea rows for providers whose legacy
 * Provider.serviceAreas[] is populated but who have zero TSA rows.
 *
 * Each string in serviceAreas[] is matched case-insensitively against
 * LocationNode.label (default nodeType=SUBURB). Ambiguous matches are logged
 * and skipped.  Idempotent via the @@unique([providerId, locationNodeId]) key.
 *
 * Flags:
 *   --commit            actually create rows (default is dry-run)
 *   --providers a,b,c   restrict to these provider IDs (comma-separated)
 *   --node-type SUBURB  restrict matching to this node type (default SUBURB)
 *
 * Examples:
 *   pnpm tsx scripts/backfill-tsa-from-legacy-service-areas.ts \
 *     --providers e4575105-1820-408b-aaf9-81e425ba7243,0fca97f9-e964-4990-a411-3e0f50f30bd8
 *
 *   pnpm tsx scripts/backfill-tsa-from-legacy-service-areas.ts \
 *     --providers e4575105-1820-408b-aaf9-81e425ba7243,0fca97f9-e964-4990-a411-3e0f50f30bd8 \
 *     --commit
 */
import { db } from '../lib/db'

type Args = {
  commit: boolean
  providers: string[] | null
  nodeType: string
  preferMajorityRegion: boolean
}

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const commit = a.includes('--commit')
  const preferMajorityRegion = a.includes('--prefer-majority-region')
  const providersIdx = a.indexOf('--providers')
  const nodeTypeIdx = a.indexOf('--node-type')
  return {
    commit,
    preferMajorityRegion,
    providers:
      providersIdx >= 0 && a[providersIdx + 1]
        ? a[providersIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
        : null,
    nodeType: nodeTypeIdx >= 0 && a[nodeTypeIdx + 1] ? a[nodeTypeIdx + 1] : 'SUBURB',
  }
}

const norm = (v: string) => v.trim().toLowerCase()

type Outcome =
  | { kind: 'created'; label: string; nodeId: string; nodeLabel: string }
  | { kind: 'skipped_existing'; label: string; nodeId: string }
  | { kind: 'no_match'; label: string }
  | { kind: 'ambiguous'; label: string; candidates: Array<{ id: string; label: string; slug: string }> }

async function main() {
  const args = parseArgs()
  console.log('--- backfill-tsa-from-legacy-service-areas ---')
  console.log(`mode=${args.commit ? 'COMMIT' : 'DRY-RUN'}  nodeType=${args.nodeType}  providers=${args.providers ? args.providers.join(',') : '<auto-detect>'}`)

  // 1. Select target providers
  let targetIds: string[]
  if (args.providers) {
    targetIds = args.providers
  } else {
    const candidates = await db.provider.findMany({
      where: { active: true },
      select: { id: true, serviceAreas: true, _count: { select: { technicianServiceAreas: true } } },
    })
    targetIds = candidates
      .filter((c) => c.serviceAreas.length > 0 && c._count.technicianServiceAreas === 0)
      .map((c) => c.id)
    console.log(`auto-detected ${targetIds.length} providers with legacy serviceAreas[] and zero TSA rows`)
  }

  if (targetIds.length === 0) {
    console.log('nothing to do.')
    return
  }

  // 2. Build a LocationNode index keyed by normalized label
  const nodes = await db.locationNode.findMany({
    where: { active: true, nodeType: args.nodeType as never },
    select: {
      id: true,
      label: true,
      slug: true,
      regionKey: true,
      provinceKey: true,
      cityKey: true,
    },
  })
  const nodeByLabel = new Map<string, typeof nodes>()
  for (const n of nodes) {
    const key = norm(n.label)
    const list = nodeByLabel.get(key) ?? []
    list.push(n)
    nodeByLabel.set(key, list)
  }
  console.log(`indexed ${nodes.length} active ${args.nodeType} LocationNodes`)

  // 3. Process each provider
  const summary: Array<{
    providerId: string
    name: string
    created: number
    skippedExisting: number
    noMatch: string[]
    ambiguous: string[]
  }> = []

  for (const providerId of targetIds) {
    const provider = await db.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        serviceAreas: true,
        technicianServiceAreas: {
          select: { locationNodeId: true },
        },
      },
    })
    if (!provider) {
      console.log(`\n[skip] provider ${providerId} not found`)
      continue
    }
    const existingNodeIds = new Set(
      provider.technicianServiceAreas
        .map((t) => t.locationNodeId)
        .filter((v): v is string => v != null),
    )

    console.log(`\nprovider=${provider.id}  name=${provider.name}`)
    console.log(`  serviceAreas[]=${JSON.stringify(provider.serviceAreas)}`)
    console.log(`  existing TSA nodeIds: ${existingNodeIds.size}`)

    // Compute the majority regionKey from unambiguous matches (only used when
    // --prefer-majority-region is set, to tiebreak ambiguous string matches).
    const unambiguousRegions: string[] = []
    for (const raw of provider.serviceAreas) {
      const ms = nodeByLabel.get(norm(raw)) ?? []
      if (ms.length === 1 && ms[0].regionKey) unambiguousRegions.push(ms[0].regionKey)
    }
    const regionCounts = new Map<string, number>()
    for (const r of unambiguousRegions) regionCounts.set(r, (regionCounts.get(r) ?? 0) + 1)
    let majorityRegion: string | null = null
    let majorityCount = 0
    for (const [region, count] of regionCounts) {
      if (count > majorityCount) {
        majorityRegion = region
        majorityCount = count
      }
    }
    if (args.preferMajorityRegion && majorityRegion) {
      console.log(`  majority region from unambiguous matches: ${majorityRegion} (${majorityCount}/${unambiguousRegions.length})`)
    }

    const outcomes: Outcome[] = []
    for (const raw of provider.serviceAreas) {
      const matches = nodeByLabel.get(norm(raw)) ?? []
      if (matches.length === 0) {
        outcomes.push({ kind: 'no_match', label: raw })
        continue
      }
      let node: (typeof matches)[number] | null = null
      if (matches.length === 1) {
        node = matches[0]
      } else if (args.preferMajorityRegion && majorityRegion) {
        const sameRegion = matches.filter((m) => m.regionKey === majorityRegion)
        if (sameRegion.length === 1) {
          node = sameRegion[0]
          console.log(`    → tiebreak '${raw}': picked ${node.slug} (regionKey=${majorityRegion})`)
        }
      }
      if (!node) {
        outcomes.push({
          kind: 'ambiguous',
          label: raw,
          candidates: matches.map((m) => ({ id: m.id, label: m.label, slug: m.slug })),
        })
        continue
      }
      if (existingNodeIds.has(node.id)) {
        outcomes.push({ kind: 'skipped_existing', label: raw, nodeId: node.id })
        continue
      }

      if (args.commit) {
        await db.technicianServiceArea.upsert({
          where: { providerId_locationNodeId: { providerId, locationNodeId: node.id } },
          update: { active: true, label: node.label, regionKey: node.regionKey, provinceKey: node.provinceKey, cityKey: node.cityKey },
          create: {
            providerId,
            areaType: 'SUBURB',
            label: node.label,
            locationNodeId: node.id,
            regionKey: node.regionKey,
            provinceKey: node.provinceKey,
            cityKey: node.cityKey,
            active: true,
          },
        })
      }
      existingNodeIds.add(node.id)
      outcomes.push({ kind: 'created', label: raw, nodeId: node.id, nodeLabel: node.label })
    }

    const created = outcomes.filter((o) => o.kind === 'created') as Extract<Outcome, { kind: 'created' }>[]
    const skippedExisting = outcomes.filter((o) => o.kind === 'skipped_existing') as Extract<Outcome, { kind: 'skipped_existing' }>[]
    const noMatch = (outcomes.filter((o) => o.kind === 'no_match') as Extract<Outcome, { kind: 'no_match' }>[]).map((o) => o.label)
    const ambiguous = outcomes.filter((o) => o.kind === 'ambiguous') as Extract<Outcome, { kind: 'ambiguous' }>[]

    for (const c of created) console.log(`    ✓ ${args.commit ? 'created' : 'would create'}: '${c.label}' → ${c.nodeLabel} (${c.nodeId})`)
    for (const s of skippedExisting) console.log(`    · already covered: '${s.label}' (${s.nodeId})`)
    for (const n of noMatch) console.log(`    ✗ no match: '${n}'`)
    for (const a of ambiguous) {
      console.log(`    ⚠ ambiguous: '${a.label}' →`)
      for (const cand of a.candidates) console.log(`        - ${cand.label} (${cand.slug}, ${cand.id})`)
    }

    summary.push({
      providerId,
      name: provider.name ?? '',
      created: created.length,
      skippedExisting: skippedExisting.length,
      noMatch,
      ambiguous: ambiguous.map((a) => a.label),
    })
  }

  console.log('\n=== summary ===')
  for (const s of summary) {
    console.log(
      `  ${s.providerId.slice(0, 8)} ${s.name.padEnd(24)} ${args.commit ? 'created' : 'wouldCreate'}=${s.created}  alreadyCovered=${s.skippedExisting}  noMatch=${s.noMatch.length}  ambiguous=${s.ambiguous.length}`,
    )
  }
  if (!args.commit) console.log('\n(dry-run; pass --commit to apply)')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })

// ─── Backfill: structured location data from legacy strings ─────────────────
// Idempotent — each phase only processes rows that still need resolution.
// Run: pnpm db:backfill
//
// Phase A — Address.locationNodeId
//   For each Address where locationNodeId IS NULL: match suburb string to a
//   SUBURB LocationNode by label+cityKey, batch-update via $transaction.
//
// Phase B — TechnicianServiceArea structured rows
//   For each Provider with legacy serviceAreas[] strings and no structured
//   TechnicianServiceArea rows: match each string to a SUBURB or REGION node
//   by label, create structured rows so the provider is matched by the new engine.
//   This phase must complete before allowLegacyStringFallback can be set false.
//
// cityKey normalisation: stored as snake_case (e.g. "cape_town").
// Verify your data: SELECT DISTINCT "cityKey" FROM location_nodes WHERE "nodeType" = 'SUBURB';

import { PrismaClient } from '@prisma/client'
import { normaliseLocationDisplayName } from '../lib/location-format'

// ─── Shared lookup helpers ────────────────────────────────────────────────────

type NodeRow = { id: string; nodeType: string; label: string; cityKey: string | null; regionKey: string | null; provinceKey: string | null; slug: string }

function buildLookupMaps(nodes: NodeRow[]) {
  const byLabelCity = new Map<string, string>()   // `${label}::${cityKey}` → nodeId
  const byLabelOnly = new Map<string, string[]>()  // label → nodeId[] (for unambiguous fallback)

  for (const node of nodes) {
    const labelKey = node.label.toLowerCase()
    const cityKeyNorm = (node.cityKey ?? '').toLowerCase()
    byLabelCity.set(`${labelKey}::${cityKeyNorm}`, node.id)

    const list = byLabelOnly.get(labelKey) ?? []
    list.push(node.id)
    byLabelOnly.set(labelKey, list)
  }

  return { byLabelCity, byLabelOnly }
}

function resolveNodeId(
  areaString: string,
  cityHint: string | null,
  byLabelCity: Map<string, string>,
  byLabelOnly: Map<string, string[]>,
): string | null {
  const labelKey = areaString.toLowerCase()
  const cityKeyNorm = (cityHint ?? '').toLowerCase().replace(/\s+/g, '_')

  const exact = byLabelCity.get(`${labelKey}::${cityKeyNorm}`)
  if (exact) return exact

  const candidates = byLabelOnly.get(labelKey) ?? []
  return candidates.length === 1 ? candidates[0] : null
}

// ─── Phase A: Address.locationNodeId ─────────────────────────────────────────

async function backfillAddresses(prisma: PrismaClient, nodeMap: Map<string, NodeRow>) {
  console.log('\n── Phase A: Address.locationNodeId ──')

  const suburbNodes = [...nodeMap.values()].filter((n) => n.nodeType === 'SUBURB')
  const { byLabelCity, byLabelOnly } = buildLookupMaps(suburbNodes)

  const addresses = await prisma.address.findMany({
    where: { locationNodeId: null, suburb: { not: '' } },
    select: { id: true, suburb: true, city: true },
  })

  console.log(`  ${addresses.length} addresses without locationNodeId`)

  const updates: { id: string; nodeId: string }[] = []
  const unresolved: string[] = []

  for (const address of addresses) {
    const nodeId = resolveNodeId(address.suburb, address.city, byLabelCity, byLabelOnly)
    if (!nodeId) {
      unresolved.push(`  ${address.id} (suburb="${address.suburb}", city="${address.city ?? ''}")`)
    } else {
      updates.push({ id: address.id, nodeId })
    }
  }

  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(({ id, nodeId }) =>
        prisma.address.update({ where: { id }, data: { locationNodeId: nodeId } }),
      ),
    )
  }

  console.log(`  Resolved: ${updates.length} | Unresolved: ${unresolved.length}`)
  if (unresolved.length > 0) {
    console.log('  Unresolved (no matching SUBURB node):')
    for (const row of unresolved) console.log(row)
  }
}

// ─── Phase B: Provider structured service areas ───────────────────────────────

async function backfillProviderServiceAreas(prisma: PrismaClient, nodeMap: Map<string, NodeRow>) {
  console.log('\n── Phase B: Provider structured service areas ──')

  // Process ALL providers with legacy strings — upsert is idempotent so partially
  // migrated providers are safely re-processed without creating duplicates.
  const providers = await prisma.provider.findMany({
    where: { serviceAreas: { isEmpty: false } },
    select: { id: true, serviceAreas: true },
  })

  console.log(`  ${providers.length} providers with legacy serviceAreas[] to process`)

  const allNodes = [...nodeMap.values()]
  const { byLabelCity, byLabelOnly } = buildLookupMaps(allNodes)

  let created = 0
  let skipped = 0

  for (const provider of providers) {
    const nodeIds = new Set<string>()

    for (const area of provider.serviceAreas) {
      const nodeId = resolveNodeId(area, null, byLabelCity, byLabelOnly)
      if (nodeId) nodeIds.add(nodeId)
    }

    if (nodeIds.size === 0) {
      skipped++
      continue
    }

    for (const nodeId of nodeIds) {
      const node = nodeMap.get(nodeId)!
      const isSuburb = node.nodeType === 'SUBURB'
      const areaType = isSuburb ? 'SUBURB' : 'REGION'
      const suburbKey = isSuburb ? (node.slug.split('__').at(-1) ?? node.slug) : null

      await prisma.technicianServiceArea.upsert({
        where: {
          providerId_locationNodeId: { providerId: provider.id, locationNodeId: nodeId },
        },
        create: {
          providerId: provider.id,
          locationNodeId: nodeId,
          areaType: areaType as never,
          label: normaliseLocationDisplayName(node.label),
          provinceKey: node.provinceKey,
          cityKey: node.cityKey,
          regionKey: node.regionKey,
          suburbKey,
          active: true,
        },
        update: {
          areaType: areaType as never,
          label: normaliseLocationDisplayName(node.label),
          provinceKey: node.provinceKey,
          cityKey: node.cityKey,
          regionKey: node.regionKey,
          suburbKey,
          active: true,
        },
      })
      created++
    }
  }

  console.log(`  Created/updated: ${created} service area rows | Unresolvable providers: ${skipped}`)
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function main(prisma: PrismaClient) {
  console.log('Backfill: structured location data\n')

  // Load all active SUBURB + REGION nodes once — shared by both phases
  const allNodes = await prisma.locationNode.findMany({
    where: { nodeType: { in: ['SUBURB', 'REGION'] }, active: true },
    select: { id: true, nodeType: true, slug: true, label: true, provinceKey: true, cityKey: true, regionKey: true },
  })

  const nodeMap = new Map<string, NodeRow>(allNodes.map((n) => [n.id, n]))
  console.log(`Loaded ${nodeMap.size} active SUBURB/REGION nodes`)

  await backfillAddresses(prisma, nodeMap)
  await backfillProviderServiceAreas(prisma, nodeMap)

  console.log('\nDone.')
}

// Run directly: pnpm db:backfill
if (require.main === module) {
  const client = new PrismaClient()
  main(client)
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
    .finally(() => client.$disconnect())
}

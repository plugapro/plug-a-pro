// ─── Backfill: resolve Address.locationNodeId from raw suburb/city strings ────
// Idempotent — only processes rows where locationNodeId IS NULL.
// Run: pnpm db:backfill
//
// For each Address missing locationNodeId:
//   1. Pre-fetch all active SUBURB LocationNodes into an in-memory lookup map
//   2. Match each address by (suburb label, cityKey) — case-insensitive
//   3. Batch-update matched addresses in a single $transaction
//   4. Log stats and list unresolved rows for manual review
//
// cityKey normalisation: LocationNode.cityKey values are stored as snake_case
// (e.g. "cape_town", "johannesburg"). Address.city strings are matched via
// case-insensitive contains. Verify your node data with:
//   SELECT DISTINCT "cityKey" FROM location_nodes WHERE "nodeType" = 'SUBURB';

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('Backfill: Address.locationNodeId\n')

  // ── 1. Load all active SUBURB nodes into a lookup map ────────────────────
  const suburbNodes = await prisma.locationNode.findMany({
    where: { nodeType: 'SUBURB', active: true },
    select: { id: true, label: true, cityKey: true },
  })

  // Map key: `${labelLower}::${cityKeyLower}` for exact match; also index by
  // label alone as a fallback when city is absent or mismatched.
  const byLabelCity = new Map<string, string>() // label::cityKey → nodeId
  const byLabelOnly = new Map<string, string[]>() // label → nodeId[]

  for (const node of suburbNodes) {
    const labelKey = node.label.toLowerCase()
    const cityKeyNorm = (node.cityKey ?? '').toLowerCase()
    byLabelCity.set(`${labelKey}::${cityKeyNorm}`, node.id)

    const list = byLabelOnly.get(labelKey) ?? []
    list.push(node.id)
    byLabelOnly.set(labelKey, list)
  }

  console.log(`Loaded ${suburbNodes.length} SUBURB nodes into lookup map`)

  // ── 2. Load unresolved addresses ─────────────────────────────────────────
  const addresses = await prisma.address.findMany({
    where: { locationNodeId: null, suburb: { not: '' } },
    select: { id: true, suburb: true, city: true },
  })

  console.log(`Found ${addresses.length} addresses without locationNodeId\n`)

  const updates: { id: string; nodeId: string }[] = []
  const unresolved: string[] = []

  for (const address of addresses) {
    const labelKey = address.suburb.toLowerCase()
    // Normalise city to snake_case for lookup (matches how cityKey is stored)
    const cityKeyNorm = (address.city ?? '').toLowerCase().replace(/\s+/g, '_')

    // Try exact label + city match first
    let nodeId = byLabelCity.get(`${labelKey}::${cityKeyNorm}`)

    // Fall back to label-only if there is exactly one node with that suburb name
    if (!nodeId) {
      const candidates = byLabelOnly.get(labelKey) ?? []
      if (candidates.length === 1) {
        nodeId = candidates[0]
      }
    }

    if (!nodeId) {
      unresolved.push(`  ${address.id} (suburb="${address.suburb}", city="${address.city}")`)
      continue
    }

    updates.push({ id: address.id, nodeId })
  }

  // ── 3. Batch-update in a transaction ─────────────────────────────────────
  if (updates.length > 0) {
    await prisma.$transaction(
      updates.map(({ id, nodeId }) =>
        prisma.address.update({
          where: { id },
          data: { locationNodeId: nodeId },
        }),
      ),
    )
  }

  console.log(
    `Result: ${updates.length} resolved, ${unresolved.length} unresolved out of ${addresses.length} total`,
  )

  if (unresolved.length > 0) {
    console.log('\nUnresolved addresses (no matching SUBURB node):')
    for (const row of unresolved) {
      console.log(row)
    }
  }

  console.log('\nDone.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())

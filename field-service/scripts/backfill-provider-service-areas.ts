/**
 * Backfill TechnicianServiceArea rows from approved provider applications
 * (PJ-01c, platform audit 2026-07-06).
 *
 * For each APPROVED ProviderApplication linked to a provider, resolves the
 * application's service areas to LocationNodes (registration draft node ids
 * first, then unambiguous label matching — see
 * lib/provider-application-service-areas.ts) and creates the MISSING
 * TechnicianServiceArea rows via upsertStructuredServiceAreas, which applies
 * the matching-region gate: rows outside the active matching regions are
 * created INACTIVE. Existing TSA rows are never modified — additive only.
 *
 * Idempotent: node ids that already have a TSA row are skipped.
 *
 * Flags:
 *   --execute           actually create rows (default is DRY-RUN)
 *   --providers a,b,c   restrict to these provider IDs (comma-separated)
 *
 * Usage:
 *   pnpm exec tsx scripts/backfill-provider-service-areas.ts
 *   pnpm exec tsx scripts/backfill-provider-service-areas.ts --execute
 */
import 'dotenv/config'
import { db } from '../lib/db'
import { resolveApplicationLocationNodeIds } from '../lib/provider-application-service-areas'
import { upsertStructuredServiceAreas } from '../lib/provider-record'

type Args = { execute: boolean; providers: string[] | null }

function parseArgs(): Args {
  const a = process.argv.slice(2)
  const providersIdx = a.indexOf('--providers')
  return {
    execute: a.includes('--execute'),
    providers:
      providersIdx >= 0 && a[providersIdx + 1]
        ? a[providersIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
        : null,
  }
}

async function main() {
  const args = parseArgs()
  console.log('--- backfill-provider-service-areas ---')
  console.log(`mode=${args.execute ? 'EXECUTE' : 'DRY-RUN'}  providers=${args.providers ? args.providers.join(',') : '<all approved applications>'}`)

  const applications = await db.providerApplication.findMany({
    where: {
      status: 'APPROVED',
      providerId: { not: null },
      ...(args.providers ? { providerId: { in: args.providers } } : {}),
    },
    select: {
      id: true,
      providerId: true,
      name: true,
      serviceAreas: true,
      submittedAt: true,
    },
    orderBy: { submittedAt: 'asc' },
  })
  console.log(`found ${applications.length} approved applications with a linked provider\n`)

  // One application per provider: keep the most recently submitted.
  const latestByProvider = new Map<string, (typeof applications)[number]>()
  for (const app of applications) {
    latestByProvider.set(app.providerId as string, app)
  }

  let wouldCreate = 0
  let created = 0
  let alreadyCovered = 0
  let unresolvedApps = 0

  for (const [providerId, app] of latestByProvider) {
    const resolution = await resolveApplicationLocationNodeIds(db, {
      applicationId: app.id,
      serviceAreas: app.serviceAreas,
    })

    if (resolution.locationNodeIds.length === 0) {
      unresolvedApps += 1
      console.log(
        `? provider=${providerId} (${app.name}) — no resolvable nodes` +
          (resolution.unresolvedLabels.length > 0 ? ` (unresolved labels: ${resolution.unresolvedLabels.join(', ')})` : ''),
      )
      continue
    }

    const existing = await db.technicianServiceArea.findMany({
      where: { providerId, locationNodeId: { in: resolution.locationNodeIds } },
      select: { locationNodeId: true },
    })
    const existingIds = new Set(existing.map((row) => row.locationNodeId))
    // Additive only: never touch rows that already exist.
    const missingIds = resolution.locationNodeIds.filter((id) => !existingIds.has(id))
    alreadyCovered += existingIds.size

    if (missingIds.length === 0) {
      console.log(`· provider=${providerId} (${app.name}) — fully covered (${existingIds.size} rows, source=${resolution.source})`)
      continue
    }

    if (args.execute) {
      // upsertStructuredServiceAreas applies the region gate: rows outside the
      // active matching regions are created with active=false. Only MISSING
      // node ids are passed, so no existing row is updated.
      await upsertStructuredServiceAreas(db, providerId, missingIds)
      created += missingIds.length
      console.log(`✓ provider=${providerId} (${app.name}) — created ${missingIds.length} TSA row(s) (source=${resolution.source})`)
    } else {
      wouldCreate += missingIds.length
      console.log(`+ provider=${providerId} (${app.name}) — WOULD create ${missingIds.length} TSA row(s) (source=${resolution.source})`)
    }

    if (resolution.unresolvedLabels.length > 0) {
      console.log(`    unresolved labels (manual review): ${resolution.unresolvedLabels.join(', ')}`)
    }
  }

  console.log('\n=== summary ===')
  console.log(`providers scanned:   ${latestByProvider.size}`)
  console.log(`${args.execute ? 'rows created:       ' : 'rows would create:  '} ${args.execute ? created : wouldCreate}`)
  console.log(`rows already there:  ${alreadyCovered}`)
  console.log(`unresolvable apps:   ${unresolvedApps}`)
  if (!args.execute) console.log('\n(dry-run; pass --execute to apply)')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

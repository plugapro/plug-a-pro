// Normalises human-facing location fields without changing IDs, slugs, keys,
// coordinates, postal codes, or free-text street address fields.
// Dry run:  npx tsx scripts/normalize-location-display-names.ts
// Apply:    npx tsx scripts/normalize-location-display-names.ts --apply

import { PrismaClient } from '@prisma/client'
import {
  normaliseLocationDisplayName,
  normaliseLocationDisplayNames,
} from '../lib/location-format'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')
const SAMPLE_LIMIT = 10

type Change = {
  table: string
  id: string
  field: string
  before: string
  after: string
}

function pushScalarChange(
  changes: Change[],
  table: string,
  id: string,
  field: string,
  value: string | null | undefined,
) {
  if (value == null) return
  const after = normaliseLocationDisplayName(value)
  if (after && after !== value) {
    changes.push({ table, id, field, before: value, after })
  }
}

function printChangeSummary(title: string, changes: Change[]) {
  console.log(`\n${title}: ${changes.length} field change${changes.length === 1 ? '' : 's'}`)
  for (const change of changes.slice(0, SAMPLE_LIMIT)) {
    console.log(`  ${change.table}.${change.field} ${change.id}: "${change.before}" -> "${change.after}"`)
  }
  if (changes.length > SAMPLE_LIMIT) {
    console.log(`  ... ${changes.length - SAMPLE_LIMIT} more`)
  }
}

async function normaliseLocationNodes() {
  const rows = await prisma.locationNode.findMany({
    select: { id: true, label: true },
  })
  const changes: Change[] = []
  for (const row of rows) {
    pushScalarChange(changes, 'LocationNode', row.id, 'label', row.label)
  }
  printChangeSummary('LocationNode labels', changes)

  if (APPLY) {
    for (const change of changes) {
      await prisma.locationNode.update({
        where: { id: change.id },
        data: { label: change.after },
      })
    }
  }
  return changes.length
}

async function normaliseAddresses() {
  const rows = await prisma.address.findMany({
    select: { id: true, suburb: true, region: true, city: true, province: true },
  })
  const changes: Change[] = []
  for (const row of rows) {
    pushScalarChange(changes, 'Address', row.id, 'suburb', row.suburb)
    pushScalarChange(changes, 'Address', row.id, 'region', row.region)
    pushScalarChange(changes, 'Address', row.id, 'city', row.city)
    pushScalarChange(changes, 'Address', row.id, 'province', row.province)
  }
  printChangeSummary('Address locality fields', changes)

  if (APPLY) {
    const byId = new Map<string, Record<string, string>>()
    for (const change of changes) {
      byId.set(change.id, { ...(byId.get(change.id) ?? {}), [change.field]: change.after })
    }
    for (const [id, data] of byId) {
      await prisma.address.update({ where: { id }, data })
    }
  }
  return changes.length
}

async function normaliseServiceAreaWaitlist() {
  const rows = await prisma.serviceAreaWaitlist.findMany({
    select: { id: true, suburb: true, city: true, province: true },
  })
  const changes: Change[] = []
  for (const row of rows) {
    pushScalarChange(changes, 'ServiceAreaWaitlist', row.id, 'suburb', row.suburb)
    pushScalarChange(changes, 'ServiceAreaWaitlist', row.id, 'city', row.city)
    pushScalarChange(changes, 'ServiceAreaWaitlist', row.id, 'province', row.province)
  }
  printChangeSummary('ServiceAreaWaitlist locality fields', changes)

  if (APPLY) {
    const byId = new Map<string, Record<string, string>>()
    for (const change of changes) {
      byId.set(change.id, { ...(byId.get(change.id) ?? {}), [change.field]: change.after })
    }
    for (const [id, data] of byId) {
      await prisma.serviceAreaWaitlist.update({ where: { id }, data })
    }
  }
  return changes.length
}

async function normaliseTechnicianServiceAreas() {
  const rows = await prisma.technicianServiceArea.findMany({
    select: { id: true, label: true, city: true, province: true },
  })
  const changes: Change[] = []
  for (const row of rows) {
    pushScalarChange(changes, 'TechnicianServiceArea', row.id, 'label', row.label)
    pushScalarChange(changes, 'TechnicianServiceArea', row.id, 'city', row.city)
    pushScalarChange(changes, 'TechnicianServiceArea', row.id, 'province', row.province)
  }
  printChangeSummary('TechnicianServiceArea display fields', changes)

  if (APPLY) {
    const byId = new Map<string, Record<string, string>>()
    for (const change of changes) {
      byId.set(change.id, { ...(byId.get(change.id) ?? {}), [change.field]: change.after })
    }
    for (const [id, data] of byId) {
      await prisma.technicianServiceArea.update({ where: { id }, data })
    }
  }
  return changes.length
}

async function normaliseProviderAreaArrays() {
  const rows = await prisma.provider.findMany({
    select: { id: true, serviceAreas: true },
  })
  let changed = 0
  console.log('\nProvider.serviceAreas array changes:')

  for (const row of rows) {
    const after = normaliseLocationDisplayNames(row.serviceAreas)
    if (JSON.stringify(after) === JSON.stringify(row.serviceAreas)) continue
    changed++
    if (changed <= SAMPLE_LIMIT) {
      console.log(`  Provider ${row.id}: ${JSON.stringify(row.serviceAreas)} -> ${JSON.stringify(after)}`)
    }
    if (APPLY) {
      await prisma.provider.update({ where: { id: row.id }, data: { serviceAreas: after } })
    }
  }
  if (changed > SAMPLE_LIMIT) console.log(`  ... ${changed - SAMPLE_LIMIT} more`)
  console.log(`  ${changed} provider row${changed === 1 ? '' : 's'} would change`)
  return changed
}

async function normaliseProviderApplicationAreaArrays() {
  const rows = await prisma.providerApplication.findMany({
    select: { id: true, serviceAreas: true },
  })
  let changed = 0
  console.log('\nProviderApplication.serviceAreas array changes:')

  for (const row of rows) {
    const after = normaliseLocationDisplayNames(row.serviceAreas)
    if (JSON.stringify(after) === JSON.stringify(row.serviceAreas)) continue
    changed++
    if (changed <= SAMPLE_LIMIT) {
      console.log(`  ProviderApplication ${row.id}: ${JSON.stringify(row.serviceAreas)} -> ${JSON.stringify(after)}`)
    }
    if (APPLY) {
      await prisma.providerApplication.update({ where: { id: row.id }, data: { serviceAreas: after } })
    }
  }
  if (changed > SAMPLE_LIMIT) console.log(`  ... ${changed - SAMPLE_LIMIT} more`)
  console.log(`  ${changed} application row${changed === 1 ? '' : 's'} would change`)
  return changed
}

async function main() {
  console.log(`Location display-name normalisation (${APPLY ? 'apply' : 'dry run'})`)

  const totals = [
    await normaliseLocationNodes(),
    await normaliseAddresses(),
    await normaliseServiceAreaWaitlist(),
    await normaliseTechnicianServiceAreas(),
    await normaliseProviderAreaArrays(),
    await normaliseProviderApplicationAreaArrays(),
  ]

  const total = totals.reduce((sum, value) => sum + value, 0)
  console.log(`\nTotal affected records/fields reported: ${total}`)
  if (!APPLY) {
    console.log('Dry run only. Re-run with --apply to write these display-name changes.')
  }
}

main()
  .catch((error) => {
    console.error('[normalize-location-display-names] failed', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

/**
 * Seeds the provider-agnostic identity verification vendor config rows.
 *
 * Secrets stay in environment variables. This script only writes operational
 * thresholds and display metadata used by admin and consent surfaces.
 */

import { db } from '../lib/db'

const vendors = [
  { vendorKey: 'manual', displayName: 'Manual review', livenessRequired: false },
  { vendorKey: 'mock', displayName: 'Mock', livenessRequired: true },
  { vendorKey: 'smile_id', displayName: 'Smile ID', livenessRequired: true },
  { vendorKey: 'thisisme', displayName: 'ThisIsMe', livenessRequired: true },
  { vendorKey: 'datanamix', displayName: 'Datanamix', livenessRequired: true },
  { vendorKey: 'omnicheck', displayName: 'OmniCheck', livenessRequired: true },
] as const

async function main() {
  for (const vendor of vendors) {
    await db.verificationVendorConfig.upsert({
      where: { vendorKey: vendor.vendorKey },
      create: {
        vendorKey: vendor.vendorKey,
        active: vendor.vendorKey === 'manual',
        confidenceThreshold: 0.9,
        livenessRequired: vendor.livenessRequired,
        configJson: {
          displayName: vendor.displayName,
          expectedTurnaroundMinutes: 30,
        },
      },
      update: {
        configJson: {
          displayName: vendor.displayName,
          expectedTurnaroundMinutes: 30,
        },
      },
    })
    console.log(`Seeded verification vendor config: ${vendor.vendorKey}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

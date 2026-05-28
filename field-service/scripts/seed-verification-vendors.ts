/**
 * Seeds the provider-agnostic identity verification vendor config rows.
 *
 * Secrets stay in environment variables. This script only writes operational
 * thresholds and display metadata used by admin and consent surfaces.
 */

import type { Prisma } from '@prisma/client'

import { db } from '../lib/db'

type VendorSeed = {
  vendorKey: string
  displayName: string
  livenessRequired: boolean
  configJson: Prisma.InputJsonValue
}

const vendors: VendorSeed[] = [
  {
    vendorKey: 'manual',
    displayName: 'Manual review',
    livenessRequired: false,
    configJson: {
      displayName: 'Manual review',
      expectedTurnaroundMinutes: 30,
    },
  },
  {
    vendorKey: 'mock',
    displayName: 'Mock',
    livenessRequired: true,
    configJson: {
      displayName: 'Mock',
      expectedTurnaroundMinutes: 30,
    },
  },
  {
    vendorKey: 'smile_id',
    displayName: 'Smile ID',
    livenessRequired: true,
    configJson: {
      displayName: 'Smile ID',
      expectedTurnaroundMinutes: 5,
      smileLinkTtlMinutes: 60,
      passResultCodes: ['0810'],
      rejectResultCodes: ['0811', '0812', '0816', '1014'],
      product: 'enhanced_document_verification',
      jobType: 11,
    },
  },
  {
    vendorKey: 'thisisme',
    displayName: 'ThisIsMe',
    livenessRequired: true,
    configJson: {
      displayName: 'ThisIsMe',
      expectedTurnaroundMinutes: 30,
    },
  },
  {
    vendorKey: 'datanamix',
    displayName: 'Datanamix',
    livenessRequired: true,
    configJson: {
      displayName: 'Datanamix',
      expectedTurnaroundMinutes: 30,
    },
  },
  {
    vendorKey: 'omnicheck',
    displayName: 'OmniCheck',
    livenessRequired: true,
    configJson: {
      displayName: 'OmniCheck',
      expectedTurnaroundMinutes: 30,
    },
  },
]

async function main() {
  for (const vendor of vendors) {
    await db.verificationVendorConfig.upsert({
      where: { vendorKey: vendor.vendorKey },
      create: {
        vendorKey: vendor.vendorKey,
        active: vendor.vendorKey === 'manual',
        confidenceThreshold: 0.9,
        livenessRequired: vendor.livenessRequired,
        configJson: vendor.configJson,
      },
      update: {
        configJson: vendor.configJson,
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

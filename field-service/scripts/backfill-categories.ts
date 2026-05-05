/**
 * backfill-categories.ts
 *
 * Seeds the DB-backed Category tables from the current legacy
 * service-category policy file. Safe to run multiple times.
 *
 * Usage:
 *   npx tsx scripts/backfill-categories.ts
 */

import 'dotenv/config'
import { db } from '../lib/db'
import { listCategoryPolicies } from '../lib/service-category-policy'

function titleize(input: string) {
  return input
    .split(/[\s&]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

async function main() {
  const categories = listCategoryPolicies()

  for (const [index, policy] of categories.entries()) {
    const category = await (db as any).category.upsert({
      where: { slug: policy.normalizedCategory },
      update: {
        label: titleize(policy.normalizedCategory),
        bookingOnAssignment: policy.bookingOnAssignment,
        regulated: policy.regulated,
        active: true,
        sortOrder: index,
      },
      create: {
        slug: policy.normalizedCategory,
        label: titleize(policy.normalizedCategory),
        bookingOnAssignment: policy.bookingOnAssignment,
        regulated: policy.regulated,
        active: true,
        sortOrder: index,
      },
      select: { id: true, slug: true },
    })

    await (db as any).categoryRequiredCertification.deleteMany({
      where: { categoryId: category.id },
    })
    await (db as any).categoryRequiredEquipment.deleteMany({
      where: { categoryId: category.id },
    })
    await (db as any).categoryRequiredVehicleType.deleteMany({
      where: { categoryId: category.id },
    })

    if (policy.requiredCertificationCodes.length > 0) {
      await (db as any).categoryRequiredCertification.createMany({
        data: policy.requiredCertificationCodes.map((code) => ({
          categoryId: category.id,
          code,
        })),
      })
    }

    if (policy.requiredEquipmentTags.length > 0) {
      await (db as any).categoryRequiredEquipment.createMany({
        data: policy.requiredEquipmentTags.map((tag) => ({
          categoryId: category.id,
          tag,
        })),
      })
    }

    if (policy.requiredVehicleTypes.length > 0) {
      await (db as any).categoryRequiredVehicleType.createMany({
        data: policy.requiredVehicleTypes.map((vehicleType) => ({
          categoryId: category.id,
          vehicleType,
        })),
      })
    }

    console.log(`✓ synced category ${category.slug}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

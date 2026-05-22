/**
 * seed-categories.ts
 *
 * Upserts initial Category rows with risk tiers.
 * Safe to re-run — uses upsert by slug throughout.
 *
 * Run after deploying the add_category_risk_tier migration:
 *   npx tsx scripts/seed-categories.ts
 */
import { PrismaClient, CategoryRiskTier } from '@prisma/client'

const db = new PrismaClient()

const CATEGORIES: Array<{ slug: string; label: string; riskTier: CategoryRiskTier }> = [
  { slug: 'cleaning',     label: 'Cleaning',                riskTier: CategoryRiskTier.LOW },
  { slug: 'garden',       label: 'Garden & Landscaping',    riskTier: CategoryRiskTier.LOW },
  { slug: 'diy',          label: 'DIY & Assembly',          riskTier: CategoryRiskTier.LOW },
  { slug: 'moving',       label: 'Moving & Packing',        riskTier: CategoryRiskTier.LOW },
  { slug: 'painting',     label: 'Painting',                riskTier: CategoryRiskTier.LOW },
  { slug: 'plumbing',     label: 'Plumbing',                riskTier: CategoryRiskTier.STANDARD },
  { slug: 'electrical',   label: 'Electrical',              riskTier: CategoryRiskTier.STANDARD },
  { slug: 'hvac',         label: 'HVAC',                    riskTier: CategoryRiskTier.STANDARD },
  { slug: 'pest-control', label: 'Pest Control',            riskTier: CategoryRiskTier.STANDARD },
]

async function main() {
  console.log(`Seeding ${CATEGORIES.length} categories…`)
  for (const cat of CATEGORIES) {
    await db.category.upsert({
      where: { slug: cat.slug },
      update: { riskTier: cat.riskTier },
      create: {
        slug: cat.slug,
        label: cat.label,
        riskTier: cat.riskTier,
      },
    })
    console.log(`  ${cat.riskTier === 'LOW' ? '✓ LOW     ' : '○ STANDARD'} ${cat.slug}`)
  }
  console.log('Done.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())

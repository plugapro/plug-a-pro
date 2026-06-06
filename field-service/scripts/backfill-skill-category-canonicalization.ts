/**
 * Canonicalizes legacy skill/category labels into service category slug tags.
 *
 * Dry run:
 *   pnpm exec tsx scripts/backfill-skill-category-canonicalization.ts
 *
 * Apply:
 *   pnpm exec tsx scripts/backfill-skill-category-canonicalization.ts --apply --confirm=canonicalize-skill-category-values
 */
import 'dotenv/config'

import { db } from '../lib/db'
import { runSkillCategoryCanonicalizationBackfill } from '../lib/skill-category-canonicalization-backfill'

const APPLY = process.argv.includes('--apply')
const DRY_RUN = process.argv.includes('--dry-run') || !APPLY
const CONFIRMED = process.argv.includes('--confirm=canonicalize-skill-category-values')

function printSummary(summary: Awaited<ReturnType<typeof runSkillCategoryCanonicalizationBackfill>>) {
  console.log(`[skill-category-canonicalization] mode=${summary.mode}`)
  console.log(`[skill-category-canonicalization] changed_rows=${summary.totalChangedRows}`)
  console.log(`[skill-category-canonicalization] audit_rows_written=${summary.auditRowsWritten}`)

  for (const [field, counts] of Object.entries(summary.fields)) {
    console.log(
      `[skill-category-canonicalization] field=${field} scanned=${counts.rowsScanned} changed_rows=${counts.rowsChanged} changed_values=${counts.valuesChanged}`,
    )
  }

  for (const warning of summary.warnings) {
    console.warn(`[skill-category-canonicalization] warning=${warning}`)
  }

  if (summary.changes.length > 0) {
    console.log('[skill-category-canonicalization] diffs:')
    for (const change of summary.changes) {
      console.log(JSON.stringify({
        entityType: change.entityType,
        entityId: change.entityId,
        field: change.field,
        before: change.before,
        after: change.after,
      }))
    }
  }
}

async function main() {
  if (APPLY && DRY_RUN && process.argv.includes('--dry-run')) {
    throw new Error('Choose either --dry-run or --apply, not both.')
  }

  const summary = await runSkillCategoryCanonicalizationBackfill(db as never, {
    apply: APPLY,
    confirmed: CONFIRMED,
    actorId: 'script:backfill-skill-category-canonicalization',
  })
  printSummary(summary)

  if (!APPLY && summary.totalChangedRows > 0) {
    console.log('Re-run with --apply --confirm=canonicalize-skill-category-values to write changes.')
  }
}

main()
  .catch((error) => {
    console.error('[skill-category-canonicalization] failed', error)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

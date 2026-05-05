/**
 * Normalizes all Provider phone numbers to E.164 format (+27xxxxxxxxx).
 *
 * Providers created before consistent normalization may have phones stored as:
 *   - 27xxxxxxxxx  (WhatsApp format, no + prefix)
 *   - 0xxxxxxxxx   (local SA format)
 *
 * The OTP login portal lookup uses findUnique({ where: { phone: '+27...' } })
 * and misses non-E.164 records, causing WORKER_NOT_FOUND even for valid providers.
 *
 * Usage:
 *   pnpm tsx scripts/backfill-provider-phone-e164.ts         # dry run
 *   pnpm tsx scripts/backfill-provider-phone-e164.ts --commit # apply
 */

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DRY_RUN = !process.argv.includes('--commit')

function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()']/g, '')
  if (stripped.startsWith('+')) return stripped
  if (stripped.startsWith('0') && stripped.length === 10) return `+27${stripped.slice(1)}`
  if (stripped.startsWith('27') && stripped.length === 11) return `+${stripped}`
  return stripped
}

async function main() {
  console.log(DRY_RUN ? '[dry-run] backfill-provider-phone-e164' : '[commit] backfill-provider-phone-e164')

  const providers = await db.provider.findMany({
    where: { NOT: { phone: { startsWith: '+' } } },
    select: { id: true, phone: true, name: true },
    orderBy: { createdAt: 'asc' },
  })

  console.log(`Found ${providers.length} provider(s) with non-E.164 phone`)

  let repaired = 0
  let skipped = 0
  let conflicts = 0

  for (const p of providers) {
    const e164 = normalizePhone(p.phone)
    if (e164 === p.phone) {
      skipped++
      continue
    }

    if (!e164.startsWith('+27') || !/^\+27[678]\d{8}$/.test(e164)) {
      console.warn(`  SKIP  ${p.id}  ${p.phone} → ${e164} (not a valid SA mobile number)`)
      skipped++
      continue
    }

    const existing = await db.provider.findUnique({ where: { phone: e164 }, select: { id: true } })
    if (existing && existing.id !== p.id) {
      console.warn(`  CONFLICT  ${p.id}  ${p.phone} → ${e164} already taken by ${existing.id}`)
      conflicts++
      continue
    }

    console.log(`  ${DRY_RUN ? 'WOULD REPAIR' : 'REPAIR'}  ${p.id}  "${p.name}"  ${p.phone} → ${e164}`)

    if (!DRY_RUN) {
      await db.provider.update({ where: { id: p.id }, data: { phone: e164 } })
      repaired++
    } else {
      repaired++
    }
  }

  console.log(`\nSummary: ${repaired} to repair, ${skipped} skipped, ${conflicts} conflict(s)`)
  if (DRY_RUN && repaired > 0) {
    console.log('Re-run with --commit to apply repairs.')
  }

  await db.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })

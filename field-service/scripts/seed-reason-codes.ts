/**
 * seed-reason-codes.ts
 *
 * Upserts all governed reason codes to the DB.
 * Run once after deploying the add_reason_codes migration:
 *
 *   npx tsx scripts/seed-reason-codes.ts
 */

import { db } from '../lib/db'

const CODES: Array<{
  key: string
  queueType: string
  label: string
  requireNote: boolean
}> = [
  // Dispatch queue
  { key: 'COVERAGE_GAP',          queueType: 'DISPATCH', label: 'No eligible providers in area',        requireNote: false },
  { key: 'DUPLICATE_REQUEST',     queueType: 'DISPATCH', label: 'Duplicate customer request',           requireNote: false },
  { key: 'CUSTOMER_CANCELLED',    queueType: 'DISPATCH', label: 'Customer cancelled before dispatch',   requireNote: false },
  { key: 'FRAUD_SUSPECTED',       queueType: 'DISPATCH', label: 'Fraud suspected',                      requireNote: true  },
  { key: 'PROVIDER_UNRESPONSIVE', queueType: 'DISPATCH', label: 'Provider did not respond to lead',     requireNote: false },
  { key: 'OUT_OF_SCOPE',          queueType: 'DISPATCH', label: 'Request outside platform scope',       requireNote: false },
  { key: 'OTHER',                 queueType: 'DISPATCH', label: 'Other (explain in note)',               requireNote: true  },

  // Field exceptions queue
  { key: 'PROVIDER_NO_SHOW',    queueType: 'FIELD', label: 'Provider did not arrive',                   requireNote: false },
  { key: 'CUSTOMER_NO_SHOW',    queueType: 'FIELD', label: 'Customer not available',                    requireNote: false },
  { key: 'SITE_ACCESS_BLOCKED', queueType: 'FIELD', label: 'Site access was blocked',                   requireNote: false },
  { key: 'ADDITIONAL_SCOPE',    queueType: 'FIELD', label: 'Additional scope required',                 requireNote: true  },
  { key: 'EQUIPMENT_MISSING',   queueType: 'FIELD', label: 'Required equipment not available',          requireNote: false },
  { key: 'OTHER',               queueType: 'FIELD', label: 'Other (explain in note)',                   requireNote: true  },

  // Finance queue
  { key: 'REFUND_ISSUED',      queueType: 'FINANCE', label: 'Refund issued to customer',                requireNote: false },
  { key: 'RETRIED_OK',         queueType: 'FINANCE', label: 'Payment retried successfully',             requireNote: false },
  { key: 'WRITTEN_OFF',        queueType: 'FINANCE', label: 'Written off',                              requireNote: true  },
  { key: 'CUSTOMER_CONTACTED', queueType: 'FINANCE', label: 'Customer contacted to resolve',           requireNote: false },
  { key: 'OTHER',              queueType: 'FINANCE', label: 'Other (explain in note)',                  requireNote: true  },

  // Trust/disputes queue
  { key: 'RESOLVED_REFUND',    queueType: 'TRUST', label: 'Resolved — refund issued',                  requireNote: false },
  { key: 'RESOLVED_REDO',      queueType: 'TRUST', label: 'Resolved — redo scheduled',                 requireNote: false },
  { key: 'RESOLVED_NO_ACTION', queueType: 'TRUST', label: 'Resolved — no further action',              requireNote: false },
  { key: 'ESCALATED_LEGAL',    queueType: 'TRUST', label: 'Escalated to legal',                        requireNote: true  },
  { key: 'OTHER',              queueType: 'TRUST', label: 'Other (explain in note)',                    requireNote: true  },

  // Quotes queue
  { key: 'QUOTE_EXPIRED',    queueType: 'QUOTES', label: 'Quote expired without customer response',    requireNote: false },
  { key: 'QUOTE_DECLINED',   queueType: 'QUOTES', label: 'Quote declined by customer',                 requireNote: false },
  { key: 'AMOUNT_DISPUTED',  queueType: 'QUOTES', label: 'Customer disputed the quoted amount',        requireNote: true  },
  { key: 'PROVIDER_REVISED', queueType: 'QUOTES', label: 'Provider submitted a revised quote',         requireNote: false },
  { key: 'OTHER',            queueType: 'QUOTES', label: 'Other (explain in note)',                    requireNote: true  },
]

async function main() {
  let upserted = 0
  for (const code of CODES) {
    await db.reasonCode.upsert({
      where: { key_queueType: { key: code.key, queueType: code.queueType } },
      update: { label: code.label, requireNote: code.requireNote, active: true },
      create: code,
    })
    upserted++
  }
  console.log(`Seeded ${upserted} reason codes.`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

/**
 * backfill-cases.ts
 *
 * Idempotent script that creates open Case rows for existing entities that
 * have no associated case yet. Run once after deploying the case lifecycle
 * migration, and again whenever you want to sweep for newly uncovered entities.
 *
 * Only run against staging or production — requires a live database.
 *
 *   npx tsx scripts/backfill-cases.ts
 */

import { db } from '../lib/db'
import type { CaseQueueType, CaseEntityType } from '@prisma/client'

// SLA targets in hours per queue type
const SLA_HOURS: Record<CaseQueueType, number> = {
  VALIDATION: 4,
  DISPATCH: 1,
  FIELD: 2,
  QUOTES: 24,
  FINANCE: 48,
  TRUST: 24,
  SUPPLY: 24,
}

function slaDueAt(queueType: CaseQueueType, createdAt: Date): Date {
  const h = SLA_HOURS[queueType]
  return new Date(createdAt.getTime() + h * 60 * 60 * 1000)
}

async function upsertCase(
  entityType: CaseEntityType,
  entityId: string,
  queueType: CaseQueueType,
  createdAt: Date
): Promise<{ created: boolean; id: string }> {
  const existing = await db.case.findFirst({
    where: { entityType, entityId, queueType, state: { in: ['OPEN', 'IN_PROGRESS'] } },
    select: { id: true },
  })
  if (existing) return { created: false, id: existing.id }

  const c = await db.case.create({
    data: {
      entityType,
      entityId,
      queueType,
      state: 'OPEN',
      slaDueAt: slaDueAt(queueType, createdAt),
      events: {
        create: {
          type: 'SYSTEM_EVENT',
          payload: { backfilled: true, backfilledAt: new Date().toISOString() },
        },
      },
    },
    select: { id: true },
  })
  return { created: true, id: c.id }
}

async function main() {
  let created = 0
  let skipped = 0

  // Open job requests → VALIDATION queue
  const openJRs = await db.jobRequest.findMany({
    where: { status: { in: ['PENDING', 'REVIEWING'] } },
    select: { id: true, createdAt: true },
  })
  for (const jr of openJRs) {
    const r = await upsertCase('JOB_REQUEST', jr.id, 'VALIDATION', jr.createdAt)
    r.created ? created++ : skipped++
  }

  // Unmatched job requests → DISPATCH queue
  const dispatchJRs = await db.jobRequest.findMany({
    where: { status: 'MATCHING' },
    select: { id: true, createdAt: true },
  })
  for (const jr of dispatchJRs) {
    const r = await upsertCase('JOB_REQUEST', jr.id, 'DISPATCH', jr.createdAt)
    r.created ? created++ : skipped++
  }

  // Open bookings → FIELD queue
  const openBookings = await db.booking.findMany({
    where: { status: { in: ['CONFIRMED', 'IN_PROGRESS'] } },
    select: { id: true, createdAt: true },
  })
  for (const b of openBookings) {
    const r = await upsertCase('BOOKING', b.id, 'FIELD', b.createdAt)
    r.created ? created++ : skipped++
  }

  // Open disputes → TRUST queue
  const openDisputes = await db.dispute.findMany({
    where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    select: { id: true, createdAt: true },
  })
  for (const d of openDisputes) {
    const r = await upsertCase('DISPUTE', d.id, 'TRUST', d.createdAt)
    r.created ? created++ : skipped++
  }

  // Pending/failed payments → FINANCE queue
  const pendingPayments = await db.payment.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] } },
    select: { id: true, createdAt: true },
  })
  for (const p of pendingPayments) {
    const r = await upsertCase('PAYMENT', p.id, 'FINANCE', p.createdAt)
    r.created ? created++ : skipped++
  }

  console.log(`Backfill complete: created=${created}, skipped=${skipped}`)
  await db.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

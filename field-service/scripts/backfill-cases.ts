#!/usr/bin/env tsx
// ─── Backfill Cases for open entities ────────────────────────────────────────
// Creates Case rows for all currently-open entities across every ops queue.
// Safe to re-run — uses upsert with onConflict DO NOTHING on (entityType,entityId,queueType).
//
// Usage:
//   pnpm exec tsx scripts/backfill-cases.ts
//   pnpm exec tsx scripts/backfill-cases.ts --dry-run
//
// Entities scanned:
//   JobRequest  → VALIDATION (PENDING_VALIDATION) or DISPATCH (OPEN/MATCHING)
//   Match       → DISPATCH (SENT/ACCEPTED/QUOTED/AWAITING_APPROVAL)
//   Booking     → FIELD (CONFIRMED/IN_PROGRESS/AWAITING_PAYMENT)
//   Dispute     → TRUST (OPEN/UNDER_REVIEW)
//   Payment     → FINANCE (FAILED/PENDING past 30min)
//   ProviderApplication → PROVIDER_ONBOARDING (PENDING)

import { PrismaClient, OpsQueueType, CaseEntityType } from '@prisma/client'
import { slaFor } from '../lib/sla'

const isDryRun = process.argv.includes('--dry-run')
const prisma = new PrismaClient()

let created = 0
let skipped = 0
let errors  = 0

async function upsertCase(params: {
  queueType:  OpsQueueType
  entityType: CaseEntityType
  entityId:   string
  createdAt:  Date
}) {
  const sla = slaFor(params.queueType)
  const slaDueAt = new Date(params.createdAt.getTime() + sla.targetMinutes * 60_000)

  try {
    if (isDryRun) {
      console.log(`[dry-run] would create Case ${params.queueType}/${params.entityType}/${params.entityId}`)
      created++
      return
    }

    const existing = await prisma.case.findUnique({
      where: {
        entityType_entityId_queueType: {
          entityType: params.entityType,
          entityId:   params.entityId,
          queueType:  params.queueType,
        },
      },
      select: { id: true },
    })

    if (existing) {
      skipped++
      return
    }

    const c = await prisma.case.create({
      data: {
        queueType:  params.queueType,
        entityType: params.entityType,
        entityId:   params.entityId,
        slaDueAt,
        events: {
          create: {
            type:    'SYSTEM_EVENT',
            payload: { backfilled: true, backfilledAt: new Date().toISOString() },
          },
        },
      },
      select: { id: true },
    })

    console.log(`created Case ${c.id} for ${params.entityType}/${params.entityId}`)
    created++
  } catch (err) {
    console.error(`error creating Case for ${params.entityType}/${params.entityId}:`, err)
    errors++
  }
}

async function main() {
  console.log(`backfill-cases starting${isDryRun ? ' (DRY RUN)' : ''}…`)

  // ── 1. VALIDATION queue — PENDING_VALIDATION job requests ─────────────────
  const pendingValidation = await prisma.jobRequest.findMany({
    where: { status: 'PENDING_VALIDATION' },
    select: { id: true, createdAt: true },
  })
  for (const jr of pendingValidation) {
    await upsertCase({ queueType: 'VALIDATION', entityType: 'JOB_REQUEST', entityId: jr.id, createdAt: jr.createdAt })
  }
  console.log(`validation queue: ${pendingValidation.length} records scanned`)

  // ── 2. DISPATCH queue — OPEN or MATCHING job requests ─────────────────────
  const openRequests = await prisma.jobRequest.findMany({
    where: { status: { in: ['OPEN', 'MATCHING'] } },
    select: { id: true, createdAt: true },
  })
  for (const jr of openRequests) {
    await upsertCase({ queueType: 'DISPATCH', entityType: 'JOB_REQUEST', entityId: jr.id, createdAt: jr.createdAt })
  }
  console.log(`dispatch queue: ${openRequests.length} records scanned`)

  // ── 3. QUOTE_APPROVAL queue — PENDING quotes ──────────────────────────────
  const pendingQuotes = await prisma.quote.findMany({
    where: { status: 'PENDING' },
    select: { id: true, createdAt: true },
  })
  for (const q of pendingQuotes) {
    await upsertCase({ queueType: 'QUOTE_APPROVAL', entityType: 'QUOTE', entityId: q.id, createdAt: q.createdAt })
  }
  console.log(`quote_approval queue: ${pendingQuotes.length} records scanned`)

  // ── 4. FIELD_EXCEPTION queue — jobs in exception states ───────────────────
  const exceptionJobs = await prisma.job.findMany({
    where: { status: { in: ['FAILED', 'CALLBACK_REQUIRED'] } },
    select: { id: true, createdAt: true },
  })
  for (const j of exceptionJobs) {
    await upsertCase({ queueType: 'FIELD_EXCEPTION', entityType: 'BOOKING', entityId: j.id, createdAt: j.createdAt })
  }
  console.log(`field_exception queue: ${exceptionJobs.length} records scanned`)

  // ── 5. DISPUTE queue — open disputes ──────────────────────────────────────
  const openDisputes = await prisma.dispute.findMany({
    where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
    select: { id: true, createdAt: true },
  })
  for (const d of openDisputes) {
    await upsertCase({ queueType: 'DISPUTE', entityType: 'DISPUTE', entityId: d.id, createdAt: d.createdAt })
  }
  console.log(`dispute queue: ${openDisputes.length} records scanned`)

  // ── 6. PAYMENT_FOLLOW_UP — failed payments ────────────────────────────────
  const failedPayments = await prisma.payment.findMany({
    where: { status: 'FAILED' },
    select: { id: true, createdAt: true },
  })
  for (const p of failedPayments) {
    await upsertCase({ queueType: 'PAYMENT_FOLLOW_UP', entityType: 'PAYMENT', entityId: p.id, createdAt: p.createdAt })
  }
  console.log(`payment_follow_up queue: ${failedPayments.length} records scanned`)

  // ── 7. PROVIDER_ONBOARDING — pending applications ─────────────────────────
  const pendingApps = await prisma.providerApplication.findMany({
    where: { status: 'PENDING' },
    select: { id: true, submittedAt: true },
  })
  for (const a of pendingApps) {
    await upsertCase({ queueType: 'PROVIDER_ONBOARDING', entityType: 'APPLICATION', entityId: a.id, createdAt: a.submittedAt })
  }
  console.log(`provider_onboarding queue: ${pendingApps.length} records scanned`)

  console.log(`\nbackfill-cases complete — created: ${created}, skipped: ${skipped}, errors: ${errors}`)
  if (errors > 0) process.exit(1)
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => prisma.$disconnect())

/**
 * One-shot remediation: Sarah Sullivan DIY & Assembly job (2026-05-19)
 *
 * Root cause: handleAssignmentHoldAcceptance called acceptLead instead of
 * acceptAssignmentOffer. acceptLead always returned EXPIRED for AUTO_ASSIGN jobs
 * because the job request status is OPEN (never transitions to MATCHING). Lovemore
 * attempted to accept at 12:41 SAST but the bug refused it. The hold timed out
 * naturally, the engine rotated twice more, all rounds timed out, and the job
 * request was marked EXPIRED.
 *
 * Fix deployed: whatsapp-bot.ts now calls acceptAssignmentOffer.
 *
 * This script:
 *   1. Resets the job request from EXPIRED → OPEN
 *   2. Creates a fresh AssignmentHold for Lovemore (10-minute window)
 *   3. Calls dispatchMatchLead — upserts the lead to SENT and sends the WhatsApp
 *
 * Job request ID : cmpcgwrwh003plg04924oftqi
 * Lead ID        : cmpci5i5j000ml404i189l9fb
 * Provider       : Lovemore Sibanda (+27823035070)
 * Customer       : Sarah Sullivan
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/redispatch-sarah-diy-to-lovemore.ts
 */

import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaClient } from '@prisma/client'
import { dispatchMatchLead } from '../lib/matching/dispatch'
import { MATCHING_CONFIG } from '../lib/matching/config'

const JOB_REQUEST_ID = 'cmpcgwrwh003plg04924oftqi'
const PROVIDER_ID = 'b6b91902-b268-4bc3-9d16-0942a25c2d60'
// From the original Lovemore dispatch round — reused so the hold has valid FK references
const DISPATCH_DECISION_ID = 'cmpchmbfr0001l4042zox7gje'
const MATCH_ATTEMPT_ID = 'cmpchmbvp0005l404esa1pcq2'

const db = new PrismaClient()

async function main() {
  // ── 1. Load job request ──────────────────────────────────────────────────────
  const jobRequest = await db.jobRequest.findUniqueOrThrow({
    where: { id: JOB_REQUEST_ID },
    include: {
      address: { select: { suburb: true, city: true, province: true, region: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
  })

  console.log('[redispatch] job request:', jobRequest.id, 'status:', jobRequest.status)

  if (jobRequest.status !== 'EXPIRED' && jobRequest.status !== 'OPEN') {
    console.error('[redispatch] Unexpected job request status — aborting. Current status:', jobRequest.status)
    process.exit(1)
  }

  // ── 2. Load provider ──────────────────────────────────────────────────────────
  const provider = await db.provider.findUniqueOrThrow({
    where: { id: PROVIDER_ID },
    select: {
      id: true,
      name: true,
      phone: true,
      skills: true,
      serviceAreas: true,
      maxTravelMinutes: true,
      reliabilityScore: true,
      averageRating: true,
      active: true,
      verified: true,
      availableNow: true,
      isTestUser: true,
      lastKnownLat: true,
      lastKnownLng: true,
    },
  })

  console.log('[redispatch] provider:', provider.name, provider.phone)

  if (!provider.active || provider.id !== PROVIDER_ID) {
    console.error('[redispatch] Provider is not active — aborting')
    process.exit(1)
  }

  // ── 3. Reset job request → OPEN ───────────────────────────────────────────────
  await db.jobRequest.update({
    where: { id: JOB_REQUEST_ID },
    data: { status: 'OPEN' },
  })
  console.log('[redispatch] job request status reset to OPEN')

  // ── 4. Find or create AssignmentHold ────────────────────────────────────────
  type HoldRow = { id: string; expiresAt: Date }
  const existingRows = await db.$queryRaw<HoldRow[]>`
    SELECT id, "expiresAt" FROM assignment_holds
    WHERE "jobRequestId" = ${JOB_REQUEST_ID}
      AND "providerId" = ${PROVIDER_ID}
      AND status = 'ACTIVE'
    LIMIT 1
  `
  let hold: { id: string; expiresAt: Date }

  if (existingRows.length > 0) {
    hold = existingRows[0]
    console.log('[redispatch] reusing existing hold:', hold.id, 'expires:', hold.expiresAt.toISOString())
  } else {
    const expiresAt = new Date(Date.now() + MATCHING_CONFIG.offerTtlMinutes * 60_000)
    // Use raw SQL — the schema requires dispatchDecisionId and matchAttemptId to be
    // non-null, so we reuse the original FK references from the first Lovemore round.
    const holdId = randomUUID()
    const now = new Date()
    await db.$executeRaw`
      INSERT INTO assignment_holds
        (id, "jobRequestId", "providerId", "dispatchDecisionId", "matchAttemptId",
         status, "offeredAt", "expiresAt", "createdAt", "updatedAt")
      VALUES
        (${holdId}, ${JOB_REQUEST_ID}, ${PROVIDER_ID}, ${DISPATCH_DECISION_ID}, ${MATCH_ATTEMPT_ID},
         'ACTIVE', ${now}, ${expiresAt}, ${now}, ${now})
    `
    hold = { id: holdId, expiresAt }
    console.log('[redispatch] created hold:', hold.id, 'expires:', hold.expiresAt.toISOString())
  }

  // ── 5. Dispatch lead + send WhatsApp ─────────────────────────────────────────
  // dispatchMatchLead upserts the lead to SENT and sends the offer notification.
  await dispatchMatchLead({
    jobRequest: {
      ...jobRequest,
      isTestRequest: (jobRequest as unknown as { isTestRequest?: boolean }).isTestRequest ?? false,
    },
    hold: {
      id: hold.id,
      expiresAt: hold.expiresAt,
      dispatchDecisionId: null,
      matchAttemptId: null,
    },
    provider: {
      ...provider,
      scoreBase: 0,
      fromPool: false,
      isOnline: null,
      liveLocationLat: null,
      liveLocationLng: null,
      lastHeartbeatAt: null,
      cohortName: null,
    },
  })

  console.log('[redispatch] ✓ WhatsApp dispatched to', provider.name, '— lead upserted to SENT, expires at', hold.expiresAt.toISOString())
  console.log('[redispatch] Lovemore has', MATCHING_CONFIG.offerTtlMinutes, 'minutes to accept.')

  await db.$disconnect()
}

main().catch((err) => {
  console.error('[redispatch] failed:', err)
  process.exit(1)
})

// Draft-abandonment WhatsApp nudge (spec §5). Selection windows: touch 1 at
// idle>2h nudgeCount=0; touch 2 at idle>24h nudgeCount=1 lastNudgeAt>20h ago.
// Hard cap 2. Flag-gated; claim/finalize mirrors the session-timeout cron.
import { NON_TERMINAL_VERIFICATION_STATUSES } from '@/lib/identity-verification/types'

const TOUCH1_IDLE_MS = 2 * 60 * 60 * 1000
const TOUCH2_IDLE_MS = 24 * 60 * 60 * 1000
const TOUCH2_GAP_MS = 20 * 60 * 60 * 1000

export function selectionWhere(now: Date) {
  return {
    submittedApplicationId: null,
    phone: { not: '' },
    OR: [
      { nudgeCount: 0, updatedAt: { lt: new Date(now.getTime() - TOUCH1_IDLE_MS) } },
      {
        nudgeCount: 1,
        updatedAt: { lt: new Date(now.getTime() - TOUCH2_IDLE_MS) },
        lastNudgeAt: { lt: new Date(now.getTime() - TOUCH2_GAP_MS) },
      },
    ],
  }
}

export type NudgeDeps = {
  now: () => Date
  db: any // TODO: narrow to the Prisma Pick actually used; kept wide for DI in unit tests
  findActiveApplication: (client: any, phone: string) => Promise<{ id: string } | null>
  mintResumeToken: (client: any, draftId: string) => Promise<string>
  sendTemplate: (params: any) => Promise<string>
  flagEnabled: (key: string) => Promise<boolean>
  // Deliberately no publicUrl dep: the resume token travels as a URL button
  // dynamic suffix (never the body), and Meta appends it to the static
  // prefix baked into the registered template — the send never needs a
  // fully-qualified resume URL, only the raw token.
}

export async function runDraftAbandonmentNudge(deps: NudgeDeps) {
  if (!(await deps.flagEnabled('provider.registration.abandonment_nudge'))) {
    return { found: 0, sent: 0, skipped: 0, errors: 0 }
  }
  const now = deps.now()
  const candidates = await deps.db.providerApplicationDraft.findMany({
    where: selectionWhere(now),
    select: {
      id: true, phone: true, name: true, nudgeCount: true, lastNudgeAt: true, updatedAt: true,
      identityVerifications: { select: { id: true, status: true } },
    },
    take: 100,
  })

  let sent = 0, skipped = 0, errors = 0
  for (const draft of candidates) {
    try {
      const hasInFlightVerification = draft.identityVerifications.some((v: { status: string }) =>
        (NON_TERMINAL_VERIFICATION_STATUSES as readonly string[]).includes(v.status),
      )
      if (hasInFlightVerification) { skipped++; continue }
      if (await deps.findActiveApplication(deps.db, draft.phone)) { skipped++; continue }
      if (await deps.db.customer.findFirst({ where: { phone: draft.phone }, select: { id: true } })) { skipped++; continue }
      if (await deps.db.provider.findFirst({ where: { phone: draft.phone }, select: { id: true } })) { skipped++; continue }

      // Atomic claim: a true compare-and-set. Guarding on nudgeCount alone is
      // not sufficient — two overlapping cron instances can both read the same
      // candidate and both pass a nudgeCount-only check before either writes.
      // Guarding on lastNudgeAt too (Prisma matches `lastNudgeAt: null`
      // correctly for first touches) means only the FIRST writer's updateMany
      // can match; the second's precondition no longer holds and it gets
      // count: 0, closing the double-send race.
      //
      // Self-heal invariant: if the process crashes between this claim and
      // the restore/finalize below, the row is left with lastNudgeAt stamped
      // but nudgeCount unchanged — it would look claimable again by count
      // alone. It does NOT get re-selected immediately only because the
      // explicit `updatedAt: now` below (Prisma also auto-bumps @updatedAt on
      // any write) pushes `updatedAt` out of the touch-1/touch-2 idle
      // windows in selectionWhere(); the row becomes re-eligible again once
      // it has been idle for a full window from this claim timestamp, not
      // sooner. This is intentional belt-and-braces, not a fix for the crash
      // itself — a crash here still costs the draft one full idle window
      // before it's retried.
      const claimed = await deps.db.providerApplicationDraft.updateMany({
        where: {
          id: draft.id,
          nudgeCount: draft.nudgeCount,
          lastNudgeAt: draft.lastNudgeAt,
          submittedApplicationId: null,
        },
        data: { lastNudgeAt: now, updatedAt: now },
      })
      if (claimed.count === 0) { skipped++; continue }

      const touch = draft.nudgeCount + 1
      // Attempt-first auditability (mirrors lib/identity-verification/in-flight-renudge.ts):
      // write the "attempted" row BEFORE calling sendTemplate so a crash
      // between a confirmed Meta send and the finalize write below can never
      // leave a delivered message with zero audit trail.
      await deps.db.auditLog.create({
        data: {
          actorId: 'system', actorRole: 'system', action: 'draft.abandonment_nudge_attempted',
          entityType: 'ProviderApplicationDraft', entityId: draft.id,
          after: { touch, to: draft.phone },
        },
      }).catch(() => {})

      try {
        const token = await deps.mintResumeToken(deps.db, draft.id)
        const firstName = draft.name?.split(' ')[0] || 'there'
        await deps.sendTemplate({
          to: draft.phone,
          template: 'provider_registration_resume_nudge',
          components: [
            { type: 'body', parameters: [{ type: 'text', text: firstName }] },
            // URL button: static prefix is baked into the Meta-registered
            // template; only the dynamic resume-token suffix travels here.
            // Never put the token/URL in body/header text — sendTemplate's
            // raw-url guard rejects that unconditionally.
            { type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: token }] },
          ],
          metadata: { draftId: draft.id, touch },
        })
      } catch (err) {
        // Release the claim: restore prior lastNudgeAt so the row is re-eligible.
        await deps.db.providerApplicationDraft.updateMany({
          where: { id: draft.id },
          data: { lastNudgeAt: draft.lastNudgeAt },
        }).catch(() => {})
        throw err
      }

      // Finalize only after a confirmed send.
      await deps.db.providerApplicationDraft.updateMany({
        where: { id: draft.id },
        data: { nudgeCount: { increment: 1 }, lastNudgeAt: now },
      })
      await deps.db.auditLog.create({
        data: {
          actorId: 'system', actorRole: 'system', action: 'draft.abandonment_nudge_sent',
          entityType: 'ProviderApplicationDraft', entityId: draft.id,
          after: { touch },
        },
      }).catch(() => {})
      sent++
    } catch {
      errors++
    }
  }
  return { found: candidates.length, sent, skipped, errors }
}

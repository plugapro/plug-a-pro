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
  publicUrl: (path: string) => string
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

      // Atomic claim: only proceeds if nudgeCount is unchanged since selection.
      const claimed = await deps.db.providerApplicationDraft.updateMany({
        where: { id: draft.id, nudgeCount: draft.nudgeCount, submittedApplicationId: null },
        data: { lastNudgeAt: now },
      })
      if (claimed.count === 0) { skipped++; continue }

      try {
        const token = await deps.mintResumeToken(deps.db, draft.id)
        const resumeUrl = deps.publicUrl(`/provider/register?resume=${encodeURIComponent(token)}`)
        const firstName = draft.name?.split(' ')[0] || 'there'
        await deps.sendTemplate({
          to: draft.phone,
          template: 'provider_registration_resume_nudge',
          components: [{ type: 'body', parameters: [
            { type: 'text', text: firstName },
            { type: 'text', text: resumeUrl },
          ] }],
          metadata: { draftId: draft.id, touch: draft.nudgeCount + 1 },
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
          after: { touch: draft.nudgeCount + 1 },
        },
      }).catch(() => {})
      sent++
    } catch {
      errors++
    }
  }
  return { found: candidates.length, sent, skipped, errors }
}

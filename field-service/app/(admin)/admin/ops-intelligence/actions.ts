'use server'

// ─── Admin: Ops Intelligence — server actions ────────────────────────────────
// Every mutation goes through crudAction() (audited) and is mirrored to
// OpenBrain. Reviewing a recommendation and approving/rejecting a draft are the
// only state changes. Approving a draft sets it APPROVED — it does NOT send.
// No external WhatsApp message is sent anywhere in Phase 1.

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { crudAction, CrudActionError } from '@/lib/crud-action'
import { requireAdmin } from '@/lib/auth'
import { captureReview, captureDraftDecision } from '@/lib/ops-agents'
import { runAgent } from '@/lib/ops-agents'
import { PHASE_1_AGENTS } from '@/lib/ops-agents/agents'
import type { OpsAgentKey, OpsRecommendationStatus } from '@prisma/client'

const FLAG = 'admin.ops_intelligence'
// Ops-intelligence triage roles. roleExact is used on every action so this list
// is authoritative — FINANCE (which outranks OPS in the hierarchy) is NOT
// admitted. OWNER is always allowed as break-glass by crudAction.
const ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const PATH = '/admin/ops-intelligence'

// ── Review a recommendation (acknowledge / resolve / dismiss) ────────────────

const ReviewSchema = z.object({
  recommendationId: z.string().min(1),
  decision: z.enum(['ACKNOWLEDGED', 'ACTIONED', 'DISMISSED']),
  note: z.string().max(2000).optional(),
})
export type ReviewInput = z.infer<typeof ReviewSchema>

export async function reviewRecommendationAction(input: ReviewInput) {
  const admin = await requireAdmin()
  const nowIso = new Date().toISOString()

  const result = await crudAction<ReviewInput, { id: string; agentKey: OpsAgentKey; entityType: string; entityId: string }>({
    entity: 'OpsRecommendation',
    entityId: input.recommendationId,
    action: 'ops.recommendation.review',
    requiredRole: [...ROLES],
    roleExact: true,
    requiredFlag: FLAG,
    schema: ReviewSchema,
    input,
    reason: input.note,
    run: async (data, tx) => {
      const rec = await tx.opsRecommendation.update({
        where: { id: data.recommendationId },
        data: {
          status: data.decision as OpsRecommendationStatus,
          reviewedById: admin.id,
          reviewedAt: new Date(nowIso),
          reviewNote: data.note ?? null,
        },
        select: { id: true, agentKey: true, entityType: true, entityId: true },
      })
      return rec
    },
  })

  void captureReview({
    recommendationId: result.data.id,
    agentKey: result.data.agentKey,
    entityType: result.data.entityType,
    entityId: result.data.entityId,
    decision: input.decision,
    adminId: admin.id,
    occurredAtIso: nowIso,
  })

  revalidatePath(PATH)
  return result
}

export async function reviewRecommendationFromFormAction(formData: FormData) {
  await reviewRecommendationAction({
    recommendationId: String(formData.get('recommendationId') ?? ''),
    decision: String(formData.get('decision') ?? '') as ReviewInput['decision'],
    note: (formData.get('note') as string) || undefined,
  })
}

// ── Approve / reject a draft (approve does NOT send) ─────────────────────────

const DraftDecisionSchema = z.object({
  draftId: z.string().min(1),
  decision: z.enum(['APPROVE', 'REJECT']),
  reason: z.string().max(2000).optional(),
})
export type DraftDecisionInput = z.infer<typeof DraftDecisionSchema>

export async function decideDraftAction(input: DraftDecisionInput) {
  const admin = await requireAdmin()
  const nowIso = new Date().toISOString()
  const approve = input.decision === 'APPROVE'

  const result = await crudAction<
    DraftDecisionInput,
    { id: string; recommendationId: string; recipientRole: string; agentKey: OpsAgentKey }
  >({
    entity: 'OpsDraftMessage',
    entityId: input.draftId,
    action: approve ? 'ops.draft.approve' : 'ops.draft.reject',
    requiredRole: [...ROLES],
    roleExact: true,
    requiredFlag: FLAG,
    schema: DraftDecisionSchema,
    input,
    reason: input.reason,
    run: async (data, tx) => {
      const existing = await tx.opsDraftMessage.findUniqueOrThrow({
        where: { id: data.draftId },
        select: { id: true, status: true, recommendationId: true, recipientRole: true, recommendation: { select: { agentKey: true } } },
      })
      // Only PENDING_APPROVAL drafts are decidable. Guard against re-deciding an
      // already APPROVED/REJECTED/SENT draft — this is what keeps a previously
      // rejected (or, in a later phase, sent) draft from being flipped back to
      // APPROVED. Hardens the no-send invariant.
      if (existing.status !== 'PENDING_APPROVAL') {
        throw new CrudActionError('CONFLICT', `Draft is ${existing.status}, not PENDING_APPROVAL — cannot ${approve ? 'approve' : 'reject'}.`)
      }
      // Approving sets APPROVED (queued, NOT sent); sending is out of Phase 1 scope.
      const next = approve ? 'APPROVED' : 'REJECTED'
      const updated = await tx.opsDraftMessage.update({
        where: { id: data.draftId },
        data: {
          status: next,
          approvedById: approve ? admin.id : null,
          approvedAt: approve ? new Date(nowIso) : null,
          failureReason: approve ? null : (data.reason ?? null),
        },
        select: { id: true, recommendationId: true, recipientRole: true },
      })
      return { ...updated, agentKey: existing.recommendation.agentKey }
    },
  })

  void captureDraftDecision({
    draftId: result.data.id,
    recommendationId: result.data.recommendationId,
    agentKey: result.data.agentKey,
    recipientRole: result.data.recipientRole,
    decision: approve ? 'approved' : 'rejected',
    adminId: admin.id,
    reason: input.reason ?? null,
    occurredAtIso: nowIso,
  })

  revalidatePath(PATH)
  return result
}

export async function decideDraftFromFormAction(formData: FormData) {
  await decideDraftAction({
    draftId: String(formData.get('draftId') ?? ''),
    decision: String(formData.get('decision') ?? '') as DraftDecisionInput['decision'],
    reason: (formData.get('reason') as string) || undefined,
  })
}

// ── Manual "Run agents now" trigger ──────────────────────────────────────────

export async function runAgentsNowAction() {
  // Gate + audit the manual trigger through crudAction (same role allow-list as
  // the mutation actions, and an AuditLog/AdminAuditEvent row recording who ran
  // the batch). The agents run AFTER, outside the audit transaction, because
  // runAgent opens its own transactions and is long-running.
  await crudAction<undefined, { id: string }>({
    entity: 'OpsAgentRun',
    entityId: 'manual-batch',
    action: 'ops.agents.run_now',
    requiredRole: [...ROLES],
    roleExact: true,
    requiredFlag: FLAG,
    run: async () => ({ id: 'manual-batch' }),
  })

  for (const { agent } of PHASE_1_AGENTS) {
    await runAgent(agent, { trigger: 'manual' })
  }
  revalidatePath(PATH)
}

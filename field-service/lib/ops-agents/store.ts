// ─── Ops Agent Workflow Team — persistence boundary ──────────────────────────
// The runner talks to this narrow store rather than Prisma directly, so it can
// be unit-tested with an in-memory store and so dedupe/draft-replacement logic
// lives in one place. createPrismaStore() is the production implementation.

import { Prisma, type OpsDraftStatus, type PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'
import type { Evaluation, OpsAgentKey } from './types'

const NON_TERMINAL_DRAFT_STATUSES: OpsDraftStatus[] = [
  'PENDING_APPROVAL',
  'BLOCKED_POLICY',
]

export interface CreateRunInput {
  agentKey: OpsAgentKey
  trigger: string
  startedAtIso: string
  windowFromIso?: string | null
  windowToIso?: string | null
}

export interface FinishRunPatch {
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  finishedAtIso: string
  candidates: number
  recommended: number
  draftsCreated: number
  error?: string | null
}

export interface UpsertRecommendationResult {
  id: string
  /** true when a new row was created, false when an existing one was updated. */
  created: boolean
}

/** Persisted draft fields, already shaped (status + preview resolved by the runner). */
export interface DraftRow {
  recipientRole: string
  recipientPhone: string
  channel: string
  templateName: string | null
  templateParams: Record<string, string>
  freeformBody: string | null
  renderedPreview: string
  rationale: string
  status: 'PENDING_APPROVAL' | 'BLOCKED_POLICY'
  policyReason: string | null
}

export interface ReplaceDraftResult {
  created: boolean
  draftId?: string
}

export interface OpsAgentStore {
  createRun(input: CreateRunInput): Promise<string>
  finishRun(runId: string, patch: FinishRunPatch): Promise<void>
  /**
   * Upsert by dedupeKey. On create, status starts PENDING. On update, content
   * fields are refreshed but the review state (status/reviewedBy/reviewedAt) is
   * preserved so re-runs do not nag ops about already-handled recommendations.
   */
  upsertRecommendation(
    runId: string,
    evaluation: Evaluation,
  ): Promise<UpsertRecommendationResult>
  /**
   * Replace the recommendation's non-terminal draft. Deletes any existing
   * PENDING_APPROVAL / BLOCKED_POLICY draft (never touches APPROVED/SENT/etc.),
   * then creates the new one if provided.
   */
  replaceDraft(
    recommendationId: string,
    draft: DraftRow | null,
  ): Promise<ReplaceDraftResult>
}

function asJson(value: unknown): Prisma.InputJsonValue {
  // TODO: Prisma.InputJsonValue is a recursive type the compiler can't infer for
  // our concrete Signal[]/RecommendedAction[]; the double cast is the known
  // workaround (prisma/prisma#9678). Inputs here are plain JSON-serialisable.
  return value as unknown as Prisma.InputJsonValue
}

export function createPrismaStore(client: PrismaClient = db): OpsAgentStore {
  return {
    async createRun(input) {
      const run = await client.opsAgentRun.create({
        data: {
          agentKey: input.agentKey,
          trigger: input.trigger,
          status: 'RUNNING',
          startedAt: new Date(input.startedAtIso),
          windowFrom: input.windowFromIso ? new Date(input.windowFromIso) : null,
          windowTo: input.windowToIso ? new Date(input.windowToIso) : null,
        },
        select: { id: true },
      })
      return run.id
    },

    async finishRun(runId, patch) {
      await client.opsAgentRun.update({
        where: { id: runId },
        data: {
          status: patch.status,
          finishedAt: new Date(patch.finishedAtIso),
          candidates: patch.candidates,
          recommended: patch.recommended,
          draftsCreated: patch.draftsCreated,
          error: patch.error ?? null,
        },
      })
    },

    async upsertRecommendation(runId, e) {
      // Content shared by create and update. `runId` is intentionally NOT in
      // here: it records the run that first created the recommendation, so a
      // later run updating the same dedupeKey does not steal attribution.
      const content = {
        agentKey: e.agentKey,
        entityType: e.entityType,
        entityId: e.entityId,
        classification: e.classification,
        score: e.score ?? null,
        severity: e.severity,
        signals: asJson(e.signals),
        summary: e.summary,
        recommendedActions: asJson(e.recommendedActions),
      }
      const existing = await client.opsRecommendation.findUnique({
        where: { dedupeKey: e.dedupeKey },
        select: { id: true },
      })
      if (existing) {
        await client.opsRecommendation.update({
          where: { dedupeKey: e.dedupeKey },
          // review state (status/reviewedBy/reviewedAt) and creation runId preserved
          data: content,
        })
        return { id: existing.id, created: false }
      }
      const created = await client.opsRecommendation.create({
        data: { ...content, runId, dedupeKey: e.dedupeKey, status: 'PENDING' },
        select: { id: true },
      })
      return { id: created.id, created: true }
    },

    async replaceDraft(recommendationId, draft) {
      const where = {
        recommendationId,
        status: { in: NON_TERMINAL_DRAFT_STATUSES },
      }
      if (!draft) {
        await client.opsDraftMessage.deleteMany({ where })
        return { created: false }
      }
      // Atomic: drop the stale non-terminal draft and write the fresh one in one
      // transaction so a crash can never leave the recommendation draftless.
      // APPROVED/SENT/REJECTED/EXPIRED/FAILED drafts are untouched by `where`.
      const [, row] = await client.$transaction([
        client.opsDraftMessage.deleteMany({ where }),
        client.opsDraftMessage.create({
          data: {
            recommendationId,
            recipientRole: draft.recipientRole,
            recipientPhone: draft.recipientPhone,
            channel: draft.channel,
            templateName: draft.templateName,
            templateParams: asJson(draft.templateParams),
            freeformBody: draft.freeformBody,
            renderedPreview: draft.renderedPreview,
            rationale: draft.rationale,
            status: draft.status,
            policyReason: draft.policyReason,
          },
          select: { id: true },
        }),
      ])
      return { created: true, draftId: row.id }
    },
  }
}

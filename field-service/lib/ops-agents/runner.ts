// ─── Ops Agent Workflow Team — runner ────────────────────────────────────────
// The single orchestration spine for every agent. It:
//   1. opens an OpsAgentRun (RUNNING)
//   2. loads candidates for the window
//   3. runs the PURE evaluator over each candidate
//   4. upserts OpsRecommendation by dedupeKey (re-run updates, never duplicates)
//   5. persists an OpsDraftMessage (PENDING_APPROVAL or BLOCKED_POLICY) when the
//      evaluation carries a draft and the injected policy gate is consulted
//   6. emits OpenBrain events (fire-and-forget)
//   7. closes the run (SUCCESS | PARTIAL | FAILED) with counts
//
// It NEVER throws to the caller: a per-candidate failure degrades the run to
// PARTIAL; a load/setup failure degrades it to FAILED. DB is the source of
// truth; OpenBrain writes are best-effort.

import {
  captureRecommendation,
  captureEscalation,
  captureRunFinish,
  captureRunStart,
} from './openbrain'
import { createPrismaStore, type DraftRow, type OpsAgentStore } from './store'
import type {
  DraftMessageSpec,
  Evaluation,
  Evaluator,
  OpsAgentKey,
  OpsTrigger,
} from './types'

export interface DraftPolicyResult {
  allowed: boolean
  reason?: string
}

/** WhatsApp policy gate. Phase 2 wires this to lib/whatsapp-policy#canSend. */
export type DraftPolicyCheck = (
  draft: DraftMessageSpec,
) => Promise<DraftPolicyResult> | DraftPolicyResult

export interface AgentDefinition<TCandidate> {
  agentKey: OpsAgentKey
  /** Load the minimised candidate projection for this window. */
  loadCandidates(args: {
    nowIso: string
    windowFromIso?: string | null
    windowToIso?: string | null
  }): Promise<TCandidate[]>
  /** Pure classification/scoring. Must not perform I/O. */
  evaluate: Evaluator<TCandidate>
  /** Optional WhatsApp policy gate. When absent, drafts default to PENDING_APPROVAL. */
  policyCheck?: DraftPolicyCheck
}

export interface RunAgentOptions {
  trigger: OpsTrigger
  windowFromIso?: string | null
  windowToIso?: string | null
  /** Injected clock. Defaults to wall-clock; tests pass a fixed function. */
  now?: () => string
  /** Injected store. Defaults to the Prisma-backed store. */
  store?: OpsAgentStore
}

export interface RunSummary {
  runId: string
  agentKey: OpsAgentKey
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED'
  candidates: number
  recommended: number
  created: number
  updated: number
  draftsCreated: number
  errors: string[]
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

/** Defensive, PII-free id extraction for error labelling when evaluate() throws. */
function candidateLabel(candidate: unknown, index: number): string {
  if (candidate && typeof candidate === 'object') {
    const rec = candidate as Record<string, unknown>
    const id = rec.id ?? rec.entityId
    if (typeof id === 'string') return id
  }
  return `index:${index}`
}

function renderDraftPreview(spec: DraftMessageSpec): string {
  if (spec.template === 'FREEFORM') return spec.freeformBody ?? ''
  const params = spec.templateParams ?? {}
  return `${spec.template}(${JSON.stringify(params)})`
}

function buildDraftRow(
  spec: DraftMessageSpec,
  status: 'PENDING_APPROVAL' | 'BLOCKED_POLICY',
  policyReason: string | null,
): DraftRow {
  return {
    recipientRole: spec.recipientRole,
    recipientPhone: spec.recipientPhone,
    channel: spec.channel,
    templateName: spec.template === 'FREEFORM' ? null : spec.template,
    templateParams: spec.templateParams ?? {},
    freeformBody: spec.freeformBody ?? null,
    renderedPreview: renderDraftPreview(spec),
    rationale: spec.rationale,
    status,
    policyReason,
  }
}

export async function runAgent<TCandidate>(
  def: AgentDefinition<TCandidate>,
  opts: RunAgentOptions,
): Promise<RunSummary> {
  const now = opts.now ?? (() => new Date().toISOString())
  const store = opts.store ?? createPrismaStore()
  const nowIso = now()

  const base: Omit<RunSummary, 'runId' | 'status'> = {
    agentKey: def.agentKey,
    candidates: 0,
    recommended: 0,
    created: 0,
    updated: 0,
    draftsCreated: 0,
    errors: [],
  }

  // Setup — if we can't even open the run, return a synthetic FAILED summary.
  let runId: string
  try {
    runId = await store.createRun({
      agentKey: def.agentKey,
      trigger: opts.trigger,
      startedAtIso: nowIso,
      windowFromIso: opts.windowFromIso,
      windowToIso: opts.windowToIso,
    })
  } catch (e) {
    return { ...base, runId: '', status: 'FAILED', errors: [`createRun: ${errMessage(e)}`] }
  }

  void captureRunStart({
    runId,
    agentKey: def.agentKey,
    trigger: opts.trigger,
    occurredAtIso: nowIso,
    windowFromIso: opts.windowFromIso,
    windowToIso: opts.windowToIso,
  })

  // Load candidates.
  let candidates: TCandidate[]
  try {
    candidates = await def.loadCandidates({
      nowIso,
      windowFromIso: opts.windowFromIso,
      windowToIso: opts.windowToIso,
    })
  } catch (e) {
    const finishedAt = now()
    await store
      .finishRun(runId, {
        status: 'FAILED',
        finishedAtIso: finishedAt,
        candidates: 0,
        recommended: 0,
        draftsCreated: 0,
        error: `loadCandidates: ${errMessage(e)}`,
      })
      .catch(() => {})
    void captureRunFinish({
      runId,
      agentKey: def.agentKey,
      status: 'FAILED',
      occurredAtIso: finishedAt,
      candidates: 0,
      recommended: 0,
      draftsCreated: 0,
      error: errMessage(e),
    })
    return { ...base, runId, status: 'FAILED', errors: [`loadCandidates: ${errMessage(e)}`] }
  }

  const errors: string[] = []
  let created = 0
  let updated = 0
  let draftsCreated = 0

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]
    try {
      const evaluation: Evaluation | null = def.evaluate(candidate, { nowIso })
      if (!evaluation) continue

      const upsert = await store.upsertRecommendation(runId, evaluation)
      if (upsert.created) created++
      else updated++

      if (evaluation.draft) {
        const policy = def.policyCheck
          ? await def.policyCheck(evaluation.draft)
          : { allowed: true }
        const status = policy.allowed ? 'PENDING_APPROVAL' : 'BLOCKED_POLICY'
        const row = buildDraftRow(evaluation.draft, status, policy.reason ?? null)
        const draftRes = await store.replaceDraft(upsert.id, row)
        if (draftRes.created && status === 'PENDING_APPROVAL') draftsCreated++
      }

      void captureRecommendation({
        recommendationId: upsert.id,
        runId,
        agentKey: evaluation.agentKey,
        entityType: evaluation.entityType,
        entityId: evaluation.entityId,
        classification: evaluation.classification,
        severity: evaluation.severity,
        score: evaluation.score ?? null,
        signals: evaluation.signals,
        hasDraft: Boolean(evaluation.draft),
        occurredAtIso: nowIso,
      })

      if (evaluation.severity === 'HIGH' || evaluation.severity === 'CRITICAL') {
        void captureEscalation({
          recommendationId: upsert.id,
          agentKey: evaluation.agentKey,
          entityType: evaluation.entityType,
          entityId: evaluation.entityId,
          classification: evaluation.classification,
          severity: evaluation.severity,
          reason: evaluation.summary,
          occurredAtIso: nowIso,
        })
      }
    } catch (e) {
      errors.push(`${candidateLabel(candidate, i)}: ${errMessage(e)}`)
    }
  }

  const recommended = created + updated
  const status: RunSummary['status'] =
    errors.length === 0 ? 'SUCCESS' : recommended > 0 ? 'PARTIAL' : 'FAILED'

  const finishedAt = now()
  const errorText = errors.length ? errors.join('; ').slice(0, 2000) : null
  await store
    .finishRun(runId, {
      status,
      finishedAtIso: finishedAt,
      candidates: candidates.length,
      recommended,
      draftsCreated,
      error: errorText,
    })
    .catch(() => {})

  void captureRunFinish({
    runId,
    agentKey: def.agentKey,
    status,
    occurredAtIso: finishedAt,
    candidates: candidates.length,
    recommended,
    draftsCreated,
    error: errorText,
  })

  return {
    runId,
    agentKey: def.agentKey,
    status,
    candidates: candidates.length,
    recommended,
    created,
    updated,
    draftsCreated,
    errors,
  }
}

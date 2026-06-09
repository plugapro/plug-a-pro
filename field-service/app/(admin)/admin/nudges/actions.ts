'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { crudAction } from '@/lib/crud-action'
import { buildNudgeCsv } from '@/lib/nudges/csv'
import {
  listNudgeCandidates,
  NUDGE_MARK_SENT_BATCH_CAP,
  type NudgeCandidate,
} from '@/lib/nudges/queue'
import type { ProviderTier } from '@/lib/provider-tier'

const FLAG = 'launch.west_rand_pilot.nudge_console'
// Roles that can view the queue + export + mark batches sent. Mirrors the
// other ops-facing admin surfaces.
const ALLOWED_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const

// ── Schemas ────────────────────────────────────────────────────────────────

const PreviewSchema = z.object({
  providerId: z.string().min(1),
})

const ExportSchema = z.object({
  suburbSlug: z.string().nullable(),
  categorySlug: z.string().nullable(),
  tier: z
    .enum(['R1', 'R2', 'R3', 'R4', 'R5', 'PENDING_R1'])
    .nullable(),
})

const MarkSentSchema = z.object({
  providerIds: z.array(z.string().min(1)),
  batchNote: z.string().nullable(),
  confirmPhrase: z.string(),
})

// ── Actions ────────────────────────────────────────────────────────────────

export async function previewNudgeAction(input: z.input<typeof PreviewSchema>) {
  return crudAction<z.input<typeof PreviewSchema>, { renderedMessage: string; tier: ProviderTier; missingItems: string[] }>({
    entity: 'Nudge',
    entityId: input.providerId,
    action: 'nudge.preview.viewed',
    requiredRole: [...ALLOWED_ROLES] as any,
    requiredFlag: FLAG,
    schema: PreviewSchema,
    input,
    run: async (parsed) => {
      const all = await listNudgeCandidates({})
      const candidate = all.find((c) => c.providerId === parsed.providerId)
      if (!candidate) {
        return { renderedMessage: '', tier: 'R5' as ProviderTier, missingItems: [] }
      }
      return {
        renderedMessage: candidate.renderedMessage,
        tier: candidate.tier,
        missingItems: candidate.missingItems,
      }
    },
  })
}

export async function exportNudgeQueueCsvAction(input: z.input<typeof ExportSchema>) {
  return crudAction<z.input<typeof ExportSchema>, { csv: string; rowCount: number }>({
    entity: 'Nudge',
    action: 'nudge.csv.exported',
    requiredRole: [...ALLOWED_ROLES] as any,
    requiredFlag: FLAG,
    schema: ExportSchema,
    input,
    run: async (parsed) => {
      const candidates: NudgeCandidate[] = await listNudgeCandidates({
        suburbSlug: parsed.suburbSlug,
        categorySlug: parsed.categorySlug,
        tier: parsed.tier,
      })
      const csv = buildNudgeCsv(candidates)
      return { csv, rowCount: candidates.length }
    },
  })
}

type MarkSentInput = z.input<typeof MarkSentSchema>

export type MarkNudgeBatchSentResult =
  | { ok: true; data: { count: number } }
  | {
      ok: false
      error: 'confirm-phrase-mismatch' | 'empty-batch' | 'batch-oversized'
      cap?: number
    }

export async function markNudgeBatchSentAction(
  input: MarkSentInput,
): Promise<MarkNudgeBatchSentResult> {
  // Pre-crudAction guards: validation rejects, not events worth auditing.
  if (input.providerIds.length === 0) {
    return { ok: false as const, error: 'empty-batch' as const }
  }
  if (input.providerIds.length > NUDGE_MARK_SENT_BATCH_CAP) {
    return {
      ok: false as const,
      error: 'batch-oversized' as const,
      cap: NUDGE_MARK_SENT_BATCH_CAP,
    }
  }
  const expectedPhrase = `mark-sent-${input.providerIds.length}`
  if (input.confirmPhrase !== expectedPhrase) {
    return { ok: false as const, error: 'confirm-phrase-mismatch' as const }
  }

  const result = await crudAction<MarkSentInput, { count: number }>({
    entity: 'Nudge',
    action: 'nudge.batch.marked_sent',
    requiredRole: [...ALLOWED_ROLES] as any,
    requiredFlag: FLAG,
    schema: MarkSentSchema,
    input,
    reason: input.batchNote ?? undefined,
    run: async (parsed) => {
      return { count: parsed.providerIds.length }
    },
  })

  // Revalidate so the queue UI picks up the new lastNudgedAt derived value.
  revalidatePath('/admin/nudges')

  return result
}

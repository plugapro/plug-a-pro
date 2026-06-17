// ─── Server actions for the Quality admin view ───────────────────────────────
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import {
  previewNudges,
  sendNudges,
  QUALITY_UPLIFT_FLAG,
} from '@/lib/provider-quality/orchestrator'
import type { QualityFilter } from '@/lib/provider-quality/queries'

const filterSchema = z.object({
  missingKyc: z.boolean().optional(),
  missingProfilePhoto: z.boolean().optional(),
  missingPortfolioEvidence: z.boolean().optional(),
  missingHighRiskCert: z.boolean().optional(),
  hasHighRiskSkill: z.boolean().optional(),
  notQualityReady: z.boolean().optional(),
  kycStartedIncomplete: z.boolean().optional(),
  kycFailedOrExpired: z.boolean().optional(),
})

const sendSchema = z.object({
  providerIds: z.array(z.string().min(1)).min(1).max(200),
  forceOverrideRecency: z.boolean().optional(),
})

const READ_ROLES = ['OPS', 'TRUST', 'ADMIN', 'OWNER'] as const
const SEND_ROLES = ['OPS', 'ADMIN', 'OWNER'] as const

/**
 * Pure compute. Returns the preview snapshot — no mutations.
 * Reads still require admin auth so we don't expose provider PII publicly.
 */
export async function previewNudgesAction(rawFilter: unknown) {
  const result = await crudAction<QualityFilter, Awaited<ReturnType<typeof previewNudges>>>({
    entity: 'ProviderQualityNudge',
    action: 'provider_quality.preview',
    requiredRole: [...READ_ROLES],
    schema: filterSchema,
    input: rawFilter,
    run: async (filter) => previewNudges(filter),
  })
  return result.data
}

/**
 * Actually send a batch. Behind QUALITY_UPLIFT_FLAG so we can ship dark.
 * The orchestrator re-checks dedup + cap before each individual send.
 */
export async function sendNudgesAction(rawArgs: unknown) {
  const session = await getSession()
  if (!session) throw new CrudActionError('UNAUTHENTICATED', 'Authentication required.')
  const admin = await db.adminUser
    .findUnique({
      where: { userId: session.id },
      select: { id: true, role: true, active: true },
    })
    .catch(() => null)
  const actorRole = admin?.role
  if (!admin || !actorRole) {
    throw new CrudActionError('UNAUTHORIZED', 'Admin record not found.')
  }
  const result = await crudAction<z.infer<typeof sendSchema>, Awaited<ReturnType<typeof sendNudges>>>({
    entity: 'ProviderQualityNudge',
    action: 'provider_quality.send',
    requiredRole: [...SEND_ROLES],
    requiredFlag: QUALITY_UPLIFT_FLAG,
    schema: sendSchema,
    input: rawArgs,
    run: async (args) =>
      sendNudges({
        providerIds: args.providerIds,
        forceOverrideRecency: args.forceOverrideRecency,
        actorId: admin.id,
        actorRole,
      }),
  })
  revalidatePath('/admin/quality')
  return result.data
}

/**
 * Read-only admin endpoint: AI operating loop improvement candidates.
 *
 * GET only. Surfaces the advisory candidates produced by the learning layer for
 * an admin to triage. There is intentionally no POST/PUT/DELETE — the loop never
 * mutates anything from the UI; acting on a candidate is a separate, human-driven
 * Claude Code task. Gated to ADMIN/OWNER (same level as viewing the audit log).
 */

import { requireRoleApi } from '@/lib/auth'
import { apiError, apiSuccess } from '@/lib/api-response'
import { listImprovementCandidatesForAdmin } from '@/lib/ai-loop/admin-view'

export const dynamic = 'force-dynamic'

export async function GET(): Promise<Response> {
  const actor = await requireRoleApi(['ADMIN', 'OWNER'])
  if (actor instanceof Response) return actor

  try {
    const candidates = await listImprovementCandidatesForAdmin()
    return apiSuccess({ candidates, count: candidates.length })
  } catch {
    return apiError('AI_LOOP_LIST_FAILED', 'Could not load improvement candidates', 500)
  }
}

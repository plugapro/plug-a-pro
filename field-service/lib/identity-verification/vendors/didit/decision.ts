// Server-side polling helper used by the admin "Refresh from Didit" action
// when a webhook is missed.

import { getSessionDecision } from './client'
import { getDiditConfig } from './config'
import { normalizeDiditDecision, type DiditNormalizedOutput } from './normalize'
import type { DiditDecisionResponse } from './types'

export type RefreshDiditSessionOutput = {
  raw: DiditDecisionResponse
  normalized: DiditNormalizedOutput
}

export async function refreshDiditSession(
  sessionId: string,
  options: { storedVendorWorkflowId?: string | null } = {},
): Promise<RefreshDiditSessionOutput> {
  const raw = await getSessionDecision(sessionId)
  const config = getDiditConfig()
  const authoritativeWorkflowId = config.enabled ? config.workflowIds.authoritative : null
  // The decision comes from our authenticated GET to Didit, so its
  // workflow_id is trustworthy. Fall back to it for rows created before
  // workflow stamping existed; an explicitly stored value always wins.
  const rawWorkflowId = typeof raw.workflow_id === 'string' && raw.workflow_id.trim()
    ? raw.workflow_id.trim()
    : null
  const normalized = normalizeDiditDecision(raw, {
    storedVendorWorkflowId: options.storedVendorWorkflowId ?? rawWorkflowId,
    authoritativeWorkflowId,
  })
  return { raw, normalized }
}

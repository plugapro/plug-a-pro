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
  const normalized = normalizeDiditDecision(raw, {
    storedVendorWorkflowId: options.storedVendorWorkflowId ?? null,
    authoritativeWorkflowId,
  })
  return { raw, normalized }
}

/**
 * One-shot remediation: Sarah Sullivan plumbing job (2026-05-17)
 *
 * Root cause: The selected-provider-acceptance path does not call notifyLeadUnlocked,
 * so the lead_unlock_provider template (which includes the customer phone) was never
 * sent to Tshepo serve1. The post_match_intro:provider CTA also failed (re-engagement
 * window). Tshepo has no WhatsApp with Sarah's contact details.
 *
 * Fix: call notifyLeadUnlocked for the existing LeadUnlock record. Idempotency keys
 * for both the provider and customer notifications are unused, so no duplicates.
 *
 * Lead unlock ID : cmp9ki4yx0003jo04l31c79k8
 * Lead ID        : cmp9kfqc30001jr045kl8nvav
 * Job request ID : cmp9kenan0007k404icbl94im
 * Provider       : Tshepo serve1  (+27764010810)
 * Customer       : Sarah Sullivan (+27773923802)
 */

import 'dotenv/config'
import { notifyLeadUnlocked } from '../lib/provider-wallet-notifications'

const UNLOCK_ID = 'cmp9ki4yx0003jo04l31c79k8'

async function main() {
  console.log('[remediate] sending lead unlock notifications for unlock', UNLOCK_ID)
  await notifyLeadUnlocked(UNLOCK_ID)
  console.log('[remediate] done — check message_events for lead_unlock:provider_confirmation and lead_unlock:customer_intro')
}

main().catch((err) => {
  console.error('[remediate] failed:', err)
  process.exit(1)
})

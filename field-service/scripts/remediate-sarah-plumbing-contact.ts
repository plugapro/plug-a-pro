/**
 * One-shot remediation: resend lead-unlock notifications for a plumbing job
 * where the provider never received the customer's contact details.
 *
 * Root cause: The selected-provider-acceptance path does not call notifyLeadUnlocked,
 * so the lead_unlock_provider template (which includes the customer phone) was never
 * sent to the matched provider. The post_match_intro:provider CTA also failed
 * (re-engagement window). The provider had no WhatsApp with the customer's contact
 * details.
 *
 * Fix: call notifyLeadUnlocked for the existing LeadUnlock record. Idempotency keys
 * for both the provider and customer notifications are unused, so no duplicates.
 *
 * The lead-unlock record id is supplied at runtime so no production PII or record
 * IDs are committed to source. Look it up from the affected LeadUnlock row first.
 *
 * Usage:
 *   UNLOCK_ID=... pnpm tsx --env-file=.env.local scripts/remediate-sarah-plumbing-contact.ts
 */

import 'dotenv/config'
import { notifyLeadUnlocked } from '../lib/provider-wallet-notifications'

const UNLOCK_ID = process.env.UNLOCK_ID?.trim()

async function main() {
  if (!UNLOCK_ID) {
    console.error('[remediate] Missing required env var UNLOCK_ID. Set it to the affected LeadUnlock id before running.')
    process.exit(1)
  }
  console.log('[remediate] sending lead unlock notifications for unlock', UNLOCK_ID)
  await notifyLeadUnlocked(UNLOCK_ID)
  console.log('[remediate] done — check message_events for lead_unlock:provider_confirmation and lead_unlock:customer_intro')
}

main().catch((err) => {
  console.error('[remediate] failed:', err)
  process.exit(1)
})

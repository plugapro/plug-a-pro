# ops — provider lead-response comms ACTIVATED: 7 deactivation notices + 4 warnings sent (2026-08-25)

> Synced to OpenBrain 2026-09-07 (local CLI backend + Worker MCP).
> Tags: domain:ops, provider-engagement, whatsapp, comms, activation

Provider-comms system fully activated same-day as the funnel-fix deploy (#204 live).

- Flag `provider.comms.lead_response` flipped ON in prod (via Supabase Management API — Vercel `DATABASE_URL` is a sensitive var and cannot be pulled locally, so the sweep script can't run on this machine; executed the sweep's exact logic through dbq.sh + direct Graph API instead).
- Cohorts recomputed live before sending and matched the owner-approved lists exactly: WARN = 4 (Archie Gwenda, Eric Khoza, Gibson Mhembere, Prince Charles Ncube — 1–2 leads, 0 responses, no declines, non-test), DEACTIVATE-new = 0 (the 7 are already inactive), idempotency clean (no prior sends).
- Sent 11/11 via the Meta-APPROVED UTILITY templates (deliver outside the 24h window): `provider_deactivated_no_show` to the 7 paused providers (Donald Bhunu, Fana Matjokana, Jonathan Carvalho, Leon Dhliwayo, Neo Kabe, Simphiwe Dube, Siphiwe Ncube — invites a WhatsApp reply to be reactivated) and `provider_lead_response_warning` to the 4. All accepted by Meta with wamids.
- 11 MessageEvent audit rows written with the lib's exact idempotency keys (`provider:deactivated_no_show:{id}` / `provider:lead_response_warning:{id}`) so future sweep runs skip these as duplicates and the system of record matches `lib/provider-lead-response-comms.ts` behaviour.

REACTIVATION FLOW (manual for now): replies land in the Business WhatsApp inbox + `inbound_whatsapp_messages`; owner reviews motivation → "reactivate [name]" → flip `active=true` + clear `suspendedReason` (audited). Inbound auto-handler remains a deferred follow-up.

Standing: campaign live (R894 by 08-25), half-budget checkpoint R1,750 (<5 real requests = pause), PRs #202/#203 open for review, acceptance-stage test pending optional credit grant.

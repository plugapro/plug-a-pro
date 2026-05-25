# Incident — Lovemore RFP WhatsApp availability failure (2026-05-25)

## Root cause

Lovemore tapped the Review Providers First `I'm Available` WhatsApp button for Sarah's request `PAP-2940235F` / `cmpky3jjh000gla040qzhmz2j`.

The inbound payload was valid:

- Lead: `cmpky5kcs000ml804mrsh5a6u`
- Provider: `b6b91902-b268-4bc3-9d16-0942a25c2d60`
- Context message: `rfp:job_lead_actions`
- Error ref shown to provider: `wbot_03d4c2fd69ba`

The handler failed inside the database transaction. Production drifted from the committed Prisma schema: `provider_lead_responses.response` was the old Postgres enum `LeadResponseStatus`, while the current Prisma schema expects `String` / `TEXT`. Prisma threw `P2032` while creating the provider response, so the lead status update rolled back and Lovemore saw the retry error.

## Fix applied

1. Converted production `provider_lead_responses.response` back to `TEXT`.
2. Added migration `20260525105500_repair_provider_lead_response_text` so future environments repair the same drift.
3. Added a schema regression test to keep this drift visible.
4. Replayed Lovemore's valid availability tap through the RFP handler after the schema repair.

## Result

- `provider_lead_responses.response` is now `text`.
- Lovemore's lead `cmpky5kcs000ml804mrsh5a6u` is now `INTERESTED`.
- A `provider_lead_responses` row exists with response `INTERESTED`.
- No credit was deducted; this is the free availability step before customer selection.

## Follow-up note

The local production WhatsApp token on this machine returned Meta OAuth error `190` when trying to send the confirmation from local tooling. The data state is correct, and if Lovemore taps the retry button again the production app should now respond idempotently that his availability is already noted.

## Verification

- `pnpm vitest run __tests__/lib/qualified-shortlist-schema-foundation.test.ts __tests__/lib/whatsapp-flows/rfp-lead.test.ts __tests__/lib/whatsapp-bot-stateless.test.ts` — 72 passing.
- `pnpm typecheck` — passing.
- `pnpm lint` — passing.

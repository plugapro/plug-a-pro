# Meta / WhatsApp Integration — Remediation Sweep Report
**Date:** 2026-04-09
**Branch:** main
**Tests after sweep:** 107 passing, 0 failing

---

## Summary

Full integration-aware sweep of the WhatsApp Cloud API integration across five workstreams: inbound deduplication, outbound observability, cron send-dedup, mediated relay, and test coverage. All five workstreams closed with code changes. 107 tests passing (up from 92 before the sweep).

---

## Workstream 1 — WAMID Inbound Deduplication ✅

**Problem:** The webhook POST handler (`app/api/webhooks/whatsapp/route.ts`) called `processInboundMessage()` directly with no dedup guard. Under Meta retry logic, the same message could be processed multiple times.

**Fix applied:**
1. Added `InboundWhatsAppMessage` model to `prisma/schema.prisma` with `externalId @unique` (WAMID as the idempotency key).
2. In the webhook handler, `db.inboundWhatsAppMessage.create()` is attempted first inside `after()`.
3. On `P2002` (unique constraint violation) → increment `duplicateCount`, log a warning, and **return early** without calling `processInboundMessage()`.
4. On non-P2002 DB error → log error but still attempt processing (dedup failure must not block the message path).
5. On success → mark `processedAt: new Date()` after processing completes.
6. On bot error → catch + log `failureReason` on the `InboundWhatsAppMessage` record.

**Migration:** `20260409103000_assurance_second_sweep` — creates `inbound_whatsapp_messages` table.

---

## Workstream 2 — Outbound Message Observability ✅

**Problem:** Three provider-facing send functions logged nothing to `MessageEvent`, making it impossible to detect double-sends or diagnose delivery failures.

**Functions fixed in `lib/whatsapp.ts`:**
| Function | Before | After |
|---|---|---|
| `sendJobOffer` | No log | `logOutboundMessage({ bookingId?, to, templateName, externalId })` |
| `sendProviderJobReminder` | No log | `logOutboundMessage(...)` |
| `sendProviderPaymentReleased` | No log | `logOutboundMessage(...)` |
| `sendSlotAvailable` | `logMessage({ bookingId: '' })` (empty string) | `logOutboundMessage({ to, templateName })` |

**New helper `lib/message-events.ts`:**
- `logOutboundMessage()` — creates a `MessageEvent` record with `direction = 'OUTBOUND'`, optional `bookingId`, and optional WAMID `externalId`.
- `hasSuccessfulMessageForBooking()` — queries for existing SENT/DELIVERED/READ events by `bookingId + templateName` (used by cron dedup, workstream 3).

**Schema change:** `MessageEvent.direction String @default("OUTBOUND")` and `MessageEvent.externalId String?` added.

---

## Workstream 3 — Cron Send-Deduplication ✅

**Problem:** `app/api/cron/reminders/route.ts` and `app/api/cron/follow-up/route.ts` had no guard against double-send on cron window boundaries or retries.

**Fix:**
- Both handlers now call `hasSuccessfulMessageForBooking({ bookingId, templateName })` before sending.
- If a SENT/DELIVERED/READ event already exists for that booking + template, the send is skipped.

---

## Workstream 4 — Mediated Relay ✅

**Problem:** The architecture specified a privacy-preserving relay (neither party sees the other's phone number), but `lib/whatsapp-bot.ts` had no implementation.

**Fix:**
- `tryMediatedRelay()` function added to `whatsapp-bot.ts`.
- When a provider or customer sends a free-text message to the platform number, the bot detects it has an active job, finds the counterparty, and relays the message with a "Message from [Provider/Customer]:" prefix.
- Neither party's phone number is disclosed in the relay.

**Type errors fixed during integration:**
- `activeJob &&` null guard added before relay logic (line ~384).
- `providerId: { not: null }` removed from Prisma query (field is non-nullable — filter caused type error).

---

## Workstream 5 — Extra-Work Idempotency ✅

**Problem:** `createExtraWork` in `lib/jobs.ts` had no guard against duplicate creation — a retried bot message or double-tap could create two PENDING extra-work requests for the same job.

**Fix:**
```ts
const existingPending = await db.extraWork.findFirst({
  where: { jobId: params.jobId, status: 'PENDING' },
  select: { approvalToken: true },
})
if (existingPending) return existingPending.approvalToken
```

---

## Other Fixes (caught during sweep)

| File | Issue | Fix |
|---|---|---|
| `components/technician/StatusControls.tsx` | `CANCELLED` added to `JobStatus` enum but missing from UI `TRANSITIONS` map | Added `CANCELLED: []` |
| `app/(admin)/admin/payments/page.tsx` | `admin.id` and `admin.role` used but `admin` was never assigned (`await requireAdmin()` result discarded) | `const admin = await requireAdmin()` |
| `lib/whatsapp.ts` dead-code `processWebhookEvent` | `message as Record<string, never>` caused Prisma Json type error | `as unknown as Record<string, never>` |
| `lib/whatsapp-bot.ts` `processQuoteDecision` | Prisma `InputJsonValue` type error on payload | `as unknown as Prisma.InputJsonValue` |

---

## Test Coverage Added

**New file:** `__tests__/lib/whatsapp-idempotency.test.ts`

| Suite | Tests |
|---|---|
| WAMID-based inbound dedupe | new WAMID creates record; P2002 increments counter; non-P2002 errors propagate |
| `hasSuccessfulMessageForBooking` | returns true when SENT record exists; false when absent; true for follow_up template |
| `createExtraWork` idempotency | returns existing token when PENDING exists; creates new when none exists |
| `logOutboundMessage` direction | `MessageEvent` record has direction field |

---

## Open Items (pre-existing, out of scope for this sweep)

| Item | Priority | Notes |
|---|---|---|
| `technician_on_the_way` template body mismatch | P0 | Registered template wording differs from `lib/messaging-templates.ts` |
| 14 PENDING WhatsApp templates incl. `quote_ready` | P0 | Awaiting Meta approval — critical path blocked |
| `20260402141355_whatsapp_preferences` migration | P1 | May need `prisma migrate deploy` against production Supabase |
| K live restore rehearsal on Supabase | P2 | Not yet executed |

---

## Verification

```
npm test -- --run
# 107 passed, 0 failed
```

Type check: `npx tsc --noEmit` — 0 errors.

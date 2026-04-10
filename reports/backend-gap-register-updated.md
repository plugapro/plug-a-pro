# Backend Gap Register — Final State (2026-04-10)

## Resolved in Accessible Scope

All P0 and P1 issues closed. All accessible P2 issues closed.

| # | Severity | Issue | Status | Key files |
|---|---|---|---|---|
| 1 | P0 | Inbound WhatsApp replay / duplicate mutation | Resolved | `app/api/webhooks/whatsapp/route.ts`, `lib/whatsapp.ts`, `prisma/schema.prisma`, migration `20260409103000` |
| 2 | P0 | Provider direct STARTED→COMPLETED bypass | Resolved | `lib/jobs.ts`, `app/api/technician/jobs/[id]/status/route.ts`, `lib/whatsapp-flows/provider-journey.ts`, customer booking page |
| 3 | P1 | Booking cancellation shallow / unorchestrated | Resolved | `lib/bookings.ts`, customer + admin booking pages |
| 4 | P1 | Reschedule flow was conversational no-op | Resolved | `lib/bookings.ts`, `lib/whatsapp-bot.ts`, `lib/whatsapp-flows/help.ts` |
| 5 | P1 | Mediated messaging relay absent | Resolved at MVP relay level | `lib/whatsapp-bot.ts`, `lib/whatsapp-interactive.ts`, `lib/whatsapp.ts` |
| 6 | P1 | Marketing onboarding disconnected from operational records | Resolved | `marketing/app/api/leads/route.ts`, `prisma/schema.prisma`, migration `20260409103000` |
| 7 | P2 | Audit logging absent for override / exception flows | Resolved | `lib/audit.ts`, admin + customer + provider mutation points, `lib/jobs.ts` |
| 8 | P2 | Reminder / follow-up duplicate cron sends | Resolved | `lib/message-events.ts`, `app/api/cron/reminders/route.ts`, `app/api/cron/follow-up/route.ts` |
| 9 | P2 | WhatsApp help copy overstated platform guarantees | Resolved | `lib/whatsapp-flows/help.ts` |
| 10 | P2 | Quote expiry not normalized in DB (PENDING rows accumulate past validUntil) | Resolved | `lib/quotes.ts` (`expireStaleQuotes`), `app/api/cron/match-leads/route.ts` |
| 11 | P2 | reqId tracing absent from reminders + follow-up cron handlers | Resolved | `app/api/cron/reminders/route.ts`, `app/api/cron/follow-up/route.ts` |

## Blocked Residuals — Explicitly Documented

These items cannot be closed from the repository or local environment. Each requires a specific external action listed below.

### Blocked by external integration access / credentials

| # | Severity | Issue | Blocked by | Required action |
|---|---|---|---|---|
| B1 | P1 | Live PSP checkout / refund / webhook execution verification | Peach Payments credentials + provider console | Ops to run live payment cycle in staging with real PSP account |
| B2 | P1 | Meta WhatsApp template approval + live delivery verification | Meta Business Manager access | Ops to confirm `quote_ready` and `technician_assigned` template approval status in WABA console |

### Blocked by missing product / documentation decision

| # | Severity | Issue | Blocked by | Required action |
|---|---|---|---|---|
| B3 | P2 | Payment policy normalization across authoritative docs | No single doc owns the rule | Product to decide: is online payment collection active at launch or deferred? Update `docs/architecture/marketplace-model.md` and OpenBrain decision log. |
| B4 | P2 | In-memory marketing rate limiter (serverless-unsafe under concurrent scale) | No durable KV store integrated | Ops to provision Upstash Redis (or equivalent Marketplace KV) and replace `marketing/app/api/leads/route.ts:39` map with atomic Redis counter |
| B5 | P3 | ProviderPayout creation flow — model exists, no runtime writes | No payout provider decision | Product to decide payout mechanism (manual bank transfer → ops records, or automated via Peach/Ozow). Implement once decided. |

### Blocked by architecture / post-MVP scope

| # | Severity | Issue | Blocked by | Notes |
|---|---|---|---|---|
| B6 | P2 | Durable outbox / retry for WhatsApp + payment sends | Architectural change | External sends currently fire-and-log. Safe for MVP where failure is manual-recoverable. Post-MVP: add outbox table + retry cron. |
| B7 | P2 | Orphan-state reconciliation (booking/job/payment drift detection) | Operational tooling gap | Requires admin reports or scheduled checks. No immediate user-visible risk at launch volumes. |
| B8 | P3 | Address / service-area validation (geocoding) | No geocoding service provisioned | Current intake accepts free-text suburb. Matching uses `serviceAreas` string comparison. Risk: low-quality matches. Post-MVP: integrate geocoding. |

## Post-MVP / Deferred Low-Severity

| # | Severity | Item |
|---|---|---|
| D1 | P3 | Admin-facing intake queue UI for `onboarding_intakes` |
| D2 | P3 | Audit-log viewer for ops |
| D3 | P3 | Automated tests for reschedule-request flow and relay-routing branches |
| D4 | P3 | Janice-specific scenario validation (no persona context available in OpenBrain) |
| D5 | P3 | `field-service/README.md` still describes dispatch-first model — update to marketplace framing |

## Verification Baseline (2026-04-10)

- `field-service npm test` → **112 passed | 4 todo | 0 failed**
- `field-service npm run build` → **passed**
- `marketing npm test` → **21 passed**
- `marketing npm run build` → **passed**

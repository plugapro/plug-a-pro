# Backend Gap Register

## Immediate Blockers

| Priority | Severity | Gap | Why it matters | Where to change | Classification | Scope |
|---|---|---|---|---|---|---|
| 1 | P0 | Add inbound WhatsApp idempotency/replay protection | Duplicate Meta deliveries can repeat business mutations | `field-service/app/api/webhooks/whatsapp/route.ts`, `field-service/lib/whatsapp-bot.ts`, new persistence model | Missing implementation | Launch-critical |
| 2 | P0 | Enforce customer completion confirmation before `COMPLETED` | Jobs can close without sign-off or final review checkpoint | `field-service/lib/jobs.ts`, `field-service/app/api/technician/jobs/[id]/status/route.ts`, customer confirmation action | Implementation drift | Launch-critical |
| 3 | P1 | Centralize booking cancellation | Current cancellation only flips booking status and leaves lifecycle gaps | customer booking server action + new booking service | Missing orchestration | Launch-critical |
| 4 | P1 | Implement real reschedule workflow or remove implied support | Current WhatsApp reschedule path is conversational only | `field-service/lib/whatsapp-bot.ts`, booking service, notifications | Partial implementation | Launch-critical |
| 5 | P1 | Resolve mediated messaging relay scope | Canonical spec requires it, implementation does not provide it | new relay service or spec amendment | Missing implementation / scope conflict | Launch-critical |
| 6 | P1 | Integrate marketing onboarding to field-service records | Funnel capture is disconnected from operational entities | `marketing/app/api/leads/route.ts`, cross-app ingestion path | Cross-app journey gap | Launch-critical |

## Pre-Launch Hardening

| Priority | Severity | Gap | Why it matters | Where to change | Classification | Scope |
|---|---|---|---|---|---|---|
| 7 | P2 | Dedupe reminder/follow-up cron sends | Cron reruns can spam customers | `field-service/app/api/cron/reminders/route.ts`, `follow-up/route.ts`, `MessageEvent` checks | Missing resilience | MVP-critical |
| 8 | P2 | Log interactive WhatsApp events | Support cannot reconstruct many high-value interactions | `field-service/lib/whatsapp-interactive.ts`, admin messages page model | Missing observability | MVP-critical |
| 9 | P2 | Normalize quote expiry | Stale quotes can remain pending in storage/reporting | `field-service/lib/quotes.ts`, quote expiry job or update path | Partial implementation | MVP-critical |
| 10 | P2 | Implement payout creation flow or document its external owner | Earnings dashboards depend on `ProviderPayout` records | payout job/service | Missing implementation | MVP-critical |
| 11 | P2 | Replace in-memory marketing rate limiter | Current protection is not reliable under serverless scale | `marketing/app/api/leads/route.ts` | Fragile implementation | MVP-critical |
| 12 | P2 | Tighten address/service-area validation | Intake quality and matching precision depend on it | WhatsApp request flow + customer API + optional geocoding | Partial implementation | MVP-critical |

## Operational Resilience Improvements

| Priority | Severity | Gap | Why it matters | Where to change | Classification | Scope |
|---|---|---|---|---|---|---|
| 13 | P2 | Use `AuditLog` for override actions | Refunds, dispute changes, cancellations, and manual corrections are not attributable | admin server actions, customer/provider server actions | Missing implementation | Pre-launch |
| 14 | P2 | Add durable outbox / retry coordination for external sends | Current send failures are usually logged and suppressed | messaging/payment orchestration layer | Architecture gap | Post-MVP hardening |
| 15 | P2 | Add orphan-state reconciliation jobs/views | Booking/job/payment/message drift is currently manual to detect | admin reports / scheduled checks | Operational gap | Pre-launch |
| 16 | P2 | Expand structured request tracing | Only some routes carry request IDs | webhook, cron, quote, booking mutation paths | Observability gap | Pre-launch |

## Spec / Documentation Cleanup

| Priority | Severity | Gap | Why it matters | Where to change | Classification | Scope |
|---|---|---|---|---|---|---|
| 17 | P3 | Normalize payment policy across docs and code | Current payment intent is contradictory | `docs/architecture/marketplace-model.md`, quote spec, README, OpenBrain decision log | Unresolved ambiguity | Immediate |
| 18 | P3 | Update `field-service/README.md` to current marketplace model | Readme still implies dispatch-first field-service thinking | `field-service/README.md` | Outdated documentation | Near-term |
| 19 | P3 | Record Janice-specific scenarios in OpenBrain or docs | Persona-specific validation was not available to this sweep | OpenBrain / product docs | Missing context | Near-term |

## Fast Wins

- Add `MessageEvent` existence checks before reminder/follow-up sends.
- Write `AuditLog` entries in refund, dispute update, and customer cancellation actions.
- Remove provider ability to send `COMPLETED` directly.
- Persist inbound Meta message IDs with a simple unique table and short-circuit duplicates.

## Dangerous Hidden Gaps

- The primary operating channel is WhatsApp, but inbound replay safety is weaker than the payment webhook safety.
- Code exists for booking cancellation and reschedule intents, but the underlying business journey is still incomplete.
- Quote and payment code presence can create false confidence even though the actual collection policy is intentionally bypassed and not formally normalized in product decisions.
- Admin tools are visible and functional, but because audit logging is absent, they are less support-safe than they appear.

## Recommended Implementation Order

1. Inbound WhatsApp idempotency
2. Completion confirmation enforcement
3. Booking cancellation service
4. Reschedule service
5. Audit logging for manual and customer/provider overrides
6. Reminder/follow-up dedupe
7. Marketing onboarding integration
8. Payment policy/documentation normalization
9. Mediated messaging relay decision and implementation/removal
10. Outbox/retry and broader operational reconciliation

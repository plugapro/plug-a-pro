# Backlog Recommendations — Plug A Pro Platform Audit (2026-07-06)

Prioritised implementation backlog derived from the [findings register](./FINDINGS_REGISTER.md). Finding IDs link each item to its evidence.

- **P0** — must fix before wider client acquisition
- **P1** — must fix before onboarding many more providers
- **P2** — should fix during pilot hardening
- **P3** — later improvements

---

## P0 — before wider client acquisition

### P0-1 · Make the marketplace tell customers the truth at every state change (CJ-03, CJ-05, CJ-06, CJ-08, CJ-09)
- **Why:** every observed funnel failure (matched-not-told, mid-flow 100% drop, expired-in-silence) is a variant of "the system knew, the customer wasn't told." This is the single biggest revenue leak.
- **Good output:** no JobRequest/Booking state change that matters to a customer happens without either a message or a recorded, alertable reason for why not.
- **Acceptance criteria:** (1) post-match acceptance notice has an approved template fallback and the nudge cron is on and ≤1h; (2) WhatsApp cancel routes to `cancelBookingLifecycle` when a booking exists; (3) reschedule creates a durable ops-queue item and notifies the provider; (4) PENDING_VALIDATION / SHORTLIST_READY / PROVIDER_CONFIRMATION_PENDING all have expiry + nudge sweeps; (5) EMPTY_POOL sends an immediate honest "no providers" message.
- **Risk if not done:** continued silent churn; every rand of ad spend leaks at mid-funnel.
- **Notes:** most pieces exist flag-gated — this is largely template approval + flag flips + extending `expireOpenJobRequest`'s status list + one routing fix in `whatsapp-bot.ts:3115-3144`.

### P0-2 · Payment webhook hardening (SRE-01, SRE-02, SRE-04, SEC-02/SRE-07)
- **Why:** four independent defects can each corrupt payment truth the day checkout mode turns on; one (failed-clobbers-PAID) can fire false "payment failed" messages at paying customers.
- **Good output:** payment state can only move forward legally; every miss is recorded and re-drivable.
- **Acceptance criteria:** (1) `handlePaymentFailed` uses guarded `updateMany` excluding PAID/REFUNDED + existence check (no P2025 500s); (2) Payment row upserted PENDING **before** PSP session creation; (3) booking-confirmation send tracked by sentinel + cron re-drive; (4) Peach provider constructor throws on empty `PEACH_WEBHOOK_SECRET`; (5) unit tests for out-of-order webhook sequences.
- **Risk if not done:** money taken with no record; PAID flipped to FAILED; confirmations silently lost.
- **Notes:** all changes localised to `lib/payments.ts` + `app/api/webhooks/payments/route.ts`. Verify `PEACH_WEBHOOK_SECRET` is set in prod **today**.

### P0-3 · Deliver the payment link (CJ-01)
- **Why:** in checkout mode customers literally cannot pay — the checkout URL and the ready-made Pay@Go WhatsApp message are both generated and discarded.
- **Good output:** booking creation in checkout mode sends the payment link; bypass mode unchanged.
- **Acceptance criteria:** checkout URL delivered via WhatsApp (window-safe) on booking creation; payment-failed message includes a fresh link (CJ-13); e2e test covers the send.
- **Risk if not done:** revenue collection stays manual forever; checkout mode can never be enabled.

### P0-4 · Dead-letter re-drive for inbound WhatsApp + failed-send sweep (SRE-03, AD-01, OBS-10)
- **Why:** customer replies can vanish permanently (dedup row blocks Meta redelivery), and the admin Retry button ops relies on is a no-op that hides failures.
- **Good output:** no inbound message or outbound failure is unrecoverable; the retry button actually retries.
- **Acceptance criteria:** (1) cron sweeps `InboundWhatsAppMessage` where `processedAt IS NULL AND failureReason IS NOT NULL` with capped attempts; (2) admin Retry re-sends inline and preserves failure history; (3) broadcast either sends or the QUEUED path gets a drain worker; (4) FAILED outbound sweep or admin resend that works.
- **Risk if not done:** silent message loss during any DB blip or bot bug; ops false confidence.

### P0-5 · Turn the lights on: Sentry client wiring + boundary capture + cron heartbeats (OBS-01, OBS-02, ARC-03, OBS-09)
- **Why:** the platform currently cannot see client-side crashes at all, and a dead match-leads cron would stall the entire marketplace silently.
- **Good output:** errors reach Sentry from browser and server; a dead cron pages someone within an hour.
- **Acceptance criteria:** (1) `instrumentation-client.ts` added; Sentry ingest host in CSP `connect-src`; verified event from prod browser; (2) `onRequestError` export + `app/global-error.tsx`; (3) every `error.tsx` calls `captureException`; (4) cron heartbeat rows + a stale-heartbeat alert (external uptime check on `/api/health` as the dead-man's switch); (5) `SENTRY_DSN` + `ADMIN_WHATSAPP_NUMBER` confirmed set in prod.
- **Risk if not done:** next incident is diagnosed by customer complaint, not by telemetry.

### P0-6 · Fix silent provider unmatchability at approval (PJ-01)
- **Why:** approved providers with no active `TechnicianServiceArea` rows silently never receive leads — supply-side churn that also starves the customer funnel.
- **Good output:** approval provisions matchability, and a readiness check tells ops (and the provider) when it doesn't.
- **Acceptance criteria:** (1) approval-time TSA sync from application serviceAreas; (2) a matchability-readiness function that runs the filter reason codes for one provider; (3) surfaced on the admin provider detail page and in the approval flow; (4) backfill audit: prod query for approved providers lacking active TSA rows, then repair.
- **Risk if not done:** provider acquisition spend wasted; "I never got any work" reputation damage.

### P0-7 · Encrypt `idNumber` at rest (SEC-01)
- **Why:** POPIA §26 special personal information; the schema's own "encrypt before GA" deadline has passed.
- **Good output:** no plaintext government identifiers in the database.
- **Acceptance criteria:** AES-GCM encryption (reuse `lib/identity-verification/crypto.ts`), backfill migration, purge where Didit already holds the verified identity, read-path updated, key in env with rotation note.
- **Risk if not done:** regulatory exposure on any DB compromise or over-broad export.

### P0-8 · Stub-quote guard (CJ-07)
- **Why:** live customers can currently open a quote page showing R0 with working Accept/Decline buttons that fail with a raw error.
- **Good output:** stub quotes render as "awaiting the provider's quote" and cannot be actioned.
- **Acceptance criteria:** `/quotes/[token]` guards amount=0/validUntil=null quotes; decision path rejects them with friendly copy; regression test.
- **Risk if not done:** trust-destroying broken page at the most commercially sensitive moment.

### P0-9 · Fix the dead ratings loop (CJ-02)
- **Why:** matching and shortlists rank on `averageRating` that is never updated — reviews are collected and discarded, and the marketplace's core trust signal is fiction.
- **Acceptance criteria:** review submit recomputes `averageRating` (+count); reviews unified on jobId+matchId; backfill from existing Review rows; follow-up dedup sees all reviews.
- **Risk if not done:** ranking quality never improves; review asks annoy customers for nothing.

---

## P1 — before onboarding many more providers

### P1-1 · Provider funnel recovery lanes (PJ-05, PJ-06, PJ-02)
- **Why:** the deepest-funnel (highest-intent) applicants get the worst treatment: PWA drafts never re-engaged, deep WhatsApp steps get cold-start copy, post-cutoff KYC unmatchables get no nudge.
- **Acceptance criteria:** draft-based recovery lane reading `ProviderApplicationDraft`; classifier covers all `reg_*` steps; Didit link-never-clicked cohort added to renudge; KYC nudge extended past the legacy cohort; recovery flags flipped from report-only.
- **Risk:** provider CAC wasted at exactly the step where intent is proven.

### P1-2 · Certification pipeline (PJ-03, PJ-04)
- **Why:** cert-gated matching queries tables nothing writes; only electrical carries required codes. Regulated trades either never match or match unverified people.
- **Acceptance criteria:** application cert captures promoted to `ProviderCertification` on approval with a verification step; required cert codes defined for all high-risk categories; admin approve blocks high-risk approval without verified certs; matching test extended.
- **Risk:** legal/safety liability dispatching unverified tradespeople; electrical category permanently starved.

### P1-3 · Lead/JobRequest state machines (ARC-01)
- **Why:** the two highest-cardinality, money-adjacent entities rely on per-callsite discipline across 33 writer files; blind writes exist in race-prone paths.
- **Acceptance criteria:** `transitionLead()` / `transitionJobRequest()` with transition maps + CAS (template: `lib/jobs.ts`); all writers migrated; illegal-transition attempts logged; tests for the race pairs (expire-vs-accept, supersede-vs-accept).
- **Risk:** race-window corruption that is nearly impossible to debug after the fact.

### P1-4 · Job completion closure (PJ-07, CJ-11, CJ-10)
- **Why:** jobs hang forever on silent customers; PAUSED/FAILED/CANCELLED are silent to customers; providers stall unpaid/unclosed.
- **Acceptance criteria:** 24h customer re-nudge; auto-complete after N days with notice; admin force-complete action (crudAction); customer notifications on all four silent transitions; completion-check covers all assignment modes.
- **Risk:** provider trust erosion + review/metrics pipeline starvation.

### P1-5 · Post-top-up lead resume + wallet UX (PJ-08, PJ-14)
- **Why:** providers pay for credits then lose the lead that prompted the purchase; they can't reconcile credits against outcomes.
- **Acceptance criteria:** credit-confirmation message carries a pending-lead CTA; lead history page (accepted/expired/declined with credit linkage); shortlist expiry notice.
- **Risk:** top-up revenue churn; credit disputes.

### P1-6 · Ops diagnosis surfaces (AD-03, AD-08, CJ-25, TST-03)
- **Why:** the two questions ops asks most — "customer says paid, where is it?" and "did my message reach them?" — are currently hard or impossible to answer; the customer token pages have zero smoke coverage.
- **Acceptance criteria:** payments page search by phone/name/PSP ref + unmatched-payment intake; messages page pagination/filters/inbound view; invalid-token smoke checks for all five token surfaces; smoke runs against preview deployments on PRs.
- **Risk:** support cost scales linearly with volume; broken token pages ship unnoticed.

### P1-7 · Funnel event completion + payment forensics (OBS-03, OBS-05, ARC-04)
- **Why:** the funnel goes dark exactly where past incidents happened (post-acceptance); PSP payloads survive only as console lines; support reference IDs can't be traced.
- **Acceptance criteria:** WorkflowEvents emitted for booking/job/payment/invoice/review transitions; PaymentWebhookEvent table storing redacted raw payloads; `reference_id` derived from correlation ID and logged.
- **Risk:** the next "I paid but…" incident is unreconstructable.

### P1-8 · External-call resilience (SRE-06) and env validation (ARC-10)
- **Why:** a hung Meta/Peach endpoint pins serverless functions and blows cron budgets; 193 raw env reads mean misconfig is discovered in production at call time.
- **Acceptance criteria:** shared fetch helper with `AbortSignal.timeout` + one retry (Didit client is the template) adopted by whatsapp.ts/payments.ts; zod-validated `lib/env.ts` loaded at instrumentation time listing every required var per integration.
- **Risk:** cron starvation mid-batch; the next `ADMIN_WHATSAPP_NUMBER`-class silent no-op.

### P1-9 · Unify gate-ON submission before flipping qgv2 (PJ-11); phone-variant lookups (CJ-15); refund desync (SRE-05); Blob privacy (SEC-03); rate-limit env confirm (SEC-09/SRE-10); provider double-booking guard (SRE-08)
- Bundled smaller items, each with a one-PR scope; see finding entries for acceptance criteria.

---

## P2 — pilot hardening

| Item | Findings | One-line scope |
|---|---|---|
| Error envelope migration + `parseBody(schema)` helper | ARC-02, ARC-11, SRE-09 | One envelope, zod at every public boundary, lint rule |
| Feature-flag admin UI (OWNER-gated) + delete settings/services stubs | AD-09 | Kill-switches without DB access |
| crudAction consolidation: dispatch redispatch/escalate, case lifecycle, vendor seed, applications inline writes | AD-05, AD-06, AD-07, OBS-12 | Every admin mutation audited |
| `roleExact` on finance mutations | AD-04 | TRUST can no longer refund |
| Suspension/strike/ban notifications + appeal path | PJ-10 | Due process for providers |
| Split whatsapp-bot.ts into flow modules; lib/ domain folders | ARC-09 | Pay down the god-module before it grows |
| Matching N+1 batching | ARC-08 | Required before ~10× volume |
| Dispute FK + enum; MessageEvent jobRequestId; booking-created event | ARC-06, OBS-06, OBS-08 | Additive schema integrity |
| Structured logger + persisted correlation IDs | OBS-04 | Log↔DB joins stop depending on timestamps |
| Waitlist drain on region activation | CJ-20 | Stop promising and not delivering |
| Customer CAPI attribution | CJ-14 | Make paid customer acquisition measurable |
| Channel policy parity (West Rand gate on WhatsApp path) | CJ-16 | One policy, one choke point |
| Relay UX: menu-first interception | CJ-22 | Stop forwarding "thanks" to providers |
| Completion evidence parity + sign-off bypass fix | PJ-13 | One completion path |
| PII log masking (3 sites), proxy matcher scope, quote-token expiry | SEC-08, SEC-04, SEC-05/CJ-23 | Residual security polish |
| Refresh CLAUDE.md | AD-10 | Stale docs actively mislead |

## P3 — later

| Item | Findings |
|---|---|
| Payout/earnings story (build or remove the facade) | PJ-09 (decision is P1; build is P3) |
| Customer slot selection | CJ-17 |
| Invoice push + tax handling; customer vouchers | CJ-27 |
| Token hashing at rest; timing-safe cron compare | SEC-06, SEC-07 |
| Dependency pruning (Radix dup, smile-identity-core, dynamic-import heavy libs) | ARC-14 |
| Admin bookings query projection; AssignmentHold admin surface | ARC-15, AD-13 |
| Server-action convention codemod + lint | ARC-13 |
| Dead-code cleanup | CJ-28 |
| `prisma generate` in postinstall | TST-02 |
| Command education, stale-button try/catch, copy fixes | PJ-16, CJ-26 |

---

## Sequencing note

P0 items P0-1 through P0-5 are independent and parallelisable. P0-6/P0-9 (provider matchability, ratings) touch matching code that P1-3 (state machines) will refactor — do the P0 fixes first as surgical changes, then fold them into the transition functions. Verify the three env-var questions (PEACH_WEBHOOK_SECRET, SENTRY_DSN, ADMIN_WHATSAPP_NUMBER + Upstash) **today** — they change the live severity of four findings.

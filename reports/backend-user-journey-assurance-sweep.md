# Backend User Journey Assurance Sweep

## 1. Executive Summary
- Overall judgement: backend journey alignment is `partial` and not yet launch-safe without targeted remediation.
- Overall alignment score: `67/100`.
- Confidence level: `medium-high` for static alignment, `medium` for real-world operational behaviour.
- Readiness summary:
  - Core marketplace intake, matching, quote submission, quote approval, booking creation, job execution, dispute intake, and provider earnings are present.
  - Several journeys remain only partially supported or operationally unsafe: inbound WhatsApp replay handling, booking cancellation/reschedule semantics, customer completion confirmation enforcement, mediated messaging relay, and onboarding integration between marketing intake and the field-service marketplace.
  - Payment is intentionally in launch-mode bypass, but the governing documents conflict on whether payment is deferred, optional, or platform-collected. This is a decision hygiene issue as much as an implementation issue.
- Journey coverage summary:
  - Fully implemented: lead matching core loop, provider approval eligibility, quote submission and revision trail, admin disputes review surface, provider earnings read APIs.
  - Partially implemented: onboarding/intake, booking lifecycle, payment lifecycle, dispatch recovery, communications, admin override auditability, observability.
  - Missing or materially misaligned: mediated messaging relay, inbound message idempotency, structured reschedule workflow, customer-enforced completion confirmation, durable audit trail usage.
- Top 5 critical gaps:
  1. Inbound WhatsApp processing has no replay/idempotency guard, so duplicate webhook deliveries can repeat state transitions.
  2. Providers can complete jobs directly without customer sign-off, despite the model and admin flow diagrams expecting `PENDING_COMPLETION_CONFIRMATION`.
  3. Booking cancellation and reschedule flows are shallow and do not consistently update job/payment/message/audit state.
  4. Mediated customer-provider messaging relay remains absent, despite the authoritative marketplace spec requiring it.
  5. WhatsApp-first marketing onboarding is not integrated into field-service customer/provider lifecycle state and still depends on env-sensitive marketing lead persistence.

## 2. Scope and Method

### Repo areas inspected
- `docs/`
- `field-service/app/api`
- `field-service/lib`
- `field-service/prisma`
- `field-service/__tests__`
- `marketing/app/api`
- `marketing/lib`

### Specs used
- `docs/architecture/marketplace-model.md`
- `field-service/docs/superpowers/plans/2026-03-31-whatsapp-marketplace-journeys.md`
- `field-service/docs/superpowers/specs/2026-03-31-provider-quote-earnings-design.md`
- `docs/release-readiness-tracker.md`
- `docs/release-runbook.md`
- repo READMEs and spec trace docs

### OpenBrain context used
- Project context for `Plug A Pro`
- Decision list for `Plug A Pro`
- Memory search for `Janice`, `Plug A Pro`, `ServiceMen`, backend journey, booking, quote, payment, technician, WhatsApp, admin/ops, onboarding, customer communication

### Executed verification
- `cd field-service && npm test` → `96 passed | 4 todo`
- `cd field-service && npm run build` → passed
- `cd marketing && npm test` → `21 passed`
- `cd marketing && npm run build` → passed

### Static-only review areas
- Binary docs (`.docx`, `.png`) were inventoried but not parsed in this sweep.
- No live verification of Meta, PSP, Supabase production state, cron schedules, or webhooks was possible from repository state alone.

### Limitations
- Janice-specific OpenBrain memories were not found. Janice-related conclusions therefore rely on repository specs plus general Plug A Pro memories rather than persona-specific operational notes.
- Payment/webhook behaviour was reviewed statically; no live PSP events were replayed.
- WhatsApp production behaviour was reviewed from handlers/templates and tests, not from live Meta event traffic.

## 3. Source Inventory

| Path | Type | Authority | Last-modified clue | Journey coverage |
|---|---|---:|---|---|
| `docs/architecture/marketplace-model.md` | Architecture / canonical domain model | Primary | 2026-03-31 | End-to-end marketplace behaviour, domain entities, MVP checklist |
| `field-service/docs/superpowers/plans/2026-03-31-whatsapp-marketplace-journeys.md` | Implementation plan | Primary-secondary | 2026-03-31 | WhatsApp intake, provider journey, matching, cron |
| `field-service/docs/superpowers/specs/2026-03-31-provider-quote-earnings-design.md` | Feature design spec | Primary-secondary | 2026-03-31 | Quote, approval, earnings, inspection-first flow |
| `docs/release-readiness-tracker.md` | Operational tracker | Secondary | 2026-04-08 | Security hardening, CI, cron, template status, evidence claims |
| `docs/release-runbook.md` | Ops runbook | Secondary | 2026-04-06 / updated 2026-04-08 | Deploy, migrations, env, backup/restore, smoke tests |
| `docs/spec-trace-marketplace-model-2026-04-08.md` | Internal trace doc | Secondary | 2026-04-08 | Prior implementation-to-spec checkpoint |
| `field-service/README.md` | App readme | Tertiary / outdated in parts | current repo | Setup, architecture summary, role model |
| `README.md` | Monorepo readme | Tertiary | current repo | High-level product/stack framing |
| `docs/whatsapp-template-verification-2026-04-08.md` | External verification note | Secondary | 2026-04-08 | Template approval status |
| `docs/Plug_a_Pro_Master_Solution_Document.docx` | Binary product doc | Unverified | 2026-03-25 | Potential high-level business intent |
| `docs/Plug_a_Pro_Master_Solution_Document v2.docx` | Binary product doc | Unverified | 2026-03-26 | Potential updated business intent |
| `docs/WhatsApp User Journey.png` | Binary journey diagram | Unverified | 2026-03-26 | Visual journey reference |
| OpenBrain decision: `Adopt WhatsApp-first self-registration for marketing intake` | Decision memory | Secondary | 2026-04-09 | Intake/onboarding |
| OpenBrain decision: `Defer OTP or confirmation-link verification for onboarding` | Decision memory | Secondary | 2026-04-09 | Onboarding trust model |
| OpenBrain memory: `implementation log — marketplace launch-mode readiness pass (2026-04-08)` | Execution log | Secondary | 2026-04-08 | Payment bypass, matching fixes, mediated relay still open |

### Source conflicts observed
- `docs/architecture/marketplace-model.md` and `field-service/docs/superpowers/specs/2026-03-31-provider-quote-earnings-design.md` both describe marketplace-oriented quote flows, but payment intent differs:
  - quote spec says `Payment: Deferred — no PayFast or payment templates in pilot`
  - schema and `lib/payments.ts` still model full platform payment objects
  - OpenBrain execution memory says launch-mode payment bypass is active
  - Classification: `unresolved ambiguity` plus `outdated documentation`
- `field-service/README.md` still describes a field-service/dispatch model and Peach Payments-first framing that no longer matches the authoritative marketplace design.
  - Classification: `outdated documentation`

## 4. Intended Journey Model From Spec

### A. Entry / Intake / Onboarding
- Customer should be able to request help through WhatsApp-first intake with category, address, timing, and identity continuity.
- Provider should be able to self-register through WhatsApp/web, be reviewed, approved, and then become available for matching.
- Platform should deduplicate customers/providers by phone and support later account linking.

### B. Quote Journey
- Provider accepts or inspects first, then submits a full quote through the platform.
- Customer reviews quote through WhatsApp/web, can approve or decline, and declined quotes may be revised.
- Quote lifecycle should preserve auditability, expiry, and revision intent.

### C. Booking Journey
- Booking is created only after quote approval.
- Scheduling should reflect provider availability or direct coordination when inspection/custom work requires it.
- Cancellation/reschedule behaviour should be explicit and safe.

### D. Payment Journey
- Spec family is inconsistent:
  - authoritative architecture expects marketplace trust/payment support
  - quote design explicitly defers live payment for pilot
  - implementation models payment but currently bypasses collection
- Minimum intent is still clear: the quote approval/booking flow must support later activation of platform collection without breaking state integrity.

### E. Dispatch / Technician Journey
- Platform matches up to a small set of eligible providers, providers self-select leads, and the first valid acceptance wins.
- Provider should update execution states and optionally request inspection-first or extra work approval.
- Admin should moderate, not manually dispatch employed technicians.

### F. Job Completion / Closeout
- Provider marks work done, customer confirms completion, invoice/receipt is generated, and follow-up/review is triggered.

### G. Communications / Messaging
- WhatsApp is the primary operating channel.
- Templates and event routing should cover lead offers, quote approvals, booking confirmations, reminders, follow-up, and mediated communication.
- Duplicate, out-of-order, and failed messages should not corrupt business state.

### H. Admin / Ops Journey
- Admin reviews provider applications, monitors matches, handles disputes/refunds, and can intervene safely with visibility and traceability.

## 5. Implemented Backend Journey Model

### Entry points and orchestration
- Customer intake:
  - WhatsApp bot: `field-service/lib/whatsapp-bot.ts` → `lib/whatsapp-flows/job-request.ts`
  - Customer API: `field-service/app/api/customer/bookings/route.ts`
  - Marketing onboarding capture: `marketing/app/api/leads/route.ts`
- Provider onboarding:
  - WhatsApp registration: `field-service/lib/whatsapp-flows/registration.ts`
  - Admin approval UI/server action: `field-service/app/(admin)/admin/applications/page.tsx`
- Matching:
  - `field-service/lib/matching-engine.ts`
  - cron trigger: `field-service/app/api/cron/match-leads/route.ts`
- Quotes:
  - provider API: `field-service/app/api/technician/quotes/route.ts`
  - shared decision service: `field-service/lib/quotes.ts`
  - customer token API: `field-service/app/api/quotes/[token]/route.ts`
- Booking/payment:
  - booking created in `lib/quotes.ts`
  - payment initialisation in `lib/payments.ts`
  - payment webhook in `app/api/webhooks/payments/route.ts`
- Job execution:
  - transition engine: `field-service/lib/jobs.ts`
  - provider status update API: `app/api/technician/jobs/[id]/status/route.ts`
  - extra work API: `app/api/technician/jobs/[id]/extras/route.ts`
  - photo upload API: `app/api/technician/jobs/[id]/photo/route.ts`
- Messaging:
  - template sends + policy + message log: `field-service/lib/whatsapp.ts`, `field-service/lib/whatsapp-policy.ts`
  - interactive sends: `field-service/lib/whatsapp-interactive.ts`
  - inbound webhook: `field-service/app/api/webhooks/whatsapp/route.ts`
- Admin/ops:
  - disputes page server action: `field-service/app/(admin)/admin/disputes/page.tsx`
  - payments page refund action: `field-service/app/(admin)/admin/payments/page.tsx`
  - matches moderation page: `field-service/app/(admin)/admin/matches/page.tsx`

### Implemented state models
- Request: `PENDING_VALIDATION → OPEN → MATCHING → MATCHED → EXPIRED | CANCELLED`
- Lead: `SENT → VIEWED → ACCEPTED | DECLINED | EXPIRED`
- Match: `MATCHED → INSPECTION_SCHEDULED → INSPECTION_COMPLETE → QUOTED → QUOTE_APPROVED | QUOTE_DECLINED | CANCELLED`
- Quote: `PENDING → APPROVED | DECLINED | EXPIRED | REVISED`
- Booking: `SCHEDULED | RESCHEDULED | CANCELLED | COMPLETED`
- Job: `SCHEDULED → EN_ROUTE → ARRIVED → STARTED → PAUSED | AWAITING_APPROVAL | PENDING_COMPLETION_CONFIRMATION | COMPLETED | FAILED | CALLBACK_REQUIRED`

### Async side effects present
- WhatsApp template sends for confirmations, reminders, follow-up, extras, arrivals, etc.
- Cron jobs for matching, reminders, follow-up, stale request expiry
- Payment webhook handling

### Async side effects notably absent
- Durable queue/outbox
- dead-letter/retry coordination
- inbound WhatsApp dedupe store
- formal mediated message relay

## 6. Alignment Assessment

| Journey | Assessment | Summary |
|---|---|---|
| Entry / intake / onboarding | Partial | WhatsApp bot intake exists; marketing onboarding exists; cross-system onboarding integration remains incomplete and env-sensitive |
| Quote journey | Partial-strong | Core quote submit/approve/decline/revise path works; expiry and negotiation remain limited |
| Booking journey | Partial | Booking creation works; reschedule/cancel semantics are weak; slotting is intentionally minimal |
| Payment journey | Partial / ambiguous | Payment data model and webhook exist; live collection is bypassed; documentation and intent conflict |
| Dispatch / technician journey | Partial-strong | Matching and lead lifecycle are materially implemented; reassignment/callback flows are not fully closed operationally |
| Job completion / closeout | Partial | Status machine exists, but completion can bypass customer confirmation; invoice generation is best-effort |
| Communications / messaging | Partial | Outbound templates and message logs exist; inbound replay protection and mediated relay are missing |
| Admin / ops | Partial | Admin review, disputes, payments, reports exist; override actions lack full auditability and stronger controls |
| Cross-cutting controls | Partial | Route auth is materially in place; idempotency, observability, audit logs, and durable retries remain incomplete |

## 7. Gap Analysis

### P0 Critical

#### 7.1 Inbound WhatsApp webhook replay can repeat state transitions
- Journey: Communications / intake / matching / quote interaction
- What was expected:
  - inbound events should be idempotent or deduplicated by external message ID to survive Meta retries and duplicate deliveries safely.
- What was found:
  - `field-service/app/api/webhooks/whatsapp/route.ts` validates signature and immediately calls `processInboundMessage(message)` for each inbound message.
  - `field-service/lib/whatsapp-bot.ts` does not persist or check inbound `message.id` before mutating conversation state or business data.
  - No model in `field-service/prisma/schema.prisma` stores inbound webhook IDs for replay protection.
- Evidence:
  - `field-service/app/api/webhooks/whatsapp/route.ts`
  - `field-service/lib/whatsapp-bot.ts`
  - `field-service/prisma/schema.prisma`
- Impacted actors: customer, provider, ops
- Business impact:
  - duplicate requests, duplicate lead actions, duplicate provider application actions, or repeated menu-state transitions become possible under webhook retries or replayed payloads.
- Technical risk:
  - non-idempotent state machine entry point at the platform’s primary channel.
- Recommendation:
  - persist inbound WhatsApp message IDs and reject already-processed events before routing to conversation handlers.
  - store an idempotency record keyed by Meta message ID and response type.
- Suggested priority: Immediate blocker
- Classification: Missing implementation / operationally unsafe

#### 7.2 Job completion can bypass customer sign-off
- Journey: Job completion / closeout
- What was expected:
  - provider marks work done, job enters `PENDING_COMPLETION_CONFIRMATION`, customer confirms completion, then final completion and follow-up occur.
- What was found:
  - `field-service/lib/jobs.ts` allows `STARTED → COMPLETED` and `AWAITING_APPROVAL → COMPLETED`.
  - `field-service/app/api/technician/jobs/[id]/status/route.ts` allows providers to submit `COMPLETED` directly.
  - customer booking page displays the timeline but exposes no completion-confirm action.
- Evidence:
  - `field-service/lib/jobs.ts`
  - `field-service/app/api/technician/jobs/[id]/status/route.ts`
  - `field-service/app/(customer)/bookings/[id]/page.tsx`
  - `field-service/app/(admin)/admin/flows/FlowsClient.tsx`
- Impacted actors: customer, provider, ops
- Business impact:
  - jobs can be closed without customer acknowledgment; disputes and incomplete work are harder to resolve.
- Technical risk:
  - state-machine integrity broken against intended lifecycle.
- Recommendation:
  - remove direct provider transition to `COMPLETED`.
  - require `PENDING_COMPLETION_CONFIRMATION`, then add explicit customer confirm/fail path.
- Suggested priority: Immediate blocker
- Classification: Implementation drift from spec

### P1 High

#### 7.3 Booking cancellation is shallow and leaves orphaned lifecycle concerns
- Journey: Booking journey / payment / communications / admin support
- What was expected:
  - cancellation should consistently update booking, job, payment/refund handling, messaging, and audit trace.
- What was found:
  - customer cancellation in `field-service/app/(customer)/bookings/[id]/page.tsx` only updates `booking.status = 'CANCELLED'`.
  - no corresponding job transition, dispute/payment/refund decision, customer/provider notification, or audit log write is triggered.
- Evidence:
  - `field-service/app/(customer)/bookings/[id]/page.tsx`
  - `field-service/lib/jobs.ts`
  - `field-service/lib/payments.ts`
  - `field-service/prisma/schema.prisma` (`AuditLog`, `Payment`, `Job`)
- Impacted actors: customer, provider, finance, ops
- Business impact:
  - cancelled bookings can leave live jobs, payment ambiguity, and support confusion.
- Technical risk:
  - orphaned states and hidden downstream inconsistency.
- Recommendation:
  - centralise cancellation in a booking service that performs status transitions, refund policy, notifications, and audit logging atomically where possible.
- Suggested priority: Immediate blocker
- Classification: Missing backend orchestration

#### 7.4 Reschedule flow is conversational but not operational
- Journey: Booking journey / customer correction path
- What was expected:
  - reschedule should record intent, update booking state, and notify downstream actors.
- What was found:
  - `field-service/lib/whatsapp-bot.ts` collects a reschedule reason and asks the user to type availability, but does not persist a booking change or create an ops task.
  - no dedicated backend reschedule service or API route exists.
- Evidence:
  - `field-service/lib/whatsapp-bot.ts`
  - route inventory in `field-service/app/api`
- Impacted actors: customer, provider, ops
- Business impact:
  - customers can believe they rescheduled when only a conversational acknowledgement occurred.
- Technical risk:
  - silent expectation gap and support burden.
- Recommendation:
  - add a booking reschedule workflow with explicit persistence, state transition, and notification semantics.
- Suggested priority: Immediate blocker
- Classification: Partial implementation

#### 7.5 Mediated messaging relay remains unimplemented
- Journey: Communications / trust & safety
- What was expected:
  - authoritative marketplace spec requires mediated communication between customer and provider.
- What was found:
  - `docs/architecture/marketplace-model.md` includes mediated communication in the platform role and the Phase 1 checklist.
  - `field-service/lib/whatsapp.ts` only logs inbound messages with a TODO in `processWebhookEvent`.
  - no route/service exists for a customer-provider relay thread, relay moderation, or message persistence beyond outbound `MessageEvent`.
- Evidence:
  - `docs/architecture/marketplace-model.md`
  - `field-service/lib/whatsapp.ts`
  - route inventory in `field-service/app/api`
- Impacted actors: customer, provider, ops
- Business impact:
  - privacy/trust promise is incomplete; off-platform coordination will happen.
- Technical risk:
  - customer/provider contact and scope decisions are not observable or supportable.
- Recommendation:
  - either implement a basic mediated relay with persisted message records and admin visibility, or formally remove it from Phase 1 scope in the spec.
- Suggested priority: Immediate blocker
- Classification: Missing implementation

#### 7.6 Marketing WhatsApp-first onboarding is not integrated to core marketplace identity state
- Journey: Entry / intake / onboarding
- What was expected:
  - WhatsApp-first onboarding should capture lead intent and bridge into the actual customer/provider lifecycle.
- What was found:
  - OpenBrain decision says WhatsApp-first self-registration is adopted.
  - `marketing/app/api/leads/route.ts` stores onboarding submissions to `marketing_leads` and returns a WhatsApp link.
  - `marketing/lib/supabase.ts` warns that missing Supabase env causes lead/chat routes to fail at runtime.
  - no implemented handoff from marketing onboarding rows into `field-service` `Customer`, `ProviderApplication`, or provider onboarding state.
- Evidence:
  - OpenBrain decisions dated 2026-04-09
  - `marketing/app/api/leads/route.ts`
  - `marketing/lib/supabase.ts`
  - `field-service/prisma/schema.prisma`
- Impacted actors: customer, provider, marketing ops
- Business impact:
  - funnel attribution exists, but onboarding does not yet guarantee marketplace-operational records.
- Technical risk:
  - split-brain identity and partial data capture.
- Recommendation:
  - define and implement the canonical ingestion boundary from marketing onboarding into field-service customer/provider records or an explicit intake queue.
- Suggested priority: Immediate blocker
- Classification: Partial implementation / cross-app journey gap

### P2 Medium

#### 7.7 AuditLog model exists but override actions do not use it
- Journey: Admin / ops / cross-cutting controls
- What was expected:
  - high-impact manual actions should be auditable.
- What was found:
  - `AuditLog` model exists in `field-service/prisma/schema.prisma`.
  - repository search found no `db.auditLog` writes in runtime code.
  - admin payments, disputes, customer cancellation, and other server actions mutate operational state without audit writes.
- Evidence:
  - `field-service/prisma/schema.prisma`
  - repo search for `db.auditLog`
  - `field-service/app/(admin)/admin/payments/page.tsx`
  - `field-service/app/(admin)/admin/disputes/page.tsx`
  - `field-service/app/(customer)/bookings/[id]/page.tsx`
- Impacted actors: ops, compliance, support
- Business impact:
  - weak forensic ability during disputes, refunds, or manual corrections.
- Technical risk:
  - support actions are not attributable.
- Recommendation:
  - enforce audit writes for refund, dispute update, cancellation, manual status correction, and customer preference overrides.
- Suggested priority: Pre-launch hardening
- Classification: Missing implementation

#### 7.8 Cron reminders and follow-ups have no dedupe protection
- Journey: Communications / notification reliability
- What was expected:
  - repeated cron execution should not resend the same reminder/follow-up unintentionally.
- What was found:
  - `field-service/app/api/cron/reminders/route.ts` and `field-service/app/api/cron/follow-up/route.ts` select by time window and send messages directly.
  - they do not check `MessageEvent` for prior sends of the same template for the same booking.
- Evidence:
  - `field-service/app/api/cron/reminders/route.ts`
  - `field-service/app/api/cron/follow-up/route.ts`
  - `field-service/app/(admin)/admin/messages/page.tsx`
- Impacted actors: customer, ops
- Business impact:
  - duplicate reminders/follow-ups on reruns or manual retries.
- Technical risk:
  - noisy customer experience and support load.
- Recommendation:
  - add a dedupe query on `MessageEvent` or a template-send ledger before sending cron-driven notifications.
- Suggested priority: Pre-launch hardening

#### 7.9 Interactive WhatsApp sends are not logged in MessageEvent
- Journey: Communications / supportability
- What was expected:
  - key user-visible outbound events should be reviewable for support and operations.
- What was found:
  - template sends in `field-service/lib/whatsapp.ts` call `logMessage`.
  - interactive sends in `field-service/lib/whatsapp-interactive.ts` do not create `MessageEvent` records.
  - quote approvals, lead offers, and many conversational prompts therefore bypass the admin message log.
- Evidence:
  - `field-service/lib/whatsapp.ts`
  - `field-service/lib/whatsapp-interactive.ts`
  - `field-service/app/(admin)/admin/messages/page.tsx`
- Impacted actors: ops, support
- Business impact:
  - support cannot reconstruct important customer/provider interactions.
- Technical risk:
  - audit gap in the primary operating channel.
- Recommendation:
  - log interactive outbound events with channel, target, semantic type, external ID, and entity linkage.
- Suggested priority: Pre-launch hardening

#### 7.10 Quote expiry handling is only partially durable
- Journey: Quote journey / timeout path
- What was expected:
  - expired quotes should be durably marked expired and not remain pending indefinitely.
- What was found:
  - `processQuoteDecision()` checks `validUntil` and returns `EXPIRED`, but does not update quote state to `EXPIRED`.
  - technician quote submission marks the previous pending quote expired only when a provider tries to send a revision.
  - quote token GET computes `expired` dynamically for display.
- Evidence:
  - `field-service/lib/quotes.ts`
  - `field-service/app/api/technician/quotes/route.ts`
  - `field-service/app/api/quotes/[token]/route.ts`
- Impacted actors: customer, provider, ops
- Business impact:
  - stale pending quotes can remain in storage/reporting until another action occurs.
- Technical risk:
  - inconsistent quote state and reporting noise.
- Recommendation:
  - add a quote expiry sweeper or update state eagerly on expired decision attempts.
- Suggested priority: Pre-launch hardening

#### 7.11 Slotting/capacity support is intentionally minimal, but not clearly reconciled with customer expectations
- Journey: Booking / scheduling
- What was expected:
  - either provider availability-based sloting or clear direct-coordination semantics.
- What was found:
  - `field-service/lib/slotting.ts` can compute schedule windows per provider.
  - `field-service/app/api/customer/slots/route.ts` returns no slots and says timing is arranged directly after matching.
  - `field-service/__tests__/lib/slotting.test.ts` still contains only TODOs.
- Evidence:
  - `field-service/lib/slotting.ts`
  - `field-service/app/api/customer/slots/route.ts`
  - `field-service/__tests__/lib/slotting.test.ts`
- Impacted actors: customer, provider, product
- Business impact:
  - schedule support is weaker than the code surface may suggest.
- Technical risk:
  - false confidence from partial slotting helpers.
- Recommendation:
  - formally choose either direct coordination for MVP or real provider-availability-backed booking, then delete or complete the unused path.
- Suggested priority: Pre-launch hardening

#### 7.12 Provider payout generation appears read-only from this repo slice
- Journey: Provider earnings / payment closeout
- What was expected:
  - payout records should be created by a clear backend process once jobs/payments settle.
- What was found:
  - `field-service/app/api/technician/earnings/route.ts` and `statement/route.ts` read `ProviderPayout`.
  - repository search in the audited backend slice did not surface a payout creation workflow.
- Evidence:
  - `field-service/app/api/technician/earnings/route.ts`
  - `field-service/app/api/technician/earnings/statement/route.ts`
  - schema model `ProviderPayout`
- Impacted actors: provider, finance
- Business impact:
  - earnings dashboards may depend on manually-seeded or externally-created payout records.
- Technical risk:
  - payout lifecycle incompleteness.
- Recommendation:
  - document and implement the payout creation trigger path if it is in scope for launch.
- Suggested priority: Pre-launch hardening

### P3 Low

#### 7.13 Documentation drift remains substantial in field-service README
- Journey: Cross-cutting
- What was expected:
  - readme should reflect current marketplace architecture.
- What was found:
  - `field-service/README.md` still references dispatch, technician terminology, and Peach-first go-live steps that no longer represent the authoritative state cleanly.
- Evidence:
  - `field-service/README.md`
  - `docs/architecture/marketplace-model.md`
- Recommendation:
  - align README with the authoritative marketplace model and launch-mode payment policy.
- Suggested priority: Spec/documentation cleanup

## 8. Scenario Coverage Review

| Scenario class | Coverage | Notes |
|---|---|---|
| Happy path | Strong | Intake → match → quote → approve → booking → status progression exists |
| Expected alternate paths | Partial | inspection-first and quote revision exist; reschedule/cancel are incomplete |
| User correction paths | Partial | customer can decline quote with feedback; address correction exists in WhatsApp; reschedule persistence missing |
| Admin override paths | Partial | disputes and refunds exist; auditability is weak |
| Payment failure paths | Partial | failed webhook updates payment; broader unpaid booking behaviour remains policy-ambiguous |
| Timeout / expiry paths | Partial | lead expiry exists; quote expiry is not durably swept |
| Duplicate / replay paths | Weak | payment webhook duplicate guarded; inbound WhatsApp replay not guarded |
| Race condition paths | Partial | match uniqueness and lead uniqueness help; other flows rely on best effort |
| Retry / webhook repeat paths | Partial | payment duplicate guarded; message cron dedupe missing |
| Partial completion paths | Weak | dispute intake exists, but no strong partial-completion state or closeout policy |
| External dependency failure paths | Partial | messaging calls often log-and-suppress; no durable retry |
| Unsupported input / validation paths | Partial | quote route has meaningful validation; customer booking intake is still minimal; onboarding rate limiting is in-memory only |
| Security / abuse paths | Partial | session/link hardening and webhook signatures exist; replay/idempotency and audit remain weak |
| Operational exception paths | Partial | admin pages exist; support-grade state repair/audit tools are limited |
| Data integrity / orphan-state paths | Weak | booking cancel and quote expiry leave integrity gaps |

## 9. Operational and Reliability Risks

- State integrity:
  - booking cancellation is not centrally orchestrated.
  - direct completion bypass undermines intended final-confirmation state.
  - quote expiry is not durably normalized.
- Retries and idempotency:
  - payment webhook duplicate handling is present.
  - inbound WhatsApp replay protection is absent.
  - cron reminder/follow-up dedupe is absent.
- Auditability:
  - `JobStatusEvent` is good for job transitions.
  - `AuditLog` is currently unused for admin/customer/provider override actions.
  - `MessageEvent` captures template sends but misses interactive sends.
- Observability:
  - logs are mostly `console.*`; no evidence of trace IDs beyond a few request IDs.
  - no outbox, no dead-letter, no alert hooks in code.
- Supportability:
  - admin views for matches, payments, disputes, and messages are helpful.
  - absence of full audit trail and mediated message history limits support diagnostics.

## 10. Security and Control Observations

- Positive controls confirmed:
  - session cookie is server-managed and route auth is enforced in `field-service/lib/auth.ts` and `field-service/proxy.ts`
  - `/api/auth/link` now binds linking to the verified session phone
  - WhatsApp webhook verifies Meta `X-Hub-Signature-256`
  - payment webhook verifies signature before processing
  - attachment proxy enforces authenticated access
- Gaps:
  - inbound replay/idempotency protection missing
  - customer/provider/admin server actions generally do not create audit records
  - marketing lead rate limiting is in-memory only and not production-grade
  - no evidence of webhook replay nonce/timestamp enforcement beyond signature validation

## 11. Recommendations

### Immediate blockers
1. Add inbound WhatsApp idempotency keyed on Meta message ID before any business mutation.
2. Remove direct provider transition to `COMPLETED`; require customer completion confirmation.
3. Centralize booking cancellation/reschedule logic into services with status, messaging, refund-policy, and audit handling.
4. Decide and document the Phase 1 position on mediated messaging relay, then either implement the minimum viable relay or remove it from the authoritative MVP.
5. Bridge marketing onboarding to field-service identity/application records or explicitly isolate it as pre-platform lead capture.

### Pre-launch hardening
1. Add reminder/follow-up dedupe using `MessageEvent`.
2. Log interactive WhatsApp sends into `MessageEvent`.
3. Add durable quote expiry normalization.
4. Implement or document payout creation flow.
5. Replace in-memory marketing rate limiting with shared storage.

### Operational resilience improvements
1. Use `AuditLog` for refund, dispute update, cancellation, and manual corrections.
2. Add structured error/reporting hooks for webhook failures and cron failures.
3. Add reconciliation views for unmatched requests, orphan bookings/jobs, stale pending quotes, and failed payment states.

### Spec/documentation cleanup
1. Normalize payment policy across spec, README, and launch-mode implementation.
2. Update field-service README to marketplace language and current route model.
3. Record Janice-specific scenarios or explicitly state they are not yet codified in OpenBrain.

### Technical debt and architecture improvements
1. Formalize booking/job lifecycle services instead of spreading server actions across pages.
2. Introduce durable outbox/retry for external messaging.
3. Convert high-value journey mutations to explicit use-case services with tests.

## 12. Suggested Remediation Order

### Phase 1 — journey correctness
1. Inbound WhatsApp idempotency
2. Completion confirmation enforcement
3. Booking cancel/reschedule orchestration
4. Quote expiry normalization

### Phase 2 — support and trust
1. AuditLog adoption
2. MessageEvent coverage for interactive sends
3. Reminder/follow-up dedupe
4. Mediated messaging relay decision and implementation/removal

### Phase 3 — funnel and policy alignment
1. Marketing onboarding integration
2. Payment policy normalization
3. Payout lifecycle completion
4. Documentation cleanup

## 13. Appendix

### Routes inspected
- `field-service/app/api/auth/session/route.ts`
- `field-service/app/api/auth/link/route.ts`
- `field-service/app/api/customer/bookings/route.ts`
- `field-service/app/api/customer/preferences/route.ts`
- `field-service/app/api/customer/services/[serviceId]/route.ts`
- `field-service/app/api/customer/slots/route.ts`
- `field-service/app/api/quotes/[token]/route.ts`
- `field-service/app/api/technician/quotes/route.ts`
- `field-service/app/api/technician/jobs/[id]/status/route.ts`
- `field-service/app/api/technician/jobs/[id]/extras/route.ts`
- `field-service/app/api/technician/jobs/[id]/photo/route.ts`
- `field-service/app/api/technician/earnings/route.ts`
- `field-service/app/api/technician/earnings/statement/route.ts`
- `field-service/app/api/webhooks/whatsapp/route.ts`
- `field-service/app/api/webhooks/payments/route.ts`
- `field-service/app/api/cron/match-leads/route.ts`
- `field-service/app/api/cron/reminders/route.ts`
- `field-service/app/api/cron/follow-up/route.ts`
- `field-service/app/api/cron/slots/route.ts`
- `marketing/app/api/leads/route.ts`

### Key modules inspected
- `field-service/lib/auth.ts`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/quotes.ts`
- `field-service/lib/payments.ts`
- `field-service/lib/jobs.ts`
- `field-service/lib/slotting.ts`
- `field-service/lib/whatsapp-bot.ts`
- `field-service/lib/whatsapp.ts`
- `field-service/lib/whatsapp-interactive.ts`
- `field-service/lib/whatsapp-policy.ts`
- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/whatsapp-flows/status.ts`

### Key models inspected
- `Customer`
- `Address`
- `Provider`
- `ProviderApplication`
- `JobRequest`
- `Lead`
- `Match`
- `InspectionSlot`
- `Quote`
- `Booking`
- `Job`
- `JobStatusEvent`
- `ExtraWork`
- `Payment`
- `ProviderPayout`
- `Invoice`
- `Review`
- `Dispute`
- `MessageEvent`
- `Conversation`
- `AuditLog`

### Tests reviewed
- `field-service/__tests__/api/auth.test.ts`
- `field-service/__tests__/api/health.test.ts`
- `field-service/__tests__/api/technician-quotes.test.ts`
- `field-service/__tests__/api/webhooks-security.test.ts`
- `field-service/__tests__/api/webhooks.test.ts`
- `field-service/__tests__/lib/jobs.test.ts`
- `field-service/__tests__/lib/matching-engine.test.ts`
- `field-service/__tests__/lib/quotes.test.ts`
- `field-service/__tests__/lib/slotting.test.ts`
- `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`
- `field-service/__tests__/lib/whatsapp-policy.test.ts`

### Commands run
- `find docs field-service/docs marketing/docs -type f ...`
- `sed -n '1,220p' docs/architecture/marketplace-model.md`
- `sed -n '1,220p' field-service/docs/superpowers/plans/2026-03-31-whatsapp-marketplace-journeys.md`
- `sed -n '1,220p' field-service/docs/superpowers/specs/2026-03-31-provider-quote-earnings-design.md`
- `sed -n '1,260p' docs/release-readiness-tracker.md`
- `sed -n '1,260p' docs/release-runbook.md`
- `cd field-service && npm test`
- `cd field-service && npm run build`
- `cd marketing && npm test`
- `cd marketing && npm run build`

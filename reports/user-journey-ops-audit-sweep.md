# User Journey and Operations Assurance Sweep

## 1. Executive Summary

### Overall judgement

Plug-A-Pro / ServiceMen has a materially implemented marketplace core, a meaningful admin control surface, and enough workflow depth to demonstrate the intended customer and provider journeys. It does **not** yet have a production-capable operations model.

Current operating maturity: **pre-production / emerging ops maturity**.

Current readiness statement: **ops can monitor and partially intervene, but cannot safely run the platform end-to-end without off-platform coordination and engineering support**.

### Biggest risks

- **P0 Critical:** audit trails exist but are often not reconstructable at field level because many admin actions only log `{ id }` as the post-change payload, and pre-change snapshots are optional. Evidence: `field-service/lib/crud-action.ts:73-79`, `field-service/lib/crud-action.ts:151-172`.
- **P0 Critical:** there is no formal cross-queue case lifecycle for ownership, notes, close-out, reopen, or structured outcomes. Most queue pages stop at claim/release plus deep links. Evidence: `field-service/app/(admin)/admin/quotes/page.tsx:261-289`, `field-service/app/(admin)/admin/field-exceptions/page.tsx:244-269`, `field-service/app/(admin)/admin/payments/page.tsx:367-405`.
- **P0 Critical:** transactional admin CRUD is incomplete for bookings, quotes, payments, disputes, and messages. Ops can inspect many records, but cannot safely correct many exceptions inside the product.
- **P1 High:** permission boundaries are coarse and cumulative. `OPS`, `FINANCE`, `TRUST`, `ADMIN`, and `OWNER` are treated as a hierarchy rather than a strict least-privilege matrix. Evidence: `field-service/lib/auth.ts:102-166`, `field-service/lib/crud-action.ts:26-37`.
- **P1 High:** static/reference control is only partial. Categories and locations are DB-backed and manageable, but most operational rules remain code or env backed: settings, reason codes, communication templates, fee rules, and workflow configuration. Evidence: `field-service/app/(admin)/admin/settings/page.tsx:1-73`, `field-service/app/(admin)/admin/messages/page.tsx:1-92`.

### Top critical gaps

1. Durable case management for ops exceptions is missing.
2. Auditability is partial and often inadequate for disputes, support reviews, or compliance reconstruction.
3. Booking, payment, quote, and message interventions are underpowered for real support operations.
4. Customer and provider correction tooling is incomplete for addresses, duplicates, identity corrections, and communication history.
5. Sensitive data export and privileged reads are not finely segmented by role.

## 2. Scope and Method

### Sources reviewed

- OpenBrain project context, search results, and context packs for Plug-A-Pro / ServiceMen
- Repository docs and prior sweeps
- Prisma schema
- Admin routes, server actions, service-layer logic, queue pages, and export APIs
- Automated test, build, and lint runs

### OpenBrain context used

OpenBrain was queried first for project context, user journeys, admin/ops assumptions, deferred items, audit expectations, and CRUD/exception-handling history. It confirmed that:

- the platform is being shaped as a queue-first operations model
- prior remediation added audit scaffolding and queue ownership patterns
- prior documentation about admin flows had been regenerated from implementation
- several ops hardening items remained explicitly deferred

OpenBrain was useful but incomplete. Some calls timed out or were unavailable, including deeper decision-history retrieval. This report therefore treats OpenBrain as contextual guidance, not as authoritative proof of implemented state.

### Repo areas inspected

- `field-service/prisma/schema.prisma`
- `field-service/lib/auth.ts`
- `field-service/lib/crud-action.ts`
- `field-service/lib/audit.ts`
- `field-service/lib/bookings.ts`
- `field-service/lib/jobs.ts`
- `field-service/lib/flags.ts`
- `field-service/app/(admin)/admin/*`
- `field-service/app/api/admin/*`
- `field-service/app/api/webhooks/payments/route.ts`
- `docs/*`
- `reports/platform-responsibility-and-user-journey-sweep.md`

### What was verified statically vs executed

Static inspection:

- schema, role checks, admin pages, actions, exports, webhook behavior, and docs

Executed locally:

- `cd field-service && npm test` -> passed
- `cd field-service && npm run build` -> passed
- `cd field-service && npm run lint` -> warning only
- `cd marketing && npm test` -> passed
- `cd marketing && npm run build` -> passed
- `cd marketing && npm run lint` -> failed

Not executed:

- authenticated browser end-to-end admin/customer/provider journeys
- live OTP, WhatsApp, payment-provider, or production telemetry verification

### Localized corrections applied during this sweep

Two low-risk operational corrections were implemented because they were obvious defects affecting admin safety:

1. `field-service/app/(admin)/admin/providers/actions.ts`
   Corrected `SetProviderKycSchema` to use the actual Prisma `KycStatus` enum values.
2. `field-service/app/(admin)/admin/technicians/[id]/page.tsx`
   Corrected provider profile action visibility so activate/deactivate controls appear when CRUD is enabled, and aligned the KYC dropdown values to the real enum.

These were narrow corrective fixes. No broad business-behavior change was made.

## 3. Source Inventory

| Path / source | Type | Apparent authority | Subject area | Relevance |
| --- | --- | --- | --- | --- |
| OpenBrain context pack + project memories | Project memory | Medium | Prior decisions, deferred ops work, audit assumptions | High |
| `README.md` | Repo overview | Medium | Product framing, app split, go-live checklist | Medium |
| `docs/architecture/marketplace-model.md` | Architecture baseline | High | Core marketplace model and intended lifecycle | High |
| `docs/admin-crud-rollout.md` | Delivery record | High for delivered scopes, medium for follow-ups | Admin CRUD rollout status, flags, deferred items | High |
| `docs/PlugAPro-Ops-Implementation-Plan.md` | Advisory plan | Medium | Intended ops hardening roadmap | High |
| `docs/audits/2026-04-20-periodic-platform-assurance-sweep.md` | Prior audit | Medium | Broader assurance baseline, some stale runtime results | Medium |
| `reports/platform-responsibility-and-user-journey-sweep.md` | Prior sweep | Medium | Marketplace responsibility boundaries and trust model | Medium |
| `field-service/prisma/schema.prisma` | Canonical implementation source | High | Domain model, audit tables, queue entities | High |
| `field-service/lib/auth.ts` | Canonical implementation source | High | Role model, session model, route guards | High |
| `field-service/lib/crud-action.ts` | Canonical implementation source | High | Mutation controls, feature flags, audit write behavior | High |
| `field-service/lib/audit.ts` | Canonical implementation source | High | Audit write shape | High |
| `field-service/app/(admin)/admin/*` | Canonical implementation source | High | Actual ops tooling available to admin users | High |

## 4. Implemented User Journey Model

### Customer journey

Implemented customer path is substantial:

1. customer identity can begin as WhatsApp-first and later link to authenticated PWA identity. Evidence: `field-service/lib/auth.ts:183-220`.
2. customer records, job requests, quotes, bookings, payments, messages, disputes, and review-related entities exist in the schema. Evidence: `field-service/prisma/schema.prisma:17-95`, `field-service/prisma/schema.prisma:283-554`, `field-service/prisma/schema.prisma:812-885`.
3. booking detail pages, quote approval, payment records, and job execution state all exist.

What is implemented well:

- intake and identity linking
- service request capture
- quote and booking data model
- booking/job/payment lifecycle persistence
- complaint/dispute object presence

What is only partial:

- structured customer address maintenance in admin tooling
- customer-visible and ops-visible communication history linkage
- duplicate-account handling beyond merge tooling for customer master records
- operational handling when journeys fail midstream

### Provider journey

Implemented provider path is also substantial:

1. provider onboarding/application and profile models exist.
2. provider status, KYC status, certifications, equipment, notes, strikes, and service-area structures exist. Evidence: `field-service/prisma/schema.prisma:157-226`, `field-service/prisma/schema.prisma:1372-1405`.
3. provider detail page supports profile edits, status changes, KYC updates, notes, certifications, and equipment sections. Evidence: `field-service/app/(admin)/admin/technicians/[id]/page.tsx:362-399`.

What is implemented well:

- provider record CRUD basics
- onboarding/review data structures
- active job, match, quote, and quality-related attributes in schema

What is only partial:

- structured provider suspension/archive reason persistence
- duplicate-provider handling
- reassignment after provider-side failure
- payment/payout exception servicing

### Admin / operations journey

Admin ops is implemented as a queue-first console:

- validation queue
- dispatch console
- quote approvals queue
- bookings detail
- field exceptions queue
- payments queue
- disputes queue
- customers/providers/team/categories/locations

Strengths:

- queues have clear read visibility
- claim/release ownership is present in several operational queues
- some mutation flags allow staged rollout
- dispatch has ranking and override mechanics

Weaknesses:

- queue close-out is not formalized
- timelines and case notes are inconsistent or absent
- interventions are often only partial
- audit visibility inside the UI is inconsistent

## 5. Operations Serviceability Assessment

### How ops can currently support the platform

Ops can currently:

- monitor queue backlogs and ownership
- claim or release work in validation, dispatch, quotes, field exceptions, payments, disputes, applications
- inspect customer, provider, booking, payment, dispute, and some audit data
- make selected customer/provider corrections when flags are enabled
- perform limited dispatch overrides and refunds

The current admin surface is therefore more than a demo. It provides real monitoring and some intervention capability.

### Where ops are blocked

Ops are materially blocked in real-world exception handling because the platform lacks a complete case model:

- `field-service/app/(admin)/admin/field-exceptions/page.tsx:244-269` offers claim/release plus deep links, but not resolve/close/reopen or structured outcomes.
- `field-service/app/(admin)/admin/quotes/page.tsx:261-289` offers claim/release and open-page links, but not quote correction, expiry override, dispute capture, or close-out.
- `field-service/app/(admin)/admin/payments/page.tsx:367-405` offers claim/release and refunds for paid records, but not reconciliation, adjustment, retry, write-off, or structured investigation.
- `field-service/app/(admin)/admin/bookings/[id]/page.tsx:543-575` only exposes `Mark as Paid` and `Cancel Booking`.
- `field-service/app/(admin)/admin/messages/page.tsx:16-35` is a read-only list of the last 100 outbound events.

### Where support depends on unsafe or manual work

Support currently depends on unsafe or incomplete workarounds in several areas:

- many corrections would require direct DB edits or engineering assistance
- audit reconstruction is often impossible because field deltas and reasons are not reliably captured
- some operational rules still live in env vars, code, or implicit status strings rather than admin-manageable reference data
- webhook failures can be suppressed from retry by returning HTTP 200 on handler errors. Evidence: `field-service/app/api/webhooks/payments/route.ts:89-92`

**Serviceability judgement:** the platform is service-observable, but not yet service-operable at production standard.

## 6. CRUD Capability Assessment

Detailed ratings are in `reports/ops-crud-capability-matrix.md`.

### Static / reference data

Adequately or materially supported today:

- categories: DB-backed CRUD with legacy fallback. Evidence: `field-service/app/(admin)/admin/categories/page.tsx:11-25`
- location taxonomy: create/update/deactivate/delete via admin surface when flag enabled. Evidence: `field-service/app/(admin)/admin/locations/page.tsx:36-157`
- admin team users: invite, role change, deactivate/reactivate, gated to owner. Evidence: `field-service/app/(admin)/admin/team/page.tsx:47-177`

Weak or missing:

- feature-flag management UI
- reason-code registry
- booking/quote/dispute/payment status reference data
- cancellation reasons
- dispute categories
- communication templates
- fee / pricing rules
- platform settings beyond read-only env display. Evidence: `field-service/app/(admin)/admin/settings/page.tsx:21-73`

### Customer / client information

Supported:

- customer create/update/basic suspend/archive/merge/purge flows
- customer notes
- WhatsApp preference audit sub-history

Weak or partial:

- address CRUD is not operationally complete; admin actions only maintain legacy free-text `address` on `Customer`, while structured `Address[]` exists in schema. Evidence: `field-service/prisma/schema.prisma:39-55`, `field-service/app/(admin)/admin/customers/actions.ts:19-34`, `field-service/app/(admin)/admin/customers/actions.ts:107-114`, `field-service/app/(admin)/admin/customers/actions.ts:156-164`
- block reason is written into `notes`, not dedicated `blockedReason`/`blockedAt`. Evidence: `field-service/app/(admin)/admin/customers/actions.ts:176-195`
- customer detail page does not include addresses, conversations, or active case rollups. Evidence: `field-service/app/(admin)/admin/customers/[id]/page.tsx:65-101`

### Key transactional entities

Strongest:

- read visibility for bookings, disputes, payments, jobs, queue assignments
- dispatch ranking and some override capability
- job status transition history is more mature than most areas. Evidence: `field-service/prisma/schema.prisma:475-488`

Weakest:

- bookings: no admin reschedule or structured manual correction flow
- quotes: no admin amend/expire/void workflow
- payments: no structured reconciliation/write-off/retry workflow
- disputes: no taxonomy, evidence workflow, or decision template
- messages: no inbound/outbound thread workspace, resend, or retry

## 7. Auditability and Traceability Assessment

Detailed ratings are in `reports/auditability-traceability-matrix.md`.

### What is logged

The platform does have explicit audit structures:

- `AuditLog` captures actor, role, action, entity type, entity id, before/after JSON, IP, user agent, timestamp. Evidence: `field-service/prisma/schema.prisma:904-918`
- `AdminAuditEvent` captures admin-centric audit rows with similar core fields plus metadata. Evidence: `field-service/prisma/schema.prisma:1251-1268`
- `crudAction()` guarantees audit writes inside the same transaction as wrapped admin mutations. Evidence: `field-service/lib/crud-action.ts:145-176`
- job execution has `JobStatusEvent` with actor and status transitions. Evidence: `field-service/prisma/schema.prisma:475-488`

### What is not reliably logged

The main weakness is not the absence of tables. It is the incompleteness of what gets written:

- `crudAction()` writes `after` using the mutation return payload, not a guaranteed post-update row snapshot. Evidence: `field-service/lib/crud-action.ts:146-172`
- many mutations return only `{ id }`, making field-level after-state unreconstructable.
- `before` is optional and not consistently supplied.
- reason codes and justifications are not uniformly stored in audit structures.
- source workflow / channel is not formalized.
- downstream side effects such as notification sends, retry attempts, or external syncs are not consistently linked.

### UI traceability weaknesses

Operational audit visibility is also inconsistent in the admin UI:

- validation queue reads `entityType: 'job_request'` even though queue actions write `entity: 'JobRequest'`. Evidence: `field-service/app/(admin)/admin/validation/page.tsx:84-89`, `field-service/app/(admin)/admin/validation/page.tsx:108-123`
- dispatch queue has the same mismatch. Evidence: `field-service/app/(admin)/admin/dispatch/page.tsx:278-283`
- quote queue reads lowercase `quote` while actions commonly log `Quote`. Evidence: `field-service/app/(admin)/admin/quotes/page.tsx:291-305`

### Consequence

This is a serious operational control weakness. During support review, dispute handling, or internal investigation, the system will often show that something happened, but not enough to explain **exactly what changed, why, and what side effects followed**.

## 8. Exception Handling Assessment

Detailed scenario coverage is in `reports/exception-scenario-coverage.md`.

### Supported at least partially

- customer block/suspend/archive/merge
- provider status changes and trust notes
- queue claiming and reassignment ownership
- manual dispatch override
- paid-payment refund initiation
- dispute status/resolution note update

### Weak or uncatered

- customer address correction using structured address records
- booking reschedule by ops after failed coordination
- quote correction after wrong amount/scope
- duplicate provider handling
- payment mismatch reconciliation
- inbound communication recovery after WhatsApp or support-call interventions
- workflow recovery after partially failed webhook/process steps
- formal handling of stale/orphaned statuses

### Overall judgement

The platform handles several exception primitives, but it does not yet support a robust real-world exception operating model. It remains too dependent on implied process rather than explicit in-product controls.

## 9. Role and Permission Assessment

### What exists

- active admin access is backed by `AdminUser`
- owner-only team management page uses `requireRole(['OWNER'])`. Evidence: `field-service/app/(admin)/admin/team/page.tsx:47-50`
- selected actions narrow to trust/admin/owner, for example provider KYC update. Evidence: `field-service/app/(admin)/admin/providers/actions.ts:319-338`

### Core weaknesses

1. **Cumulative hierarchy instead of strict capability separation**
   `OPS < FINANCE < TRUST < ADMIN < OWNER` is treated as interchangeable privilege escalation. Evidence: `field-service/lib/auth.ts:102-166`, `field-service/lib/crud-action.ts:26-37`
2. **Broad read access**
   Many pages use `requireAdmin()` instead of `requireRole()`, making read access wider than a least-privilege support model would normally allow.
3. **Support vs configuration separation is weak**
   There is little distinction between support actions, trust actions, finance actions, and configuration-change rights.
4. **Sensitive export controls are too broad**
   customer and provider CSV exports require only `requireAdmin()` plus a flag, not finer-grained export privilege. Evidence: `field-service/app/api/admin/customers/export/route.ts:9-14`, `field-service/app/api/admin/providers/export/route.ts:9-14`

### Permission judgement

The role model is better than having no role model, but it is not yet mature enough for production operations with sensitive PII, payment issues, and trust/safety interventions.

## 10. Gap Analysis

### Finding 1

- **Severity:** P0 Critical
- **Title:** Admin audit logs do not reliably capture reconstructable field changes
- **Affected journey / domain:** All admin and ops mutations
- **What is expected:** Every important admin action should record actor, timestamp, entity, before/after values, and enough detail to explain what changed.
- **What exists today:** `crudAction()` writes audit rows atomically, but many actions return only `{ id }`, and `before` snapshots are optional.
- **Evidence:** `field-service/lib/crud-action.ts:73-79`, `field-service/lib/crud-action.ts:145-176`, `field-service/app/(admin)/admin/customers/actions.ts:88-119`, `field-service/app/(admin)/admin/providers/actions.ts:230-253`
- **Risk / business impact:** disputes, support escalations, compliance reviews, and privileged-action investigations cannot be reconstructed reliably.
- **Recommendation:** require structured diff capture in all privileged mutations, make reason capture mandatory for high-risk actions, and log downstream side effects as linked events.
- **Priority:** Immediate pre-launch blocker

### Finding 2

- **Severity:** P0 Critical
- **Title:** No formal case lifecycle exists for operational exceptions
- **Affected journey / domain:** Dispatch, validation, quotes, payments, disputes, field exceptions
- **What is expected:** Queue items should support claim, note, resolve, reopen, outcome code, and linked activity timeline.
- **What exists today:** Most queues support claim/release only, with ad hoc action buttons.
- **Evidence:** `field-service/app/(admin)/admin/field-exceptions/page.tsx:244-269`, `field-service/app/(admin)/admin/quotes/page.tsx:261-289`, `field-service/app/(admin)/admin/payments/page.tsx:367-405`
- **Risk / business impact:** ops cannot safely close the loop on exceptions, and resolution knowledge is lost in off-platform communication.
- **Recommendation:** introduce first-class case, case-event, and case-note primitives across operational queues.
- **Priority:** Immediate pre-launch blocker

### Finding 3

- **Severity:** P0 Critical
- **Title:** Transactional admin CRUD is insufficient for real support operations
- **Affected journey / domain:** Bookings, quotes, payments, disputes, messages
- **What is expected:** Ops should be able to safely correct, override, reschedule, cancel, retry, or reconcile key records with validation and audit.
- **What exists today:** booking actions are minimal; payments and disputes are partial; messages are read-only.
- **Evidence:** `field-service/app/(admin)/admin/bookings/[id]/page.tsx:543-575`, `field-service/app/(admin)/admin/disputes/page.tsx:337-368`, `field-service/app/(admin)/admin/messages/page.tsx:16-35`
- **Risk / business impact:** normal failure handling moves outside the platform into Slack, WhatsApp, or direct database intervention.
- **Recommendation:** add structured admin workflows for reschedule, correction, override, reconciliation, resend/retry, and case-linked notes.
- **Priority:** Immediate pre-launch blocker

### Finding 4

- **Severity:** P1 High
- **Title:** Customer data maintenance is incomplete and partly inconsistent with the schema
- **Affected journey / domain:** Customer support and data correction
- **What is expected:** Ops should manage customer identity, addresses, contact corrections, flags, history, and duplicates against the canonical data model.
- **What exists today:** customer CRUD edits free-text address only; block reasons are written to `notes`; detail page omits structured addresses and conversation history.
- **Evidence:** `field-service/prisma/schema.prisma:39-55`, `field-service/app/(admin)/admin/customers/actions.ts:107-114`, `field-service/app/(admin)/admin/customers/actions.ts:176-195`, `field-service/app/(admin)/admin/customers/[id]/page.tsx:65-101`
- **Risk / business impact:** customer corrections are error-prone and support context is fragmented.
- **Recommendation:** make structured address CRUD first-class, persist block metadata into dedicated fields, and surface conversations/open cases on customer profiles.
- **Priority:** High

### Finding 5

- **Severity:** P1 High
- **Title:** Provider status and trust interventions do not persist full operational context
- **Affected journey / domain:** Provider support, trust and safety
- **What is expected:** status/KYC/suspension actions should capture reasons, state diffs, and operator-visible history.
- **What exists today:** provider status action requires a reason in the form, but the mutation does not persist it to `suspendedReason`, `archiveReason`, or a note trail.
- **Evidence:** `field-service/prisma/schema.prisma:195-203`, `field-service/app/(admin)/admin/providers/actions.ts:14-18`, `field-service/app/(admin)/admin/providers/actions.ts:229-253`, `field-service/app/(admin)/admin/technicians/[id]/page.tsx:362-382`
- **Risk / business impact:** provider enforcement decisions are weakly attributable and hard to justify later.
- **Recommendation:** persist reasons structurally, emit explicit provider-lifecycle events, and require trust notes for high-risk status changes.
- **Priority:** High

### Finding 6

- **Severity:** P1 High
- **Title:** Audit and activity panels can silently miss relevant admin events
- **Affected journey / domain:** Queue supervision and post-action review
- **What is expected:** queue activity views should reflect the actual audit records written by queue actions.
- **What exists today:** entity-type casing mismatches cause some queue pages to query a different entity key than the one written by mutations.
- **Evidence:** `field-service/app/(admin)/admin/validation/page.tsx:84-89`, `field-service/app/(admin)/admin/validation/page.tsx:108-123`, `field-service/app/(admin)/admin/dispatch/page.tsx:278-283`, `field-service/app/(admin)/admin/quotes/page.tsx:291-305`
- **Risk / business impact:** operators may believe no recent action occurred when it actually did.
- **Recommendation:** normalize audit entity naming to enums/constants and fix existing queries.
- **Priority:** High

### Finding 7

- **Severity:** P1 High
- **Title:** Permission model is too coarse for support, trust, finance, and PII export boundaries
- **Affected journey / domain:** Admin governance
- **What is expected:** least-privilege, action-specific permission separation, especially for exports and sensitive edits.
- **What exists today:** cumulative role hierarchy plus broad `requireAdmin()` reads; exports are available to any admin-role holder when flags are on.
- **Evidence:** `field-service/lib/auth.ts:138-166`, `field-service/app/api/admin/customers/export/route.ts:9-14`, `field-service/app/api/admin/providers/export/route.ts:9-14`
- **Risk / business impact:** overpowered support roles increase privacy, fraud, and accidental-misuse risk.
- **Recommendation:** split read/update/export/configure/refund/trust powers into explicit permissions and audit privileged views.
- **Priority:** High

### Finding 8

- **Severity:** P1 High
- **Title:** Static/reference-data management is incomplete beyond categories and locations
- **Affected journey / domain:** Configuration safety and operational consistency
- **What is expected:** operational rules should be managed as controlled data with audit, validation, and lifecycle controls.
- **What exists today:** categories and locations are manageable, but settings are read-only and many controls remain code/env based.
- **Evidence:** `field-service/app/(admin)/admin/categories/page.tsx:11-25`, `field-service/app/(admin)/admin/locations/page.tsx:36-157`, `field-service/app/(admin)/admin/settings/page.tsx:21-73`
- **Risk / business impact:** rule changes require engineering intervention or risky manual edits, slowing incident response and increasing drift.
- **Recommendation:** move reason codes, communication templates, fee rules, operational statuses, and configurable thresholds into governed reference data.
- **Priority:** High

### Finding 9

- **Severity:** P1 High
- **Title:** Payment and communication exception handling is materially underpowered
- **Affected journey / domain:** Finance ops and support recovery
- **What is expected:** ops should be able to reconcile mismatches, retry failed messaging, and preserve recoverable webhook behavior.
- **What exists today:** payments queue supports refund only; messages page is outbound-read-only; payment webhook handler returns 200 on handler error.
- **Evidence:** `field-service/app/(admin)/admin/payments/page.tsx:367-405`, `field-service/app/(admin)/admin/messages/page.tsx:16-35`, `field-service/app/api/webhooks/payments/route.ts:89-92`
- **Risk / business impact:** transient failures can be hidden, retries can be lost, and finance/support issues require manual work.
- **Recommendation:** add reconciliation, retry, resend, failure-triage, and replay-safe recovery workflows.
- **Priority:** High

### Finding 10

- **Severity:** P2 Medium
- **Title:** Operational readiness depends on feature-flag rollout, not only code presence
- **Affected journey / domain:** Deployment and launch operations
- **What is expected:** launch-critical admin capabilities should have a controlled rollout plan and visible readiness checklist.
- **What exists today:** mutation flags are seeded disabled by default; missing enablement leaves queues read-only even when code exists.
- **Evidence:** `field-service/scripts/seed-flags.ts:19-72`, `field-service/scripts/seed-flags.ts:92-95`, `field-service/lib/flags.ts:11-37`, `docs/admin-crud-rollout.md:23-43`
- **Risk / business impact:** teams can overestimate readiness based on screens that render but cannot mutate.
- **Recommendation:** create an ops-launch checklist covering flags, roles, data backfills, and smoke verification.
- **Priority:** Medium

## 11. Recommendations

### Immediate blockers

1. Implement first-class case management across queues.
2. Upgrade audit logging to capture required before/after/reason/side-effect detail.
3. Close the CRUD gaps for bookings, quotes, payments, disputes, and messages.
4. Tighten role boundaries and privilege segmentation for sensitive reads, exports, and finance/trust actions.

### Pre-launch controls

1. Make structured customer address and communication history operationally manageable.
2. Persist provider status-change reasons and trust notes structurally.
3. Normalize audit entity naming and repair queue activity feeds.
4. Add a launch checklist for feature flags, admin backfills, and queue mutation enablement.

### Medium-term hardening

1. Move operational reason codes, cancellation reasons, dispute categories, fee rules, and templates into admin-governed reference data.
2. Add message retry/resend and payment reconciliation tooling.
3. Add operator performance, queue outcome, and exception analytics.
4. Add authenticated browser smoke tests for admin/customer/provider happy and unhappy paths.

### Architectural improvements

1. Introduce a unified case/event/note model above queue assignments.
2. Replace cumulative role logic with explicit capability grants.
3. Standardize auditable service-layer mutations around typed entity constants and diff capture.
4. Separate support tooling from configuration tooling and from engineering-only powers.

## 12. Suggested Remediation Order

### Phase 0: Control foundations

1. Audit diff capture and reason-code discipline
2. Entity-name normalization for audit/event lookup
3. Role/capability matrix design

### Phase 1: Core ops operability

1. Case lifecycle: claim, note, resolve, reopen
2. Queue detail timelines and linked case notes
3. Booking, quote, dispute, and payment intervention workflows

### Phase 2: Data stewardship

1. Structured customer address and profile correction
2. Provider status/KYC/trust enforcement audit completion
3. Duplicate detection and merge tooling for provider and customer edge cases

### Phase 3: Controlled configuration

1. Reason registries
2. communication templates
3. fee/pricing rules
4. workflow lookups and operational settings

### Phase 4: Observability and resilience

1. Payment/message reconciliation and retry tooling
2. queue outcome analytics
3. browser assurance and rollback-ready release gates

## 13. Appendix

### Implementation inventory

| Area | File path(s) | Main route / service / model | Purpose | Actor(s) | CRUD capability | Auditability status | Risk notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Auth and role control | `field-service/lib/auth.ts` | `requireAdmin`, `requireRole`, `getSession` | session and role enforcement | customer, provider, admin | Read enforcement only | Partial | coarse cumulative hierarchy |
| Audit wrapper | `field-service/lib/crud-action.ts` | `crudAction()` | gated admin mutations + atomic audit | admin roles | Wrapper for create/update/delete-style actions | Partial | after-state often too thin |
| Audit storage | `field-service/lib/audit.ts`, `field-service/prisma/schema.prisma` | `AuditLog`, `AdminAuditEvent` | audit persistence | system/admin | Create/read | Partial | no guaranteed reason/delta discipline |
| Customer admin | `field-service/app/(admin)/admin/customers/*` | customers list/detail/actions | support customer records | ops, trust, admin | create/update/block/suspend/archive/merge/purge partial | Partial | structured addresses/conversations absent |
| Provider admin | `field-service/app/(admin)/admin/providers/*`, `field-service/app/(admin)/admin/technicians/[id]/page.tsx` | provider detail/actions | support provider lifecycle | ops, trust, admin | create/update/status/KYC/notes/certs/equipment partial | Partial | reason persistence weak |
| Categories | `field-service/app/(admin)/admin/categories/*` | categories page/client | reference data management | admin | read/create/update/deactivate partial | Partial | broader taxonomy still missing |
| Locations | `field-service/app/(admin)/admin/locations/*` | location taxonomy | service-area reference management | admin | read/create/update/deactivate/delete | Partial | good relative maturity |
| Team admin | `field-service/app/(admin)/admin/team/*` | team page/actions | admin-user lifecycle | owner | invite/update/deactivate/reactivate/revoke | Partial | better role gating than most areas |
| Validation queue | `field-service/app/(admin)/admin/validation/page.tsx` | validation queue | review new requests | ops | claim/release/promote/cancel | Partial | no formal case close-out |
| Dispatch queue | `field-service/app/(admin)/admin/dispatch/page.tsx` | dispatch console | rank and assign providers | ops | claim/release/auto-assign/rerank/override | Partial | no durable case model |
| Quotes queue | `field-service/app/(admin)/admin/quotes/page.tsx` | quote approvals | monitor pending quote approvals | ops | claim/release only | Weak | no correction/resolve workflow |
| Booking admin | `field-service/app/(admin)/admin/bookings/[id]/page.tsx` | booking detail | booking support | ops | mark paid/cancel only | Partial | no reschedule or correction |
| Payments queue | `field-service/app/(admin)/admin/payments/page.tsx` | payments queue | finance monitoring | finance, admin | claim/release/refund only | Partial | reconciliation missing |
| Disputes queue | `field-service/app/(admin)/admin/disputes/page.tsx` | disputes queue | complaint review | trust, admin | claim/release/status/resolution note | Partial | no taxonomy/evidence workflow |
| Field exceptions | `field-service/app/(admin)/admin/field-exceptions/page.tsx` | field exceptions queue | live job exception handling | ops | claim/release only | Weak | no resolve/reopen flow |
| Messages | `field-service/app/(admin)/admin/messages/page.tsx` | messages log | outbound event visibility | ops | read only | Weak | no thread/retry/recovery tooling |
| Settings | `field-service/app/(admin)/admin/settings/page.tsx` | settings page | configuration visibility | admin | read only | None | operational config not governed in app |

### Tests reviewed or run

- `field-service`: tests passed, build passed, lint warning only
- `marketing`: tests passed, build passed, lint failed

### Commands executed

```bash
git status --short
cd field-service && npm test
cd field-service && npm run build
cd field-service && npm run lint
cd marketing && npm test
cd marketing && npm run build
cd marketing && npm run lint
rg --files
rg -n "model ..."
nl -ba <file> | sed -n '<range>p'
```

### Limitations

- No authenticated browser walkthrough was run.
- No live WhatsApp, OTP, PSP, or production telemetry systems were exercised.
- Some OpenBrain memory retrieval calls timed out, so historical decision coverage is incomplete.
- This report therefore has **high confidence on implementation structure** and **medium confidence on live runtime behavior**.

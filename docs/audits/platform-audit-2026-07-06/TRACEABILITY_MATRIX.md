# Traceability Matrix — Plug A Pro Platform Audit (2026-07-06)

Can each critical user action be observed end to end? Evidence is from code inspection on audit day.

**Legend:** ✅ captured with evidence · ◐ partial · ❌ NO — gap

| # | Flow | Initiator captured | What/when captured | DB change captured | External call captured | External response captured | User notified + status captured | Admin visible | Log correlation | Failure state visible | Retry / recovery |
|---|------|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| 1 | Customer creates service request | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ |
| 2 | Customer confirms booking | ◐ | ✅ | ✅ | ◐ | ◐ | ◐ | ✅ | ◐ | ◐ | ◐ |
| 3 | Customer pays | ◐ | ✅ | ✅ | ◐ | ◐ | ✅ | ✅ | ◐ | ✅ | ✅ |
| 4 | WhatsApp confirmation sent | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ❌ |
| 5 | Provider accepts job | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 6 | Technician starts job | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ◐ | ◐ |
| 7 | Technician completes job | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 8 | Invoice / receipt generated | ◐ | ✅ | ✅ | ✅ | ✅ | ◐ | ✅ | ✅ | ◐ | ◐ |
| 9 | Admin manual intervention | ✅ | ✅ | ✅ | ◐ | ◐ | ◐ | ✅ | ✅ | ✅ | ◐ |
| 10 | Provider completes KYC | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

## Per-flow evidence and gaps

### 1. Customer creates service request
- `WorkflowEvent REQUEST_SUBMITTED` with `actorId: customerId` + source pwa/whatsapp (`lib/job-requests/create-job-request.ts:617`); JobRequest row; confirmations via `logOutboundMessage`; visible in funnel report + validation/dispatch queues.
- **Gap (failure visibility ◐):** abandonment is inferred only from REQUEST_STARTED-without-SUBMITTED delta. **Recovery:** `customer-abandoned-recovery` cron (flag-gated).

### 2. Customer confirms booking
- Booking + Job created in the quote-approval transaction (`lib/quotes.ts:86-107`); quote decision writes AuditLog rows (`lib/quotes.ts:195,248`).
- **Gaps:** no `CUSTOMER_ACCEPTED_MATCH` / `JOB_SCHEDULED` WorkflowEvent (enum values exist, never emitted); no BookingStatusEvent "created" row — booking origin must be inferred from the quote audit trail; token-based approval records the decision but the actor identity is the token, not a session.
- **Recommendation:** emit WorkflowEvents + a CREATED→SCHEDULED BookingStatusEvent inside the same transaction.

### 3. Customer pays
- Default mode is **bypass** (`lib/payments.ts:78`): Payment row recorded with explanatory metadata but no money verified. Checkout mode: webhook has signature verify, unknown-booking reject, ±1c amount validation, PAID idempotency early-return (`app/api/webhooks/payments/route.ts:46-80`); failures enqueue `PAYMENT_FOLLOW_UP` ops items (`lib/payments.ts:526,587`).
- **Gaps:** raw PSP request/response payloads are **not persisted** (console only — contrast KYC, which stores redacted raw payloads); no `PAYMENT_COMPLETED`/`PAYMENT_FAILED` WorkflowEvent.
- **Recovery:** PSP webhook retries + `expire-payment-intents` recovery loop (wallet top-ups).
- **Recommendation:** add a PaymentWebhookEvent table mirroring `ProviderVerificationWebhookEvent`.

### 4. WhatsApp confirmation sent
- `sendBookingConfirmation` → MessageEvent SENT with `bookingId` + WAMID; delivery/read/failed statuses updated by the Meta status webhook (`app/api/webhooks/whatsapp/route.ts:145-161`); visible at `/admin/messages`.
- **Gaps:** MessageEvent lacks `jobRequestId`/`matchId` FKs, so pre-booking comms can't join to the request story; **retry ❌** — no automated resend of a FAILED message; the admin "Retry" button is a no-op (flips status to QUEUED which nothing consumes — finding AD-01); recovery is flow-specific nudge crons only.

### 5. Provider accepts job
- `Lead.providerAcceptedAt/respondedAt` (schema:616) + `WorkflowEvent PROVIDER_ACCEPTED` (`lib/selected-provider-acceptance.ts:376`); accept + credit check + deduction + lock in one transaction; customer notified via post-match comms (`CLIENT_NOTIFIED` + MessageEvent, `lib/post-match-communications.ts:717`); late-accept grace + expiry timestamps on Lead. **Best-covered money flow.**

### 6. Technician starts job
- `transitionJob`: CAS-guarded update + JobStatusEvent + AuditLog in one transaction (`lib/jobs.ts:66-102`), actor id/role captured; customer WhatsApp side-effects logged.
- **Gaps:** side-effect (notification) failures only `console.error`'d; no `JOB_STARTED` WorkflowEvent.

### 7. Technician completes job
- Same transaction + Booking→COMPLETED cascade (`lib/jobs.ts:106-111`), CAPI conversion emit (`:120`), FIELD_EXCEPTION case on FAILED/CALLBACK_REQUIRED (`:126`), `sendJobCompleted` MessageEvent; `completion-check` cron as recovery sweep (flag-gated, AUTO_ASSIGN only).
- **Gap:** no `JOB_COMPLETED` WorkflowEvent — funnel is blind to completion.

### 8. Invoice / receipt generated
- `db.invoice.upsert` with Blob pdfUrl (`lib/invoice/generate.tsx:91`); admin path fully audited via crudAction with `sentAt` idempotency guard (`app/(admin)/admin/invoices/actions.ts:140-145`).
- **Gaps:** customer self-serve route (`app/api/customer/bookings/[id]/invoice/route.ts:61`) generates without an audit row; invoices are pull-only — never pushed to the customer; no `INVOICE_ISSUED` WorkflowEvent.

### 9. Admin manual intervention
- `crudAction`: role check, flag check, zod validation, mutation + AuditLog + AdminAuditEvent atomically with before/after/reason (`lib/crud-action.ts:200-232`); unified viewer at `/admin/audit-log` (ADMIN/OWNER-gated).
- **Gaps:** `AuditLog.ipAddress`/`userAgent` columns exist but are not populated by crudAction (`lib/crud-action.ts:207-218`); two direct `adminAuditEvent.create` bypasses (`app/(admin)/admin/applications/page.tsx:854,908`); dispatch `redispatch`/`escalate` actions bypass crudAction entirely (`app/(admin)/admin/dispatch/actions.ts:75-156`); external side-effects of admin actions (WhatsApp notify) are logged separately, not linked to the audit row.

### 10. Provider completes KYC
- Raw redacted webhook payload persisted (`app/api/webhooks/verification/[vendor]/route.ts:44`) → guarded state transition (`lib/identity-verification/orchestrator.ts:424-489`, invalid transitions throw) → `ProviderVerificationEvent` (from/to, actor, decision, reasonCode) + `Provider.kycStatus` update + terminal notification; errors go to Sentry with searchable tags (`lib/identity-verification/log.ts`); visible at `/admin/verifications` + `/admin/reports/kyc-funnel`; renudge crons (`kyc-drive-nudge`, `identity-verification-in-flight-renudge`).
- **This is the best-instrumented flow in the codebase — the template the others should copy.**

## Cross-cutting correlation assessment

For one JobRequest a developer **can** reconstruct the chain via DB joins:
`JobRequest → Match (jobRequestId @unique) → Quote (matchId) → Booking (matchId, quoteId) → Payment/Invoice (bookingId) → Job (bookingId) → JobStatusEvent (jobId) → Lead (jobRequestId+providerId) → MessageEvent (bookingId/leadId) → WorkflowEvent (entityType/entityId)`

**Weak links:**
1. WorkflowEvent is polymorphic with no FKs — LEAD-scoped events carry `jobRequestId` only inside unindexed JSON metadata.
2. MessageEvent lacks `jobRequestId`; `customerId` is null when no Customer row matches the phone at send time.
3. `lib/correlation.ts` exists but is used in only 3 routes and the correlationId is **never persisted to any DB row** — log↔DB joining depends on timestamps and Vercel log retention.
4. Support `reference_id` values are random (`lib/api-response.ts:31-35`), not derived from the correlation ID — a customer-quoted reference cannot be traced to logs.

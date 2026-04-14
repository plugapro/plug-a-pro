# Plug-A-Pro Platform Hardening Audit

Date: 2026-04-13  
Scope: customer, provider, and operations platform hardening  
Mode: audit + safe, targeted remediation only

## 1. Journey Inventory

### A. Client / customer journeys

| Journey | Entry point | Main steps | Dependencies | Failure points | Permissions |
|---|---|---|---|---|---|
| Browse and start a request | [field-service/app/(customer)/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/page.tsx:1), [services/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/services/page.tsx:1) | land on home, browse categories, open `/book/[serviceId]`, complete booking form | customer auth cookie, category list, booking form, geocoding, create-job-request API | sign-in redirect loss, address capture friction, failed request creation, missing post-submit tracking | guest on home, authenticated customer required on `/services` and `/book/*` |
| Customer auth and account linking | [sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/sign-in/page.tsx:1), [verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/verify/page.tsx:1), [api/auth/session/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:1), [api/auth/link/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/auth/link/route.ts:1) | send OTP, verify code, persist HttpOnly cookie, link Supabase user to existing customer row | Supabase OTP, session cookie, phone-match link flow | lost callback/deep link, raw provider error copy, stale customer linkage by phone/userId | customer role |
| Track active requests and bookings | [bookings/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/bookings/page.tsx:1), [requests/[id]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/requests/[id]/page.tsx:1), [bookings/[id]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/bookings/[id]/page.tsx:1) | list active requests, open request, open booking, cancel, sign off completion, raise dispute | customer resolution by session, request/match/booking data, quote/payment/job context | no results due to cross-channel identity split, dead links, weak ownership checks | authenticated customer, server-side ownership check |
| Quote approval and payment | [quotes/[token]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/quotes/[token]/page.tsx:1), [api/quotes/[token]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/quotes/[token]/route.ts:1), [api/webhooks/payments/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/webhooks/payments/route.ts:1) | review quote, approve or decline, create booking artifacts, initialize payment, handle webhook | approval token, quote transaction, PSP webhook verification | token misuse if entropy/rotation is weak, payment webhook retry/error ambiguity, customer messaging dead links | public token flow + PSP signed webhook |
| Attachment and status visibility | [api/attachments/[id]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1), [lib/whatsapp-flows/status.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/status.ts:1) | open proof photos, view request status, follow app CTA | session auth, attachment proxy, WhatsApp interactive sends | attachment denial if customer not linked properly, raw blob exposure if URL leaks, interactive fallback failure | customer/provider/admin auth on proxy route |

### B. Service provider journeys

| Journey | Entry point | Main steps | Dependencies | Failure points | Permissions |
|---|---|---|---|---|---|
| Provider onboarding and login | [provider-sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/provider-sign-in/page.tsx:1), [provider-verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/provider-verify/page.tsx:1), [technician-* auth pages](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/technician-sign-in/page.tsx:1), [applications/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/applications/page.tsx:1) | register via WhatsApp, admin reviews application, provider OTP sign-in, provider role verified | Supabase user metadata, application dedupe, provider sync | duplicate active applications, lost callback, raw verify errors, approval conflicts | provider role required |
| Accept or reject assignment offer | [api/provider/assignment-offers/[id]/accept/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/provider/assignment-offers/[id]/accept/route.ts:1), [reject/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/provider/assignment-offers/[id]/reject/route.ts:1) | resolve provider from session, accept or reject offer, update assignment state | provider DB lookup, matching service | duplicate actions, stale offers, error payloads from service layer | authenticated provider, provider ownership enforced server-side |
| Quote and inspection lifecycle | [provider/quotes/[matchId]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(provider)/provider/quotes/[matchId]/page.tsx:1), [api/technician/quotes/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/technician/quotes/route.ts:1) | inspection complete, submit quote, revise declined quote | provider auth, match ownership, quote state machine | duplicate quote submissions, inconsistent revision state, public quote token downstream | authenticated provider |
| Job execution lifecycle | [provider/jobs/[id]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(provider)/provider/jobs/[id]/page.tsx:1), [api/technician/jobs/[id]/status/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/technician/jobs/[id]/status/route.ts:1), [photo/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/technician/jobs/[id]/photo/route.ts:1) | open job, update status, upload photos, request extra work, raise dispute | provider auth, job ownership, attachment storage, job transition state machine | invalid state transitions, upload validation failure, job side-effect dead links | authenticated provider, assigned-provider ownership enforced |
| Earnings and profile | [provider/earnings/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(provider)/provider/earnings/page.tsx:1), [provider/profile/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(provider)/provider/profile/page.tsx:1) | review earnings, update profile | provider auth, provider record | missing provider link, stale metadata | authenticated provider |

### C. Operations dashboard journeys

| Journey | Entry point | Main steps | Dependencies | Failure points | Permissions |
|---|---|---|---|---|---|
| Admin sign-in and protected navigation | [admin-sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/admin-sign-in/page.tsx:1), [proxy.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/proxy.ts:1), [requireAdmin](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/auth.ts:84) | email/password sign-in, set session cookie, enter admin routes | Supabase auth, role metadata, proxy redirect | lost callback, unauthorized route access, role mismatch | admin or owner |
| Dashboard triage | [admin/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/page.tsx:1) | view validation, dispatch, quotes, field exceptions, finance, trust recovery, onboarding lanes | aggregate DB queries, ops queue ownership | stale counts, queue/action drift, missing browser verification | admin/owner |
| Validation, dispatch, and field exceptions | [validation/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/validation/page.tsx:1), [dispatch/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/dispatch/page.tsx:1), [field-exceptions/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/field-exceptions/page.tsx:1) | claim queue item, review data, mark ready, assign, override, release | ops queue assignment model, matching service, job request state | migration mismatch, claim drift, manual override side effects | admin/owner |
| Provider onboarding review | [applications/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/applications/page.tsx:1) | review pending application, claim item, approve or reject, notify provider | application dedupe helpers, Supabase admin API, provider sync | duplicate phone identities, partial user/profile creation | admin/owner |
| Payments and disputes | [payments/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/payments/page.tsx:1), [disputes/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(admin)/admin/disputes/page.tsx:1) | claim item, review payment/dispute, refund or update case | payment records, dispute records, audit logging | privileged money actions, weak traceability if logs are missing | admin/owner |

## 2. Issue Register

### H-001 — Auth callback mismatch and open redirect exposure
- Persona affected: customer, provider, admin
- Journey affected: sign-in recovery from protected deep links
- Severity: High
- Category: Security / Reliability / UX
- Location: [proxy.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/proxy.ts:1), [sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/sign-in/page.tsx:1), [verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/verify/page.tsx:1), provider/admin auth entry pages
- How to reproduce: open a protected route while signed out, let proxy redirect to sign-in, complete auth
- Expected behavior: user returns safely to the original in-app route only
- Actual behavior before fix: proxy used `callbackUrl`, sign-in flow read `next`, and the raw redirect target was not sanitized
- Root cause: redirect plumbing diverged between proxy and auth screens, and redirect targets were trusted too loosely
- Fix applied: introduced [safe-redirect.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/safe-redirect.ts:1), updated customer/provider/technician/admin auth entry pages to read sanitized `next` or `callbackUrl`, and updated [proxy.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/proxy.ts:1) to emit both parameters consistently
- Residual risk: browser-level verification of every deep-link path still required

### H-002 — Customer cross-channel identity mismatch broke request tracking
- Persona affected: customer
- Journey affected: post-booking tracking, booking detail, attachment access
- Severity: High
- Category: Access Control / Reliability / Data Integrity
- Location: [customer-session.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/customer-session.ts:1), [create-job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/job-requests/create-job-request.ts:1), customer bookings/request pages, [api/attachments/[id]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1)
- How to reproduce: book via WhatsApp, later authenticate on web with same phone, then open bookings/request tracking
- Expected behavior: the authenticated web customer sees the same customer/request history as the WhatsApp identity
- Actual behavior before fix: customer resolution relied too heavily on `userId`, so phone-only records could appear “missing”
- Root cause: customer identity continuity existed in concept but was not enforced consistently across route handlers and page-level ownership checks
- Fix applied: centralized server-side session resolution in [customer-session.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/customer-session.ts:1), updated booking/request/profile screens and attachment proxy to use it, and hardened job-request creation to reconcile by phone before creating a new customer
- Residual risk: legacy production data with truly duplicated customer rows may still require manual cleanup

### H-003 — Customer request tracking was incomplete after successful booking
- Persona affected: customer
- Journey affected: request creation → track progress
- Severity: High
- Category: UX / Reliability
- Location: [bookings/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/bookings/page.tsx:1), [BookingFlow.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/components/customer/BookingFlow.tsx:1)
- How to reproduce: create a job request that has not yet become a booking, then open “My bookings”
- Expected behavior: active requests remain visible until they become bookings
- Actual behavior before fix: the customer saw an empty bookings screen because only confirmed bookings were listed
- Root cause: the customer app modeled tracking around bookings only, ignoring pre-booking `JobRequest` state
- Fix applied: active request listing added to the customer bookings hub and post-submit CTA updated to the request detail
- Residual risk: no browser verification was run in this audit turn

### H-004 — WhatsApp request tracking exposed raw URLs and brittle fallback behavior
- Persona affected: customer
- Journey affected: WhatsApp “My Request”
- Severity: Medium
- Category: UX / Error Messaging / Security
- Location: [status.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/status.ts:1)
- How to reproduce: ask the bot to track a request
- Expected behavior: safe, guided app handoff with resilient fallback
- Actual behavior before fix: bot messages could embed raw tracking URLs directly
- Root cause: default status rendering used plain text/buttons with inline URLs instead of a safer CTA-first pattern
- Fix applied: switched to CTA-based app links with text fallback and updated regression tests
- Residual risk: raw URL remains in the fallback text path when interactive delivery fails, because there is no alternate signed short link system yet

### H-005 — OTP verification screens surfaced raw provider/backend error strings
- Persona affected: customer, provider
- Journey affected: OTP verification
- Severity: Medium
- Category: Error Messaging / Security
- Location: [verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/verify/page.tsx:1), [provider-verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/provider-verify/page.tsx:1), [technician-verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/technician-verify/page.tsx:1)
- How to reproduce: submit an invalid or expired code, or trigger a provider-side OTP error
- Expected behavior: user-friendly and non-technical guidance
- Actual behavior before fix: raw `verifyError.message` could be shown
- Root cause: verify forms forwarded provider error text directly to the UI
- Fix applied: added [auth-client-errors.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/auth-client-errors.ts:1) and normalized verify-page error messaging
- Residual risk: send-OTP pages still rely on inline mapping, not a shared helper, but user-facing output is already controlled

### H-006 — Payment webhook leaked internal exception text in HTTP response
- Persona affected: operations, platform security
- Journey affected: payment webhook failure handling
- Severity: Medium
- Category: Security / Error Messaging
- Location: [api/webhooks/payments/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/webhooks/payments/route.ts:1)
- How to reproduce: force `handlePaymentSuccess` or `handlePaymentFailed` to throw
- Expected behavior: webhook response should not echo raw internal error text
- Actual behavior before fix: response body included `message: String(err)`
- Root cause: catch block serialized the thrown exception directly
- Fix applied: response now returns only `{ status: 'error' }`, with details kept in server logs
- Residual risk: webhook still returns HTTP 200 on handler error by design, which can suppress PSP retries and should be revisited carefully with an explicit retry strategy

### H-007 — Session cookie lifetime was client-shaped
- Persona affected: all authenticated users
- Journey affected: session establishment
- Severity: Medium
- Category: Security / Architecture
- Location: [api/auth/session/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:1)
- How to reproduce: call `/api/auth/session` with an arbitrarily large `expiresIn`
- Expected behavior: server controls cookie lifetime regardless of caller input
- Actual behavior before fix: `expiresIn` from the client directly shaped `Max-Age`
- Root cause: verified token ownership was enforced, but cookie lifetime was not bounded server-side
- Fix applied: cookie max-age is now clamped to a server-side minimum/maximum window
- Residual risk: no server-side token refresh flow exists yet, so session UX still depends on Supabase token expiry behavior

### H-008 — Completion message used a dead invoice route
- Persona affected: customer
- Journey affected: job completion notification
- Severity: Medium
- Category: UX / Reliability
- Location: [jobs.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/jobs.ts:1)
- How to reproduce: complete a job and inspect the WhatsApp completion link
- Expected behavior: completion message should land on a real invoice-visible screen
- Actual behavior before fix: message linked to `/bookings/{id}/invoice`, which does not exist
- Root cause: side-effect URL drifted from the actual routed UI
- Fix applied: completion message now links to the booking detail page, which already exposes invoice information
- Residual risk: none in code; still needs manual verification of the customer message copy

### H-009 — Attachment storage remains publicly addressable at the blob layer
- Persona affected: customer, provider, operations
- Journey affected: proof photos, quote attachments, invoice artifacts
- Severity: High
- Category: Security / Privacy
- Location: [storage.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/storage.ts:1), [api/attachments/[id]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1)
- How to reproduce: obtain a raw Vercel Blob URL from an attachment record and fetch it directly
- Expected behavior: attachment access should be private by default and enforced server-side
- Actual behavior: the application proxy protects normal UI access, but blobs are still uploaded with `access: 'public'`
- Root cause: storage design relies on URL secrecy plus proxy gating rather than private object storage or short-lived signed access
- Fix applied or recommendation: not changed blindly in this audit; recommendation is to migrate sensitive artifacts to private storage semantics or signed short-lived URLs and scrub any raw blob URL exposure from application records
- Residual risk: privacy exposure persists if raw URLs leak into logs, client state, third-party tools, or browser history

### H-010 — No browser-level regression coverage for core journeys
- Persona affected: customer, provider, operations
- Journey affected: all major surfaces
- Severity: Medium
- Category: Reliability / Test Coverage
- Location: repository-wide test posture
- How to reproduce: compare automated coverage with real browser flows
- Expected behavior: at least one high-signal end-to-end check for auth, booking/request tracking, provider job execution, and admin queues
- Actual behavior: unit/integration coverage is meaningful, but browser/E2E coverage was not present in this audit scope
- Root cause: testing is concentrated in service and API layers
- Fix applied or recommendation: not implemented here; recommend adding a minimal authenticated browser smoke suite for `/bookings`, `/provider/jobs/[id]`, `/admin`, `/admin/dispatch`, and `/admin/field-exceptions`
- Residual risk: route-level regressions can still pass unit tests

## 3. Fix Summary

### Files changed
- [field-service/lib/customer-session.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/customer-session.ts:1)
- [field-service/lib/job-requests/create-job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/job-requests/create-job-request.ts:1)
- [field-service/app/(customer)/bookings/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/bookings/page.tsx:1)
- [field-service/app/(customer)/bookings/[id]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/bookings/[id]/page.tsx:1)
- [field-service/app/(customer)/requests/[id]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/requests/[id]/page.tsx:1)
- [field-service/app/(customer)/profile/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/profile/page.tsx:1)
- [field-service/app/(customer)/layout.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/layout.tsx:1)
- [field-service/components/customer/BookingFlow.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/components/customer/BookingFlow.tsx:1)
- [field-service/lib/geocoding.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/geocoding.ts:1)
- [field-service/app/api/customer/location-reverse/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/customer/location-reverse/route.ts:1)
- [field-service/lib/whatsapp-flows/status.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/status.ts:1)
- [field-service/lib/safe-redirect.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/safe-redirect.ts:1)
- [field-service/proxy.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/proxy.ts:1)
- [field-service/app/(auth)/sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/sign-in/page.tsx:1)
- [field-service/app/(auth)/verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/verify/page.tsx:1)
- [field-service/app/(auth)/provider-sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/provider-sign-in/page.tsx:1)
- [field-service/app/(auth)/provider-verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/provider-verify/page.tsx:1)
- [field-service/app/(auth)/technician-sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/technician-sign-in/page.tsx:1)
- [field-service/app/(auth)/technician-verify/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/technician-verify/page.tsx:1)
- [field-service/app/(auth)/admin-sign-in/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(auth)/admin-sign-in/page.tsx:1)
- [field-service/lib/auth-client-errors.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/auth-client-errors.ts:1)
- [field-service/app/api/auth/session/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:1)
- [field-service/app/api/webhooks/payments/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/webhooks/payments/route.ts:1)
- [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1)
- [field-service/lib/jobs.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/jobs.ts:1)

### What changed and why
- Centralized customer identity resolution so WhatsApp-originated customers and authenticated web customers converge safely on one record.
- Exposed active `JobRequest` tracking in the customer app instead of only confirmed `Booking` records.
- Added safe location-assisted address capture to reduce broken or incomplete request submissions.
- Replaced unsafe callback handling with a shared in-app redirect sanitizer.
- Normalized OTP verify error copy so users get guidance without provider/backend error leakage.
- Removed raw internal exception text from payment webhook responses.
- Bounded session cookie lifetime server-side instead of trusting caller-supplied `expiresIn`.
- Fixed a dead completion link and aligned customer attachment authorization to the server-side customer identity model.

### Risk reduction achieved
- Reduced chance of broken post-booking tracking.
- Reduced redirect abuse exposure on auth entry points.
- Reduced privacy/operational confusion from raw provider/backend error strings.
- Reduced attachment authorization drift for customers who were created on WhatsApp first.
- Reduced dead-link fallout in lifecycle notifications.

## 4. Test and Verification Summary

### Tests run
- `pnpm vitest run __tests__/lib/safe-redirect.test.ts __tests__/lib/auth-client-errors.test.ts __tests__/api/attachments-authz.test.ts __tests__/api/webhooks-security.test.ts __tests__/api/auth.test.ts __tests__/lib/customer-session.test.ts __tests__/lib/whatsapp-flows/status.test.ts __tests__/lib/jobs.test.ts`
- `pnpm build`

### Results
- Vitest: passed
- Build/typecheck: passed

### Manual verification notes
- The latest defect screenshots in `/Users/shimane/Desktop/defects/PlugAPro` were reviewed and translated into code fixes where the filenames and visible UI states gave enough evidence.
- Browser-level verification of the new customer, provider, and ops behaviors was **not** run in this audit turn.

### What still needs human validation
- Customer deep-link sign-in recovery to `/requests/[id]` and `/bookings/[id]`
- Provider and admin deep-link recovery from signed-out entry
- Customer booking form “Use my current location” behavior on a real device/browser
- WhatsApp CTA link behavior in production messaging
- Admin queues after any production deployment or migration changes

## 5. Final Hardening Summary

### Biggest risks found
1. Public blob storage for sensitive attachments.
2. Broken cross-channel customer identity causing missing tracking history.
3. Unsafe or inconsistent redirect recovery on protected auth flows.
4. Raw exception or provider error text leaking into webhook/auth responses.
5. Missing browser-level regression coverage for core journeys.

### Biggest risks fixed
1. Protected-route callback recovery now returns users to safe in-app paths only.
2. Cross-channel customer identity resolution now works across request, booking, profile, and attachment access paths.
3. Customer request tracking no longer collapses to “no bookings” for active requests.
4. Payment webhook no longer echoes internal exception text.
5. OTP verify forms no longer expose raw provider/backend errors to end users.
6. Completion messaging no longer points to a dead invoice route.

### Risks intentionally left untouched
1. Public blob access model: changing storage privacy semantics is a platform/storage migration, not a safe audit-day patch.
2. Webhook retry semantics on handler error: changing `200` vs retry behavior requires PSP-specific operational design.
3. Quote approval token trust model: token entropy and lifecycle need deliberate review before changing public approval flows.
4. Full E2E/browser automation: high value, but outside a minimal hardening patch set.

### Recommended next hardening priorities
1. Migrate attachments away from public blob URLs or introduce signed short-lived retrieval.
2. Add browser-level smoke coverage for customer request tracking, provider job lifecycle, and admin queue routes.
3. Review public token-based quote approval lifecycle for entropy, expiry, and replay resilience.
4. Introduce structured operational logging and correlation IDs on customer booking, provider acceptance, and webhook flows.
5. Revisit PSP webhook failure semantics with an explicit retry/runbook strategy rather than implicit `200` swallowing.

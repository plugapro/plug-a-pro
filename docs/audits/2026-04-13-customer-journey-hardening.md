# Plug A Pro Customer Journey Hardening

Date: 2026-04-13  
Scope: customer-only hardening review and safe remediation

## Customer Journey Map

| Stage | Entry point | Main steps | Dependencies | Common failure points | Permissions |
|---|---|---|---|---|---|
| Discover and start | [field-service/app/(customer)/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/page.tsx:1), [services/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/services/page.tsx:1) | land, browse categories, open `/book/[serviceId]` | route guard, service category list | auth redirect loss, weak CTA recovery | guest on landing, authenticated customer on `/services` |
| Authenticate and recover context | [sign-in/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(auth)/sign-in/page.tsx:1), [verify/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(auth)/verify/page.tsx:1), [api/auth/session/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/auth/session/route.ts:1), [api/auth/link/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/auth/link/route.ts:1) | send OTP, verify code, persist session cookie, link account to customer record, return to target | Supabase OTP, session cookie, phone-linking | lost callback path, raw error copy, overlong client-shaped session cookie | customer auth only |
| Start request | [book/[serviceId]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/book/[serviceId]/page.tsx:1), [BookingFlow.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/BookingFlow.tsx:1), [api/customer/bookings/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/customer/bookings/route.ts:1), [create-job-request.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/lib/job-requests/create-job-request.ts:1) | capture address, optional location assist, describe job, confirm, create job request | customer session, address validation, reverse geocoding, transactional intake | whitespace-only input, vague submission errors, duplicate submit risk, cross-channel customer mismatch | authenticated customer |
| Track request and booking | [bookings/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/page.tsx:1), [requests/[id]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/requests/[id]/page.tsx:1), [bookings/[id]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/[id]/page.tsx:1), [api/attachments/[id]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/attachments/[id]/route.ts:1) | view active requests, view booking, inspect quote/payment/job status, open attachments | customer record resolution, ownership checks, attachment proxy | request invisibility from identity split, dead links, customer auth mismatch | authenticated customer |
| Approve quote and pay | [quotes/[token]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/quotes/[token]/page.tsx:1), [api/quotes/[token]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/quotes/[token]/route.ts:1), [api/webhooks/payments/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/api/webhooks/payments/route.ts:1) | inspect quote, approve or decline, initialize payment, receive booking confirmation | approval token, quote state machine, PSP webhook | expired/public token flow, payment failure ambiguity, internal error leakage | public tokenized flow |
| Approve additional work | [approve/[token]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/approve/[token]/page.tsx:1), [ApprovalCard.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/ApprovalCard.tsx:1) | open token link, approve or decline extra work | extra-work token, server action | UI claiming success after failed server action | public tokenized flow |
| Close out and rate | [bookings/[id]/rate/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/[id]/rate/page.tsx:1), [jobs.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/lib/jobs.ts:1) | confirm completion, open rating page, submit rating | booking ownership, job status, review creation | stale ownership check, duplicate review creation, dead completion/invoice link | authenticated customer |

## Issue List

### CJ-001 — Redirect recovery for customer routes was inconsistent
- Severity: High
- Category: Reliability / Access Control
- Location: customer sign-in/verify pages, protected customer pages, [proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/proxy.ts:1)
- Reproduce: open `/bookings`, `/profile`, `/book/[serviceId]`, or `/bookings/[id]/rate` while signed out
- Expected: after OTP login, return to the exact in-app page
- Actual before fix: some routes lost context or relied on unsanitized redirect params
- Root cause: proxy and auth pages used mismatched redirect parameters and no shared sanitizer
- Fix applied: shared safe redirect helper and explicit `next` preservation on customer routes
- Residual risk: still needs browser-level confirmation across all protected customer paths

### CJ-002 — Active requests were not visible in the customer hub
- Severity: High
- Category: UX / Reliability
- Location: [bookings/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/page.tsx:1)
- Reproduce: create a job request that has not yet produced a booking
- Expected: request remains visible for tracking
- Actual before fix: customer saw no bookings and could not find their request
- Root cause: the page only queried `Booking`, not active `JobRequest`
- Fix applied: added “Active requests” list with links to request detail
- Residual risk: none in code; still needs manual/browser validation

### CJ-003 — Cross-channel customer identity could hide data from the rightful customer
- Severity: High
- Category: Data Integrity / Access Control
- Location: [customer-session.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/lib/customer-session.ts:1), request/booking/profile pages, attachment proxy
- Reproduce: create a customer via WhatsApp, later authenticate via PWA with the same phone
- Expected: one customer identity across channels
- Actual before fix: userId-based lookups could miss phone-only records
- Root cause: identity linking existed but was not used consistently in customer-owned paths
- Fix applied: centralized session-to-customer resolution and used it across customer pages and attachment access
- Residual risk: existing duplicated customer rows in production may still need cleanup

### CJ-004 — Booking submission validation was too permissive and errors were weak
- Severity: Medium
- Category: Validation / Error Messaging
- Location: [BookingFlow.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/BookingFlow.tsx:1)
- Reproduce: submit whitespace-only address/title, malformed postal code, or hit expired session during submit
- Expected: clear validation and safe messages
- Actual before fix: HTML `required` handled only obvious empty fields, whitespace-only values slipped through, and API errors were surfaced too generically
- Root cause: no explicit client-side validation layer before confirmation/submission
- Fix applied: added normalized address/title validation, postal-code check, better submit error mapping, and a no-double-submit guard
- Residual risk: no server-side schema validator yet; API still relies on route-level checks rather than shared schema parsing

### CJ-005 — Extra-work approval UI could show success on failure
- Severity: Medium
- Category: Reliability / UX
- Location: [ApprovalCard.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/ApprovalCard.tsx:1)
- Reproduce: make the server action behind extra-work approval fail
- Expected: user sees a retryable error and the card does not claim approval/decline succeeded
- Actual before fix: UI always moved into done-state after awaiting the action
- Root cause: optimistic completion state without error handling
- Fix applied: wrapped action in try/catch and show retryable error instead of marking done on failure
- Residual risk: browser/manual verification still needed on real token links

### CJ-006 — Rating flow relied on stale page-time ownership and lacked action-time recheck
- Severity: High
- Category: Access Control / Data Integrity
- Location: [bookings/[id]/rate/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/[id]/rate/page.tsx:1)
- Reproduce: rate a booking after cross-channel customer linking changes, or replay a stale action
- Expected: rating creation re-verifies the active session owns the booking and only one review is created
- Actual before fix: page used direct `customer.userId === session.id`, and the server action did not re-check ownership or duplicate review state
- Root cause: customer hardening reached booking/request pages but not the rating path
- Fix applied: migrated rating page to `resolveCustomerForSession`, preserved deep-link auth recovery, rechecked active session ownership in the action, and blocked duplicate review creation in the action itself
- Residual risk: no explicit audit log exists for review submission

### CJ-007 — Completion notification linked customers to a dead invoice path
- Severity: Medium
- Category: UX / Reliability
- Location: [jobs.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/lib/jobs.ts:1)
- Reproduce: complete a job and inspect the message link
- Expected: customer lands on a real page showing invoice information
- Actual before fix: link pointed to `/bookings/{id}/invoice`, which does not exist
- Root cause: lifecycle side-effect URL drift
- Fix applied: completion link now points to the booking detail page
- Residual risk: none in code

### CJ-008 — Customer auth verify screens exposed raw provider/backend wording
- Severity: Medium
- Category: Error Messaging / Security
- Location: [verify/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(auth)/verify/page.tsx:1)
- Reproduce: submit invalid or expired OTP
- Expected: safe, plain-language explanation
- Actual before fix: raw provider error strings could appear
- Root cause: direct propagation of `verifyError.message`
- Fix applied: normalized OTP verify messages through [auth-client-errors.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/lib/auth-client-errors.ts:1)
- Residual risk: send-OTP pages still use inline mapping rather than the same shared helper

## Fixes Applied

### Code changes
- [field-service/components/customer/BookingFlow.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/BookingFlow.tsx:1)  
  Added normalized client-side validation, better submission error mapping, and duplicate-submit guard.
- [field-service/components/customer/ApprovalCard.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/components/customer/ApprovalCard.tsx:1)  
  Added failure handling so approval/decline only shows success after a successful server action.
- [field-service/app/(customer)/book/[serviceId]/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/book/[serviceId]/page.tsx:1)  
  Preserves the exact route through customer sign-in.
- [field-service/app/(customer)/services/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/services/page.tsx:1)
- [field-service/app/(customer)/bookings/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/page.tsx:1)
- [field-service/app/(customer)/profile/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/profile/page.tsx:1)  
  Customer route auth recovery now preserves destination.
- [field-service/app/(customer)/bookings/[id]/rate/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/app/(customer)/bookings/[id]/rate/page.tsx:1)  
  Replaced stale ownership checks with `resolveCustomerForSession`, revalidated session ownership in the action, and blocked duplicate ratings.
- [field-service/__tests__/lib/create-job-request.test.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service/__tests__/lib/create-job-request.test.ts:1)  
  Refreshed the customer request-creation test coverage to match the transactional, cross-channel customer resolution logic.

### Why these changes matter
- They reduce broken post-login recovery.
- They make request submission failures understandable and recoverable.
- They prevent customer-facing false-success states.
- They tighten access control on customer-only post-completion actions.

## Tests and Verification

### Tests run
- `pnpm vitest run __tests__/lib/create-job-request.test.ts __tests__/lib/customer-session.test.ts __tests__/lib/whatsapp-flows/status.test.ts __tests__/api/auth.test.ts __tests__/api/attachments-authz.test.ts __tests__/api/webhooks-security.test.ts __tests__/lib/safe-redirect.test.ts __tests__/lib/auth-client-errors.test.ts __tests__/lib/jobs.test.ts`
- `pnpm build`

### Result
- Tests: passed
- Build/typecheck: passed

### Human verification still needed
- browser check of sign-in recovery back to `/book/[serviceId]`, `/bookings`, `/profile`, and `/bookings/[id]/rate`
- real-device geolocation flow in the booking form
- token-based extra-work approval flow in a browser
- payment failure and retry behavior in production PSP conditions

## Remaining Risks

1. Public blob URLs remain a customer privacy risk if attachment URLs leak outside the proxy path.
2. Payment failure UX and retry handling still require browser-level and PSP-integrated validation.
3. Customer form validation is improved, but there is still no shared schema parser at the API boundary.
4. No browser-level end-to-end coverage exists for the customer journey, so route-level regressions can still escape unit tests.

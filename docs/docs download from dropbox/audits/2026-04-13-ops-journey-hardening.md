# Plug A Pro Operations Journey Hardening Audit

Date: 2026-04-13  
Scope: Admin / operations dashboard and privileged workflows only  
Focus: Access control, privileged action safety, auditability, and operator-visible error handling

## Ops Journey Map

### 1. Admin authentication and entry
- Entry points:
  - `/admin-sign-in`
  - `/admin`
- Main steps:
  - admin or owner signs in with email/password
  - session cookie is established
  - `proxy.ts` and `requireAdmin()` protect `/admin/*`
- Dependencies:
  - Supabase auth
  - `user_metadata.role` of `admin` or `owner`
- Failure points:
  - expired session
  - missing role metadata
  - unsafe assumption that page-level protection alone is enough for server actions
- Permissions:
  - admin and owner only

### 2. Dashboard and queue navigation
- Entry points:
  - `/admin`
  - `/admin/validation`
  - `/admin/dispatch`
  - `/admin/field-exceptions`
  - `/admin/quotes`
  - `/admin/payments`
  - `/admin/disputes`
  - `/admin/applications`
- Main steps:
  - dashboard renders queue counts and owner badges
  - operator drills into queue-specific pages
  - operator claims, releases, or acts on entities
- Dependencies:
  - queue assignment records
  - underlying entity status
- Failure points:
  - stale state after claim/release or mutations
  - poor feedback when privileged actions fail
- Permissions:
  - admin and owner only

### 3. Booking and payment intervention
- Entry points:
  - `/admin/bookings/[id]`
  - `/admin/payments`
- Main steps:
  - open booking/payment details
  - mark payment as paid
  - cancel booking
  - issue refund
- Dependencies:
  - booking state
  - payment state
  - PSP integration
  - audit logging
- Failure points:
  - stale-state mutation attempts
  - silent refund failures
  - insufficient server-side checks on destructive or financial actions
- Permissions:
  - admin and owner only

### 4. Provider onboarding and lifecycle control
- Entry points:
  - `/admin/applications`
  - `/admin/providers/[id]`
- Main steps:
  - claim application
  - approve/reject application
  - activate/deactivate provider
- Dependencies:
  - provider application state
  - provider records
  - Supabase service-role user creation
- Failure points:
  - duplicate active applications
  - silent approval blocks
  - provider-active toggles without explicit action audit
- Permissions:
  - admin and owner only

### 5. Customer and provider record access
- Entry points:
  - `/admin/customers/[id]`
  - `/admin/providers/[id]`
  - `/admin/technicians/[id]`
- Main steps:
  - review PII, history, preferences, activity
  - toggle customer marketing preferences
  - toggle provider active status
- Dependencies:
  - customer/provider records
  - WhatsApp preference log
- Failure points:
  - server actions trusting bound client values instead of re-authing
  - no audit on sensitive preference or lifecycle changes
- Permissions:
  - admin and owner only

### 6. Dispatch and override workflow
- Entry point:
  - `/admin/dispatch`
- Main steps:
  - claim a request
  - auto-assign top candidate
  - refresh ranked shortlist
  - manually override assignment
- Dependencies:
  - dispatch ranking service
  - matching history
  - queue ownership
- Failure points:
  - no explicit audit for reassignment actions
  - weak operator feedback on failed override/assign attempts
- Permissions:
  - admin and owner only

## Issue List

### OJ-001
- Title: Some admin server actions relied on page guards instead of re-authenticating
- Persona affected: Operations
- Journey affected: Customer preference override, provider active toggle
- Severity: High
- Category: Access Control
- Location in code:
  - `app/(admin)/admin/customers/[id]/page.tsx`
  - `app/(admin)/admin/technicians/[id]/page.tsx`
- How to reproduce:
  - inspect the server actions for customer marketing override and provider active toggle
- Expected behavior:
  - every privileged server action should independently call `requireAdmin()`
- Actual behavior before fix:
  - actions trusted page protection and bound actor values from the rendered page
- Root cause:
  - server actions were written as if route protection alone guaranteed authorization
- Fix applied:
  - both actions now re-run `requireAdmin()` server-side
  - marketing override now uses the authenticated admin id instead of a bound client-supplied actor id
- Residual risk:
  - similar patterns should still be watched for in future admin server actions

### OJ-002
- Title: Refund action could fail silently and accepted weak operator input
- Persona affected: Operations / finance ops
- Journey affected: Payments
- Severity: High
- Category: Reliability / Error Messaging / Data Integrity
- Location in code:
  - `app/(admin)/admin/payments/page.tsx`
- How to reproduce:
  - attempt refund with invalid amount, exhausted refundable balance, or PSP/config failure
- Expected behavior:
  - invalid refunds are blocked server-side
  - operator gets clear feedback
- Actual behavior before fix:
  - route accepted weak inputs and swallowed failures with only console logging
- Root cause:
  - refund action lacked server-side amount/state validation and did not redirect with outcome feedback
- Fix applied:
  - added validation for refundable state and remaining amount
  - added clear operator-safe success/error banner messages
  - kept audit logging on successful refund requests
- Residual risk:
  - failed refunds are still not audit-logged as failed attempts

### OJ-003
- Title: Mark-as-paid trusted UI state and could run from stale booking state
- Persona affected: Operations
- Journey affected: Booking detail
- Severity: High
- Category: Data Integrity / Reliability
- Location in code:
  - `app/(admin)/admin/bookings/[id]/page.tsx`
- How to reproduce:
  - invoke mark-paid against a booking whose state changed after page render
- Expected behavior:
  - server re-checks whether the booking is still payable from its current state
- Actual behavior before fix:
  - action used rendered-page assumptions instead of a fresh state check
- Root cause:
  - server action relied on UI visibility rather than re-reading booking/payment state
- Fix applied:
  - added fresh booking/payment state validation inside the action
  - added clear success/error feedback banner
- Residual risk:
  - no browser-level validation was run for this banner flow

### OJ-004
- Title: Provider application review lacked audit coverage and clear duplicate-block feedback
- Persona affected: Operations
- Journey affected: Provider onboarding
- Severity: Medium
- Category: Auditability / Error Messaging
- Location in code:
  - `app/(admin)/admin/applications/page.tsx`
- How to reproduce:
  - approve or reject application
  - attempt approval when another active application exists for the same phone
- Expected behavior:
  - privileged review decisions are audited
  - blocked approval explains why
- Actual behavior before fix:
  - approve/reject mutated state without explicit admin audit entry
  - duplicate approval block only logged to console
- Root cause:
  - onboarding review flow had business logic but weak operator-facing integrity feedback
- Fix applied:
  - added audit log entries for approve and reject
  - added operator banner for duplicate active application blocks
- Residual risk:
  - auth-user creation failures still fall back to console logging and partial continuation by design

### OJ-005
- Title: Dispatch override and assignment actions were not explicitly audited and failed opaquely
- Persona affected: Operations / dispatch
- Journey affected: Dispatch
- Severity: Medium
- Category: Auditability / Error Messaging
- Location in code:
  - `app/(admin)/admin/dispatch/page.tsx`
- How to reproduce:
  - run auto-assign, rerank, or override from dispatch
- Expected behavior:
  - material dispatch actions are audited
  - operator sees safe success/failure feedback
- Actual behavior before fix:
  - dispatch actions had no explicit audit trail in the page flow and could error without a clear operator message
- Root cause:
  - dispatch mutations delegated to service logic but did not add console-level operator feedback or explicit action audit at the admin boundary
- Fix applied:
  - added audit logs for auto-assign, rerank, and manual override
  - added safe success/failure feedback banners
- Residual risk:
  - queue claim/release itself is still not audited

### OJ-006
- Title: Queue ownership actions are not uniformly audited
- Persona affected: Operations
- Journey affected: Validation, dispatch, quotes, payments, disputes, onboarding, field exceptions
- Severity: Medium
- Category: Auditability
- Location in code:
  - `lib/ops-queue.ts`
  - admin queue pages
- How to reproduce:
  - claim or release queue items across ops pages
- Expected behavior:
  - ownership changes on sensitive operational queues are traceable
- Actual behavior:
  - claim/release changes update queue rows but do not write explicit audit-log entries
- Root cause:
  - queue assignment model is separate from audit log model and currently unaudited
- Fix applied or recommendation:
  - recommendation only; do not patch blindly until ownership-event volume and retention expectations are agreed
- Residual risk:
  - post-incident accountability on queue ownership remains weaker than booking/payment/dispute state changes

### OJ-007
- Title: Admin and owner share the same effective surface without finer privilege split
- Persona affected: Operations leadership
- Journey affected: All admin surfaces
- Severity: Medium
- Category: Architecture / Access Control
- Location in code:
  - `lib/auth.ts`
  - `proxy.ts`
- How to reproduce:
  - review admin route guards and role checks
- Expected behavior:
  - owner-only actions exist if higher privilege is required
- Actual behavior:
  - `admin` and `owner` are treated as equivalent across the accessible ops surface
- Root cause:
  - no secondary privileged role split has been implemented
- Fix applied or recommendation:
  - recommendation only; avoid changing role boundaries without an explicit policy
- Residual risk:
  - access is broader than it would be in a more mature least-privilege model

## Fixes Applied

### 1. Re-authenticated sensitive admin server actions
- Files changed:
  - `field-service/app/(admin)/admin/customers/[id]/page.tsx`
  - `field-service/app/(admin)/admin/technicians/[id]/page.tsx`
- What changed:
  - server actions now call `requireAdmin()` directly
  - customer marketing override no longer trusts a bound actor id from the rendered page
  - provider active toggle now writes an audit log entry
- Why:
  - closes a real access-control weakness and improves traceability
- Risk reduced:
  - privilege misuse through server-action trust assumptions

### 2. Hardened refund workflow feedback and validation
- Files changed:
  - `field-service/app/(admin)/admin/payments/page.tsx`
  - `field-service/lib/admin-action-messages.ts`
- What changed:
  - server-side validation for refundable amount and allowed payment states
  - success/error redirect banners for ops users
- Why:
  - avoids silent failures and weak financial mutations
- Risk reduced:
  - invalid refund requests and opaque operator outcomes

### 3. Hardened mark-paid booking action
- Files changed:
  - `field-service/app/(admin)/admin/bookings/[id]/page.tsx`
  - `field-service/lib/admin-action-messages.ts`
- What changed:
  - fresh server-side booking/payment state validation
  - clear operator banner after success or stale-state block
- Why:
  - prevents stale privileged action execution
- Risk reduced:
  - incorrect payment state mutation from stale UI

### 4. Added audit and operator feedback for onboarding review
- Files changed:
  - `field-service/app/(admin)/admin/applications/page.tsx`
  - `field-service/lib/admin-action-messages.ts`
- What changed:
  - approve/reject now write audit logs
  - duplicate active application block now surfaces a banner
- Why:
  - review decisions are material operational actions and need traceability
- Risk reduced:
  - silent privileged state changes and unclear duplicate handling

### 5. Added dispatch action audit logs and safe feedback
- Files changed:
  - `field-service/app/(admin)/admin/dispatch/page.tsx`
  - `field-service/lib/admin-action-messages.ts`
- What changed:
  - auto-assign, rerank, and override now write audit logs
  - dispatch actions redirect with safe success/failure banners instead of failing opaquely
- Why:
  - dispatch override is a high-sensitivity operational action
- Risk reduced:
  - weak traceability and poor failure recovery in dispatch

## Tests / Verification

### Tests run
- `pnpm vitest run __tests__/lib/admin-action-messages.test.ts __tests__/lib/ops-queue.test.ts`

### Results
- 2 test files passed
- 8 tests passed

### Build
- `pnpm build`
- Result: passed

### Manual verification
- No browser-level admin walkthrough was run in this pass

### What still needs human validation
- `/admin/payments` refund banner paths
- `/admin/bookings/[id]` mark-paid banner paths
- `/admin/applications` duplicate-block banner path
- `/admin/dispatch` success/failure banner behavior after real assignment actions

## Remaining Risks

1. Queue claim/release changes are still not explicitly audit-logged.
2. Admin and owner still share the same effective privilege level across accessible ops surfaces.
3. Refund failures are operator-visible now, but failed refund attempts are not yet persisted as audit events.
4. Some admin pages still rely on redirect-based feedback patterns rather than richer action-result surfaces.
5. No browser-level verification was run for the ops hardening changes in this pass.

## Summary

The operations surface is materially safer after this pass:
- sensitive admin server actions now re-authenticate
- booking/payment state changes have stronger server-side guardrails
- onboarding and dispatch decisions now have clearer audit coverage
- operators get safe feedback instead of silent failures on several high-value workflows

The biggest remaining gaps are least-privilege separation between admin and owner, missing queue ownership audit events, and the lack of browser-level verification for the new operator feedback paths.

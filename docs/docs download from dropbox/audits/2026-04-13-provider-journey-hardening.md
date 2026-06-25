# Plug A Pro Provider Journey Hardening Audit

Date: 2026-04-13  
Scope: Provider/service professional journey only  
Focus: Access control, job execution reliability, failure handling, and provider-visible error quality

## Provider Journey Map

### 1. Auth and entry
- Entry points:
  - `/provider-sign-in`
  - `/provider-verify`
  - protected app shell at `/provider`
- Main steps:
  - provider enters phone number
  - OTP is sent and verified
  - session cookie is established through `/api/auth/session`
  - `proxy.ts` and `requireProvider()` protect `/provider/*`
- Dependencies:
  - Supabase OTP auth
  - session cookie
  - `user_metadata.role === "provider"`
  - `Provider` row linked by `userId`
- Failure points:
  - missing provider row after auth
  - expired session
  - unsafe redirect or lost return path
- Permissions:
  - provider role only

### 2. Provider dashboard / job list
- Entry point:
  - `/provider`
- Main steps:
  - provider session resolves
  - `Provider` row is loaded by `userId`
  - active jobs and upcoming scheduled jobs render
  - provider navigates into job detail
- Dependencies:
  - `Provider` row
  - `Job` records owned by `providerId`
- Failure points:
  - job card path drift
  - missing provider row
  - stale job visibility
- Permissions:
  - provider sees only jobs where `job.providerId === provider.id`

### 3. Quote workflow
- Entry points:
  - `/provider/quotes/[matchId]`
  - `/api/technician/quotes`
- Main steps:
  - provider opens quote screen for owned match
  - optional inspection completion
  - quote form validates input
  - server creates quote and updates match state
- Dependencies:
  - owned `Match`
  - quote state and inspection state
  - WhatsApp notifications
- Failure points:
  - route/path drift after submit or cancel
  - weak network failures
  - invalid match state
- Permissions:
  - provider sees only owned match

### 4. Job execution
- Entry points:
  - `/provider/jobs/[id]`
  - `/api/technician/jobs/[id]/status`
  - `/api/technician/jobs/[id]/photo`
- Main steps:
  - provider opens owned job
  - status transition buttons call API
  - evidence photos upload through attachment API
  - extra work requests and disputes can be raised from the page
- Dependencies:
  - owned `Job`
  - server-side transition state machine
  - storage upload path
  - attachment proxy authorization
- Failure points:
  - raw server error leakage
  - network drop during status/photo actions
  - duplicate photo submission after ambiguous upload outcome
- Permissions:
  - provider sees only owned job and owned attachments through proxy

### 5. Profile and readiness
- Entry point:
  - `/provider/profile`
- Main steps:
  - provider edits contact/profile text
  - availability schedule is upserted per day
  - provider can subscribe to push
- Dependencies:
  - owned `Provider` row
  - `providerSchedule`
- Failure points:
  - weak validation on profile text, URLs, and schedule ordering
  - no surfaced save error path from server action
- Permissions:
  - provider edits only own profile via `userId`

## Issue List

### PJ-001
- Title: Provider dashboard linked to technician routes
- Persona affected: Provider
- Journey affected: Dashboard, job detail, quote workflow
- Severity: High
- Category: UX / Reliability
- Location in code:
  - `components/technician/JobCard.tsx`
  - `components/technician/QuoteForm.tsx`
  - `app/(provider)/provider/page.tsx`
  - `app/(provider)/provider/quotes/[matchId]/page.tsx`
- How to reproduce:
  - sign in as provider
  - open `/provider`
  - tap a job or submit/cancel a quote
- Expected behavior:
  - provider stays inside `/provider/*`
- Actual behavior before fix:
  - shared components routed providers into `/technician/*`
- Root cause:
  - shared technician components encoded hardcoded technician base paths
- Fix applied:
  - added explicit `basePath` support and passed `/provider` from provider pages
- Residual risk:
  - duplicated provider/technician route trees still create maintenance drift risk

### PJ-002
- Title: Provider status API leaked internal transition errors
- Persona affected: Provider
- Journey affected: Job execution
- Severity: High
- Category: Error Messaging / Security / Reliability
- Location in code:
  - `app/api/technician/jobs/[id]/status/route.ts`
  - `components/technician/StatusControls.tsx`
- How to reproduce:
  - attempt a stale or invalid job transition
- Expected behavior:
  - provider sees a safe actionable message
- Actual behavior before fix:
  - raw transition error text was returned and rendered
- Root cause:
  - API serialized `err.message` directly
- Fix applied:
  - mapped route errors to provider-safe copy and added client-side network fallback handling
- Residual risk:
  - true offline queueing is still absent; provider must retry manually

### PJ-003
- Title: Photo upload leaked storage errors and handled weak network poorly
- Persona affected: Provider
- Journey affected: Job execution / proof upload
- Severity: High
- Category: Reliability / Error Messaging / Security
- Location in code:
  - `app/api/technician/jobs/[id]/photo/route.ts`
  - `components/technician/PhotoUpload.tsx`
- How to reproduce:
  - upload while offline or when storage fails
  - upload non-image or oversize file
- Expected behavior:
  - provider sees safe retryable messages
- Actual behavior before fix:
  - raw upload/storage error text could be exposed, and network failures could break the client action without clear guidance
- Root cause:
  - server returned `err.message` directly; client had no fetch exception handling
- Fix applied:
  - sanitized upload errors server-side
  - added file preflight checks and explicit network failure handling client-side
- Residual risk:
  - upload is still not idempotent; duplicate evidence can still happen after ambiguous success/failure at the network edge

### PJ-004
- Title: Quote submission surfaced raw fetch failures and routed provider incorrectly after submit/cancel
- Persona affected: Provider
- Journey affected: Quote workflow
- Severity: Medium
- Category: Reliability / Error Messaging
- Location in code:
  - `components/technician/QuoteForm.tsx`
  - `app/(provider)/provider/quotes/[matchId]/page.tsx`
- How to reproduce:
  - submit quote during weak connectivity
  - cancel from provider quote screen
- Expected behavior:
  - clear retryable messaging, and provider stays in `/provider`
- Actual behavior before fix:
  - raw fetch exception text could surface, and navigation targeted technician routes
- Root cause:
  - shared quote form used hardcoded technician base path and generic thrown errors
- Fix applied:
  - added provider-safe client error mapping and provider base path support
- Residual risk:
  - quote submission still lacks true offline retry semantics

### PJ-005
- Title: Provider profile save path has weak validation and no surfaced server-action failure state
- Persona affected: Provider
- Journey affected: Profile readiness
- Severity: Medium
- Category: Validation / Reliability
- Location in code:
  - `app/(provider)/provider/profile/page.tsx`
- How to reproduce:
  - submit malformed portfolio URLs or inconsistent schedule times
- Expected behavior:
  - provider gets explicit validation feedback
- Actual behavior:
  - server action trims values and upserts schedule but does not surface structured validation errors
- Root cause:
  - no shared validation layer on provider profile form
- Fix applied or recommendation:
  - recommendation only; too risky to change blindly without introducing a real surfaced error state
- Residual risk:
  - malformed data can still be saved unless restricted by downstream consumers

### PJ-006
- Title: Provider actions rely on duplicated provider and technician route trees
- Persona affected: Provider
- Journey affected: Multiple
- Severity: Medium
- Category: Architecture / Maintainability
- Location in code:
  - `app/(provider)/provider/*`
  - `app/(technician)/technician/*`
- How to reproduce:
  - compare provider and technician screens and shared components
- Expected behavior:
  - single clear route model or fully safe shared abstractions
- Actual behavior:
  - duplicated trees increase drift risk and already caused provider-path defects
- Root cause:
  - dual route strategy without strict shared path abstraction
- Fix applied or recommendation:
  - partial fix only: shared components now accept explicit base path
- Residual risk:
  - future divergence can reintroduce broken links or inconsistent behavior

## Fixes Applied

### 1. Provider action error mapping
- Files changed:
  - `field-service/lib/provider-action-errors.ts`
  - `field-service/app/api/technician/jobs/[id]/status/route.ts`
  - `field-service/app/api/technician/jobs/[id]/photo/route.ts`
  - `field-service/components/technician/StatusControls.tsx`
  - `field-service/components/technician/PhotoUpload.tsx`
  - `field-service/components/technician/QuoteForm.tsx`
- What changed:
  - introduced shared safe error mapping for provider actions
  - removed raw internal error leakage from status and upload APIs
  - added client-side handling for network failures and expired session/forbidden cases
- Why:
  - reduces internal leakage and improves provider recoverability on weak networks
- Risk reduced:
  - raw error exposure
  - silent or confusing failures during core job execution actions

### 2. Provider path correctness
- Files changed:
  - `field-service/components/technician/JobCard.tsx`
  - `field-service/components/technician/QuoteForm.tsx`
  - `field-service/app/(provider)/provider/page.tsx`
  - `field-service/app/(provider)/provider/quotes/[matchId]/page.tsx`
- What changed:
  - shared components now accept an explicit provider base path
  - provider pages pass `/provider`
- Why:
  - keeps provider users inside the provider app instead of misrouting to technician paths
- Risk reduced:
  - broken navigation in signed-in provider flow

### 3. Upload preflight validation
- Files changed:
  - `field-service/components/technician/PhotoUpload.tsx`
- What changed:
  - added client-side image type and 10 MB size checks before upload
  - reset file input after failure or success to make retries deterministic
- Why:
  - avoids obvious invalid uploads and improves retry behavior
- Risk reduced:
  - failed submissions and unclear upload retry state

## Tests / Verification

### Tests run
- `pnpm vitest run __tests__/lib/provider-action-errors.test.ts __tests__/api/provider-job-actions.test.ts __tests__/lib/jobs.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts`

### Results
- 4 test files passed
- 36 tests passed

### Build
- `pnpm build`
- Result: passed

### Manual verification
- No browser-level provider walkthrough was run in this pass

### What still needs human validation
- provider sign-in → `/provider` job navigation
- provider quote submit/cancel flow on a live page
- provider status transition button behavior on a real assigned job
- provider photo upload from a real mobile device under weak connectivity

## Remaining Risks

1. Provider profile readiness validation is still weak and does not surface structured server-action errors.
2. Photo upload is not idempotent; duplicate evidence can still happen after ambiguous network interruption.
3. Provider quote submission and status updates still rely on manual retry; there is no offline queue or background retry layer.
4. Dual provider/technician route trees remain an architecture drift risk.
5. Assignment offer accept/reject API routes were not changed in this pass; if a UI path is later added, their user-facing failure mapping should be reviewed.

## Summary

The provider journey is materially safer than before this pass:
- provider users stay inside the correct route namespace
- job execution and evidence upload no longer leak raw backend/storage errors
- weak-network failures now degrade to clear retryable messages
- server-side ownership and transition guards remain intact

The biggest remaining gaps are profile validation, lack of true offline retry semantics, and the long-term maintenance risk from duplicated provider/technician route trees.

# Plug-A-Pro Security And Architecture Closure

Date: 2026-04-13  
Scope: final whole-codebase closure pass after the customer, provider, and ops hardening audits  
Goal: identify remaining exploitable weaknesses, architecture integrity issues, and operational risk; apply safe, scoped fixes only

## Prioritized Security Findings

### 1. High: internal error leakage from privileged and provider action routes
- Areas:
  - [field-service/app/api/dispatch/service-requests/[id]/assign/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/assign/route.ts:1)
  - [field-service/app/api/dispatch/service-requests/[id]/override/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/override/route.ts:1)
  - [field-service/app/api/dispatch/service-requests/[id]/candidates/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/candidates/route.ts:1)
  - [field-service/app/api/technician/jobs/[id]/extras/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/technician/jobs/[id]/extras/route.ts:1)
- Risk:
  - server exceptions were being reflected directly to operators/providers
  - internal identifiers like `JOB_REQUEST_NOT_FOUND` and transition details could leak implementation detail and create confusing recovery behavior
- Fix applied:
  - added shared server-side mapping in [field-service/lib/route-action-errors.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/route-action-errors.ts:1)
  - routes now return safe status codes and operator/provider-facing messages without surfacing raw backend exceptions
- Residual risk:
  - claim/release queue actions still need the same explicit audit/logging treatment as other privileged mutations

### 2. High: public quote token actions exposed internal conflict/state codes
- Area:
  - [field-service/app/api/quotes/[token]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/quotes/[token]/route.ts:1)
  - [field-service/components/quotes/QuoteApproval.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/components/quotes/QuoteApproval.tsx:1)
- Risk:
  - tokenized customer quote actions were returning symbolic domain codes like `ALREADY_ACTIONED` and `MISSING_PREFERRED_DATE`
  - the client was also inferring success for stale `ALREADY_ACTIONED` conflicts instead of forcing the user back into the actual current state
- Fix applied:
  - route now maps quote decision errors to safe public messages
  - client now treats stale/expired/conflict responses as explicit user-facing errors instead of guessing success
- Residual risk:
  - token entropy and lifecycle are still a product/security review item; they were not changed blindly in this pass

### 3. High: attachment privacy still depends on proxy discipline rather than storage-layer privacy
- Area:
  - [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1)
- Risk:
  - authz at the proxy route is now stronger, but blob objects remain publicly addressable at the storage layer if raw URLs leak
- Fix status:
  - partially reduced in a follow-up implementation batch
  - new uploads now use randomized blob pathnames
  - upload APIs no longer return raw blob URLs to clients
  - attachment proxy now resolves a server-side download URL before fetching blobs
- Why left untouched:
  - the current `@vercel/blob` SDK/runtime in this repo is still public-upload oriented, so a true private-blob switch needs a deliberate dependency/runtime upgrade and rollout validation
  - storage privacy changes also affect file-serving behavior, cacheability, and migration of already-issued URLs
- Required next step:
  - move sensitive attachments to private storage access patterns or signed URL indirection

### 4. Medium: admin and owner still share the same effective privilege boundary
- Area:
  - [field-service/lib/auth.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/auth.ts:82)
- Risk:
  - `requireAdmin()` admits both `admin` and `owner` with identical runtime authority
  - if product intent expects stricter separation for user management, refunds, or settings, that boundary is not encoded
- Fix status:
  - not changed in this pass
- Why left untouched:
  - role-splitting is a product/ops governance decision and would impact multiple admin routes and workflows

### 5. Medium: public approval/token flows need manual abuse testing
- Areas:
  - [field-service/app/api/quotes/[token]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/quotes/[token]/route.ts:1)
  - [field-service/app/(customer)/approve/[token]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/approve/[token]/page.tsx:1)
  - [field-service/lib/jobs.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/jobs.ts:299)
- Risk:
  - token routes are intentionally public; the remaining question is whether token entropy, expiry, replay behavior, and logging satisfy real-world abuse expectations
- Fix status:
  - no token model changes in this pass
- Required next step:
  - manual pen-testing of token guessing, replay, stale-link reuse, and shared-device leakage

## Prioritized Architecture Findings

### 1. High: route handlers still carry inconsistent error contracts
- Pattern:
  - some routes already used safe user-facing mappers while others still exposed raw exception text
- Impact:
  - operational inconsistency, accidental backend detail leakage, and harder UI recovery logic
- Fix applied:
  - added shared route error mapping in [field-service/lib/route-action-errors.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/route-action-errors.ts:1)
- Recommendation:
  - continue converging server-route error handling into shared mappers per persona instead of ad hoc `catch` blocks

### 2. High: storage/privacy model is weaker than the auth architecture implies
- Pattern:
  - protected attachment access exists at the app layer, but the underlying storage remains public-addressable
- Impact:
  - architecture communicates stronger confidentiality than the storage layer actually guarantees
- Recommendation:
  - align storage privacy with route-level authorization rather than relying on URL secrecy

### 3. Medium: auditability is uneven across privileged workflows
- Pattern:
  - booking, dispute, dispatch override, and status transitions are audited
  - queue claim/release and some failed admin action attempts are not fully audit-logged
- Impact:
  - reduces operational traceability during incident review and staff accountability analysis
- Recommendation:
  - extend audit coverage to queue ownership mutations and failed privileged attempts where operationally useful

### 4. Medium: duplicated provider and technician route trees remain a maintainability risk
- Areas:
  - `/provider/*` and `/technician/*`
- Impact:
  - drift already caused broken provider path behavior earlier in the audit
- Fix status:
  - broken pathing issues were fixed in the provider pass
- Recommendation:
  - consolidate or formalize route ownership boundaries in a later refactor

### 5. Medium: validation remains fragmented across route handlers
- Pattern:
  - validation logic is mostly route-local and persona-specific
- Impact:
  - makes consistency, test coverage, and safe reuse harder than it should be
- Recommendation:
  - introduce shared request schemas for high-risk write paths when doing the next hardening tranche

## Fixes Applied In This Closure Pass

### Safe route-contract hardening
- Added [field-service/lib/route-action-errors.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/route-action-errors.ts:1)
- Hardened:
  - [field-service/app/api/dispatch/service-requests/[id]/assign/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/assign/route.ts:1)
  - [field-service/app/api/dispatch/service-requests/[id]/override/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/override/route.ts:1)
  - [field-service/app/api/dispatch/service-requests/[id]/candidates/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/dispatch/service-requests/[id]/candidates/route.ts:1)
  - [field-service/app/api/technician/jobs/[id]/extras/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/technician/jobs/[id]/extras/route.ts:1)
  - [field-service/app/api/quotes/[token]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/quotes/[token]/route.ts:1)
- Risk reduced:
  - prevents raw backend exception leakage
  - gives operators/providers/customers actionable, non-technical recovery paths
  - makes status codes more aligned with actual failure semantics

### Stale-state quote approval hardening
- Updated [field-service/components/quotes/QuoteApproval.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/components/quotes/QuoteApproval.tsx:1)
- Risk reduced:
  - avoids treating public-token conflict responses as implicit success
  - reduces incorrect customer-side state assumptions during concurrent quote actions

## Tests And Verification

Passed:
- `cd field-service && pnpm vitest run __tests__/lib/route-action-errors.test.ts __tests__/api/provider-job-actions.test.ts __tests__/lib/quotes.test.ts`
- `cd field-service && pnpm build`

Added coverage:
- [field-service/__tests__/lib/route-action-errors.test.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/__tests__/lib/route-action-errors.test.ts:1)
- extended [field-service/__tests__/api/provider-job-actions.test.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/__tests__/api/provider-job-actions.test.ts:1)

Still requiring human validation:
- browser verification of quote approval conflict/expiry states
- authenticated verification of dispatch route error banners
- real storage/privacy verification for attachment URL leakage scenarios

## Items Requiring Manual Penetration Testing Or Product-Owner Review

### Manual penetration testing
- token replay/guessing/stale-link behavior for:
  - quote approvals
  - extra-work approvals
- attachment confidentiality if raw blob URLs leak outside the proxy route
- CSRF/session behavior on authenticated mutation routes using the session cookie
- dispatch/admin action abuse scenarios across real browser sessions and stale tabs

### Product-owner / governance review
- whether `admin` and `owner` should remain equivalent
- whether queue claim/release must be audit-logged as a material privileged action
- whether quote and extra-work approval tokens need explicit expiry/rotation UX beyond current behavior
- whether storage-layer privacy requirements are strong enough to justify a Blob access-model change

## Final Recommendation List By Risk Reduction Impact

1. Move attachment storage off publicly addressable URLs or front it with signed/private access semantics.
2. Split `admin` and `owner` privileges if governance requires different authority over settings, refunds, or user management.
3. Add audit logs for queue claim/release and failed privileged actions that materially affect operations.
4. Run manual penetration testing on all public tokenized approval flows.
5. Add shared schema validation for the highest-risk write endpoints to reduce drift in route-local validation.
6. Standardize server-route error mapping across remaining write handlers so no raw exceptions leak back into persona-facing flows.
7. Add browser-level regression coverage for quote approval conflicts, dispatch failures, and provider extra-work failures.

## Closure Summary

This final pass did not find a new catastrophic auth or webhook-break class issue beyond the residuals already identified in prior audits. The main code-level weaknesses still present were inconsistent route error contracts and stale-state handling in a public quote flow; those are now fixed. The most important remaining risks are architectural and operational rather than simple line-level bugs: storage privacy, role-boundary clarity, audit completeness, and token-flow abuse resistance.

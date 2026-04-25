# 2026-04-20 Periodic Platform Assurance Sweep

Repository: `Plug-A-Pro`
Audit date: `2026-04-20`
Audit mode: whole-platform assurance sweep
Change policy during audit: non-destructive review only

## A. Audit Scope and Context

### Findings

- Scope reviewed:
  - `field-service/` Next.js field-service platform
  - `marketing/` Next.js marketing site
  - Prisma schema and migrations
  - auth/session handling
  - route protection and API surface
  - file storage and attachment access
  - payment and webhook flows
  - cron and operational alerting
  - CI workflows and test surfaces
- Audit evidence sources:
  - repository code and configuration
  - automated test runs
  - lint/build runs
  - route inventory and schema inspection
  - local OpenBrain project context via CLI
- OpenBrain MCP connectors were unavailable during this sweep. Project memory was loaded and logged via the local OpenBrain CLI instead.
- Architectural non-negotiables loaded from OpenBrain:
  - auth tokens should be stored in HttpOnly server-side cookies
  - attachment access should be mediated through an authenticated proxy
  - shared service functions are the preferred place for core business logic
  - `match-leads` cron should run every 30 minutes during business hours
  - legacy string service-area fallback should be treated as a deliberate transition state, not a permanent end state
- Evidence boundaries:
  - no production deployment or live preview environment was audited
  - no external telemetry backend was queried
  - no authenticated browser smoke run was completed because `E2E_BASE_URL`, `E2E_ADMIN_EMAIL`, and `E2E_ADMIN_PASSWORD` were not available in the shell and were not safely derivable from repo state
  - OTP delivery, live Supabase policies, and live third-party provider behavior were not directly exercised

### Analysis

- The audit is strong on repository-level and automated-test evidence.
- The audit is weaker on live environment behavior, browser rendering under real credentials, and external dependency controls because those inputs were unavailable.
- Confidence is therefore highest on code/config drift and medium on runtime functional/security behavior.

### Recommendations

- Treat this document as the new audit baseline for future sweeps.
- Add a non-production audit environment with seeded admin credentials so the Playwright smoke suite can be run during periodic assurance without secret discovery.
- Restore OpenBrain MCP connectivity so future sweeps do not depend on CLI fallback.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- All remediation items are deferred into Section J.

## B. Current-State Implementation Summary

### Findings

- The repository currently contains two actively implemented Next.js applications:
  - `field-service/`: the main platform application
  - `marketing/`: the public marketing and lead-capture site
- Current route inventory observed:
  - `field-service`: `56` `page.tsx` routes and `38` API route handlers
  - `marketing`: `21` `page.tsx` routes and `2` API route handlers
- The actual auth model in `field-service` is:
  - customer: phone OTP
  - provider: phone OTP
  - technician: legacy alias routes still present
  - admin/owner: email and password
- Auth/session resolution is driven by Supabase user identity plus `user_metadata.role` in [field-service/lib/auth.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/auth.ts:57) and route enforcement in [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:56).
- Session persistence is implemented with an HttpOnly `sb-access-token` cookie in [field-service/app/api/auth/session/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:16).
- Prisma models observed in current schema include `Customer`, `Provider`, `PushSubscription`, `JobRequest`, `Booking`, `Attachment`, `Payment`, and `AuditLog` in [field-service/prisma/schema.prisma](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/prisma/schema.prisma:17).
- Operational platform features currently implemented include:
  - admin console with queue-based ops surfaces
  - customer booking and booking tracking flows
  - provider job and quote flows
  - attachment proxying
  - payment abstraction and webhook handling
  - WhatsApp integration and policy logic
  - scheduled jobs in [field-service/vercel.json](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/vercel.json:1)
  - health check route in [field-service/app/api/health/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/health/route.ts:1)
- A durable audit trail helper exists in [field-service/lib/audit.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/audit.ts:1).
- There is no evidence of an implemented subscription, billing-plan entitlement, or feature-entitlement enforcement layer in the current application code or Prisma schema.

### Analysis

- The platform is no longer a simple three-role PWA. It has evolved into a more complex marketplace and ops system with matching, queue health, audit logging, cron-driven operations, and WhatsApp automation.
- The codebase reflects a single-business marketplace architecture rather than a generalized SaaS entitlement model.
- The implementation is materially ahead of the public documentation in some areas and materially behind it in others, which increases operational ambiguity.

### Recommendations

- Update the canonical architecture description to match the actual provider/customer/admin operating model and route layout.
- Explicitly document that subscription and plan entitlements are not yet implemented, or implement them and enforce them centrally.
- Promote a single source of truth for auth, payment, and storage architecture to reduce drift between docs, env examples, and runtime code.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- Architecture and documentation alignment is deferred into Section J.

## C. Functional Testing Results

### Findings

- Executed automated checks:
  - `cd field-service && pnpm test`: passed, `302` tests passed, `1` skipped, `4` todo
  - `cd marketing && pnpm test`: passed, `31` tests passed
  - `cd field-service && pnpm lint`: no errors surfaced
  - `cd marketing && pnpm lint`: failed
  - `cd marketing && pnpm build`: passed
  - `cd field-service && pnpm build`: failed during page-data collection after compile/type-check
- Functional matrix:

| Area | Status | Evidence | Notes |
| --- | --- | --- | --- |
| Customer session persistence | Pass | `auth.test.ts`, `auth.ts`, `/api/auth/session` | Cookie issuance and clearing are covered in tests and code |
| Customer account linking | Pass | `auth.test.ts`, `/api/auth/link` | Verified by API tests for phone-matched link flow |
| Attachment authorization | Pass | `attachments-authz.test.ts`, attachment proxy route | Ownership checks and token-scoped access are covered in tests and code |
| Webhook signature handling | Pass | `webhooks-security.test.ts`, webhook routes | Signature verification paths are covered in tests and code |
| Health endpoint | Pass | `health.test.ts`, `/api/health` | Database-backed health check route present and tested |
| Marketing lead capture backend | Pass | `marketing/__tests__/api/leads.test.ts`, `lead-magnet.test.ts`, successful build | API validation and persistence paths have direct tests |
| Field-service local production build | Fail | local `pnpm build` run | Build failed because Next could not resolve `next/dist/client/components/builtin/global-not-found.js` during page-data collection |
| Marketing lint quality gate | Fail | local `npm run lint` run | ESLint fails on unescaped entities, hook usage, and CommonJS import style |
| Admin browser smoke | Blocked | Playwright suite exists in `field-service/e2e/smoke.spec.ts` | Could not run safely without base URL and audit credentials |
| OTP login, logout, and verification UX | Blocked | sign-in/verify routes present | Live OTP delivery and browser execution not available in audit scope |
| User onboarding and lifecycle | Partial | code routes and seed data | Core paths exist, but end-to-end runtime behavior was not directly exercised |
| Plan-based feature access | Not implemented | no entitlement layer observed | Scope item not present in current implementation |
| Dashboard and admin summaries | Partial | admin pages and ops dashboard code present | Rendering and role-gated browser verification were blocked |
| Reports, analytics, and exports | Partial | admin routes exist | Runtime output not directly exercised |
| File upload/import processing | Partial | attachment/photo upload code and tests | Browser upload path not directly exercised |
| Chatbot and in-app guidance | Partial | marketing `/api/chat` and AI elements present | Live model calls were not executed in this sweep |

- Confirmed functional defects and gaps:

| ID | Severity | Business impact | Issue | Reproduction |
| --- | --- | --- | --- | --- |
| FUNC-001 | High | Release confidence, deployment risk | `field-service` local production build currently fails | `cd field-service && pnpm build` |
| FUNC-002 | Medium | CI hygiene, release noise | `marketing` lint gate is currently red | `cd marketing && npm run lint` |
| FUNC-003 | Medium | Scope completeness | No implemented subscription or plan-entitlement enforcement was found | repo inspection |

### Analysis

- Backend logic and API behavior have materially better assurance coverage than browser-level user journeys.
- The strongest functional evidence is around auth APIs, attachment authorization, webhooks, and marketing lead capture.
- The weakest evidence is around real browser journeys for admin, provider, customer OTP flows, and AI chat runtime behavior.
- The local `field-service` build failure is the highest-confidence functional break identified during this sweep because it is directly reproducible.

### Recommendations

- Fix the `field-service` build break immediately and add a regression check for the failing Next artifact path.
- Repair marketing lint so the declared CI quality gate reflects a passing baseline.
- Add non-production audit credentials and a stable preview URL so the existing Playwright smoke suite can actually be run as part of future sweeps.
- If plan entitlements are a product requirement, implement them centrally instead of allowing pricing/plan messaging to outpace enforcement.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- `FUNC-001`, `FUNC-002`, and the entitlement gap are deferred into Section J.

## D. Regression Testing Results

### Findings

- Confirmed regression and drift risks:

| ID | Severity | Impact | Observed regression or drift | Evidence |
| --- | --- | --- | --- | --- |
| REG-001 | High | Support, onboarding, security expectations | Documentation still states technician email/password auth and owner MFA, but the actual code uses provider phone OTP and shows no owner MFA implementation evidence | [README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/README.md:36), [field-service/README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/README.md:41), [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:11) |
| REG-002 | High | Payments rollout, config safety | Runtime payment abstraction defaults to Peach, while env example and repo docs position PayFast as the active PSP | [field-service/lib/payments.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/payments.ts:1), [field-service/.env.local.example](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/.env.local.example:42), [README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/README.md:41) |
| REG-003 | High | Security posture | Attachment route comments describe private-by-default blob handling, but upload helpers still write blobs with `access: 'public'` | [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1), [field-service/lib/storage.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/storage.ts:30) |
| REG-004 | High | Release assurance | Local `field-service` production build is broken even though the repo still advertises standard build flow | local `pnpm build` result, [field-service/package.json](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/package.json:5) |
| REG-005 | Medium | PR safety | `field-service` build is not required on pull requests and is gated by secret availability on push | [.github/workflows/field-service-ci.yml](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/.github/workflows/field-service-ci.yml:1) |
| REG-006 | Medium | Terminology consistency | Provider and technician concepts coexist in routes, docs, tests, and UI copy, increasing maintenance drift | [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:12), [field-service/README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/README.md:41) |

- Regression protection strengths:
  - attachment authorization has a dedicated regression test file
  - auth APIs have dedicated regression coverage
  - webhook security has dedicated regression coverage
  - WhatsApp flows and matching logic have broad unit coverage
- Areas with weak or missing regression protection:
  - authenticated browser flows
  - deployment/build health on pull requests
  - documentation parity checks
  - payment-provider configuration parity
  - subscription and entitlement behavior

### Analysis

- The main regression pattern is not only feature breakage; it is baseline drift between runtime behavior, documentation, environment examples, and CI expectations.
- This kind of drift creates operational regressions even when unit tests remain green.
- The repo has strong logic-level tests, but it lacks enough cross-surface regression protection to catch build, documentation, and deployment drift early.

### Recommendations

- Make `field-service` build mandatory on pull requests.
- Add a small parity checklist or smoke test for auth model, active PSP, and attachment security mode.
- Collapse technician/provider terminology to one canonical operating model.
- Treat outdated README and env guidance as regression defects, not low-priority documentation debt.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- All confirmed regressions are deferred into Section J.

## E. Security Vulnerability Assessment

### Findings

- Confirmed preventive controls present:
  - HttpOnly session cookie issuance in [field-service/app/api/auth/session/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:16)
  - route-level role enforcement in [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:56)
  - attachment ownership checks and token-scoped access in [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:66)
  - webhook signature validation for payments and WhatsApp
  - cron-secret enforcement in cron routes such as [field-service/app/api/cron/ops-alerts/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/cron/ops-alerts/route.ts:21)
  - Zod validation on marketing lead intake in [marketing/app/api/leads/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/app/api/leads/route.ts:10)
  - file size and MIME validation in [field-service/lib/storage.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/storage.ts:120)
- Confirmed detective and corrective controls present:
  - audit-log helper in [field-service/lib/audit.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/audit.ts:6)
  - health endpoint in [field-service/app/api/health/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/health/route.ts:1)
  - ops-alert cron with cooldown tracking in [field-service/app/api/cron/ops-alerts/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/cron/ops-alerts/route.ts:31)
- Severity-rated security findings:

| ID | Severity | Impact | Finding | Evidence |
| --- | --- | --- | --- | --- |
| SEC-001 | High | Customer/provider data exposure | Attachment uploads are still written to Vercel Blob with `access: 'public'`; the authenticated proxy is acting as a compensating control, not true storage isolation | [field-service/lib/storage.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/storage.ts:30), [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:133) |
| SEC-002 | Medium | Spam, abuse, noisy data, operational cost | Marketing lead intake uses a known best-effort in-memory rate limiter that resets on cold start and does not provide durable abuse protection | [marketing/app/api/leads/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/app/api/leads/route.ts:49) |
| SEC-003 | Medium | Brute force and enumeration exposure | No repo evidence of durable app-side throttling for OTP entry, admin sign-in, attachment fetches, or session-creation endpoints; upstream provider controls were not verifiable in this sweep | [field-service/app/api/auth/session/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/auth/session/route.ts:25), [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:85), [field-service/app/(auth)/admin-sign-in/page.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/(auth)/admin-sign-in/page.tsx:1) |
| SEC-004 | Medium | XSS blast radius, policy weakness | `field-service` ships a global CSP that still allows `unsafe-inline` and `unsafe-eval`; `marketing` sets headers but no CSP was observed | [field-service/next.config.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/next.config.ts:13), [marketing/next.config.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/next.config.ts:1) |
| SEC-005 | Medium | Admin-account takeover risk | Owner MFA is documented but no MFA enforcement implementation was evidenced in current auth code | [field-service/README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/README.md:80), [field-service/lib/auth.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/auth.ts:57), [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:11) |
| SEC-006 | Medium | Privilege drift and governance risk | Authorization decisions rely on Supabase `user_metadata.role` rather than an application-side entitlement or privileged-role source of truth | [field-service/lib/auth.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/auth.ts:73), [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:107) |

- Control gap analysis:
  - Preventive controls:
    - present: signed session cookie, role guards, webhook verification, MIME validation, cron secrets
    - missing or weak: durable rate limiting, stronger CSP, MFA evidence, true private attachment storage
  - Detective controls:
    - present: audit log, queue alerting, console logging, health probe
    - missing or weak: external error monitoring, suspicious activity detection, structured security analytics
  - Corrective controls:
    - present: admin error boundaries, cooldown-based ops alerting, session timeout cron
    - missing or weak: incident automation, lockout workflows, centralized alert routing
  - Compensating controls:
    - attachment auth proxy partly compensates for public blob writes
  - Administrative controls:
    - not verifiable from repo evidence
  - Physical controls:
    - not applicable in accessible repo scope

### Analysis

- The platform has a reasonable baseline of application-layer security controls, especially around auth cookies, webhook verification, and object ownership checks.
- The largest security concern is not a single broken endpoint; it is the mismatch between intended security posture and actual operational controls:
  - public blob storage plus proxy compensation
  - weak abuse controls at public ingress points
  - missing external detective telemetry
  - documented but unverified MFA expectations
- No direct evidence of SQL injection, unsafe raw query construction, or broken attachment ownership was found in accessible scope.
- CSRF, SSRF, and live CORS behavior were not fully verified against a running environment and should be treated as partially assessed.

### Recommendations

- Move attachments to true private storage or rotate/migrate all public blob objects behind signed or fully private retrieval.
- Add durable rate limiting for public and auth-sensitive endpoints using Redis or equivalent shared infrastructure.
- Tighten CSP policies, especially for `field-service`, and add a CSP for `marketing`.
- Implement or explicitly remove owner MFA expectations; current documentation should not overstate security posture.
- Consider a DB-backed privileged-role and entitlement assertion layer for admin/owner access.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- `SEC-001` through `SEC-006` are deferred into Section J.

## F. Architectural Drift Assessment

### Findings

- Drift items grouped by domain:

| Domain | Severity | Drift item | Evidence | Impact |
| --- | --- | --- | --- | --- |
| Auth architecture | High | Docs still describe technician email/password and owner MFA, while runtime model is customer/provider phone OTP plus admin email/password | [README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/README.md:36), [field-service/README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/README.md:41), [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:11) | Support confusion, invalid audit assumptions, security overstatement |
| Payment architecture | High | Runtime default is Peach Payments but env/docs position PayFast as primary | [field-service/lib/payments.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/payments.ts:1), [field-service/.env.local.example](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/.env.local.example:42) | Wrong production configuration and broken payment rollout risk |
| Storage/security boundary | High | Attachment route describes private-by-default posture, but upload helpers still create public blobs | [field-service/app/api/attachments/[id]/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1), [field-service/lib/storage.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/storage.ts:30) | Security boundary drift and audit mismatch |
| Naming and component semantics | Medium | Provider and technician naming remain mixed across routes, tests, docs, and UI | [field-service/proxy.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/proxy.ts:12), [field-service/README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/README.md:53) | Higher maintenance cost and developer error risk |
| Testing strategy | Medium | Playwright smoke exists but is not wired into package scripts or CI workflows | [field-service/playwright.config.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/playwright.config.ts:1), [field-service/e2e/smoke.spec.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/e2e/smoke.spec.ts:1), [.github/workflows/field-service-ci.yml](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/.github/workflows/field-service-ci.yml:1) | Browser regressions can escape into releases |
| Operability/observability | Medium | Error boundaries explicitly say to forward to observability later, indicating intended monitoring architecture is not yet wired | [field-service/app/(admin)/admin/error.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/(admin)/admin/error.tsx:17) | Lower incident visibility and slower support response |
| SaaS operating model | Medium | Pricing and venture language exist, but no subscription or entitlement architecture was found | [README.md](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/README.md:3), repo/schema inspection | Product/architecture mismatch if SaaS monetization is expected |

### Analysis

- The dominant architectural drift pattern is split authority:
  - docs say one thing
  - env examples say another
  - runtime code does a third
- This raises assurance cost because every sweep must first rediscover the true baseline.
- The platform is operationally richer than the docs suggest, but also less formally hardened than the docs imply.

### Recommendations

- Re-baseline architecture docs immediately after fixing payment/auth/storage contradictions.
- Collapse provider/technician terminology to one bounded context and route language.
- Decide explicitly whether the platform is remaining single-business marketplace software or moving toward a multi-tenant SaaS entitlement model, then align schema and access boundaries accordingly.
- Turn intended observability and security patterns into implemented platform primitives rather than comments and future hooks.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- All architectural drift items are deferred into Section J.

## G. Testing and Quality System Review

### Findings

- Current automated quality surface:
  - `field-service`: strong Vitest coverage across auth APIs, attachment authorization, health, webhooks, matching, jobs, provider flows, WhatsApp flows, and queue logic
  - `marketing`: tests exist for lead capture, lead magnet flow, chat context, content, and metadata
  - browser smoke exists only in `field-service/e2e/smoke.spec.ts`
- CI workflows:
  - `field-service`: lint and test on push and PR, build only on push and only when secrets/vars allow it
  - `marketing`: lint, test, and build on push and PR
- Quality gaps:
  - no evidence of enforced coverage thresholds
  - no contract/API schema tests were observed
  - no automated browser smoke is currently wired into CI for `field-service`
  - no stable, documented test credentials for authenticated E2E audits were observed
  - local `field-service` build failure means the current quality system is not fully protecting deployability
  - `marketing` lint is currently red, meaning the baseline is already below the declared quality bar
- Flakiness:
  - no flaky tests were observed from this single run
  - this sweep did not perform repeated-run flake analysis

### Analysis

- The quality system is strong at logic-level regression prevention in `field-service`.
- The weakest area is cross-layer release validation:
  - build health
  - authenticated browser flows
  - environment-sensitive behavior
- `marketing` is less mature than `field-service` from a quality-gate perspective because the lint baseline is already broken.

### Recommendations

- Minimum CI quality gates:
  - on every PR: lint, test, and build for both apps
  - on preview or protected branches: Playwright smoke for authenticated admin routes
  - migration-safe Prisma generation and schema validation
- Add coverage reporting and enforce floor thresholds for critical modules.
- Add explicit auth and abuse-control tests for admin sign-in, OTP initiation, and rate limiting once durable throttling is implemented.
- Add a documented non-production audit fixture strategy for admin and provider users.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- Testing and CI hardening is deferred into Section J.

## H. Observability and Operability Review

### Findings

- Observability and operability strengths:
  - DB-backed health check in [field-service/app/api/health/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/health/route.ts:1)
  - audit-log writes in operational workflows through [field-service/lib/audit.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/lib/audit.ts:6)
  - scheduled ops alerting in [field-service/app/api/cron/ops-alerts/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/cron/ops-alerts/route.ts:21) and [field-service/vercel.json](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/vercel.json:1)
  - queue health and operational dashboard surfaces in admin pages
- Observability and operability gaps:

| ID | Severity | Impact | Gap | Evidence |
| --- | --- | --- | --- | --- |
| OPS-001 | High | Incident response, debugging speed | No external error monitoring or tracing pipeline was evidenced; admin error boundary still contains a placeholder comment to wire one later | [field-service/app/(admin)/admin/error.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/(admin)/admin/error.tsx:17) |
| OPS-002 | Medium | Support visibility | Logs are primarily `console.*` statements rather than a structured logging pipeline with searchable correlation IDs | repo-wide logging inspection |
| OPS-003 | Medium | Health blind spots | `/api/health` checks database reachability only; it does not verify Supabase auth, Blob access, WhatsApp provider health, or payment provider reachability | [field-service/app/api/health/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/health/route.ts:1) |
| OPS-004 | Medium | Alert routing resiliency | Ops alerts currently depend on a single WhatsApp admin notification path and audit-log cooldown tracking | [field-service/app/api/cron/ops-alerts/route.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/field-service/app/api/cron/ops-alerts/route.ts:7) |
| OPS-005 | Medium | Marketing-site supportability | Marketing app shows error logging and analytics hooks but no equivalent operational diagnostics or health surface | [marketing/app/error.tsx](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/app/error.tsx:13), [marketing/lib/analytics.ts](/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug-A-Pro/marketing/lib/analytics.ts:14) |

### Analysis

- The platform is operable by an engineer with code access, but it is not yet operable in a mature support or incident-management sense.
- Audit logging is a strong internal primitive.
- External visibility, alert fan-out, and dependency health are materially underdeveloped compared with the complexity of the platform.

### Recommendations

- Add external error monitoring and release tracking for both apps.
- Introduce structured logging with request IDs across critical API routes and cron jobs.
- Expand health checks to cover dependency reachability and key secrets/config readiness.
- Add secondary alert paths beyond a single WhatsApp destination.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- Observability and operability hardening is deferred into Section J.

## I. Consolidated Risk Summary

### Findings

- Overall assurance view:
  - functional confidence: moderate
  - security confidence: moderate for code-level controls, low-to-moderate for operational hardening
  - architectural coherence: moderate with material drift
  - production readiness confidence: reduced by build drift and weak live smoke coverage
- Severity summary in accessible scope:
  - Critical: `0`
  - High: `8`
  - Medium: `11`
  - Low: `0`
- Systemic issues:
  - documentation, env, and runtime divergence
  - insufficient release gates for build and authenticated browser behavior
  - compensating controls being treated as final-state architecture
  - weak external observability relative to platform complexity

- Top 10 issues by business importance:
  1. `field-service` local production build failure
  2. public attachment storage despite auth-proxy intent
  3. PSP baseline drift between runtime and env/docs
  4. auth and MFA documentation drift
  5. missing durable rate limiting on public ingress
  6. no enforced browser smoke in CI for admin routes
  7. lack of external error monitoring
  8. missing subscription/entitlement enforcement despite platform-scope expectations
  9. provider/technician terminology split
  10. marketing lint baseline currently broken

- Top 10 issues by technical risk:
  1. public blob writes for attachments
  2. `field-service` build failure
  3. payment architecture contradiction
  4. auth-model contradiction between docs and runtime
  5. missing durable abuse controls
  6. weak CSP posture
  7. role enforcement based only on auth metadata
  8. CI build protection missing on pull requests
  9. observability placeholder instead of pipeline
  10. health checks covering DB only

### Analysis

- No single catastrophic code exploit was proven in accessible scope.
- The biggest near-term risk is compounded operational drift: the platform is becoming harder to reason about than it should be.
- If left alone, these issues will raise the cost of every release, incident, and future audit.

### Recommendations

- Prioritize remediation by release safety first, then data exposure, then abuse prevention, then observability.
- Use the remediation sequencing in Section J rather than fixing low-signal drift items in isolation.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- All risk items are deferred into Section J.

## J. Prioritized Remediation Plan

### Findings

- Immediate hotfixes:

| Priority | Issue | Root cause | Proposed fix | Affected area | Effort | Risk if deferred | Suggested owner | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `field-service` build fails locally | toolchain/runtime drift in Next build artifact resolution | reproduce in clean install, pin failing dependency state, repair build, and add PR build gate | `field-service` build and CI | Medium | releases remain untrustworthy | platform engineer | `pnpm build` green locally and in CI |
| 2 | attachments still stored publicly | storage implementation lagged behind intended security model | migrate uploads to private access or signed/private retrieval and rotate exposed objects where needed | attachment storage and retrieval | Medium | file exposure risk persists | backend/security engineer | access test proves direct blob URL no longer bypasses auth |
| 3 | marketing lead abuse control is weak | in-memory limiter used as production control | replace with shared durable rate limiter and add logging/alerts on abuse | `marketing/app/api/leads/route.ts` | Small | spam and noisy data persist | growth/platform engineer | repeated distributed requests are throttled correctly |
| 4 | docs/env/runtime contradict on PSP and auth model | no enforced architecture baseline | update docs and env examples after deciding canonical runtime behavior | root docs, field-service docs, env examples | Small | misconfiguration and bad operator decisions continue | tech lead | docs, env, and runtime match exactly |

- Short-term engineering fixes:

| Priority | Issue | Root cause | Proposed fix | Affected area | Effort | Risk if deferred | Suggested owner | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5 | no PR build gate for `field-service` | workflow only builds on push with secrets gating | run build on pull requests using safe CI env strategy | `.github/workflows/field-service-ci.yml` | Small | regressions keep landing before build validation | platform engineer | PR build required and passing |
| 6 | Playwright smoke is unused | test exists but is not operationalized | wire preview-based smoke into CI with stable audit creds | `field-service/e2e`, CI | Medium | admin route regressions remain latent | QA/platform engineer | preview smoke runs on protected branches |
| 7 | no external error monitoring | observability design not implemented | integrate Sentry or equivalent in both apps and release pipeline | both apps | Medium | incident triage stays slow and incomplete | platform engineer | forced errors appear in monitoring with release tags |
| 8 | owner MFA expectation is unsupported | documentation outpaced implementation | either implement MFA for privileged roles or remove the claim and add a tracked gap | auth model | Medium | admin-account risk remains ambiguous | security/platform engineer | MFA enforced for owner/admin or docs corrected |
| 9 | weak global CSP posture | permissive defaults remained in production config | tighten `field-service` CSP and add CSP to `marketing` | both apps | Medium | XSS blast radius remains larger than necessary | security/frontend engineer | headers verified in runtime response |

- Medium-term architectural cleanup:

| Priority | Issue | Root cause | Proposed fix | Affected area | Effort | Risk if deferred | Suggested owner | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 | provider vs technician naming split | historical transition left dual terminology in place | choose canonical role language and remove legacy aliases where safe | routes, docs, tests, UI copy | Medium | maintenance and support confusion grow | tech lead | terminology consistent across app/docs/tests |
| 11 | authorization depends on auth metadata only | privileged roles not asserted from app-side source | introduce DB-backed privileged-role checks or allowlist for admin/owner paths | auth and admin enforcement | Medium | privilege drift risk remains | backend/security engineer | admin access validated against app-side control |
| 12 | health and alerting are narrow | operability grew faster than monitoring | add dependency health checks, structured logs, and multi-channel alert routing | ops surfaces and API runtime | Medium | outages remain harder to detect and diagnose | platform engineer | degraded dependencies surface through health and alerts |

- Long-term platform improvements:

| Priority | Issue | Root cause | Proposed fix | Affected area | Effort | Risk if deferred | Suggested owner | Validation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 13 | missing plan-entitlement layer | product scope and platform architecture are misaligned | implement central subscription and entitlement service, or formally narrow product claims | cross-platform | Large | future monetization and access control stay ad hoc | product + tech lead | features enforce plan state consistently |
| 14 | audit execution still depends on manual setup | assurance workflow is not fully productized | create a repeatable audit harness with seeded accounts, preview URL, and OpenBrain MCP health checks | engineering process | Medium | periodic audits stay expensive and inconsistent | platform lead | next sweep runs with less manual discovery |

### Analysis

- The remediation sequence intentionally starts with release trust and data-exposure control.
- Architectural cleanup should not come before build, storage, and abuse hardening.
- Subscription/entitlement work is important only after the current operational baseline is coherent.

### Recommendations

- Execute priorities `1` through `4` before the next materially risky release.
- Treat priorities `5` through `9` as the next assurance sprint.
- Re-run a focused mini-audit after priorities `1` through `9` are complete.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- All backlog items remain deferred pending execution ownership.

## K. OpenBrain Logging Summary

### Findings

- OpenBrain memory was loaded and updated through the local CLI because MCP connectivity was unavailable.
- Logged during this sweep:
  - `Periodic platform assurance sweep kickoff — 2026-04-20`
  - `OpenBrain connector outage observed during assurance sweep — 2026-04-20`
  - `Assurance sweep phase summary — discovery and automated checks`
- Additional final-summary entries should be recorded after this report is accepted as the sweep baseline.

### Analysis

- The audit memory trail exists, but connector health is itself now an operability issue for future sweeps.

### Recommendations

- Restore OpenBrain MCP access before the next audit cycle.
- Store the final consolidated findings and remediation baseline as separate OpenBrain entries for easier comparison in the next sweep.

### Fixes Applied

- None during this audit.

### Fixes Deferred

- Final summary logging and connector restoration are deferred into the next step after this report is written.

## L. Suggested cadence for next audit cycle

### Findings

- Recommended cadence:
  - every pull request:
    - lint, test, and build both apps
    - run preview smoke where credentials exist
  - weekly:
    - authenticated smoke against admin routes
    - dependency and build-health check
  - monthly:
    - focused security-control review
    - documentation/env/runtime parity review
  - quarterly:
    - full platform assurance sweep using this template
  - after any auth, payment, storage, or routing change:
    - targeted mini-audit within the same release cycle

### Analysis

- The current rate of platform change is high enough that a quarterly full sweep plus monthly hardening review is justified.

### Recommendations

- Use this document as the template baseline.
- Compare the next sweep explicitly against:
  - build health
  - attachment storage mode
  - active PSP
  - auth model
  - observability wiring
  - CI quality gates

### Fixes Applied

- None during this audit.

### Fixes Deferred

- Cadence adoption is a process decision and remains deferred.

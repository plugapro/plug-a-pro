# Plug A Pro — Release Readiness Tracker

> **Updated:** 2026-04-08
> **Branch:** `feat/whatsapp-marketing-preferences`
> **Apps:** `field-service/` (marketplace) · `marketing/` (site)

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Closed — evidence in this doc |
| 🔴 | Blocker — must close before go-live |
| 🟡 | Pre-production — complete before go-live |
| 🔵 | Post-launch hardening (first 30 days) |
| ⬜ | Not started |
| 🔄 | In progress |

---

## Priority 0 — Deploy / Test Baseline

### P0-0 · WhatsApp templates approved in Meta
| Field | Value |
|-------|-------|
| Status | 🔄 In progress — 20 approved, 2 pending (`quote_ready`, `technician_assigned`) |
| Owner | operator |
| Evidence | Live API check 2026-04-09 |
| Updated | 2026-04-09 |

**WABA confirmed:** `<PRODUCTION_WABA_ID>` is the production WABA under "Kgolaentle Holdings". Phone number +27 69 355 2447. This is not a sandbox account.

**Live status as of 2026-04-09 (verified via Graph API):**

| Template | Status | Category (Meta) |
|----------|--------|-----------------|
| `booking_confirmation` | ✅ APPROVED | UTILITY |
| `booking_cancelled` | ✅ APPROVED | UTILITY |
| `booking_reminder` | ✅ APPROVED | UTILITY |
| `booking_rescheduled` | ✅ APPROVED | UTILITY |
| `extra_work_approval` | ✅ APPROVED | UTILITY |
| `follow_up` | ✅ APPROVED | UTILITY |
| `job_completed` | ✅ APPROVED | UTILITY |
| `job_offer` | ✅ APPROVED | MARKETING |
| `no_technician_available` | ✅ APPROVED | UTILITY |
| `payment_received` | ✅ APPROVED | UTILITY |
| `payment_reminder` | ✅ APPROVED | UTILITY |
| `slot_available` | ✅ APPROVED | MARKETING |
| `technician_application_declined` | ✅ APPROVED | UTILITY |
| `technician_application_received` | ✅ APPROVED | UTILITY |
| `technician_arrived` | ✅ APPROVED | UTILITY |
| `technician_job_reminder` | ✅ APPROVED | UTILITY |
| `technician_on_the_way` | ✅ APPROVED | UTILITY |
| `technician_payment_released` | ✅ APPROVED | UTILITY |
| `technician_welcome` | ✅ APPROVED | MARKETING |
| `quote_ready` | 🔄 PENDING | **MARKETING** (Meta reclassified from our UTILITY submission) |
| `technician_assigned` | 🔄 PENDING | UTILITY |

**Critical finding — `quote_ready` category mismatch (resolved 2026-04-09):**
Meta overrode our UTILITY submission and classified `quote_ready` as MARKETING. Code updated accordingly: `lib/messaging-templates.ts` category changed to `MARKETING`. `canSend()` will now gate on `whatsappMarketingOptIn`. CLAUDE.md template table updated.

**Critical path:** `quote_ready` still PENDING. Marketplace quote delivery loop is blocked until Meta approves it. `technician_assigned` is also PENDING but not on critical path.

**Remaining gate:** Wait for Meta to approve `quote_ready` and `technician_assigned`. Re-verify:
```bash
# Pass the token in the Authorization header, never as an access_token query
# parameter (query-string credentials leak via proxy/process/CLI logs).
source field-service/.env.production.local
curl -s \
  -H "Authorization: Bearer ${WHATSAPP_ACCESS_TOKEN}" \
  "https://graph.facebook.com/v21.0/${WHATSAPP_WABA_ID}/message_templates?limit=200&fields=name,status,category" \
  | python3 -m json.tool
```

---

### P0-1 · Field-service test suite green
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering |
| Files changed | `field-service/__tests__/lib/whatsapp-policy.test.ts` |
| Evidence | `107 passed, 4 todo` — all tests pass (2026-04-09) |

**Root cause:** Commit `b0c900b` reclassified `booking_cancelled` and `quote_ready` from MARKETING → UTILITY. Tests 3 and 4 of `whatsapp-policy.test.ts` still referenced `booking_cancelled` expecting MARKETING behaviour. Fixed by switching to `slot_available` (a true MARKETING template).

---

### P0-2 · Marketing test suite green
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering |
| Files changed | `marketing/__tests__/lib/chat-context.test.ts` |
| Evidence | `16 passed` — all tests pass |

**Root cause:** Stale placeholder assertion `expect(prompt).toContain("My Product")` — actual product name is `Plug A Pro`. Fixed by updating the assertion.

---

### P0-3 · CI release gates (lint + test + build)
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | platform/SRE |
| Files changed | `.github/workflows/field-service-ci.yml`, `.github/workflows/marketing-ci.yml`, `field-service/eslint.config.mjs`, `field-service/package.json` |
| Evidence | Workflows created and committed. `lint-and-test` job runs on every PR. `build` job runs on push to main (requires secrets). `npm run lint` fixed: Next.js 16 removed `next lint`; replaced with `eslint .` + `eslint.config.mjs` (flat config). 0 lint errors locally. |

Local verification commands:
```bash
# field-service
cd field-service && npm run lint && npm run test && npm run build

# marketing
cd marketing && npm run lint && npm run test && npm run build
```

---

### P0-4 · Migration baseline — fresh environment reproducible
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | data / engineering |
| Files | `field-service/prisma/migrations/20260327000000_baseline/migration.sql`, `field-service/prisma/migrations/20260402141355_whatsapp_preferences/` |
| Evidence | `_prisma_migrations` table created and baseline record inserted 2026-04-08 via Supabase SQL Editor |

**Progress (2026-04-06):**
- `prisma/migrations/20260327000000_baseline/migration.sql` — **created** (609 lines). Generated via `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script`. Sorts before `20260402141355_whatsapp_preferences`, so `prisma migrate deploy` on a blank DB now creates the full schema in the correct order.
- Migration path documented in `docs/release-runbook.md`.

**Completed 2026-04-08:**
- Direct DB connection from local environment was blocked (Supabase blocks port 5432 externally).
- Used Supabase SQL Editor to: (1) create `_prisma_migrations` table (was absent — schema was applied directly, not via Prisma migrate), (2) insert `20260327000000_baseline` row with `applied_steps_count=1`.
- SELECT confirmed: `20260327000000_baseline | 2026-04-08 19:44:55+00 | 1` — 1 row returned.
- `prisma migrate status` will now show no drift for the baseline. The `20260402141355_whatsapp_preferences` migration must still be applied via `prisma migrate deploy` on the live DB (or via SQL Editor) before go-live if not already present.

**Completed 2026-04-09:**
- Applied `20260402141355_whatsapp_preferences` and `20260409103000_assurance_second_sweep` to production DB via Supabase MCP `apply_migration`.
- Schema verified post-apply: `whatsapp_preference_logs` ✅, `inbound_whatsapp_messages` ✅, `onboarding_intakes` ✅, `JobStatus.CANCELLED` ✅, `message_events.direction` ✅.
- Both migrations recorded in `_prisma_migrations` with correct checksums. `prisma migrate deploy` will detect no pending migrations.

---

## Priority 1 — Stop-Ship Blockers

### P1-A · Auth / session security — JS-readable tokens
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | security |
| Files | `field-service/app/(auth)/verify/page.tsx`, `field-service/app/(auth)/provider-verify/page.tsx`, `field-service/app/(auth)/admin-sign-in/page.tsx`, `field-service/app/(auth)/technician-verify/page.tsx`, `field-service/proxy.ts` |
| Evidence required | Passing auth tests; token cookie is `HttpOnly`; staging sign-in/sign-out walkthrough |

**Issues found:**

1. **JS-readable cookie (XSS vector):** All four auth pages write the Supabase access token using:
   ```js
   document.cookie = `sb-access-token=${data.session.access_token}; path=/; max-age=...; SameSite=Lax`
   ```
   The cookie has **no `HttpOnly` flag**, meaning any injected JavaScript can steal the token.

2. **`/api/auth/link` trusts client-supplied `userId`:** The route accepts `{ userId, phone }` from the request body. A malicious caller can supply any `userId` to link their phone to another user's account. The `userId` should be extracted from the verified server-side session, not the request body.

3. **`proxy.ts` uses anon key for `getUser(token)`:** Technically valid (Supabase validates the JWT on their end), but the cookie it reads (`sb-access-token`) is the same JS-readable one described above.

**Fix applied (2026-04-06):**
- Created `POST /api/auth/session` — verifies token with Supabase server-side, sets `HttpOnly; SameSite=Lax; Secure` cookie. Returns `{ userId }`.
- Created `DELETE /api/auth/session` — clears the cookie on sign-out.
- Removed `document.cookie = ...` from all 4 auth pages (`verify`, `provider-verify`, `technician-verify`, `admin-sign-in`). Replaced with `fetch('/api/auth/session', ...)`.
- Fixed `getSession()` in `lib/auth.ts`: now reads `sb-access-token` cookie and passes it to `supabase.auth.getUser(token)` (was calling `getUser()` without a token — always returned null).
- Fixed `/api/auth/link`: now calls `getSession()` to obtain `userId` from the verified server session; no longer trusts client-supplied `userId`.
- **Evidence:** `84 passed` — 8 new tests in `__tests__/api/auth.test.ts` covering: HttpOnly cookie set, invalid token rejected, unauthorized link rejected, attacker userId ignored.

---

### P1-B · Webhook security — WhatsApp POST has no signature check
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | security |
| Files | `field-service/app/api/webhooks/whatsapp/route.ts` |
| Evidence required | Passing tests for invalid-signature rejection; staging webhook receipt |

**Issue:** The WhatsApp webhook POST handler does **not** verify the `X-Hub-Signature-256` header sent by Meta. The GET handler (webhook verification challenge) is correct. Any actor who knows the endpoint URL can send arbitrary events.

**Fix applied (2026-04-06):**
- Added `verifyMetaSignature(rawBody, signature)` to `lib/whatsapp.ts` — HMAC-SHA256 using `WHATSAPP_APP_SECRET`, timing-safe comparison.
- Updated WhatsApp webhook POST to read raw body first, verify `X-Hub-Signature-256`, then parse JSON.
- Requires `WHATSAPP_APP_SECRET` env var to be set.
- **Evidence:** 6 new tests in `__tests__/api/webhooks-security.test.ts`: missing secret returns false, empty sig returns false, wrong sig returns false, missing prefix returns false, valid sig returns true, tampered body returns false. Plus 3 route-level tests: missing header → 403, wrong sig → 403, valid sig → 200.

---

### P1-C · Webhook reliability — payments webhook not idempotent on WhatsApp confirmation
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering |
| Files | `field-service/app/api/webhooks/payments/route.ts`, `field-service/lib/payments.ts` |
| Evidence required | Duplicate webhook test passes (no double WhatsApp send) |

**Issue:** `handlePaymentSuccess` is idempotent (upserts to PAID), but the payments webhook route calls `sendBookingConfirmation` unconditionally after it. A duplicate webhook delivery sends two confirmation messages to the customer.

**Fix applied (2026-04-06):**
- Payments webhook now reads `booking.status` BEFORE calling `handlePaymentSuccess`.
- If `status === 'SCHEDULED'` (set by a prior delivery), logs and returns 200 immediately — no WhatsApp send.
- `handlePaymentSuccess` itself was already idempotent (upsert to PAID/SCHEDULED).
- **Evidence:** 2 new tests in `__tests__/api/webhooks-security.test.ts`: first delivery sends confirmation; duplicate delivery skips it.

---

### P1-D · Cron schedule drift — `match-leads` comment vs. vercel.json
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering / product |
| Files | `field-service/vercel.json`, `field-service/app/api/cron/match-leads/route.ts` |
| Evidence | Schedule updated to `*/30 7-20 * * *`; handler comment updated to match |

**Issue:** The `match-leads` cron handler comment said "Runs every 30 minutes", but `vercel.json` had `"schedule": "0 8 * * *"` (once per day at 08:00). Unmatched jobs would wait up to 24 hours for re-dispatch — breaking the core marketplace loop.

**Fix applied (2026-04-06):**
- `vercel.json` schedule updated: `"*/30 7-20 * * *"` — every 30 min between 07:00–20:00 SAST (covers business hours; avoids overnight noise).
- `app/api/cron/match-leads/route.ts` comment updated: "Runs every 30 minutes during business hours (07:00–20:00 SAST) via Vercel Cron".
- Decision rationale in `docs/product-decisions/cron-match-leads-cadence.md` (Option D selected).
- `reqId` added to all log lines for traceability.

> Product decision documented: `docs/product-decisions/cron-match-leads-cadence.md`

---

### P1-E · Core marketplace loop — provider approval → eligible for matching
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering |
| Files | `field-service/lib/matching-engine.ts`, `field-service/__tests__/lib/matching-engine.test.ts` |
| Evidence | 16 tests pass (matching-engine.test.ts) covering eligibility, idempotency, empty pool, lead guard bug fix |

**Review findings (2026-04-06):**

1. **Provider eligibility query** — `db.provider.findMany({ where: { active: true, availableNow: true, verified: true } })` correctly enforces all three approval gates. Unit test confirms the exact `where` clause is passed.

2. **Lead guard bug fixed** — The duplicate dispatch guard previously blocked re-dispatch even for EXPIRED/DECLINED leads. Fixed: only `SENT` or `ACCEPTED` leads block re-dispatch. Test: "re-dispatches a provider whose previous lead has EXPIRED".

3. **TOCTOU race — already mitigated by schema** — `Match.jobRequestId` carries a `@unique` Prisma constraint (enforced by DB). If two concurrent `dispatchLeads` calls both pass the `match.findFirst` check, the second `match.create` will throw a unique constraint violation. The first call wins; the second logs an error but does not corrupt data. No additional schema change required.

**Evidence:** `__tests__/lib/matching-engine.test.ts` — 16 tests: `findCandidateProviders` (4), `dispatchLeads` (4), provider eligibility filter (3), duplicate dispatch guard (2), empty pool (1), `expireStaleLeads` (2).

**Remaining for staging:** End-to-end walkthrough from provider admin approval → `active+availableNow+verified=true` → job request submitted → `dispatchLeads` triggered → WhatsApp notification sent → provider accepts → booking created.

---

## Priority 2 — Pre-Production Blockers

### P2-F · Private artifact access
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | security / engineering |
| Files | `field-service/app/api/attachments/[id]/route.ts`, `field-service/lib/storage.ts`, `field-service/components/technician/PhotoUpload.tsx` |
| Evidence | All page components use `/api/attachments/${photo.id}`; PhotoUpload prefers `data.proxyUrl` over direct URL |

**Fix applied (2026-04-06):**
- Created `GET /api/attachments/[id]` — authenticated proxy. Verifies session, enforces role-based access (admin: any; provider: own uploads; customer: own job/request attachments), then fetches blob server-side and streams to client with `Cache-Control: private`.

**Frontend migration confirmed (2026-04-08 audit):**
- All `<img>` and `<a>` tags in customer, provider, technician, and admin page components use `/api/attachments/${photo.id}` — not direct blob URLs.
- `PhotoUpload.tsx` uses `data.proxyUrl ?? data.url` — prefers the authenticated proxy URL returned by the upload route.
- No direct blob URL exposure found in any rendered surface.

---

### P2-G · Health endpoint
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | platform/SRE |
| Files | `field-service/app/api/health/route.ts` |
| Evidence | 2 tests pass: 200 on healthy DB, 503 on DB error |

**Fix applied (2026-04-06):**
- Created `GET /api/health` — runs `db.$queryRaw\`SELECT 1\`` probe; returns `{ status: "ok", db: "ok", timestamp }` (200) or `{ status: "degraded", db: "error", timestamp }` (503).
- Unauthenticated; safe for load-balancer / uptime monitoring use.
- **Evidence:** `__tests__/api/health.test.ts` — 2 tests: healthy response and degraded response.

---

### P2-H · Structured request/workflow IDs
| Field | Value |
|-------|-------|
| Status | ✅ Closed |
| Owner | engineering |
| Files | `app/api/webhooks/payments/route.ts`, `app/api/webhooks/whatsapp/route.ts`, `app/api/cron/match-leads/route.ts` |
| Evidence | `reqId` prefix on all log lines in webhook and cron handlers |

**Fix applied (2026-04-06):**
- `reqId = crypto.randomUUID().slice(0, 8)` added at the top of each handler.
- All `console.info/warn/error` calls prefixed: `[webhook/payments:${reqId}]`, `[webhook/whatsapp:${reqId}]`, `[cron/match-leads:${reqId}]`.
- Errors are now traceable end-to-end in Vercel log streams.

---

### P2-I · Canonical workflow services
| Field | Value |
|-------|-------|
| Status | 🟡 Pre-prod — quote duplication fixed; remaining flows documented |
| Owner | engineering |
| Files | `field-service/lib/quotes.ts` (new), `app/api/quotes/[token]/route.ts`, `lib/whatsapp-bot.ts` |
| Evidence required | All core business flows invoke shared service functions; no duplicate transaction logic |

**Audit completed (2026-04-06):**

| Route / Handler | Flow | Status |
|----------------|------|--------|
| `app/api/quotes/[token]` PATCH | Quote approve/decline | ✅ Now calls `lib/quotes.ts processQuoteDecision` |
| `lib/whatsapp-bot.ts handleCustomerQuoteResponse` | Quote approve/decline via WhatsApp | ✅ Now calls `lib/quotes.ts processQuoteDecision` |
| `app/api/technician/jobs/[id]/status` | Job status transitions | ✅ Calls `lib/jobs.ts transitionJob` |
| `app/api/technician/jobs/[id]/extras` | Extra work creation | ✅ Calls `lib/jobs.ts createExtraWork` |
| `app/api/webhooks/payments` | Payment events | ✅ Calls `lib/payments.ts handlePaymentSuccess/Failed` |
| `app/api/cron/match-leads` | Lead dispatch + expiry | ✅ Calls `lib/matching-engine.ts` |
| `app/api/customer/bookings` | Job request creation | 🟡 Inline — low risk (simple create, no state machine) |
| `lib/whatsapp-bot.ts handleCancelFlow` | Job request cancel | 🟡 Inline — single `jobRequest.update`; acceptable scope |
| `lib/whatsapp-bot.ts` lead decline | Provider lead decline | 🟡 Inline — single `lead.updateMany` + `match.update` |

**Fix applied:** Created `lib/quotes.ts` with `processQuoteDecision(quoteId, action, options?)`. Both HTTP and WhatsApp callers now use the same transaction. Eliminates the race condition where dual-channel approval could produce two bookings.

---

### P2-J · Dead routes and stale product copy
| Field | Value |
|-------|-------|
| Status | ✅ Closed — decision documented, cleanup deferred to P3-O |
| Owner | product / engineering |
| Files | `field-service/app/(admin)/admin/dispatch/page.tsx`, `field-service/app/(auth)/technician-sign-in/`, `field-service/app/(technician)/` |
| Evidence | `docs/product-decisions/dead-routes-cleanup.md` |

**Audit completed 2026-04-08.** Three dead/duplicate route categories found:

| Route | Finding | Decision |
|-------|---------|----------|
| `/admin/dispatch` | Pure redirect to `/admin/matches` | Delete post-launch + add 301 rewrite |
| `/technician-sign-in`, `/technician-verify` | Legacy auth paths, preserved by proxy.ts | Monitor traffic, remove 30+ days post-launch |
| `(technician)` route group | Parallel to `(provider)` — same role, different URL prefix; WhatsApp bot links to `/technician` | P3-O: migrate all links to `/provider/*`, then delete |

None block go-live. Full rationale in `docs/product-decisions/dead-routes-cleanup.md`.

---

### P2-K · Backup / restore readiness
| Field | Value |
|-------|-------|
| Status | 🟡 Pre-prod — backups verified, live restore rehearsal pending operator action |
| Owner | operations / data |
| Files | `docs/release-runbook.md` |
| Evidence required | Operator completes "Restore to new project" rehearsal before go-live |

**Verified 2026-04-08:**
- Daily PHYSICAL backups confirmed active on Supabase Pro plan — 8 restore points available (2026-04-01 through 2026-04-08)
- PITR (Point in Time Recovery) is **not enabled** — available as a Pro add-on if sub-daily granularity is needed
- Storage objects are NOT included in database backups
- Runbook updated with correct pg_dump procedure (must use `DIRECT_URL` port 5432, not pooled `DATABASE_URL` port 6543)

**Remaining operator action:**
Use "Restore to new project" (BETA) in Supabase Dashboard → Database → Backups to rehearse a non-destructive restore before go-live. Checklist in `docs/release-runbook.md` under "Pre-launch rehearsal checklist".

---

## Priority 3 — Post-Launch Hardening (First 30 Days)

| ID | Item | Owner | Status |
|----|------|-------|--------|
| P3-L | Durable outbox/queue for side effects | engineering | 🔵 |
| P3-M | Reconciliation jobs (payments, webhooks, blobs, matches, notifications) | engineering | 🔵 |
| P3-N | Performance: matching, earnings/reporting, admin pagination, caching | engineering | 🔵 |
| P3-O | Collapse duplicate provider/technician surfaces | product / engineering | 🔵 |
| P3-P | Operator/support tooling + real `AuditLog` usage | engineering | 🔵 |
| P3-Q | CSP/HSTS headers | security | 🔵 |
| P3-R | Dependency audit automation (npm audit in CI) | security | 🔵 |
| P3-S | Startup config validation | engineering | 🔵 |
| P3-T | SLOs, alert thresholds, weekly incident review cadence | operations | 🔵 |

---

## Summary Scoreboard

| Priority | Total | ✅ Closed | 🔄 In progress | 🟡 Pre-prod open |
|----------|-------|-----------|----------------|-----------------|
| P0 | 5 | 4 (P0-1, P0-2, P0-3, P0-4) | 1 (P0-0 templates — pending Meta approval) | — |
| P1 | 5 | 5 (P1-A, P1-B, P1-C, P1-D, P1-E) | — | — |
| P2 | 5 | 4 (P2-F, P2-G, P2-H, P2-J) | — | 1 ops (P2-K) + P2-I partial |
| P3 | 9 | 0 | — | — (post-launch) |

**Go-live gate:** All P0 and P1 items must be ✅ before production deployment.

> **Status as of 2026-04-09:** All P1 blockers closed. P0-4 migration baseline closed. P0-0 WhatsApp templates: all 21 now registered; 7 already approved, 14 pending Meta review (24–72h). Go-live is gated on `quote_ready` and remaining UTILITY templates receiving Meta approval. P2-F, P2-J confirmed closed. P2-K (backup rehearsal) remains open.
>
> **2026-04-09 sweep:** WAMID inbound dedup, cron send-dedup, outbound observability, mediated relay, and createExtraWork idempotency all implemented (see `reports/meta-whatsapp-remediation-sweep.md`). Lint and TS errors driven to zero across both apps. 107 tests passing.
>
> **Blocked residuals** (require external action — no code changes possible):
> - **P0-0** — 2 WhatsApp templates still PENDING Meta approval (`quote_ready` critical path; `technician_assigned` non-critical). Operator must re-run verification script after approval. `quote_ready` must be APPROVED before go-live.
> - **P2-K** — Supabase backup restore rehearsal. Operator must use "Restore to new project" in Supabase Dashboard before go-live.
> - ~~Migration deploy~~ — ✅ Both pending migrations applied to production DB 2026-04-09 via Supabase MCP.

---

## Verification Commands

```bash
# Run all field-service tests
cd field-service && npm run test

# Run all marketing tests
cd marketing && npm run test

# Lint both apps
cd field-service && npm run lint
cd marketing && npm run lint

# Build field-service (requires DATABASE_URL and other env vars)
cd field-service && npm run build

# Build marketing
cd marketing && npm run build

# Check migration status (requires DATABASE_URL)
cd field-service && npx prisma migrate status
```

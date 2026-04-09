# Plug-A-Pro — Claude Code Context

> Field service marketplace, South Africa.
> Apps: `field-service/` (marketplace) · `marketing/` (site)
> OpenBrain project: `Plug-A-Pro`

---

## Session start

On every new session, load dynamic context (tasks, decisions, recent work):
```bash
cd /Users/shimane/Projects/MobileApps/OpenBrain/backend && pnpm brain -- context --project "Plug-A-Pro"
```

---

## Architecture

```
field-service/
  app/                  Next.js 16 App Router — pages, layouts, API routes
  app/api/              Route Handlers (no pages/ router)
  lib/                  Business logic — always call these from routes/bot
    quotes.ts           Quote approve/decline (canonical — both HTTP + WA bot)
    jobs.ts             Job state machine
    payments.ts         Payment event processing
    matching-engine.ts  Lead dispatch, expiry, provider eligibility
    auth.ts             getSession() — reads HttpOnly cookie, calls supabase.auth.getUser(token)
    whatsapp.ts         Send helpers + verifyMetaSignature()
    whatsapp-bot.ts     Inbound message routing + bot state machine
    storage.ts          Vercel Blob upload helpers
  prisma/schema.prisma  Single source of truth for data model
  prisma/migrations/    Two tracks: 20260327000000_baseline + whatsapp_preferences delta

marketing/              Separate Next.js app — marketing site only
```

Key relationships:
- `JobRequest` → `Lead`(s) → `Match` → `Quote` → `Booking` → `Job`
- `Match.jobRequestId` is `@unique` — one active match per job at a time
- Provider eligibility requires `active=true AND availableNow=true AND verified=true`

---

## Security guardrails

| Rule | Detail |
|------|--------|
| **Never `document.cookie`** | Auth token is HttpOnly. Write via `POST /api/auth/session` only. |
| **Always verify webhook signatures** | WhatsApp: `X-Hub-Signature-256` HMAC-SHA256. Payments: `x-signature` / `x-peach-signature`. |
| **userId from session, not request body** | `getSession()` → `session.id`. Never trust client-supplied userId. |
| **Attachments need auth gate** | Use `/api/attachments/[id]` proxy — never expose direct Vercel Blob URLs to clients. |
| **No secrets in responses** | Stack traces, DB errors, internal IDs go to logs only. |

---

## Engineering standards

**Service layer first** — routes must call `lib/` service functions, not inline Prisma transactions.
- Adding a new flow? Check if a service function exists before writing inline mutations.
- Core flows: quotes (`lib/quotes.ts`), jobs (`lib/jobs.ts`), payments (`lib/payments.ts`), matching (`lib/matching-engine.ts`).

**Idempotency** — every webhook handler must be safe to deliver twice:
- Check DB state before applying side effects.
- Return 200 on duplicate delivery — never 4xx (causes retries).

**Test isolation** — `vi.mock()` is hoisted. New mocks in new test files; don't add to existing files.

**No `next lint`** — Next.js 16 removed it. Use `eslint .` with `eslint.config.mjs`.

**Prisma build** — `package.json` build script runs `prisma generate` first. Never skip it.

---

## SRE / operational standards

**Request tracing** — every webhook and cron handler must set `reqId = crypto.randomUUID().slice(0, 8)` at entry and prefix all log lines: `[handler:${reqId}]`.

**Health** — `GET /api/health` runs a DB probe. Monitor for 503.

**Cron cadence** — `match-leads` runs `*/30 7-20 * * *` (every 30 min, 07:00–20:00 SAST). Do not change to daily or overnight.

**Migration discipline** — never edit existing migration files. New changes → new migration. Baseline at `20260327000000_baseline` must always be first in deploy order.

**Error budget** — return `{ status: 'error', message: String(err) }` with 200 (not 500) on webhook handler errors to prevent PSP/Meta retries.

---

## WhatsApp template rules

| Template | Type | Opt-out blocks? | Meta status |
|----------|------|-----------------|-------------|
| `booking_confirmation` | UTILITY | No | APPROVED |
| `booking_cancelled` | UTILITY | No | APPROVED |
| `quote_ready` | MARKETING | Yes (`whatsappMarketingOptIn`) | PENDING — Meta classified as MARKETING |
| `technician_assigned` | UTILITY | No | PENDING |
| `slot_available` | MARKETING | Yes | APPROVED |
| `promo_*` | MARKETING | Yes | — |

Never reclassify UTILITY → MARKETING without checking all `canSend()` call sites.
`quote_ready` reclassified 2026-04-09: Meta overrode our UTILITY submission → MARKETING. Code updated to match.

---

## Release readiness

Tracker: `docs/release-readiness-tracker.md`
Runbook: `docs/release-runbook.md`
Smoke tests: `docs/staging-smoke-test.md`

Go-live gate: all P0 + P1 items ✅. Current status: all P1 closed, P0-4 baseline applied 2026-04-08. Pending migrations: `20260402141355_whatsapp_preferences`, `20260409103000_assurance_second_sweep` — apply via `prisma migrate deploy` at production deploy time. P0-0 gated on `quote_ready` Meta approval.

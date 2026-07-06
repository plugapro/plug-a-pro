# SRE Readiness Scorecard — Plug A Pro Platform Audit (2026-07-06)

**Scale:** 0 Missing · 1 Weak · 2 Partial · 3 Acceptable for MVP · 4 Strong · 5 Production-grade

| Dimension | Score | Summary |
|---|:--:|---|
| Logging | 2 | ~745 raw `console.*` sites; no logger abstraction; one excellent PII-safe structured logger exists but is KYC-only |
| Monitoring | 1 | `/api/health` + public `/status` page exist; no uptime monitor, no log drain, no APM in repo |
| Alerting | 1 | All human alerting is best-effort WhatsApp to `ADMIN_WHATSAPP_NUMBER` (silently no-ops if unset); no cron-failure alerting |
| Error tracking | 2 | Sentry integrated server-side with PII redaction, but client-side almost certainly dead (Turbopack + CSP) and only 8 captureException calls |
| Webhook reliability | 4 | Signature verification + idempotency solid on WhatsApp/Didit/Pay@; Peach empty-secret fail-open and no inbound re-drive are the deductions |
| Payment reliability | 2 | Webhook handling idempotent on success path, but failed-event clobber, checkout-before-Payment-row, no PSP payload persistence, no Peach reconciliation poll |
| WhatsApp reliability | 2 | Excellent inbound dedup + window-safe sends; but no outbound retry, fire-and-forget sends, dead-lettered inbound failures never reprocessed |
| Database reliability | 4 | Managed Supabase Postgres; migration-ordering CI; additive-only discipline; strong transaction design on money paths; drift scars documented |
| Job / booking state resilience | 3 | Job + Booking machines are textbook (CAS + event + audit in one tx); Lead/JobRequest scatter and stuck-state gaps (PENDING_COMPLETION_CONFIRMATION, SHORTLIST_READY) pull this down |
| Incident diagnosis | 2 | Rich audit tables + admin audit-log UI + joinable core chain; but no persisted correlation IDs, random support reference IDs, console-only payment evidence |
| Deployment safety | 4 | migrate-deploy workflow gates Vercel builds on applied migrations (same-SHA ordering, concurrency-locked); lint+test CI on PRs; smoke suite exists |
| Rollback readiness | 3 | Vercel instant rollback available; additive-only migrations mean old code runs on new schema; no documented rollback runbook or tested procedure in repo |
| Test coverage | 4 | 5,164 unit tests across 511 files, deep money-path coverage (wallet 60 / ledger 33 / webhook 33 files); e2e smoke exists but doesn't run on PRs; token-surface pages unsmoked |
| Operational dashboards | 3 | Strong ops control-tower dashboard (SLA queues, matching health, breach banner) + reports; funnel behind default-OFF flag; messages page capped at 100 events, no search |

**Overall: 2.6 / 5 — Partial.** The platform is strong where engineering effort was recently invested (webhooks, deployment safety, money-path transactions, test depth) and weak in exactly the layer that tells you something broke: alerting, error tracking, retries, and correlation.

---

## Score reasoning

### Logging — 2 (Partial)
Three maturity tiers coexist. Best: `lib/identity-verification/log.ts` — structured, PII-safe, Sentry sink with tag allowlist. Middle: single-line JSON in `lib/payat-go/booking-payments.ts` and cron `cron_start` events. Rest: ~745 semi-structured `console.*` calls across `lib/` and `app/api/`. `lib/correlation.ts` exists but is used in 3 routes only and never persisted. Nothing is unloggable, but nothing outside KYC is *queryable*.

### Monitoring — 1 (Weak)
`/api/health` (rate-limited) and a public `/status` page exist and are smoke-covered. No uptime monitoring, log drains, or performance monitoring found in the repo. Vercel-native dashboards may exist outside the repo (unverified).

### Alerting — 1 (Weak)
Every alert path is a best-effort WhatsApp message to `ADMIN_WHATSAPP_NUMBER` (`lib/whatsapp.ts:1642-1696`, matching hard-pause at `lib/matching/service.ts:725`, match-leads cron) that silently skips if the env var is unset. 21 Vercel crons have no failure hook or heartbeat — **a dead match-leads cron silently stalls the entire marketplace** (OBS-09). Durable "human needed" surfaces (OpsQueueAssignment, cases) are good but require someone to be looking.

### Error tracking — 2 (Partial)
`@sentry/nextjs` 10.x is wired server-side (`instrumentation.ts` with SA-phone redaction, DSN-gated `withSentryConfig`). Deductions: Turbopack builds don't load `sentry.client.config.ts` and no `instrumentation-client.ts` exists; CSP `connect-src` omits `*.sentry.io` — client events blocked even if the SDK initialised (OBS-01); no `onRequestError` export, no `app/global-error.tsx` (OBS-02); most error boundaries and `apiError()` 5xx paths never call captureException (ARC-03). Whether the DSN is set in prod is unverified.

### Webhook reliability — 4 (Strong)
WhatsApp: HMAC + `timingSafeEqual`, fail-closed on missing secret, WAMID unique-constraint dedup, always-200 fast-ack — no Meta retry storm possible. Didit: 3-tier HMAC, signature-before-persist, idempotency key, replay-safe, deliberate 500-for-retry on completion failure. Pay@: CAS crediting + ITN recovery cron. Deductions: Peach HMACs with `''` when `PEACH_WEBHOOK_SECRET` is unset (SRE-07/SEC-02), and failed inbound WhatsApp processing is dead-lettered with no re-drive (SRE-03).

### Payment reliability — 2 (Partial)
Success path: signature + unknown-booking reject + ±1c amount check + PAID idempotency. But: `handlePaymentFailed` has no status guard — a late/duplicate failed event flips a PAID payment to FAILED and messages the customer (SRE-01); PSP checkout is created before the Payment row exists — paid-but-unrecorded is possible (SRE-04); booking confirmation is permanently lost if the send fails post-PAID (SRE-02); refund flow can desync (PSP-first, no transaction; inbound refund events ignored — SRE-05); no Peach reconciliation poll if a webhook is lost entirely. Bypass mode (current default) masks all of this — these become live risks the day checkout mode turns on.

### WhatsApp reliability — 2 (Partial)
Inbound: exemplary dedup and signature handling. 24h-window handling is real (`hasRecentInboundWhatsappSession` + template-first fallback ladders). Outbound: `sendTemplate`/`sendText` have zero retry and no timeout (`lib/whatsapp.ts:128-199`); many callers are `.catch(()=>{})` fire-and-forget; only sentinel-tracked sends (e.g. `matchFoundWhatsappSentAt`) get cron re-drive; admin Retry button is a no-op (AD-01); failed inbound processing rows are never swept (SRE-03).

### Database reliability — 4 (Strong)
Managed Supabase Postgres; 146 additive-only migrations; drift incidents repaired with documented idempotent migrations and a `db:probe-migrations` probe; strong `$transaction` usage on accept/credit/lock and job/booking transitions; RLS enabled across tables (server-side Prisma is the only data path). Deduction: schema.prisma is not the full truth (raw-SQL-only indexes), and Lead/JobRequest blind writes rely on discipline.

### Job / booking state resilience — 3 (Acceptable)
`transitionJob`/`transitionBooking` are the strongest pattern in the codebase. Deductions: Lead (16 states, 13 writer files) and JobRequest (9 states, ~20 writer files) have no transition validation (ARC-01); stuck states exist with no sweep — PENDING_COMPLETION_CONFIRMATION hangs if the customer never signs off (CJ-11), SHORTLIST_READY/PROVIDER_CONFIRMATION_PENDING have no expiry or nudge (CJ-08); provider double-booking across jobs has no overlap guard (SRE-08).

### Incident diagnosis — 2 (Partial)
The DB story is reconstructable (JobRequest→…→WorkflowEvent join chain) and `/admin/audit-log` + dispatch activity feed are genuinely useful. Deductions: correlation IDs never persisted; support `reference_id` random and untraceable (ARC-04); payment webhook evidence console-only (OBS-05); "paid but no booking" not diagnosable from the payments page (AD-03); messages page capped at last 100 events with no search (AD-08).

### Deployment safety — 4 (Strong)
`migrate-deploy.yml` applies migrations on main push and Vercel's ignored-build-step waits for the same SHA — schema always at least as far ahead as code; concurrency-locked against racing migrations. Lint + unit tests run on PRs. Deductions: build job and smoke job are push-only/env-gated, so a PR can merge without a build check or smoke run.

### Rollback readiness — 3 (Acceptable)
Vercel promotes/rolls back deployments instantly; additive-only migrations mean rolled-back code keeps working against the newer schema. No rollback runbook, no tested rollback drill, no feature-flag kill-switch UI (flags require DB/script access — AD-09).

### Test coverage — 4 (Strong)
5,164 passing unit tests, 511 files, exceptional depth on wallet/ledger/webhook/credit paths; 12 Playwright specs including mobile. Deductions: smoke doesn't run on PRs; zero smoke coverage of the customer token surfaces (`/quotes/[token]`, `/requests/access/[token]`, `/review/[token]` etc. — CJ-25); invoice/voucher test depth thin (ARC-17).

### Operational dashboards — 3 (Acceptable)
`/admin` control tower (hero metrics, 7 SLA queues, matching health, breach banner, stale-data banner) is genuinely operable. Reports: KPI, funnel (flag default OFF), kyc-funnel, acquisition (orphaned from nav). Deductions: messages surface inadequate at volume (AD-08); daily funnel reports are manual CLI only (OBS-11); no feature-flag UI; AssignmentHold not inspectable (AD-13).

# OpenBrain Knowledge Entry — Admin Platform Production-Readiness Audit

**Project:** Plug-A-Pro  
**Domain:** engineering  
**Title:** audit — admin platform production-readiness scan (2026-05-06)  
**Tags:** admin, audit, production-readiness, security, performance, 2026-05-06

---

## Summary

Full static analysis of `admin.plugapro.co.za` (field-service, Next.js 16 App Router, Prisma 6, Supabase). Browser sweep deferred pending admin credentials. Build, TypeScript, lint, and test suites all clean (one orphan scratch file blocks `pnpm build` — trivial fix). 35 admin pages exist; 4 critical systemic risks identified; partial rebuild recommended.

---

## Inspection Log

| Step | Tool | Finding |
|------|------|---------|
| `pnpm build` | CLI | Exit 1 — sole error in `tmp-check-lovemore.ts:25` (scratch file) |
| `pnpm tsc --noEmit` (scratch removed) | CLI | Exit 0 — zero real type errors |
| `pnpm lint` | CLI | 0 errors, 3 warnings (reports page `<img>`) |
| `pnpm test --run` | CLI | 1498 passed, 0 failed |
| RLS check | grep on `supabase/migrations/` | Zero `CREATE POLICY` or `ENABLE ROW LEVEL SECURITY` statements |
| CI check | `ls .github/workflows/` | Directory does not exist |
| Observability | Read `instrumentation.ts` | Timezone-only; no Sentry/OTel/pino |
| Auth fallback | Read `proxy.ts:206-214` | `user_metadata.role` fallback confirmed |
| Index audit | Prisma schema model scan | Zero `@@index` on Booking, Job, Quote, Match, Payment, Invoice, Dispute, ProviderPayout |
| Nav audit | Read `layout.tsx:33` | `/admin/audit-log` in nav but no route folder |
| Payment failure | Read `lib/payments.ts:490-498` | `handlePaymentFailed` writes DB only; no alert, no retry, no queue entry |
| WhatsApp errors | Grep `lib/whatsapp.ts` | 5 `.catch(() => {})` — failures silently swallowed |
| Smoke spec | Read `e2e/smoke.spec.ts` | 20 routes covered; 18 routes not covered |

---

## Critical Findings (C1–C4)

**C1 — CRITICAL: Zero RLS policies.**  
`supabase/migrations/20260327141019_init.sql` contains no row-level security. Any authenticated user can read/write any table via the Supabase REST anon key. Immediate data breach risk.  
Fix: Spike in `docs/rls-spike.md` (TASK-029), then migrate with `CREATE POLICY` per table per role.

**C2 — CRITICAL: No CI pipeline.**  
`.github/workflows/` does not exist. Lint, type check, and tests never run on PRs. Broken code ships unchecked.  
Fix: Create `.github/workflows/ci.yml` (TASK-003).

**C3 — CRITICAL: No observability.**  
`instrumentation.ts` sets timezone only. Error boundaries call `console.error()` and stop. Production failures are invisible.  
Fix: Sentry integration in `instrumentation.ts` + all `error.tsx` files (TASK-005).

**C4 — HIGH: Privilege escalation via `user_metadata.role`.**  
`proxy.ts:209-213` grants admin access from `user_metadata.role` when no `AdminUser` row exists. Any Supabase user can call `supabase.auth.updateUser({ data: { role: 'admin' } })` to self-escalate.  
Fix: Remove fallback (TASK-004); must be preceded by admin user backfill (TASK-033).

---

## High-Severity Findings

- **Zero indexes on 8 core models** (Booking, Job, Quote, Match, Payment, Invoice, Dispute, ProviderPayout). Every admin list page is a full sequential scan. Fix: TASK-007 through TASK-009.
- **handlePaymentFailed dead-end**: `lib/payments.ts:490-498` records status only. No ops alert, no retry, no queue. Fix: TASK-010.
- **WhatsApp failures swallowed**: `lib/whatsapp.ts` has 5 silent `.catch(() => {})` on send failures. Providers/customers never know notifications were lost. Fix: TASK-011.
- **35/35 pages force-dynamic**: No caching anywhere. Static-ish pages (settings, reports, scheduler) benefit from `revalidate=60`. Fix: TASK-023.
- **Dispatch page 7+ sequential DB awaits**: Cold load 1–3 s. Fix: TASK-013.
- **technicians/[id] 1268 lines, no page error boundary**: Single-file monolith; any DB error shows generic group message. Fix: TASK-012, TASK-014, TASK-020.
- **No last-OWNER guard**: All OWNER accounts can be simultaneously deactivated. Fix: TASK-006.
- **Dead nav link**: `/admin/audit-log` in sidebar → 404. Fix: TASK-002.

---

## Decisions Made

1. **Verdict: partial rebuild** — route surface and lib/ business logic are reusable; auth, observability, indexes, and top-5 pages need hardening.
2. **URL surface: stable** — no route renames; only grouping and dead-link removal in nav.
3. **Reuse existing primitives** — `crudAction()`, CRUD kit, `lib/flags.ts`, shadcn/Radix — not replaced.
4. **Browser sweep deferred** — requires admin credentials; pages classified GREY in synopsis until sweep completes.
5. **RLS treated as a spike** (TASK-029) not a direct implementation — high complexity, high risk of breaking existing queries.

---

## Artefacts Created

| File | Purpose |
|------|---------|
| `docs/admin-as-is-synopsis.md` | Full as-is diagnosis with page-health table, error inventory, security/performance/functional gap analysis |
| `docs/admin-rebuild-implementation-plan.md` | 6-phase plan with backlog (P0–P3), target IA, target architecture, acceptance criteria, risk register |
| `docs/admin-execution-task-list.md` | 33 executable Claude Code tasks with files, acceptance, risks |
| `docs/openbrain-admin-audit-log.md` | This file |

---

## Next Actions

1. **Immediate (next session):** TASK-033 (backfill admin users) → TASK-001 (delete scratch file) → TASK-004 (remove user_metadata fallback). These are the highest-risk items and unblock all others.
2. **This week:** TASK-003 (CI workflow), TASK-005 (Sentry), TASK-002 (remove dead nav link), TASK-006 (OWNER guard).
3. **Next sprint:** TASK-007 through TASK-009 (indexes) — require a migration window. TASK-010, TASK-011 (payment/WA failure handling).
4. **Before scaling ops:** TASK-029 (RLS spike) — do not scale ops volume until RLS is in place.

---

## Unresolved Questions

1. **Browser sweep**: Admin credentials not provided. Runtime page health (GREEN/AMBER/RED classification) is pending. Ask for: existing admin email + password, OR permission to provision temp OPS admin via Supabase MCP.
2. **`ProviderCategory` model**: `(tx as any).providerCategory` optional-chain in applications approval flow — confirm the model is in the deployed schema before removing the optional chain (TASK-026).
3. **RLS scope**: Supabase REST API usage in this codebase is not fully inventoried. The spike (TASK-029) must complete before RLS policies are written.
4. **Payment retry strategy**: Whether failed payments should auto-retry (with exponential backoff) or require ops manual action. TASK-010 adds the queue entry; retry logic is separate.
5. **WhatsApp retry queue**: Whether failed sends should be retried from a queue or left as log-only. TASK-011 adds structured logging; the retry mechanism is a P3 follow-up.

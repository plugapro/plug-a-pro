# AI operating loop MVP — OpenBrain-based observe/classify/improve foundation (2026-06-13)

## Context

First practical version of an AI-native operating loop for Plug-A-Pro, with
OpenBrain as the company brain. Goal: make the platform legible to AI and create
**safe** self-improvement loops across product, support, ops, security, and
engineering — explicitly **not** an autonomous deploy/agent system. The MVP only
observes, classifies, and prepares reviewable task instructions for human-approved
execution.

## What existed before (inspection findings)

- **OpenBrain** = markdown knowledge store at repo-root `openbrain/`
  (engineering/tasks/marketing/journeys/design). **No code writer** existed; the
  `pnpm brain` CLI lives outside this repo and has no Plug-A-Pro project.
- Systems of record already present (left untouched): `AuditLog` (admin actions),
  `SecurityEvent` (typed security taxonomy + enums), `ApplicationErrorEvent`
  (already redacts via `whatsappPhoneHash` + `redactPayload`/`REDACT_KEYS`),
  `MessageEvent`, `DailyProviderSnapshot` (aggregate-only).
- Canonical PII helpers: `maskPhone` (lib/support-diagnostics.ts), `hashPhone`
  + recursive `redactPayload` (lib/application-error-service.ts).
- RBAC: `requireRoleApi(['ADMIN','OWNER'])`, `roleCan`, Role = OPS/FINANCE/TRUST/
  ADMIN/OWNER. Response helpers: `apiSuccess`/`apiError`. Tests: vitest in
  `__tests__/`.

Decision: build a **self-contained, additive** module that reuses the proven
redaction pattern, adds **no Prisma migration** (migrations are human-gated), and
writes to the existing markdown store via a pluggable, safe-failing sink.

## What was built

New module `field-service/lib/ai-loop/` (sensor → policy → tool → gate → learning):
- `taxonomy.ts` — typed event taxonomy: 19 categories, severities, actor types,
  and a registry of definitions (openBrainEligible / improvementCandidateEligible
  + per-event redaction profile).
- `redaction.ts` — two-tier protection: **DENY** keys (tokens/secrets/gov-id/
  biometric/card/OTP/password) ⇒ reject; **SOFT** (phone/email) ⇒ mask; free text
  ⇒ summarise; embedded 13-digit IDs / long tokens scrubbed; phone-like refs hashed.
- `events.ts` — `OperationalEvent` + `validateEvent` (taxonomy membership, actor/
  category checks, ISO ts, and the non-negotiable raw-sensitive-field gate).
- `sink.ts` — memory / file (NDJSON + per-candidate markdown brief) / null sinks;
  env-resolved default; file sink fails safely on read-only FS.
- `openbrain-writer.ts` — `writeOperationalEvent` / `safeCapture`: validate →
  reject unsafe → redact → persist → degrade safely. **Never throws.**
- `human-review-policy.ts` — change-area risk classifier, **fail-safe default**
  (unknown ⇒ review required @ high); payment/KYC/auth/secrets forced critical.
- `improvement-candidates.ts` — rule-based generator (11 rules) → reviewable
  candidates with safe refs + draft Claude Code task instruction; evidence
  threshold (default 3) kills one-offs; evidence-free groups dropped; deterministic
  ids per (event, flow). Advisory only — never code/changes.
- `admin-view.ts` + `app/api/admin/improvement-candidates/route.ts` — read-only
  ADMIN/OWNER GET endpoint (no create/update/delete).
- Doc: `field-service/docs/ai-operating-loop.md` (full design + follow-ups).

## Tests & validation

- `__tests__/lib/ai-loop/*` — 6 files, **66 tests, all pass**. Cover event
  validation, redaction + unsafe-field rejection, writer fallback/degradation,
  candidate generation + noise controls, human-review classification, file sink +
  admin view. Confirmed tests do **not** pollute the real `openbrain/` store
  (temp dirs / memory sinks).
- `tsc --noEmit` — **0 errors**. `eslint` on new files — **clean**.
- Full suite: 7–8 pre-existing flaky failures (whatsapp-flows, mvp1-acceptance,
  webhooks-security, etc.) — **confirmed unrelated**: they pass in isolation and
  still fail with the ai-loop tests excluded (count varies run-to-run).

## Safety properties (acceptance)

- No production deploy/automation introduced. No payment/KYC/security/migration
  behaviour. Raw secrets/PII/documents/selfies/card data/WhatsApp bodies are
  rejected or redacted before any write. Logging never blocks a real flow.

## Follow-ups (documented, not done)

1. Wire `safeCapture()` into real failure points (booking/payment/KYC/WhatsApp/
   matching). MVP ships the library; no hot paths rewired.
2. Admin UI for the candidate list (read endpoint exists).
3. Scheduled cron to aggregate candidates over a rolling window.
4. Observation dedupe keys.

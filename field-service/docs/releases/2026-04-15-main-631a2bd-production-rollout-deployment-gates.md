# Deployment Gates — main 631a2bd production rollout

- Release: `main 631a2bd production rollout`
- Date: `2026-04-15`
- Environment: `production`
- Branch: `main`
- PRs: `IamFootprint/plug-a-pro#3`, `IamFootprint/plug-a-pro#4`
- Vercel build: `plug-a-em45ob98d`
- Overall Status: `DEFERRED`

## References

- Framework: [../deployment-framework.md](../deployment-framework.md)
- Workflow image: [../deployment-workflow.svg](../deployment-workflow.svg)
- Verification checklist: [../post-deploy-verification.md](../post-deploy-verification.md)
- PR 3: structured location taxonomy, 4 UX tracks, attachment proxy token path
- PR 4: audit hardening and dashboard enhancements

## Current Release State

Production code is live on Vercel, but the release is not complete.

Current state:

1. `Code live`
2. `Database rollout complete`
3. `Manual smoke verification pending`

Known gap:

- 2 addresses using suburb `Wilgeheuwil, Johannesburg` remain unresolved because that suburb is not present in the current taxonomy
- these requests fall back to legacy string matching
- this is not currently treated as a release blocker

## Gate 0 — Change Readiness

- Status: `PASS`
- Owner: `Engineering`
- Evidence:
  - Merged branch live on `main`
  - Production build deployed from commit `631a2bd`
  - Previous local verification completed:
    - `pnpm exec tsc --noEmit` passed
    - `pnpm test` passed with `258 passed`
  - Scope summary:
    - 4 UX tracks live in code
    - structured location taxonomy and matching live in code
    - attachment proxy token path live in code
    - audit hardening live in code
    - dashboard enhancements live in code
- Decision:
  - Change scope is ready and deployed at the application layer.
- Notes:
  - This gate only confirms code readiness and deployed code presence.

## Gate 1 — Schema and Migration Readiness

- Status: `PASS`
- Owner: `Engineering`
- Evidence:
  - Required migration identified:
    - `20260415123000_ticket_access_and_attachment_caption`
  - Required production manual steps explicitly known:
    - `pnpm db:migrate:prod`
    - `pnpm tsx field-service/scripts/backfill-location-nodes.ts`
  - Rollback notes and smoke test checklist were documented in the PR description per deploy summary
- Decision:
  - Schema and rollout requirements are understood.
- Notes:
  - Required schema rollout steps have now been executed successfully.

## Gate 2 — Production Deploy Readiness

- Status: `PASS`
- Owner: `Engineering`
- Evidence:
  - Vercel production build `plug-a-em45ob98d`
  - Build state: `Ready in 33s`
  - Commit live: `main@631a2bd`
- Decision:
  - Application deploy completed successfully.
- Notes:
  - This gate does not imply schema-dependent features are operational.

## Gate 3 — Data Rollout Readiness

- Status: `PASS`
- Owner: `Ops / Engineering`
- Evidence:
  - Migrations applied: `4` via Supabase MCP
  - `pnpm db:seed`: completed
  - Taxonomy seeded:
    - `3` provinces
    - `6` cities
    - `15` regions
    - `201` suburbs
  - `pnpm db:backfill`: completed
  - Backfill results:
    - `4/6` addresses resolved
    - `50` provider service area rows written
  - Idempotency re-run:
    - second run produced `0` new writes
- Decision:
  - Production schema and data rollout completed successfully.
- Notes:
  - The only known unresolved address gap is `Wilgeheuwil, Johannesburg`, which is outside the seeded taxonomy.

## Gate 4 — Public/Auth Access Validation

- Status: `NOT_RUN`
- Owner: `Ops / QA`
- Evidence:
  - Public signed routes:
  - Protected route redirects:
  - `/api/health` behavior:
- Decision:
  - Pending post-deploy verification.
- Notes:
  - This is now the next required step.

## Gate 5 — Feature Smoke Validation

- Status: `NOT_RUN`
- Owner: `Ops / QA`
- Evidence:
  - Happy path:
  - Failure path:
  - Network/API proof:
  - UI/runtime proof:
- Decision:
  - Pending post-deploy verification.
- Notes:
  - Must include signed ticket access, attachment proxy token path, evidence uploads, skill rehydration, progressive address flow, and dashboard checks from PR `#4`.

## Gate 6 — Backfill and Operational Risk Review

- Status: `PASS`
- Owner: `Ops / Engineering`
- Evidence:
  - Unresolved counts reviewed:
    - `2` unresolved addresses
    - both are `Wilgeheuwil, Johannesburg`
  - Deferred switches / flags:
    - `allowLegacyStringFallback` must remain `true` for this deploy
  - Follow-up actions:
    - extend taxonomy to include `Wilgeheuwil` under the correct West Rand / Roodepoort hierarchy
- Decision:
  - Backfill outcome is acceptable for this release window.
- Notes:
  - Do not flip legacy fallback off until the unresolved taxonomy gap is addressed or accepted explicitly in a later release.

## Gate 7 — Release Close-Out

- Status: `BLOCKED`
- Owner: `Release owner`
- Evidence:
  - Final go/no-go: `PENDING MANUAL SMOKE TEST`
  - Incidents observed:
    - none reported at code deploy, migration, seed, or backfill layers
  - Deferred risks:
    - live browser smoke verification not yet executed
    - `Wilgeheuwil, Johannesburg` falls back to legacy string matching
  - Follow-up steps:
    - execute [../post-deploy-verification.md](../post-deploy-verification.md)
    - update Gates 4, 5, and 7 with browser evidence
- Decision:
  - Treat current state as `operational, pending manual smoke sign-off`.
- Notes:
  - Full release status should move to `PASS` only after Gates 4, 5, and 7 are evidenced and closed.

## Immediate Next Steps

Completed:

```bash
pnpm db:migrate:prod
pnpm db:seed
pnpm tsx field-service/scripts/backfill-location-nodes.ts
pnpm tsx field-service/scripts/backfill-location-nodes.ts
```

Next:

- [../post-deploy-verification.md](../post-deploy-verification.md)

## OpenBrain Log Template — Current Deployment Update

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend
pnpm brain -- knowledge add \
  --project "Plug-A-Pro" \
  --domain "engineering" \
  --title "release gate update — main 631a2bd production rollout (2026-04-15)" \
  --tags "deployment,release,production" \
  --content "Production code is live at main 631a2bd via Vercel build plug-a-em45ob98d. Migrations, seed, backfill, and idempotency rerun are complete. Taxonomy seeded: 3 provinces, 6 cities, 15 regions, 201 suburbs. Backfill: 4/6 addresses resolved and 50 provider service area rows written. Known non-blocking gap: Wilgeheuwil, Johannesburg is missing from taxonomy, so 2 addresses fall back to legacy string matching. Current state: operational, pending manual smoke sign-off via docs/post-deploy-verification.md."
```

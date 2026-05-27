# Migration deploy automation

## What this is

A two-piece pipeline that guarantees the production database schema never falls behind the production deploy:

1. **`.github/workflows/migrate-deploy.yml`** — runs `prisma migrate deploy` against the production database on every push to `main` that touches a migration file or `schema.prisma`.
2. **`field-service/scripts/vercel-ignored-build-step.sh`** — invoked by Vercel before each production build. Polls the GitHub Actions API for the migrate-deploy result on the same SHA and either lets the build proceed or cancels it.

Together: code only reaches production after its migrations have been applied.

## Why this exists

On **2026-05-26** PR #6 merged the OTP fraud-response feature with its migration `20260526090000_otp_fraud_response_security`. Vercel auto-promoted the merge commit and the code went live. The migration **did not** run — Vercel's build script is `prisma generate && next build`, no `migrate deploy`. The provider portal then started returning HTTP 423 with code `ACCOUNT_LOCKED` and the user-visible message _"Something went wrong. Please try again or contact support."_ because the session-gate's `account_security_states.findUnique` errored on a non-existent table.

The migration was applied manually via Supabase MCP later that day, plus PR #9 (`fix(auth): skip OTP security gate while flag is off`) closed the runtime symptom. But the underlying class of bug — schema drift between repo and production — had bitten this project several times before, evident from the 4 placeholder-checksum rows (`manual`, `manually-applied-via-supabase-mcp`, empty string) and 18 missing ledger entries we found during the post-incident audit.

This automation closes that class.

## Setup checklist (one-time)

After this PR merges, two things need to be configured. Both are dashboard tasks — nothing in the repo.

### 1. GitHub: confirm the `production` environment exists

The workflow declares `environment: production` so you can add reviewer-approval gating or restrict secrets to it later. If the environment doesn't exist yet:

1. GitHub → repo Settings → Environments → New environment → name it `production`.
2. (Optional, recommended) under Deployment protection rules, add yourself as a Required reviewer. Then every migrate-deploy job will pause for manual approval before running. This is the safest mode for early adoption.
3. Confirm both database secrets are accessible to this environment:
   - `DATABASE_URL` — the pooled application connection string.
   - `DIRECT_URL` — the direct/unpooled connection string required by `schema.prisma` (`directUrl = env("DIRECT_URL")`) and by Prisma migration locking.

   The existing field-service CI workflow already uses `secrets.DATABASE_URL` for `pnpm security:rls`, and live-smoke paths already reference `secrets.DIRECT_URL`; the migrate-deploy job needs both.

### 2. Vercel: configure the Ignored Build Step

1. Vercel Dashboard → plug-a-pro project → Settings → Git → Ignored Build Step.
2. Choose **"Run my Bash script"**.
3. Paste:

   ```bash
   bash field-service/scripts/vercel-ignored-build-step.sh
   ```

4. Save.
5. (Optional) Add a Vercel env var `GH_API_TOKEN` (Production scope only) with a fine-grained PAT that has Actions read access to `plugapro/plug-a-pro`. Without it, the script falls back to anonymous GitHub API polling (60 req/hour per IP — usually fine, but tight if you push many migration-bearing commits in quick succession).

That's it. No code changes ever needed in this repo to maintain the gate.

## How it behaves

| Push scenario | migrate-deploy workflow | Vercel ignoreBuildStep | Production outcome |
|---|---|---|---|
| Commit touches `prisma/migrations/**` | Runs `prisma migrate deploy` | Polls workflow, waits up to 6 min for success | Build proceeds only after migration succeeds |
| Commit touches no migration files | Skipped by path filter | Detects no migration delta via `git diff`, proceeds immediately | Build proceeds without delay |
| Migration fails | Workflow conclusion = `failure` | Detects failed conclusion, exits 0 | Production build canceled; team is paged via the existing GitHub Actions failure notification |
| Migration takes longer than 6 min | Workflow still running | Script times out, exits 0 | Production build canceled; engineer re-runs Vercel deploy after the workflow completes |
| Preview deploy (PR builds) | Doesn't run on PRs | Detects `VERCEL_ENV=preview`, exits 1 immediately | Build proceeds — previews don't gate on production migrations |

## Operating procedure

### When a migration succeeds, you do nothing

The pipeline self-coordinates. Code lands ~30–60s after the schema does.

### When a migration fails

1. The migrate-deploy workflow turns red. You're notified.
2. Vercel cancels the corresponding production deploy. Status page shows "Canceled — Build skipped by Ignored Build Step".
3. Production continues running the previous code/schema pair. **No outage.**
4. Triage the migration locally: `pnpm --filter field-service exec prisma migrate status` against a copy of the production DB schema reveals which migration failed and why.
5. Fix forward with a new migration (additive only, never edit a merged migration's SQL).
6. Push the fix; the pipeline re-runs.

### When migrate-deploy takes too long

If a single migration genuinely needs more than 6 minutes (e.g., a large data backfill), don't increase the script timeout — that risks Vercel killing the script. Instead:

1. Split the migration into a schema-only DDL migration (fast) and a separate data backfill job.
2. The backfill job can be a Vercel cron, an admin-triggered script, or a one-shot `tsx` script run from a workstation. None of these block the deploy gate.

This keeps `migrate deploy` operations bounded to seconds.

## Out-of-band migration applies

If you ever need to apply a migration outside the pipeline (Supabase MCP, direct SQL, `prisma migrate resolve --applied`), record it in this checklist:

1. Apply the SQL.
2. Insert a row into `_prisma_migrations` with the **real file checksum** (not `manual` or empty), real timestamps, and `applied_steps_count = 1`. This script will compute the checksum for you:

   ```bash
   shasum -a 256 field-service/prisma/migrations/<dir>/migration.sql | awk '{print $1}'
   ```

3. Verify `pnpm exec prisma migrate status` reports clean.

The reconciliation we did on 2026-05-27 (Phase 1 of this PR's setup work) covered the 18 ledger entries that were missing prior to this point. Going forward, the only legitimate reason for an out-of-band apply is an emergency hotfix — and even then, only OWNER role per the project's house rules.

## Future improvements (not blocking this PR)

- **Required reviewer on the `production` environment.** Currently the migration applies automatically. For high-risk projects, adding a manual approval step is standard. Toggle in GitHub → Environments → production.
- **Schema-vs-ledger guard on PRs.** A workflow that fails any PR adding a migration directory without also having the migration listed in a local snapshot. Lower priority because the production-side pipeline now closes the drift class regardless.
- **Slack/Discord webhook on migrate-deploy failure.** Faster paging than the default GitHub Actions email.

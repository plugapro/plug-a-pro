# Preview environment

## What this is

A real, isolated Postgres branch for every PR — provisioned automatically by Supabase Database Branching, wired to that PR's Vercel preview deployment by the Supabase ↔ Vercel integration, with Prisma migrations auto-applied by `.github/workflows/migrate-preview.yml` and seeded with synthetic data by `field-service/scripts/seed-preview.ts`.

End result: a PR titled `feat/foo` gets `https://plug-a-pro-git-feat-foo-...vercel.app` pointing at a forked DB at `branch-feat-foo.oghbryokdizklgwaqksp.supabase.co`. Engineers can flip feature flags, smoke-test mutations, and run the KYC nudge canary against this branch without ever touching production.

## Why this exists

Before this work, the Vercel "Preview" tier pointed at the **same** Supabase project as Production. Any migration, feature-flag flip, or canary send tested in preview was a real production change. The 2026-06-19 KYC nudge campaign exposed this: the user wanted a preview-soak before sending WhatsApp messages to 73 real providers, and there was no preview DB to soak against. Branching was the cheapest path forward — recurring cost stays on Supabase Pro (already paid) and no PII duplication because seeds are deterministic synthetic.

## Architecture in one diagram

```
              ┌───────────────────────────────────────────────────────┐
              │                  PR opens / pushes                     │
              └────────────────────────┬──────────────────────────────┘
                                       │
                ┌──────────────────────┼──────────────────────────┐
                │                      │                          │
                ▼                      ▼                          ▼
       ┌─────────────────┐   ┌──────────────────┐    ┌─────────────────────┐
       │  Supabase       │   │  GitHub Action:  │    │  Vercel preview     │
       │  Database       │   │  migrate-preview │    │  deploy builds      │
       │  Branch         │   │  (this repo)     │    │  against branch     │
       │  auto-created   │   │                  │    │  env vars (provided │
       │  on PR open     │   │  prisma migrate  │    │  by Supabase ↔      │
       │                 │   │  deploy against  │    │  Vercel integration)│
       │                 │   │  branch DIRECT_  │    │                     │
       │                 │   │  URL             │    │                     │
       └─────────────────┘   └──────────────────┘    └─────────────────────┘
                │                      │                          │
                └──────────────────────┴──────────────────────────┘
                                       ▼
                          ┌────────────────────────┐
                          │  optional: engineer    │
                          │  runs                  │
                          │  `tsx scripts/         │
                          │   seed-preview.ts`     │
                          │  against branch DB     │
                          └────────────────────────┘
```

## One-time setup (operator, ~30 min)

These steps are dashboard work. Nothing repo-side after this PR merges.

### 1. Enable Supabase Database Branching

1. Supabase Dashboard → project `oghbryokdizklgwaqksp` → Branching.
2. Toggle **Enable Branching** (requires Pro plan — already on it per ops cost log).
3. When prompted for the GitHub repo, pick `plugapro/plug-a-pro`. Grant the Supabase GitHub App `Read` access to `field-service/prisma/migrations/`.
4. Set branch lifetime to **Keep for 14 days after PR merge** (so post-merge ops can re-soak if needed).
5. Confirm the persistent branch named `production` is created — that's the reference for diff-based branch creation.

### 2. Enable the Supabase ↔ Vercel integration (preview-scope)

1. Vercel Dashboard → `lebogangs-projects-6ffadd97/plug-a-pro` → Integrations → **Supabase**.
2. If not installed: install, link to the same Supabase project.
3. In the integration's settings, scope **Preview** to "branch databases" — this tells Supabase to push `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_AUTH_HOOK_SECRET` into Vercel's Preview env tier with branch-specific values per PR.
4. Leave **Production** scope untouched — production stays on the static prod URL.

### 3. Add `DIRECT_URL_PREVIEW_BRANCH` to GitHub Actions secrets

The `migrate-preview` workflow needs a way to resolve a PR-branch DB URL without committing it. Supabase's Management API exposes `GET /v1/projects/{ref}/branches` returning per-branch connection details. The workflow uses a Supabase Personal Access Token (`SUPABASE_ACCESS_TOKEN`) to call this.

1. Supabase Dashboard → Account → Access Tokens → **Generate new token** named `github-actions-migrate-preview`.
2. GitHub → repo Settings → Secrets and variables → Actions → Repository secrets → add `SUPABASE_ACCESS_TOKEN` with that value.
3. Add `SUPABASE_PROJECT_REF` as a **variable** (not secret — it's not sensitive): value `oghbryokdizklgwaqksp`.

### 4. Verify with a throwaway PR

1. Open a no-op PR (e.g. README typo).
2. Wait for `migrate-preview` workflow to succeed.
3. Confirm Vercel preview deployment is healthy (no DB connection errors in the runtime logs).
4. Open the Vercel preview URL — should load normally but against an empty branch DB (no providers, no jobs).
5. From your terminal:
   ```sh
   cd field-service
   set -a; source .env.local; set +a
   SUPABASE_BRANCH=feat-readme-typo npx tsx scripts/seed-preview.ts --apply
   ```
   The seed script reads the branch URL from Supabase Management API and writes a deterministic synthetic dataset.
6. Refresh the Vercel preview — admin pages should show the synthetic providers/customers.
7. Close the PR (no merge) — Supabase auto-deletes the branch DB after the 14-day window.

## Operating procedure

### Day-to-day: engineer opens a PR

Do nothing. Supabase Branching + Vercel integration handle environment provisioning. The first `migrate-preview` workflow run on your PR will:

1. Resolve the branch DB connection string from Supabase Management API.
2. Run `prisma migrate deploy` against it.
3. Annotate the PR with the migration status (success / pending / failed).

If you need test data, run `scripts/seed-preview.ts` with `SUPABASE_BRANCH=<your-PR-branch>` (the slug Supabase uses, viewable in the Supabase Dashboard).

### KYC nudge canary on a preview branch (the resume protocol)

This is the originating use case. From the OpenBrain log `d6558b32`:

1. On any open PR (or a dedicated `chore/kyc-nudge-canary` PR for this purpose), wait for `migrate-preview` to succeed against the branch DB.
2. Seed synthetic providers including at least one whose phone is YOUR real WhatsApp number:
   ```sh
   PREVIEW_SEED_CANARY_PHONE='+27...your-E.164...' SUPABASE_BRANCH=chore-kyc-nudge-canary npx tsx scripts/seed-preview.ts --apply
   ```
3. In the Supabase Dashboard, switch the SQL editor to the **branch** DB (top-left selector) and flip the flag:
   ```sql
   INSERT INTO feature_flags (key, enabled, description)
   VALUES ('kyc_drive.auto_nudge', true, 'Send provider_kyc_nudge from the daily kyc-drive cron')
   ON CONFLICT (key) DO UPDATE SET enabled = true;
   ```
4. Trigger the preview cron once manually:
   ```sh
   curl -sS "https://<your-vercel-preview-url>/api/cron/kyc-drive-nudge" \
     -H "Authorization: Bearer $PREVIEW_CRON_SECRET" | jq
   ```
   (Preview `CRON_SECRET` comes from Vercel Preview env vars — same value as prod or different per the integration's policy.)
5. Verify on YOUR phone that the WhatsApp `provider_kyc_nudge` template arrives and the "Verify identity" button opens a working `/provider/verify/<token>` URL on the **preview** Vercel deployment (not prod).
6. ✅ Once green, repeat steps 3 + 4 against the **production** Supabase project. The prod cron run sends the real campaign to 73 providers.
7. Close the canary PR. Supabase deletes the branch DB.

### When a migration fails on a preview branch

1. `migrate-preview` workflow goes red on the PR.
2. PR builds continue (the preview deployment isn't gated on migration success — by design, so you can still iterate on UI without DB changes).
3. The preview deployment will produce DB errors at runtime; fix the migration locally, push again, the workflow re-runs.
4. Migrations are scoped to the branch DB only. A bad migration on a preview branch CANNOT touch production. This is the headline safety property.

### When the branch DB drifts from migrations

If you've been running ad-hoc SQL in the branch DB and migrations no longer apply cleanly, the simplest fix is to delete the branch in the Supabase Dashboard and let the next push to your PR re-create it. Branches are designed to be disposable.

## Cost

- Supabase Branching: **included in Pro plan** (already paying for it). No new line item.
- Per-branch DB: each branch consumes compute when active. Idle branches are paused after 7 days of no connections; reactivation is sub-second.
- Estimated steady-state monthly cost increase: ~$0–10 depending on PR volume and engineer activity. Watch the Supabase usage dashboard for the first month.

## What this does NOT do

- It does not realistic-data-test scenarios that need prod-shape distributions (e.g., recommendation quality, scoring tier accuracy). For those, run shadow queries against prod data with the read-only `internal_staff_test` cohort — they're a different question.
- It does not bypass `KYC_DRIVE_NUDGE_DEADLINE` or any other env var that's marked Sensitive in Vercel — those still need separately-set values in Preview tier.
- It does not auto-seed prod-realistic provider distributions; the seed in `seed-preview.ts` is intentionally tiny (5 providers, 2 customers) to keep canary tests fast. Add more synthetic rows as new test cases demand them.

## Rollback

This whole architecture is opt-in dashboard configuration plus one new workflow file. To roll back:

1. Supabase Dashboard → Branching → Disable. Active branch DBs are kept for 14 days then auto-deleted.
2. Vercel Dashboard → Integrations → Supabase → either uninstall or remove the Preview scope.
3. Delete `.github/workflows/migrate-preview.yml`.
4. Vercel Preview env vars revert to whatever they were before (the integration removes only what it added).

Preview deployments fall back to the prior behavior (point at the same Supabase as prod). No data loss in prod — the branches were independent.

## Related

- `docs/migration-deploy-automation.md` — the production migrate pipeline this preview workflow mirrors
- `lib/internal-test-cohort.ts` — the prior isolation pattern (still useful for cross-cohort filtering inside the single prod project)
- OpenBrain `d6558b32` (2026-06-19) — KYC nudge campaign paused state and resume protocol that motivated this work

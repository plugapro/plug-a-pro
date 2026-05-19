# Plug A Pro — Release Runbook

> Version: 2026-04-06
> Applies to: `field-service/` (marketplace app) and `marketing/` (site)

---

## Pre-Deploy Checklist

Before every production deployment, confirm:

- [ ] All tests pass: `cd field-service && pnpm test`
- [ ] All tests pass: `cd marketing && pnpm test`
- [ ] Linting passes: `pnpm lint` in both apps
- [ ] Prisma migration status clean: `cd field-service && pnpm exec prisma migrate status`
- [ ] Required environment variables present (see Environment Variables section)
- [ ] `vercel.json` cron schedules reviewed and confirmed with product

---

## Deploy Order

**Always deploy in this order to avoid downtime:**

1. **Run database migrations first** (before deploying new app code)
   ```bash
   cd field-service
   DATABASE_URL=<production-db-url> pnpm exec prisma migrate deploy
   ```
   Verify: `pnpm exec prisma migrate status` shows all migrations applied.

2. **Deploy `field-service`**
   ```bash
   vercel deploy --prod
   ```
   Or via GitHub merge to `main` (CI auto-deploys on Vercel).

3. **Deploy `marketing`**
   ```bash
   cd ../marketing && vercel deploy --prod
   ```

4. **Verify smoke tests** (see `docs/staging-smoke-test.md`)

---

## Migration Order

### Production DB state (as of 2026-04-08)

P0-4 is closed. The production Supabase DB has:
- `20260327000000_baseline` — marked as applied in `_prisma_migrations` (inserted via SQL Editor 2026-04-08)
- `20260402141355_whatsapp_preferences` — needs to be applied if not yet present

**Verify current migration state:**
```bash
   cd field-service
   pnpm exec prisma migrate status
```

If `20260402141355_whatsapp_preferences` is shown as pending, apply it:
```bash
   cd field-service
   pnpm exec prisma migrate deploy
```

### Fresh environment (new blank DB)

```bash
cd field-service
   DATABASE_URL=<new-db-url> DIRECT_URL=<new-direct-url> pnpm exec prisma migrate deploy
```

This applies both migrations in order: baseline → whatsapp_preferences.

---

## Environment Variables

### Required — field-service

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Supabase Postgres connection string |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (client-safe) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) |
| `WHATSAPP_ACCESS_TOKEN` | Meta Cloud API permanent token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta phone number ID |
| `WHATSAPP_VERIFY_TOKEN` | Webhook challenge verify token (you set this) |
| `WHATSAPP_APP_SECRET` | Meta App Secret for POST webhook signature verification |
| `CRON_SECRET` | Bearer token for cron route authentication |
| `NEXT_PUBLIC_APP_URL` | Production app URL (e.g. `https://app.plugapro.co.za`) |
| `PSP_PROVIDER` | Payment provider: `peach` or `yoco` |
| `PEACH_WEBHOOK_SECRET` | Peach webhook HMAC secret |
| `VAPID_PRIVATE_KEY` | Web push VAPID private key |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | Web push VAPID public key |
| `ADMIN_WHATSAPP_NUMBER` | Admin WhatsApp number for escalations |

### Required — marketing

| Variable | Description |
|----------|-------------|
| `NEXT_PUBLIC_SITE_URL` | Canonical site URL for sitemaps |

---

## Smoke Tests After Deploy

See `docs/staging-smoke-test.md` for the full checklist. Quick summary:

1. Load the marketing homepage — no 500s
2. Sign in as a customer (phone OTP) — redirect to `/bookings`
3. Sign in as a provider — redirect to `/provider`
4. Sign in as admin — redirect to `/admin`
5. Admin panel loads — no errors in browser console
6. WhatsApp webhook GET verification returns the challenge
7. Cron endpoints return 401 without the `CRON_SECRET` token

---

## Cron Verification

Verify all cron routes are secured and responsive:

```bash
# Should return 401
curl https://app.plugapro.co.za/api/cron/match-leads

# Should return 200
curl -H "Authorization: Bearer $CRON_SECRET" https://app.plugapro.co.za/api/cron/match-leads
```

**Cron schedule review (vercel.json):**

| Route | Schedule | Intended cadence |
|-------|----------|-----------------|
| `/api/cron/reminders` | `0 8 * * *` | 08:00 daily |
| `/api/cron/follow-up` | `0 10 * * *` | 10:00 daily |
| `/api/cron/slots` | `0 6 * * 1` | Monday 06:00 |
| `/api/cron/match-leads` | `*/30 7-20 * * *` | Every 30 min, 07:00–20:00 SAST |

> P1-D closed 2026-04-06: schedule updated to `*/30 7-20 * * *`. See `docs/product-decisions/cron-match-leads-cadence.md`.

---

## Rollback Steps

### Code rollback

```bash
# Vercel: promote previous deployment to production
vercel rollback [deployment-url]

# Or via Vercel dashboard: Deployments → previous deployment → "Promote to Production"
```

### Database rollback

> Prisma does not support automatic rollbacks. All migrations should be backward-compatible.
> If a migration must be undone:

1. Write and apply a compensating migration manually
2. Deploy the previous app code first (before reverting schema)
3. Apply the compensating migration

---

## Backup / Restore

> **Status (2026-04-08):** Backups verified active. Live restore rehearsal to new project not yet executed (requires operator action — see P2-K in tracker).

### Backup state (verified 2026-04-08)

Supabase dashboard → **Database → Backups → Scheduled backups** shows:

| Backup | Type | Status |
|--------|------|--------|
| 2026-04-08 01:17:30 UTC | PHYSICAL | Available |
| 2026-04-07 01:17:59 UTC | PHYSICAL | Available |
| 2026-04-06 01:16:16 UTC | PHYSICAL | Available |
| 2026-04-05 01:14:55 UTC | PHYSICAL | Available |
| 2026-04-04 01:15:49 UTC | PHYSICAL | Available |
| 2026-04-03 01:17:55 UTC | PHYSICAL | Available |
| 2026-04-02 01:16:47 UTC | PHYSICAL | Available |
| 2026-04-01 01:17:35 UTC | PHYSICAL | Available |

Daily backups run around midnight UTC. **Storage objects are NOT included** — only the database.

**PITR (Point in Time Recovery):** Not enabled. Available as a Pro Plan add-on. Enable via Dashboard → Database → Backups → Point in time if sub-daily restore granularity is required.

### Restore via Supabase Dashboard (recommended)

1. Go to **Database → Backups → Scheduled backups**
2. Click **Restore** next to the desired backup
3. Confirm — this restores the backup to the **current project** (destructive)

> For pre-launch rehearsal, use **Restore to new project** (BETA) in the same Backups section. This creates a new Supabase project from the backup without touching production.

### Manual backup via pg_dump

> **Important:** `DATABASE_URL` uses the pooled connection (port 6543, pgBouncer). `pg_dump` requires the direct connection. Use `DIRECT_URL` (port 5432):

```bash
pg_dump "$DIRECT_URL" --no-owner --no-acl -F c -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### Manual restore via pg_restore

```bash
pg_restore --no-owner --no-acl -d "$DIRECT_URL" backup_YYYYMMDD_HHMMSS.dump
```

### Pre-launch rehearsal checklist (P2-K)

- [ ] Operator clicks "Restore to new project" on a recent backup
- [ ] New project spins up and is accessible
- [ ] Run smoke queries against the restored project: `SELECT count(*) FROM "Provider"; SELECT count(*) FROM "JobRequest";`
- [ ] Confirm `_prisma_migrations` table exists and baseline row is present
- [ ] Document time taken for restore to complete
- [ ] Delete the new project after confirming restore success

---

## Incident Response

### Failed migration

1. Check `prisma migrate status` to see which migration failed
2. Fix the SQL in the migration file
3. Re-run `prisma migrate deploy`
4. If unrecoverable, restore from backup

### Broken cron job

1. Check Vercel logs: `vercel logs --prod` or Vercel dashboard
2. Test manually: `curl -H "Authorization: Bearer $CRON_SECRET" <cron-url>`
3. Fix the handler and redeploy

### WhatsApp webhook not receiving events

1. Check Meta webhook configuration — verify the endpoint is registered
2. Verify `WHATSAPP_VERIFY_TOKEN` matches what's configured in Meta Business Manager
3. Verify `WHATSAPP_APP_SECRET` is set (required for POST signature verification since hardening)
4. Test signature: send a test event from the Meta dashboard

### Payment webhook failures

1. Check Vercel function logs for `[webhook/payments]` entries
2. Verify `PEACH_WEBHOOK_SECRET` is configured
3. PSP dashboard should show webhook delivery status and allow retries

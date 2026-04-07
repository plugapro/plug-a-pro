# Plug-A-Pro — Release Runbook

> Version: 2026-04-06
> Applies to: `field-service/` (marketplace app) and `marketing/` (site)

---

## Pre-Deploy Checklist

Before every production deployment, confirm:

- [ ] All tests pass: `cd field-service && npm run test`
- [ ] All tests pass: `cd marketing && npm run test`
- [ ] Linting passes: `npm run lint` in both apps
- [ ] Prisma migration status clean: `cd field-service && npx prisma migrate status`
- [ ] Required environment variables present (see Environment Variables section)
- [ ] `vercel.json` cron schedules reviewed and confirmed with product

---

## Deploy Order

**Always deploy in this order to avoid downtime:**

1. **Run database migrations first** (before deploying new app code)
   ```bash
   cd field-service
   DATABASE_URL=<production-db-url> npx prisma migrate deploy
   ```
   Verify: `npx prisma migrate status` shows all migrations applied.

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

### Production (first-time setup)

> **WARNING:** The current Prisma migration history is incomplete. See tracker item P0-4.
> Until a baseline migration is created, use the Supabase migration path:

```bash
# Apply the full schema via Supabase CLI (authoritative for initial setup)
supabase db push --project-ref <project-ref>

# Then mark the Prisma migration as applied (so prisma migrate doesn't re-run it)
cd field-service
DATABASE_URL=<production-db-url> npx prisma migrate resolve --applied 20260402141355_whatsapp_preferences
```

### Ongoing (after baseline migration is created — see P0-4)

```bash
cd field-service
DATABASE_URL=<production-db-url> npx prisma migrate deploy
```

### Migration baseline creation (one-time, required before go-live)

```bash
cd field-service

# 1. Generate a full baseline migration from the current schema
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script \
  > prisma/migrations/20260327000000_baseline/migration.sql

# 2. Create the migration directory entry
mkdir -p prisma/migrations/20260327000000_baseline

# 3. Mark as applied against the existing production database
DATABASE_URL=<production-db-url> npx prisma migrate resolve --applied 20260327000000_baseline

# 4. Verify
DATABASE_URL=<production-db-url> npx prisma migrate status
```

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
| `/api/cron/match-leads` | `0 8 * * *` | **TBD** — see P1-D |

> **Action required:** Confirm `match-leads` cadence with product before go-live (tracker P1-D).
> Handler comment says "every 30 minutes" but schedule is currently once daily.

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

> **Status:** This process needs a human rehearsal before go-live (tracker P2-K).

### Backup (Supabase managed)

Supabase automatically takes daily backups on Pro plan. Verify backup retention in the Supabase dashboard under **Settings → Backups**.

### Manual backup (point-in-time)

```bash
pg_dump "$DATABASE_URL" --no-owner --no-acl -F c -f backup_$(date +%Y%m%d_%H%M%S).dump
```

### Restore

```bash
pg_restore --no-owner --no-acl -d "$DATABASE_URL" backup_YYYYMMDD_HHMMSS.dump
```

> Restore has **not been rehearsed on this project**. Schedule a dry run before launch.

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

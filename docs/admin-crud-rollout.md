# Admin CRUD Rollout Guide

> Sessions 1–13 delivery — `migration/from-vdp`
> Last updated: 2026-04-20

## What was delivered

| Session | Branch / PR | Scope |
|---------|-------------|-------|
| 1 | baseline | Repo audit, conventions, CLAUDE.md |
| 2–3 | PR #6, #7 | Prisma schema (`AdminUser`, `ProviderCertification`, `ProviderEquipment`, `ProviderNote`, `CustomerNote`), migration baseline |
| 4 | PR #8 | Core library: `crudAction()`, `isEnabled()`, `audit.ts` extension |
| 5 | PR #9 | CRUD kit UI: `CRUDTable`, `CRUDForm`, `ConfirmDialog`, `DestructiveConfirmDialog` |
| 6 | PR #10 | Locations CRUD refactored onto `crudAction()` + `admin.crud.locations` flag |
| 7 | PR #11 | `/admin/team` — AdminUser invite, role change, deactivate + `admin.users.v2` flag |
| 8–9 | PR #12 | Customer CRUD — block, add note, deactivate + `admin.crud.customers` flag |
| 10–11 | PR #13 | Provider CRUD — status lifecycle, verify, certifications, notes + `admin.crud.providers` flag |
| 12 | PR #14 | Matcher wired to `ProviderCertification` & `ProviderEquipment` (WS-B.1) |
| 13 | this PR | Rollout doc, follow-up issues, cleanup |

---

## Feature flags

All mutations are gated. Flags are seeded disabled by default.

```bash
# Seed all flags (disabled)
cd field-service && npx tsx scripts/seed-flags.ts

# Enable a specific flag
npx tsx scripts/seed-flags.ts --flag=admin.crud.providers --enable

# Enable all at once
npx tsx scripts/seed-flags.ts --enable
```

| Flag | Controls |
|------|----------|
| `admin.crud.locations` | Create, update, deactivate, delete LocationNodes |
| `admin.crud.customers` | Block/unblock, add note, deactivate Customers |
| `admin.crud.providers` | Status lifecycle, verify, cert verification, add note |
| `admin.users.v2` | Invite AdminUser, change role, deactivate |

---

## Rollout sequence

### 1. Apply migrations

```bash
# Via Supabase SQL editor (production)
# Apply any pending migrations in field-service/prisma/migrations/

# Or locally:
cd field-service && npx prisma migrate deploy
```

### 2. Backfill AdminUser records

Run once after deploying to production to create `AdminUser` rows for existing Supabase admins:

```bash
cd field-service && npx tsx scripts/backfill-admin-users.ts
```

### 3. Seed feature flags

```bash
cd field-service && npx tsx scripts/seed-flags.ts
```

Flags are seeded **disabled**. Enable them one at a time as ops team is onboarded.

### 4. Enable flags incrementally

Recommended order:

1. `admin.crud.locations` — low risk, no customer-facing impact
2. `admin.crud.providers` — enables status lifecycle and cert verification
3. `admin.crud.customers` — enables block/deactivate flows
4. `admin.users.v2` — enables team management (enable last, after AdminUser backfill verified)

---

## `allowLegacyStringFallback` cutover

The matching engine still falls back to legacy `serviceAreas` string matching. To cut over:

1. Run the location backfill: `pnpm db:backfill`
2. Review unresolved provider count in logs
3. Flip `allowLegacyStringFallback = false` in a **separate deploy** (not bundled with feature work)

See OpenBrain decision: `allowLegacyStringFallback cutover is a separate deploy`.

---

## ProviderCertification & ProviderEquipment (WS-B.1)

The matcher now checks both legacy arrays and admin-verified DB records:

| Check | Legacy source | Admin-verified source |
|-------|--------------|----------------------|
| Certifications | `TechnicianCertification` (status ≠ EXPIRED) | `ProviderCertification` (verifiedAt set) |
| Equipment | `equipmentTags` string array | `ProviderEquipment` (active=true, by label or category) |

Admin ops verify certifications via `/admin/providers/[id]` → Certifications table → **Verify** button (requires `admin.crud.providers` flag).

Admin ops add equipment via the Provider detail page Equipment section.

---

## CI/CD notes

- CI runs on `.github/workflows/field-service-ci.yml`
- Build job requires `CI_BUILD_ENABLED = true` GitHub repo variable (set this to unblock build step)
- No E2E (Playwright) coverage is wired yet — see follow-up issue WS-F

---

## Follow-up issues

Opened as GitHub issues after this PR merges:

| Issue | Title |
|-------|-------|
| WS-F | Wire Playwright smoke tests into CI |
| WS-G | Admin role matrix — replace Supabase metadata roles with `AdminUser.role` |
| WS-H | `allowLegacyStringFallback` cutover deploy checklist |
| WS-I | Equipment management UI on Provider detail page |
| WS-J | Booking CRUD — cancel, reschedule, add note |
| WS-K | Dispute resolution workflow |
| WS-L | Provider application review flow improvements |

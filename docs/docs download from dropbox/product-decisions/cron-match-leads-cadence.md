# Product Decision: match-leads Cron Cadence

**Status:** Pending product approval
**Raised:** 2026-04-06
**Affects:** `field-service/vercel.json`, `field-service/app/api/cron/match-leads/route.ts`

---

## The Problem

There is a conflict between the cron handler's documented intent and the actual schedule:

| Source | Value | Meaning |
|--------|-------|---------|
| `match-leads/route.ts` comment | "Runs every 30 minutes via Vercel Cron" | Redispatch runs continuously during the day |
| `vercel.json` schedule | `"0 8 * * *"` | Runs once per day at 08:00 SAST |

At the current schedule, an unmatched job can wait **up to 23 hours 59 minutes** before the next matching attempt.

---

## Options

### Option A — Every 30 minutes (matches handler intent)
```json
{ "path": "/api/cron/match-leads", "schedule": "*/30 * * * *" }
```
- Customers get a match attempt within ~30 minutes
- Higher Vercel Function invocations (48×/day vs 1×/day)
- On Vercel Pro/Hobby, cron invocations are not billed separately

### Option B — Every hour
```json
{ "path": "/api/cron/match-leads", "schedule": "0 * * * *" }
```
- Reasonable responsiveness (max 1 hour wait)
- 24 invocations/day

### Option C — Keep once daily (current)
```json
{ "path": "/api/cron/match-leads", "schedule": "0 8 * * *" }
```
- Jobs not matched by 08:00 wait until the next day
- **Not recommended for a real-time marketplace**

### Option D — Business hours only, every 30 minutes
```json
{ "path": "/api/cron/match-leads", "schedule": "*/30 7-20 * * *" }
```
- Active 07:00–20:00 SAST (field service working hours)
- 27 invocations/day
- Matches typical provider availability window

---

## Recommendation

**Option D** — every 30 minutes during business hours (07:00–20:00 SAST).

This matches provider availability, gives customers fast turnaround within working hours, and keeps invocation count reasonable.

---

## Files to Update After Decision

1. `field-service/vercel.json` — update the `match-leads` schedule
2. `field-service/app/api/cron/match-leads/route.ts` — update the comment to match the chosen cadence
3. `docs/release-runbook.md` — update the cron schedule table
4. `docs/release-readiness-tracker.md` — close item P1-D

---

## Action Required

Product to confirm preferred option. Engineering to update `vercel.json` immediately after confirmation.

# Database Incident Runbook

## Detect

- `/api/health` DB probe fails.
- Prisma errors spike.
- Admin queues or user journeys return DB-backed failures.

## Triage

1. Check Supabase/Postgres status.
2. Review recent migrations and Prisma client version changes.
3. Check connection pool saturation and long-running queries.
4. Validate whether failures affect reads, writes, or both.

## Mitigate

- Roll back the app deployment if a code change caused the failure.
- Do not run destructive migrations or resets without explicit approval.
- Prefer additive repair migrations with backup evidence.

## Close

Record DB status, affected queries/routes, migration state, rollback or repair action, and follow-up performance work in OpenBrain.

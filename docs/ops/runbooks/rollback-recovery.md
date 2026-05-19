# Rollback And Recovery Runbook

## Detect

- Build/start smoke fails.
- Production health degrades after deploy.
- Critical user journeys fail in preview or production.

## Triage

1. Identify the last known-good deployment.
2. Compare dependency, env, schema, and migration changes.
3. Check whether rollback is app-only or requires database/storage recovery.

## Mitigate

- Use Vercel rollback for app-only regressions.
- Do not roll back schema destructively.
- If data repair is required, create a backup and use a reviewed repair script.

## Close

Record deployment IDs, rollback time, health result, affected users, and follow-up prevention in OpenBrain.

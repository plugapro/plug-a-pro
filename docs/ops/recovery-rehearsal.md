# Backup, Rollback, And Recovery Rehearsal

## Non-Destructive Rehearsal Checklist

1. Create an isolated staging database or restore target.
2. Restore the latest Supabase backup into the isolated target.
3. Point a temporary preview deployment at the restored target.
4. Run smoke checks for `/api/health`, customer booking, provider sign-in page, admin sign-in page, and attachment proxy.
5. Verify storage object availability for recent attachments or document the storage restore gap.
6. Rehearse Vercel rollback to the previous known-good deployment.
7. Record observed RTO, observed RPO, restore target, smoke result, and rollback result in OpenBrain.

## Do Not Do

- Do not restore over production.
- Do not export user data to unmanaged local files.
- Do not paste credentials or backup URLs into OpenBrain or pull requests.

## Closure Evidence

The recovery-readiness task can close only after a dated rehearsal note records:

- Backup source and restore target.
- RTO and RPO observed.
- Smoke test evidence.
- Storage restore result or explicit gap.
- Rollback command/result.
- Follow-up owner for failed steps.

**Required evidence fields**
- Target deployment URL.
- Restore environment identifier (name/ID).
- Restore duration metrics (`restore_complete_at`, RTO, RPO).
- Snapshot of successful smoke evidence (command log or screenshot).
- Rollback confirmation (timestamp + target URL/version).

## Rehearsal Evidence Log

No production-like restore or rollback rehearsal has been executed from this checklist yet.

| Date | Environment | Restore target | RTO observed | RPO observed | Smoke result | Rollback result | Evidence link |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-19 | Not executed | Pending isolated target | Pending | Pending | Pending | Pending | Pending OpenBrain rehearsal note |

## Manual Evidence Required Before Closure

1. Dated OpenBrain rehearsal note with no secret values.
2. Screenshot or exported status from the isolated restore target.
3. CI or command transcript showing `/api/health`, customer booking, provider sign-in, admin sign-in, and attachment proxy smoke results.
4. Vercel rollback rehearsal result against a non-production or approved preview target.

## Operational Evidence Checklist

- Capture dashboard/monitoring evidence for:
  - Queue depth at restore start and end.
  - Error rate during replay and catch-up period.
  - Alert/noise impact from synthetic load.
- Include RTO/RPO evidence in OpenBrain using this format:
  - `restore_start`: timestamp
  - `restore_complete`: timestamp
  - `rollback_start`: timestamp
  - `rollback_complete`: timestamp

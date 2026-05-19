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

# Provider auto-approve reliability rebuild

Date: 2026-05-06

## Context

Cron-based provider onboarding approvals had a reliability gap: optional side-effects (promo awards, WhatsApp notifications, matching rechecks) could fail and still block or confuse retries, while schema drift in `provider_promo_awards` caused intermittent critical failures.

The work rebuilds approval into a bounded transaction and introduces durable, replayable side-effect markers.

## Implementation notes

- Split execution into two phases:
  - **Phase A (critical)**: provider record sync (`skipEnrichment`), application `PENDING -> APPROVED`, category approvals, and ops queue release inside one transaction.
  - **Phase B (best-effort)**: promo award, welcome notification, and matching recheck are executed outside the critical transaction.
- Added `provider_auto_approve_side_effect_markers` with status/state for each app + side-effect kind and bounded retry metadata.
- Added schema preflight in cron run for `provider_promo_awards` column + enum requirements; run continues even when drift is detected.
- Reconciliation path `reconcileAutoApproveSideEffects(...)` replays pending markers with capped exponential-ish delay backoff.
- Added dedupe protections via unique marker key (`kind + applicationId`) and transactional status gates (`WHERE status: 'PENDING'` style checks in existing idempotent updates).
- Added per-run telemetry in auto-approve result:
  - `attempted`, `approved`, `skipped`, `errors`, `txAborts`
  - side-effect summary
  - skipped reasons and reconciliation counters

## Validation notes

- API and service-layer tests updated to the new result contract and marker-backed side-effect behavior.
- Manual/ops scripts were not changed; existing emergency manual approval flow remains intact.

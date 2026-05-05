# Arrival confirmation state

Date: 2026-05-02

## Context

The signed provider lead page showed the active arrival-time form after a provider had already confirmed arrival. The backend was already persisting `match.plannedArrivalStart`, `match.plannedArrivalEnd`, and `match.plannedArrivalNote`; the issue was page rendering.

## Implementation notes

- `match.plannedArrivalStart` is the persisted signal that the arrival scheduling step is complete.
- The signed lead page renders a confirmed arrival summary when an accepted job has a planned arrival and the provider is not explicitly editing it.
- The active arrival form is hidden after scheduling and is also hidden once the job progresses to on-the-way, arrived, started, or completed.
- Providers can still reschedule through the explicit `Change arrival time` link, which adds `editArrival=1`.
- The edit form defaults to the saved planned arrival window, not the original customer availability fallback, to avoid accidental schedule changes.

## Decisions

- No new arrival status column was added because the existing match planning fields already represent the state needed for this workflow.
- Customer notification, audit logging, duplicate detection, and provider authorization remain in `saveAcceptedLeadArrival`.
- The page remains server-rendered from persisted state, so refresh and WhatsApp in-app browser behavior do not depend on client-side state.

## Validation

- Added regression coverage for the arrival scheduling UI state machine.
- Added regression coverage for using the persisted planned arrival as edit-form defaults.

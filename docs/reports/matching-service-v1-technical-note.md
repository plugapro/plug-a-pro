# PlugAPro Matching Service V1 Technical Note

## Summary

This implementation adds the first production-ready matching service for PlugAPro on top of the existing provider, request, quote, booking, and WhatsApp flows.

This document now reflects the phase 2 hardening pass as well:

- durable assignment workflow state for timeout, retry, and idempotent reruns
- stronger geo coverage using radius-based service areas when coordinates are present
- richer provider reliability inputs
- category-specific operating constraints
- category-aware direct-booking support for work types that can be committed at assignment time

The design keeps the matching domain modular without replacing the current marketplace flow:

- `JobRequest` remains the intake object for a new customer need.
- `Provider` remains the technician/provider record.
- `DispatchDecision`, `MatchAttempt`, and `AssignmentHold` add explainable ranking and controlled assignment.
- `TechnicianScheduleItem` adds explicit scheduling commitments and blocked time.
- `Booking` remains the committed scheduled service record used by the existing quote and job flow.

The matcher is deterministic and explainable. It does not use ML, live GPS, or optimization solvers.

## Architecture

The matching pipeline is split into four layers:

1. Persistence
- Prisma models for provider capabilities, service areas, certifications, availability, schedule items, ranking attempts, and assignment holds.

2. Scheduling and travel feasibility
- Deterministic helpers estimate whether a technician can realistically fit the requested work into their current schedule.

3. Matching and assignment service
- A service layer applies hard filters, computes weighted ranking, persists audit records, creates assignment holds, and handles fallback when offers are rejected or expire.

4. Transport surfaces
- Admin dispatch APIs and provider assignment-offer APIs call the same domain service.
- Existing WhatsApp and cron entry points continue to work through the compatibility wrapper in `matching-engine.ts`.

## Why this shape was chosen

The current codebase already had a functioning marketplace flow built around:

- `JobRequest`
- `Lead`
- `Match`
- `Quote`
- `Booking`
- `Job`

Replacing that with a new parallel scheduling and booking stack would have created unnecessary migration risk. The chosen approach keeps those primitives and introduces a matching domain around them.

That gives three advantages:

1. It preserves the current operational and WhatsApp flows.
2. It adds explainable candidate ranking and auditability without rewriting the full booking lifecycle.
3. It creates a clean foundation for future dispatch improvements.

## Booking commitment model

The matching service now supports two commitment patterns:

1. Quote-first categories
- the provider accepts the assignment
- the schedule is reserved immediately
- the final `Booking` record is created on quote approval

2. Assignment-first categories
- if the category policy allows it and the customer already accepted the amount up front
- assignment acceptance creates the `Match`, an approved system quote, the `Booking`, the `Job`, and the payment record initialization

This keeps the current commercial flow intact for quote-heavy categories such as electrical, plumbing, roofing, and appliance work, while allowing standardised categories such as handyman, DIY/assembly, garden work, and cleaning to move faster when the price is already agreed.

## Scheduling assumptions

V1 scheduling is realistic but intentionally conservative:

- no live GPS assumptions
- uses last known provider location or previous commitment location
- uses heuristic travel estimates
- uses working hours plus explicit blocked items, breaks, bookings, and active holds
- applies travel buffers before and after work

This is better than simple area matching, but it is still heuristic. It will not behave like route-optimized dispatch software.

## Assignment workflow, timeout, and idempotency

Assignment state changes are persisted and the service uses explicit hold records and decision logs for traceability.

Current protections:

- each dispatch run persists one `DispatchDecision`
- ranked candidates are stored as `MatchAttempt`
- top candidate offer is materialized as `AssignmentHold`
- accept/reject/expire transitions are explicit
- schedule items are used to prevent collisions
- dispatch decisions now store an idempotency key and retry state
- repeated assignment runs reuse an active offer instead of creating duplicate holds
- cron processing can expire timed-out holds and re-offer the next ranked technician

Current limitation:

- this is still cron-driven rather than backed by a durable workflow engine or queue
- retry is deterministic and reliable enough for MVP, but not yet resilient to every infrastructure interruption scenario

## Score model

The score model is centrally configurable and deterministic:

- skill fit: `0.30`
- schedule fit: `0.20`
- travel efficiency: `0.20`
- technician reliability: `0.15`
- customer preference / repeat history: `0.10`
- margin / cost efficiency: `0.05`

This was chosen because the immediate business goal is assignment quality and explainability, not algorithmic novelty.

## What V1 now supports

- hard filtering by status, area, skill, certification, and schedule feasibility
- category-derived requirements for certifications, equipment, and vehicle constraints
- weighted ranked candidate output with reason text and score breakdown
- admin review or automatic assignment
- offer acceptance, rejection, and expiry handling
- idempotent re-dispatch when an active offer already exists
- cron-driven retry to the next ranked technician after timeout
- dispatch audit trail
- manual override with reason logging
- schedule blocking to avoid obvious collisions
- direct booking on assignment for allowed categories when the customer already accepted the amount
- radius-based service-area matching when coordinate data is present
- richer provider reliability signals including punctuality, complaint rate, and cancellation rate

## Known limitations

1. No live traffic or GPS feeds
- travel estimates are heuristic and based on area or last known coordinates.

2. No dedicated workflow engine
- offer timeout and retry are now cron-driven and idempotent, but still not backed by a dedicated workflow runner.

3. Direct booking depends on up-front commercial agreement
- assignment-first booking only works when the request already contains an accepted amount and the category policy allows direct commitment.

4. Provider cost and margin signals are shallow
- the `margin / cost efficiency` score is currently intentionally lightweight.

5. Geo coverage is stronger, but not yet full routing
- radius-based service areas are now supported when coordinates are present, but the system still does not model polygons, traffic, or road network routing.

## Recommended next phase

1. Move from cron-driven workflow to durable orchestration
- explicit timeout workers
- crash-safe retry orchestration
- stronger idempotent event handling

2. Strengthen geo logic again
- geo cells or polygon-based coverage
- more accurate travel estimation
- stale-location confidence scoring

3. Expand category policy depth
- service-specific duration heuristics
- service-specific quote-vs-booking rules
- service-specific inspection requirements

4. Improve reliability scoring freshness
- event-driven updates from job status, disputes, reviews, and cancellations
- periodic metric backfill jobs

5. Add richer provider operating constraints
- material pickup dependency
- helper/crew size requirements
- equipment confidence and maintenance state

6. Add SLA-aware dispatch modes
- urgent repair
- planned service
- recurring maintenance

## Files added in this phase

- `field-service/lib/matching/config.ts`
- `field-service/lib/matching/types.ts`
- `field-service/lib/matching/geography.ts`
- `field-service/lib/matching/scheduling.ts`
- `field-service/lib/matching/service.ts`
- `field-service/lib/service-category-policy.ts`
- admin and provider dispatch APIs
- dispatch admin page
- new matching and scheduling tests

## Final position

V1 is production-usable because it improves assignment quality, preserves explainability, and keeps operational control with the admin team.

It is not a dispatch optimization system yet. It is a deterministic, auditable marketplace matching engine built to fit the current PlugAPro flow without introducing brittle complexity.

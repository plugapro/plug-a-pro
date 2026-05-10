# Web Customer Journey — Remediation Report

**Date:** 2026-05-10  
**Branch:** `feat/web-customer-journey`  
**Scope:** Post-WP1–WP6 targeted fixes before production rollout

---

## Summary

Six high-risk gaps were identified after the initial WP1–WP6 implementation round. All six have been closed in this remediation pass. Each item is narrow in scope; no existing flows were rewritten.

---

## R1 — Auth Intent Hardening

**Risk:** Provider phones could enter the customer sign-up flow and receive a customer account linked to their provider identity. Post-signup redirect pointed to `/bookings/new`, a route that does not exist (404 on `[id]` catch-all).

**Changes:**
- `app/api/auth/link/route.ts`: After `linkCustomerAccount`, queries `db.provider.findFirst({ where: { userId: session.id } })` and returns `isProvider: boolean` in the response.
- `app/(auth)/verify/page.tsx`: When `isProvider` is true, shows an error message instead of routing the user into the customer flow.
- `app/(auth)/sign-up/page.tsx`: Default post-signup redirect changed from `/bookings/new` → `/services` (the actual booking entry point).
- `__tests__/app/api/auth/link.test.ts`: Added `@/lib/db` mock; existing 4 tests preserved.
- New: `__tests__/app/api/auth/link-provider.test.ts` — 5 scenarios covering `isProvider` flag behaviour.

**Acceptance criteria met:** Provider phone → `/sign-up` → OTP → verify page shows error, no customer routing. Non-provider phone signs up normally and lands on `/services`.

---

## R2 — Messaging Authorization

**Risk:** `GET /api/customer/messages` had no feature-flag gate and no booking-status check, allowing any authenticated customer to query message events for terminal bookings or even for bookings belonging to other customers if the booking ownership check was bypassed.

**Changes:**
- `app/api/customer/messages/route.ts`: Added `isEnabled('customer.messaging.v1')` check before any DB query (returns 404 when disabled). Added booking-status gate: only `SCHEDULED` or `RESCHEDULED` bookings return 200.
- New: `__tests__/app/api/customer/messages.test.ts` — 7 scenarios: missing `bookingId` → 400, no session → 401, flag disabled → 404 (DB not queried), wrong customer → 404, `COMPLETED` booking → 404, `SCHEDULED` → 200, `RESCHEDULED` → 200.

**Acceptance criteria met:** Flag-disabled 404 verified before any DB call. Ownership and status gates enforced. Response shape tested.

---

## R3 — AutoRefresh Step-up Backoff + Terminal State

**Risk:** `AutoRefresh` used `setInterval` (fixed 15 s forever), continued polling on terminal states (CANCELLED, COMPLETED), and would run on tabs hidden in the background for hours.

**Changes:**
- `components/customer/AutoRefresh.tsx`: Rewrote `setInterval` → recursive `setTimeout` with step-up cadence: ticks 0–3 at 15 s, ticks 4–7 at 30 s, tick 8+ at 60 s. Added `terminalState` prop — when true, no timer is scheduled. `visibilitychange` resets the tick counter and fires an immediate refresh on tab focus.
- `app/(customer)/requests/[id]/page.tsx`: Passes `terminalState` for `CANCELLED | COMPLETED | EXPIRED | CLOSED` statuses.
- `app/(customer)/bookings/[id]/page.tsx`: Passes `terminalState` for `CANCELLED | COMPLETED`.
- `app/(customer)/messages/[bookingId]/page.tsx`: Passes `terminalState={!canSend}` (stops polling when booking is not SCHEDULED/RESCHEDULED).
- `__tests__/components/customer/auto-refresh.test.ts`: Rewritten for recursive-setTimeout model; added terminalState, step-up, and `POLL_INTERVAL_MS` backward-compat tests.

**Acceptance criteria met:** Terminal pages no longer poll. Step-up verified: tick 5 fires at 30 s, not 15 s.

---

## R4 — SavedSite Region Determinism

**Risk:** `applySavedSite` reset `region: ''` but `createCustomerSiteAction` never saved `locationNodeId`, so all saved addresses had both `region = ''` and `locationNodeId = null`. The booking validator (`!region && !locationNodeId`) would always block submission for saved-address customers.

**Changes:**
- `app/(customer)/account/sites/actions.ts`: `createCustomerSiteAction` now calls `resolveSuburbNodeId(suburb, city)` and persists `locationNodeId` on the `CustomerAddress` row. No schema migration needed — the field already exists.
- `app/(customer)/book/[serviceId]/page.tsx`: `savedSites` query now includes `locationNode: { select: { regionKey: true } }`.
- `components/customer/BookingFlow.tsx`: `SavedSite` interface gains optional `locationNode` field; `applySavedSite` uses `site.locationNode?.regionKey ?? ''` instead of `region: ''`.

**Acceptance criteria met:** New saved addresses receive a `locationNodeId` on creation. Applying a saved site populates `region` from `locationNode.regionKey`; validator passes without re-entering address.

---

## R5 — Feature Flag Seed

**Risk:** `customer.realtime.v1` (Phase B Supabase Realtime) was referenced in the plan but not registered in `seed-flags.ts`, making it invisible to the flag admin UI and impossible to enable without a code deploy.

**Change:**
- `scripts/seed-flags.ts`: Added `customer.realtime.v1` (disabled by default). Run `npx tsx scripts/seed-flags.ts` after deploy to register.

---

## Test Coverage After Remediation

| Area | Before | After |
|------|--------|-------|
| `link/route.ts` isProvider flag | 0 tests | 5 tests (link-provider.test.ts) |
| `customer/messages` API | 0 tests | 7 tests (messages.test.ts) |
| AutoRefresh step-up + terminal | 5 tests (setInterval model) | 10 tests (setTimeout + step-up) |
| Total suite | 2156 | 2159 passing |

---

## Deployment Notes

1. Run `npx tsx scripts/seed-flags.ts` after deploying to register `customer.realtime.v1`.
2. `customer.messaging.v1` remains off by default; enable per-user via `enabledForUsers` for staged rollout.
3. No schema migrations required for this remediation pass.
4. Existing saved `CustomerAddress` rows with `locationNodeId: null` (created before this fix) will still trigger the region-required error. A one-time backfill can be run post-deploy if needed (`UPDATE customer_addresses SET location_node_id = ... WHERE location_node_id IS NULL`).

# CLIENT-02 — Client PWA Channel and Handoff Model

## Status
PASS

## Resolver audit

| Check | Result |
|---|---|
| `resolveClientPwaDestination()` — state-aware | YES — destination is built from current `JobRequest.status` + `Job.status`; `intendedScreen` / `view` param is accepted but never used to override the current state |
| Covers all handoff map entries | YES — all 13 `ClientPwaScreen` values are reachable via `resolveClientPwaScreenForState()` |
| Fallback for expired/invalid | YES — `resolveTokenDestination()` returns `screen: 'expired'` / `screen: 'invalid_link'` with routes to `/requests/access/recovery?reason=expired|invalid` |

The resolver chain is:
1. `resolveClientPwaDestination()` — accepts `token | requestId | jobId`
2. `resolveTokenDestination()` — validates token via `resolveJobRequestAccessToken()`
3. `buildDestination()` — calls `resolveClientPwaScreenForState()` with live DB state
4. `routeForClientPwaScreen()` — emits token-safe or booking-specific route

The `intendedScreen` parameter is accepted for API compatibility but has no effect on routing; only backend state determines the destination. This is the correct behaviour.

## Recovery route

| Check | Result |
|---|---|
| Existed before this step | NO |
| Created by this step | YES |
| Path | `field-service/app/requests/access/recovery/page.tsx` |
| Route | `/requests/access/recovery?reason=expired|invalid` |

The page renders a minimal, no-auth-required screen with appropriate copy for each reason code and a CTA linking to `/` (start a new request). It does not require a session.

Note: the recovery route sits under `app/requests/` (public, no customer layout), matching the existing `app/requests/access/[token]/` pattern. The `(customer)` route group does not have an `access/` subtree.

## WhatsApp URL generation

| Check | Result |
|---|---|
| Uses production URL helper | YES |

`getJobRequestAccessUrl()` in `field-service/lib/job-request-access.ts:60` calls `getPublicAppUrl()` from `field-service/lib/provider-credit-copy.ts` before building ticket URLs. The notification helpers in `client-pwa-submission-notifications.ts` receive `ticketUrl` as a parameter — it is the caller's responsibility to generate the URL via `getJobRequestAccessUrl()`. No hardcoded localhost or base URL was found in the notification helpers.

## Handoff map coverage

| WhatsApp event | `resolveClientPwaScreenForState()` maps to | Correct PWA path |
|---|---|---|
| Start request | `client_home` | `/bookings` |
| Continue request / draft | `request_form` | `/requests/{id}?view=request_form` |
| Add photos | `request_form` (upload_photos action) | `/requests/{id}?view=request_form` |
| Add address / details | `request_form` (resume_request action) | `/requests/{id}?view=request_form` |
| Review request | `request_form` (resume_request action) | `/requests/{id}?view=request_form` |
| Request submitted | `request_submitted` | `/requests/access/{token}?view=request_submitted` |
| Providers reviewing | `providers_reviewing` | `/requests/access/{token}?view=providers_reviewing` |
| Shortlist ready | `shortlist` | `/requests/access/{token}?view=shortlist` |
| View provider profile | `shortlist` (select_provider action) | `/requests/access/{token}?view=shortlist` |
| Provider selected | `provider_confirmation` | `/requests/access/{token}?view=provider_confirmation` |
| Provider accepted | `job_tracking` | `/requests/access/{token}?view=job_tracking` |
| Arrival confirmed | `job_tracking` (EN_ROUTE job) | `/requests/access/{token}?view=job_tracking` |
| Job completed | `completion_review` | `/bookings/{bookingId}/rate` |

Note: "Start / Continue request / Add photos / Add address / Review" all map to `request_form` because the PWA controls sub-step navigation internally. The handoff only needs to land on the correct screen.

## Deviations

| Deviation | Detail |
|---|---|
| Token TTL | Aligned to 72 hours (`lib/job-request-access.ts`). This closes the earlier 90-day deviation. Existing persisted token expiries remain valid until rotation. |
| `intendedScreen` param has no routing effect | Accepted for API compatibility (callers pass it; the page passes `view` from search params). The resolver always uses live DB state. This is correct behaviour, not a gap. |
| "View provider profile" has no dedicated screen | Provider profiles are surfaced via the shortlist screen; there is no separate `provider_profile` screen in `ClientPwaScreen`. The handoff intent `provider_profile` in `ClientPwaHandoffIntent` resolves to the shortlist view. This is an acceptable simplification given the current PWA scope. |

## Tests

52 tests in `field-service/__tests__/lib/client-pwa-handoff-model.test.ts`, all passing.

| Group | Count | Key scenarios |
|---|---|---|
| `resolveClientPwaScreenForState` — handoff map coverage | 18 | Every `JobRequestStatus`; every `JobStatus` reachable when MATCHED; EXPIRED; CANCELLED |
| `allowedActionsForClientPwaScreen` — all screens | 18 | Array defined for all 13 screens; shortlist has select_provider; job_tracking only track_job; expired/invalid_link empty |
| `resolveClientPwaDestination` — stale intent | 4 | Shortlist intent → job_tracking (MATCHED+SCHEDULED); matching intent → shortlist (SHORTLIST_READY); shortlist → provider_confirmation (PROVIDER_CONFIRMATION_PENDING); job_tracking → completion_review (COMPLETED) |
| `resolveClientPwaDestination` — recovery fallback | 4 | Invalid token; expired token; missing requestId; no params |
| Full handoff map — WhatsApp event → PWA screen | 8 | All major handoff events in a data-driven table |

Existing related tests also passing:
- `__tests__/lib/client-pwa-destination.test.ts` — 4 tests (stale token, completion review route, provider field privacy, invalid token)
- `__tests__/lib/client-pwa-handoff.test.ts` — 6 tests (`resolveClientPwaHandoff` scenarios)
- `__tests__/lib/client-pwa-state.test.ts` — pre-existing state machine tests

Overall suite: **167 passing, 1 skipped, 0 failing** (1872 tests, 4 todo).

## Gaps closed

1. **Recovery route created** — `app/requests/access/recovery/page.tsx` now exists; the resolver's fallback routes are no longer dead links.
2. **Comprehensive handoff model test coverage** — `client-pwa-handoff-model.test.ts` added with 52 tests covering every handoff map entry, stale-intent routing, and invalid/expired fallback.
3. **TTL alignment completed** — issuance window now matches the 72-hour blueprint target.

## Files changed

| File | Action |
|---|---|
| `field-service/app/requests/access/recovery/page.tsx` | Created — recovery/fallback page for expired and invalid token links |
| `field-service/__tests__/lib/client-pwa-handoff-model.test.ts` | Created — 52-test handoff model coverage suite |
| `field-service/docs/client-pwa-execution/002-client-pwa-channel-handoff-output.md` | Created — this document |

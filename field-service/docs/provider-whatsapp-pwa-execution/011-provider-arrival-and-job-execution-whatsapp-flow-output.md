# Execution Output — 11-provider-arrival-and-job-execution-whatsapp-flow.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/11-provider-arrival-and-job-execution-whatsapp-flow.md

## Objective
Implement and verify provider arrival confirmation and job status updates fully through WhatsApp text commands, including customer notification, idempotency for webhook retries, job state validation, and coverage for the `issue` command.

## Current-state findings

All core infrastructure was already in place before this step:

**`lib/provider-whatsapp-job-commands.ts`** — fully implemented:
- Arrival time parsing: bare `HH:MM`, `confirm arrival HH:MM`, `arrive HH:MM`, `arrive 9am`, relative phrases (`arrive in 2 hours`, `arrive noon`, etc.)
- `STATUS_ALIASES` covers: `on the way`, `on my way`, `otw`, `en route` → `on_the_way`; `arrived`, `i arrived`, etc. → `arrived`; `start`, `start work`, `start job` → `start`; `complete`, `done`, `finished` → `complete`
- `executeProviderJobCommand` validates provider ownership, checks job state, enforces forward-only transitions, writes `JobStatusEvent`, and skips duplicate transitions (idempotency)
- Customer arrival notification via `notifyCustomerArrival` → `sendText` with `templateName: 'provider_arrival_time_confirmed'`
- `confirmationFor(EN_ROUTE)` = `"Status updated: On the way.\nCustomer notified."` — matches blueprint spec
- `confirmationFor(ARRIVED)` = `"Status updated: Arrived.\nCustomer notified."` — matches blueprint spec
- `confirmationFor(STARTED)` = `"Status updated: Job in progress."` — matches blueprint spec

**`lib/jobs.ts` `triggerSideEffects`** — customer WhatsApp notifications already sent for:
- `EN_ROUTE` → `sendProviderOnTheWay()`
- `ARRIVED` → `sendProviderArrived()`
- `STARTED` → freeform message + optional job-tracker CTA link
- `PENDING_COMPLETION_CONFIRMATION` → sign-off request + optional sign-off CTA

**`lib/whatsapp-bot.ts`** — `parseProviderJobCommand` + `executeProviderJobCommand` integrated at line 1282. Text commands intercepted before the menu flow for any provider with a single active job.

**`issue` command** — handled separately by `handleProviderDisputeFlow` in `whatsapp-bot.ts` at line 1349. The trigger list previously matched `['dispute', 'issue with job', 'raise issue']` but did **not** match bare `"issue"`.

**Gap identified:** Bare `"issue"` text from a provider fell through to unhandled menu dispatch rather than the dispute flow. The blueprint lists `issue` as a supported command.

**Tests** — 15 existing tests in `__tests__/lib/provider-whatsapp-job-commands.test.ts` covering parsing, execution, customer notification, idempotency, and error cases. Missing explicit tests for `arrived` and `start` message text, and for `"issue"` returning null from the parser (as it belongs to the dispute router, not the job-command parser).

## Implementation completed

### 1. Added `"issue"` to the dispute trigger list in `whatsapp-bot.ts`

Bare `"issue"` now routes to `handleProviderDisputeFlow`, consistent with the blueprint's listed commands and the existing `'issue with job'` / `'raise issue'` handling.

### 2. Added 3 tests to `__tests__/lib/provider-whatsapp-job-commands.test.ts`

- **`arrived` message text** — verifies `EN_ROUTE → ARRIVED` transition and that reply contains `"Status updated: Arrived"` and `"Customer notified"`.
- **`start` message text** — verifies `ARRIVED → STARTED` transition and that reply contains `"Status updated: Job in progress"`.
- **`issue` returns null from parser** — documents that `parseProviderJobCommand('issue')` intentionally returns `null` (the command is dispatched by `whatsapp-bot`, not the job-command parser).

## Files changed

| File | Change summary |
|---|---|
| `lib/whatsapp-bot.ts` | Added `'issue'` to the dispute-flow trigger keyword list (line 1349) |
| `__tests__/lib/provider-whatsapp-job-commands.test.ts` | Added 3 tests: `arrived` status message, `start` status message, `issue` returns null from parser |

## WhatsApp flow changes

No flow logic or conversation-state changes. The `issue` routing fix is a single keyword addition to an existing `Array.some()` check.

## PWA route/screen changes
None

## API/server changes

None. All changes are in the bot routing layer and tests.

## Credit impact
None

## Security/privacy impact

The provider phone is verified against the DB before any job state change. Customer phone is only used to send notifications after the provider's ownership of the job is confirmed. No PII is added to bot replies. The `issue` routing fix only exposes the existing two-step dispute flow — no new data surface.

## Tests added or updated

File: `__tests__/lib/provider-whatsapp-job-commands.test.ts`

| Test | What it checks |
|---|---|
| `transitions EN_ROUTE to ARRIVED on "arrived"` | `transitionJob` called with `ARRIVED`, reply contains "Status updated: Arrived" and "Customer notified" |
| `transitions ARRIVED to STARTED on "start"` | `transitionJob` called with `STARTED`, reply contains "Status updated: Job in progress" |
| `returns null for "issue"` | `parseProviderJobCommand('issue')` returns `null` — dispute routing is in `whatsapp-bot`, not job-command parser |

## Commands run

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -30
```

## Test results

```
Test Files  160 passed | 1 skipped (161)
     Tests  1655 passed | 4 todo (1659)
  Duration  10.01s
```

Before: 1652 passing. After: 1655 passing (+3 new). 0 failures.

## Manual verification checklist

- [x] Provider can confirm arrival in WhatsApp — `arrive 14:00` / `confirm arrival 14:00` / bare `14:00` all parse and update `scheduledArrivalAt`, notify customer
- [x] Provider can mark on the way in WhatsApp — `on the way` / `otw` → `EN_ROUTE`, customer notified via `sendProviderOnTheWay`
- [x] Provider can mark arrived in WhatsApp — `arrived` → `ARRIVED`, customer notified via `sendProviderArrived`
- [x] Provider can start job in WhatsApp — `start` / `start work` → `STARTED`, customer notified (freeform text + CTA)
- [x] Customer receives appropriate updates — `triggerSideEffects` in `jobs.ts` sends WhatsApp messages for EN_ROUTE, ARRIVED, STARTED, PENDING_COMPLETION_CONFIRMATION
- [x] Tests pass — 1655 passing, 0 failing

## Risks and follow-ups

- The `issue` command enters the two-step `pj_dispute_collect` flow. A provider sending bare `"issue"` while in any non-idle conversation state will not reach it (the `flow === 'idle'` guard applies). This is the same behaviour as `'dispute'` and is by design.
- `sendProviderOnTheWay` passes `eta: 'approximately 20 minutes'` as a static string; a dynamic ETA from `scheduledArrivalAt` would improve customer UX — tracked as a follow-up for Step 15 (notifications/copy).
- The `as any` cast at `provider-journey.ts:1372` and `1379` pre-dates this step. A TODO comment is warranted but is outside this step's additive scope.

## OpenBrain note

Step 11 complete. Core provider arrival and job-execution WhatsApp commands (`arrive HH:MM`, `on the way`, `arrived`, `start`, `complete`, `issue`) were fully implemented before this step. Two gaps closed: (1) bare `"issue"` now routes to the dispute flow in `whatsapp-bot.ts`; (2) three missing tests added for `arrived`/`start` message content and `issue` parser behaviour. All 1655 tests pass.

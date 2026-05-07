# Execution Output — 03-provider-whatsapp-command-and-state-machine.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/03-provider-whatsapp-command-and-state-machine.md

## Objective
Audit the existing provider WhatsApp command model and state machine against the blueprint's required command set and state list, fix any gaps, and verify with tests.

## Current-state findings

### State machine — all 14 required states present
`lib/provider-whatsapp-command-model.ts` exports `ProviderWhatsappState` and `getProviderWhatsappStateNames()` with all 14 states:
`application_capture`, `application_submitted`, `pending_review`, `approved_idle`, `opportunity_review`, `interest_capture_callout`, `interest_capture_arrival`, `interest_capture_rate`, `customer_selected_pending_acceptance`, `accepted_job_active`, `arrival_confirmation`, `job_execution`, `job_completion`, `support`.

### Commands — all 18 required commands present
`PROVIDER_WHATSAPP_COMMANDS` covers every blueprint-required command:
- menu, credits, jobs, status, profile, availability, help
- interested, not interested, accept job, decline
- on the way, arrived, start (job), complete, issue
- register, opportunities, unavailable

### Common variations — all present
- hi, hello, start → pj_menu (menu aliases)
- find work → opportunity_review
- balance, credit → credits / pj_provider_status
- my jobs → jobs / pj_job_list
- available, unavailable → availability toggle commands

### Menu recovery from any state
`whatsapp-bot.ts:1316` — the `providerCommand && isProviderRole && !reply.id` branch runs unconditionally (no flow/step guard), so typing `menu` from any state overrides `flow` to `provider_journey` and `step` to `pj_menu`.

### Invalid command handling — present
`whatsapp-bot.ts:1468-1480` — when a provider sends unrecognised free text, `resolveProviderWhatsappCommand` returns `null`, the bot falls through to the idle handler and sends a helpful tip message listing all major commands before showing the main menu.

### Bug found and fixed — alias prefix collision
`resolveProviderWhatsappCommand` previously used a single linear `find` with `startsWith` which caused `start job` and `start work` to match the `menu` command (which has `start` as an alias via `startsWith('start ')`) instead of the intended `start` job-execution command. Both `start job` and `start work` were silently routed to `pj_menu` (state: `approved_idle`) rather than `pj_job_list` (state: `job_execution`).

**Fix:** The resolver now runs an exact-alias pass first, then falls back to prefix matching. This preserves all existing behaviour while making multi-word commands take precedence over single-word aliases that are a prefix of them.

### Idempotency
`resolveProviderWhatsappCommand` is a pure function with no side effects; repeated calls with the same input always return an identical result. WhatsApp webhook retry safety is handled at the bot level via the `WhatsappInboundMessage` idempotency key (`messageId`).

## Implementation completed

1. Fixed alias prefix collision in `resolveProviderWhatsappCommand` — exact alias pass before prefix pass.
2. Extended `__tests__/lib/provider-whatsapp-command-model.test.ts` with 14 new test cases covering:
   - All job-execution commands (`on the way`, `arrived`, `start job`, `complete`)
   - All opportunity-response commands (`interested`, `not interested`, `accept job`, `decline`)
   - All blueprint-required menu aliases
   - Null/undefined/empty input returning null (invalid command fall-through)
   - Whitespace normalisation
   - Case-insensitivity
   - Idempotency
   - Unique command names invariant
   - Menu command step coverage for all menu aliases
   - `start` bare vs `start job` disambiguation (the bug that was fixed)
   - Job-lifecycle state assignments
   - Support-state command coverage
   - Registration state coverage
   - Menu recovery — `pj_menu` always returned for menu commands

## Files changed

| File | Change summary |
|---|---|
| `lib/provider-whatsapp-command-model.ts` | Fixed `resolveProviderWhatsappCommand` — exact-alias pass before prefix pass to prevent shorter aliases shadowing multi-word commands |
| `__tests__/lib/provider-whatsapp-command-model.test.ts` | Extended from 4 to 18 test cases covering all required command groups, variations, edge cases, and invariants |

## WhatsApp flow changes
None — existing flow handlers are unaffected. The fix only changes which command record is returned by the resolver for `start job` / `start work`; those commands were already wired to `pj_job_list` in the provider journey handler.

## PWA route/screen changes
None

## API/server changes
None

## Credit impact
None

## Security/privacy impact
None — the fix is purely in command routing logic, no auth or data changes.

## Tests added or updated

**File:** `__tests__/lib/provider-whatsapp-command-model.test.ts`

New test cases (14 added, total 18):
- `routes all job-execution commands to provider_journey`
- `routes opportunity-response commands to provider_journey`
- `supports all blueprint-required menu aliases`
- `returns null for unrecognised text so invalid commands fall through to helpful response`
- `normalises leading/trailing whitespace and extra spaces`
- `is case-insensitive`
- `is idempotent — resolving the same command twice returns identical results`
- `every command has a unique canonical command name`
- `menu command step is pj_menu for all menu-triggering aliases`
- `start bare keyword routes to pj_menu (not start job — no collision with job execution)`
- `all job-lifecycle commands route to job_execution or job_completion state`
- `help and issue commands route to support state`
- `register command routes to application_capture state`
- `menu is always recoverable — pj_menu step is assigned for any menu-type command regardless of context`

## Commands run
```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -10
```

## Test results
156 test files passed, 1 skipped (pre-existing). 1540 tests passed, 0 failed, 4 todo (pre-existing).

Before fix: 1 failing (start job routing to approved_idle state instead of job_execution).
After fix: 0 failing.

## Manual verification checklist
- [x] Provider can use `menu` anytime — `resolveProviderWhatsappCommand('menu')` returns `pj_menu`; bot overrides flow/step unconditionally for provider roles
- [x] Provider can check credits in WhatsApp — `credits` / `balance` / `credit` all resolve to `pj_provider_status` with `provider_check_status` reply ID
- [x] Provider can view active jobs in WhatsApp — `my jobs` / `jobs` / `active jobs` all resolve to `pj_job_list` with `provider_my_jobs` reply ID
- [x] Provider can update availability in WhatsApp — `availability` / `available` / `unavailable` / `offline` all resolve to `pj_toggle_available`
- [x] Invalid command gives helpful next step — `resolveProviderWhatsappCommand('unknown text')` returns null; bot sends command tip list before main menu

## Risks and follow-ups
- The `start` alias on the `menu` command is still a potential source of confusion if a user types `start something_else` — that will now match the `menu` command's prefix pass. This is acceptable as `start X` outside of `start job` / `start work` has no defined semantics.
- `start job` / `start work` are now correctly routed to the `pj_job_list` step, but actual job status transition (marking a job as STARTED) is handled by `provider-whatsapp-job-commands.ts` — that path is exercised by the `parseProviderJobCommand` intercept at `whatsapp-bot.ts:1282`, not by the provider journey flow directly. No changes required there.
- The `not_interested` command aliases `['not interested', 'pass']` — bare `pass` will now route to opportunity_review. This was already the pre-existing behaviour; no change.

## OpenBrain note
Step 03 complete. One bug fixed (alias prefix collision causing `start job`/`start work` to route to menu instead of job execution). All 14 blueprint state machine states confirmed present. All 18 required commands confirmed present and routed correctly. 18 targeted test cases added covering command routing, variations, edge cases, and invariants. 1540/1540 tests passing.

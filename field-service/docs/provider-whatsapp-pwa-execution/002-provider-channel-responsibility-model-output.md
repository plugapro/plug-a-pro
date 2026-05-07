# Execution Output — 02-provider-channel-responsibility-model.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/02-provider-channel-responsibility-model.md

## Objective
Document and enforce the channel ownership model for the provider journey — every core provider
action must be reachable via WhatsApp; PWA remains a non-required enrichment layer.

## Current-state findings

`lib/provider-channel-responsibility.ts` already exists and is fully populated.

**14 actions total, 12 core, 2 non-core:**

| id | core | whatsapp | pwa | WhatsApp path |
|---|---|---|---|---|
| `application` | true | existing | optional | registration provider application flow |
| `profile_data_capture` | true | existing | optional | registration provider application flow |
| `application_status` | true | existing | optional | provider_application_status + approval notifications |
| `credit_balance` | true | existing | optional | provider menu / provider_status |
| `opportunity_preview` | true | existing | optional | new-lead notification with buildProviderLeadPreviewMessage + signed preview CTA |
| `interest_response` | true | existing | optional | interested:<leadId> / not_interested:<leadId> multi-step capture |
| `selected_job_acceptance` | true | existing | optional | confirm_accept:<leadId> selected-provider handler |
| `full_customer_details` | true | existing | optional | selected-provider acceptance notification with inline details + signed job link |
| `arrival_confirmation` | true | existing | optional | provider WhatsApp text: HH:MM or "confirm arrival HH:MM" |
| `job_status_updates` | true | existing | optional | provider_journey pj_upd_<jobId>_<status> |
| `completion` | true | existing | optional | provider WhatsApp complete command with note + photo-or-skip capture |
| `help_menu_status` | true | existing | optional | provider menu, provider_support, provider_status |
| `credit_ledger_history` | false | optional | existing | provider_top_up_credits sends optional PWA link |
| `advanced_dashboard` | false | optional | existing | provider_worker_portal sends optional PWA link |

**Blueprint cross-reference — all 20 required WhatsApp actions covered:**

| Blueprint requirement | Covered by |
|---|---|
| application | `application` |
| profile data capture | `profile_data_capture` |
| service category capture | `profile_data_capture` (skills captured during registration) |
| work area capture | `profile_data_capture` (serviceAreas captured during registration) |
| availability capture | `profile_data_capture` (availability captured during registration) |
| rate capture | `profile_data_capture` + `interest_response` (callout fee step) |
| application status | `application_status` |
| approval / rejection / more info | `application_status` |
| credit balance | `credit_balance` |
| opportunity preview | `opportunity_preview` |
| interest response | `interest_response` |
| call-out fee and arrival response | `interest_response` |
| customer selected notification | `selected_job_acceptance` |
| job acceptance | `selected_job_acceptance` |
| credit confirmation | `selected_job_acceptance` |
| full customer details | `full_customer_details` |
| arrival confirmation | `arrival_confirmation` |
| job status updates | `job_status_updates` |
| completion | `completion` |
| help / menu / status | `help_menu_status` |

**WhatsApp bot routing confirmed:** `lib/whatsapp-bot.ts` handles:
- `registration` flow — onboarding, profile, area, availability, rate capture
- `provider_application_status`, `provider_top_up_credits`, `provider_worker_portal`,
  `provider_support`, `provider_status` button IDs routed into `provider_journey` flow
- `interested:<leadId>`, `not_interested:<leadId>`, `confirm_accept:<leadId>` button intercepts
- `provider_journey` flow with `pj_upd_<jobId>_<status>` for job status updates
- Provider text commands (arrival time, complete, job commands) via
  `resolveProviderWhatsappCommand`, `parseProviderOpportunityArrivalText`,
  `completeProviderJobFromWhatsApp`

**Existing test file:** `__tests__/lib/provider-channel-responsibility.test.ts` — 4 assertions:
1. Every core action is WhatsApp-primary.
2. Every core action has a WhatsApp path or explicit blocker.
3. PWA-primary items are only `credit_ledger_history` and `advanced_dashboard`, both non-core.
4. Specific critical actions (`interest_response`, `opportunity_preview`, `full_customer_details`,
   `arrival_confirmation`, `completion`) marked `existing` with no blocker.

## Implementation completed

No changes needed. The channel responsibility model is fully aligned with the blueprint spec.

- All 12 core actions carry `whatsapp: 'existing'` and `primaryChannel: 'whatsapp'`.
- No core action is PWA-only.
- Both non-core actions (`credit_ledger_history`, `advanced_dashboard`) have WhatsApp optional
  links pointing to PWA routes, satisfying requirement 4.
- The test suite enforces all acceptance criteria at the code level.

## Files changed

| File | Change summary |
|---|---|
| *(none)* | No files modified — model was already aligned. |

## WhatsApp flow changes
None. All required WhatsApp paths were already wired in `lib/whatsapp-bot.ts`.

## PWA route/screen changes
None.

## API/server changes
None.

## Credit impact
None

## Security/privacy impact
No changes were made. The existing model correctly places `full_customer_details` behind
`selected_job_acceptance` — customer contact data is only sent after a credit is spent and the
provider is confirmed. Signed PWA links use time-limited tokens. No PII is exposed in opportunity
previews.

## Tests added or updated
No tests added. The existing `__tests__/lib/provider-channel-responsibility.test.ts` already covers
all acceptance criteria with 4 assertions. All 156 test files pass (1526 tests, 0 failures).

## Commands run
```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run --reporter=dot 2>&1 | tail -20
```

## Test results
156 passed | 1 skipped (157 files), 1526 passed | 4 todo — 0 failures.

## Manual verification checklist
- [x] Provider can complete required step in WhatsApp — all 12 core actions have `whatsapp: 'existing'` paths confirmed in `whatsapp-bot.ts`
- [x] PWA remains optional — `pwa: 'optional'` on all core actions; non-core actions are `pwa: 'existing'` with `whatsapp: 'optional'` links to PWA
- [x] Privacy rules are respected — customer details locked behind credit-spend and job acceptance gate
- [x] Credit rules are respected — `selected_job_acceptance` carries the credit deduction path; `credit_balance` provides balance visibility via WhatsApp
- [x] WhatsApp response is clear — each action has a documented `existingWhatsAppPath`; non-core actions carry `optionalPwaPath` for richer views

## Risks and follow-ups
- **Low:** `profile_data_capture` bundles service category, work area, availability, and rate into a single entry. If any of these sub-steps becomes independently testable, split into separate entries to maintain fine-grained coverage.
- **Low:** Non-core items (`credit_ledger_history`, `advanced_dashboard`) rely on PWA links sent via WhatsApp. If the PWA is unavailable, providers have no detailed ledger view — acceptable because neither is a core action, but worth noting.
- **Next step:** Step 03 will verify the WhatsApp command state machine covers all these paths end-to-end.

## OpenBrain note
Channel responsibility model verified as fully implemented and aligned with blueprint spec.
14 actions documented in `lib/provider-channel-responsibility.ts`; 12 core (all WhatsApp-primary,
all `existing`), 2 non-core (PWA-primary with optional WhatsApp links). Test enforcement in place
at `__tests__/lib/provider-channel-responsibility.test.ts`. No code changes required.

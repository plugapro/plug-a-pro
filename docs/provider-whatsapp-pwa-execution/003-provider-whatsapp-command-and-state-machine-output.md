# Execution Output — 03-provider-whatsapp-command-and-state-machine.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/03-provider-whatsapp-command-and-state-machine.md`

## Objective

Align the provider WhatsApp command model and state machine so providers can recover the menu anytime, check credits, view jobs, update availability, access support, and route common provider text commands through the existing canonical provider journey.

## Current-state findings

The existing provider journey already had reusable states for menu, available leads, availability toggle, pause confirmation, job list/detail, profile, service areas, support, provider status, worker portal, application status, and job status confirmation.

The missing piece was a canonical text-command model. Some provider actions were only reachable by buttons or narrow keywords, while provider text such as `credits`, `balance`, `profile`, `availability`, `help`, or `issue` could fall through to customer/default behavior.

## Implementation completed

- Added `field-service/lib/provider-whatsapp-command-model.ts` as the canonical provider text-command map.
- Added the blueprint-required provider state names as an exported state list.
- Routed provider text commands in `field-service/lib/whatsapp-bot.ts` before generic reset/status/customer routing, so provider `menu`, `hi`, and `hello` recover the provider menu instead of the customer menu.
- Kept all non-registration provider commands on the existing `provider_journey` flow.
- Kept `register`/`apply`/`join` routed through the existing registration flow.
- Updated the provider menu rows to the required model: View credits, View opportunities, View active jobs, Update availability, Update profile, Contact support.
- Updated provider menu credit copy to match the qualified shortlist rule: interest is free; one credit is spent only when the customer selects the provider and the provider accepts.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-whatsapp-command-model.ts` | Canonical provider text command and state model |
| `field-service/lib/whatsapp-bot.ts` | Provider text command routing before generic reset/status routing |
| `field-service/lib/whatsapp-flows/provider-journey.ts` | Provider menu labels and qualified-shortlist credit copy |
| `field-service/__tests__/lib/provider-whatsapp-command-model.test.ts` | Provider command routing/state model tests |
| `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` | Provider menu row assertions updated |
| `docs/provider-whatsapp-pwa-execution/003-provider-whatsapp-command-and-state-machine-output.md` | Step 3 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

Provider text commands now resolve through one model:

- `menu`, `hi`, `hello`, `start`, `provider menu`, `home` -> provider menu.
- `credits`, `credit`, `balance`, `wallet` -> provider status/credit balance.
- `jobs`, `my jobs`, `myjobs`, `my work`, `active jobs` -> active jobs list.
- `status`, `provider status`, `application status` -> provider status.
- `profile`, `my profile`, `services`, `areas`, `service areas` -> provider profile.
- `availability`, `available`, `online`, `go available` -> availability flow.
- `unavailable`, `offline`, `not available`, `pause`, `pause leads` -> pause flow.
- `help`, `support`, `issue`, `problem`, `report issue` -> support/problem report.
- `opportunities`, `available jobs`, `find work`, `find jobs`, `leads`, `interested`, `not interested`, `decline` -> available opportunities context.
- `accept job`, `on the way`, `arrived`, `start job`, `complete job` -> active jobs context.
- `register`, `apply`, `join` -> registration flow.

## PWA route/screen changes

None.

## API/server changes

No API behavior changed. The WhatsApp bot now imports the provider command resolver and uses it for routing.

## Credit impact

No credit mutation behavior changed. Provider menu copy now aligns with the selected-provider credit rule.

## Security/privacy impact

No privacy behavior changed. Command routing does not expose provider/customer data; sensitive job detail delivery remains governed by existing signed token and accepted-unlock checks.

## Tests added or updated

- Added `field-service/__tests__/lib/provider-whatsapp-command-model.test.ts`.
- Updated `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts` | Passed; 2 files, 33 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Provider can use `menu`/`hi`/`hello` to recover provider menu.
- [x] Provider can check credits in WhatsApp.
- [x] Provider can view active jobs in WhatsApp.
- [x] Provider can update availability in WhatsApp.
- [x] Provider support/problem-report commands route to provider support states.
- [x] Required provider state names are documented in code.
- [x] Command routing tests pass.

## Risks and follow-ups

- Commands such as `interested`, `accept job`, `on the way`, `arrived`, `start`, and `complete` currently route to the correct context, but later steps still need inline context-specific execution when there is exactly one active opportunity or active job.
- Invalid free-text provider commands still recover through the provider menu path; later steps can add more specific invalid-command copy if needed.

## OpenBrain note

Provider WhatsApp command/state model aligned. The existing provider journey remains canonical, with a new command resolver routing common provider text commands into existing states and preventing provider menu recovery from falling back to customer menu behavior. Credit copy now matches the qualified shortlist model.

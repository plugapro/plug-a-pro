# Execution Output — 02-provider-channel-responsibility-model.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/02-provider-channel-responsibility-model.md`

## Objective

Document and enforce the provider channel responsibility model: WhatsApp is the primary channel for normal provider operations, while the PWA remains optional for richer dashboard, history, ledger, document, gallery, and management screens.

## Current-state findings

The as-is implementation already supports several core provider actions in WhatsApp, but some normal operating actions are still PWA-dependent or PWA-heavy. The clearest gaps are inline safe opportunity preview, structured interested response with call-out fee and ETA, full customer detail delivery after selected-job acceptance, accepted-lead arrival confirmation, and completion notes/photos.

The PWA should remain the richer surface for dashboard, profile editing, bulk areas/rates, credit ledger/history, full job cards, image gallery, document management, job history, and performance reporting.

## Implementation completed

- Added a shared provider channel responsibility matrix in `field-service/lib/provider-channel-responsibility.ts`.
- Marked all core provider actions as WhatsApp-primary.
- Marked PWA-primary ownership only for non-core richer screens.
- Documented known WhatsApp blockers for actions that are not yet WhatsApp-complete.
- Added tests asserting that core provider actions cannot silently become PWA-only.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-channel-responsibility.ts` | Shared WhatsApp-first/PWA-optional provider channel model |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Assertions for core WhatsApp ownership and documented blockers |
| `docs/provider-whatsapp-pwa-execution/002-provider-channel-responsibility-model-output.md` | Step 2 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

No runtime WhatsApp behavior changed in this step. The new model documents the required WhatsApp ownership for:

- application
- profile/service/area/availability/rate capture
- application status
- credit balance
- safe opportunity preview
- interested/not-interested response with fee and ETA
- selected-job acceptance
- post-acceptance customer detail delivery
- arrival confirmation
- job status updates
- completion
- help/menu/status

## PWA route/screen changes

No runtime PWA behavior changed. The model documents PWA-primary ownership only for non-core richer screens:

- credit ledger/history
- advanced dashboard, document management, job history, and performance

## API/server changes

No API behavior changed. A pure shared model module was added for documentation and test assertions.

## Credit impact

No credit behavior changed. The model preserves the rule that core selected-job acceptance is WhatsApp-primary and credit spend happens only at selected-provider acceptance.

## Security/privacy impact

No privacy behavior changed. The model explicitly keeps full customer detail delivery as WhatsApp-primary but blocked until it can reuse the existing server-side accepted-unlock privacy checks.

## Tests added or updated

- Added `field-service/__tests__/lib/provider-channel-responsibility.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-channel-responsibility.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 1 file, 3 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Channel responsibility documented in code.
- [x] Core provider actions are WhatsApp-primary.
- [x] PWA-primary actions are limited to non-core rich screens.
- [x] Existing PWA-heavy core operations have explicit blockers.
- [x] Tests prevent silent PWA-only ownership for core actions.

## Risks and follow-ups

- The responsibility model is documentation/assertion only; later steps must wire the blocked actions into the canonical WhatsApp provider journey.
- Known blockers to resolve in later steps: inline safe preview, fee/ETA capture, full customer details in WhatsApp, arrival confirmation, and completion notes/photos.
- The model should stay synchronized with future WhatsApp state-machine changes.

## OpenBrain note

Provider channel responsibility model added. WhatsApp is now codified as the primary channel for all core provider operations, with PWA limited to optional richer management surfaces. Existing PWA-heavy core gaps are explicitly documented as blockers so later blueprint steps can close them without introducing duplicate provider journeys.

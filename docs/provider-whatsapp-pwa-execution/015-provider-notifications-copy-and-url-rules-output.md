# Execution Output — 15-provider-notifications-copy-and-url-rules.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/15-provider-notifications-copy-and-url-rules.md`

## Objective

Align provider WhatsApp/PWA copy and URL generation with the WhatsApp-complete provider journey.

## Current-state findings

The central public URL helper already blocks localhost/127.0.0.1 in production and provider links already use public URL helpers in the core flows.

Most provider copy already explained credit use, but some reusable notification builders still used older "accepted lead" phrasing and did not explicitly say that previewing/responding interested is free or that WhatsApp can continue without the PWA.

## Implementation completed

- Updated provider application approval copy:
  - Previewing and saying interested are free.
  - 1 credit is used only when customer-selected provider accepts the selected job.
  - Provider can continue on WhatsApp.
  - Worker Portal is optional for richer credits/hours/jobs.
- Updated wallet/credit notification copy:
  - Low balance.
  - Zero balance lead available.
  - Manual EFT created.
  - Payment credited.
  - Payfast top-up initiated.
- Updated provider credits PWA header copy to match selected-job-only credit rules.
- Added production URL regression test ensuring provider credit messages use canonical public URL and do not include localhost/127.0.0.1 in production.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-application-notifications.ts` | Approval notification copy aligned with WhatsApp-complete and selected-job-only credit rules |
| `field-service/lib/provider-wallet-notifications.ts` | Wallet/top-up notification copy aligned with free preview/interested and selected-job-only credit rules |
| `field-service/app/(provider)/provider/credits/page.tsx` | Provider credits PWA copy aligned |
| `field-service/__tests__/lib/provider-application-notifications.test.ts` | Approval copy assertions updated |
| `field-service/__tests__/lib/provider-wallet-notifications.test.ts` | Wallet copy and production URL assertions updated |
| `docs/provider-whatsapp-pwa-execution/015-provider-notifications-copy-and-url-rules-output.md` | Step 15 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

Reusable provider notification copy now consistently says:

```text
No credits are used for previewing or saying you are interested.
1 credit is used only when a customer selects you and you accept that selected job.
You can continue here on WhatsApp. You can also open the Worker Portal...
```

## PWA route/screen changes

The provider credits page now uses the same selected-job-only credit rule wording.

## API/server changes

No API route changes.

## Credit impact

No credit behavior changed.

## Security/privacy impact

No privacy surface changed. URL generation remains centralized through the public URL helper that blocks localhost in production.

## Tests added or updated

- Provider application approval copy assertions.
- Provider wallet notification copy assertions.
- Production URL/no-localhost notification assertion.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-wallet-notifications.test.ts __tests__/lib/provider-application-notifications.test.ts __tests__/lib/provider-credit-copy.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-wallet-notifications.test.ts __tests__/lib/provider-application-notifications.test.ts __tests__/lib/provider-credit-copy.test.ts` | Passed; 3 files, 42 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Provider messages make credit rules clear.
- [x] PWA is presented as optional for richer details, not mandatory for core actions.
- [x] Production URL helper remains central.
- [x] Production provider messages do not include localhost/127.0.0.1 when canonical public URL is configured.

## Risks and follow-ups

- Some legacy customer/technician copy still references older "app" wording outside the provider journey. Those were outside this provider WhatsApp + PWA blueprint scope.

## OpenBrain note

Provider notification copy aligned. Approval, wallet, top-up, and credits PWA copy now clearly state free preview/interested actions, selected-job-only credit spend, and optional Worker Portal handoff while preserving centralized production URL generation.

# Execution Output — 11-client-pwa-notifications-copy-and-url-rules.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_client_pwa_blueprint/11-client-pwa-notifications-copy-and-url-rules.md`

## Objective

Align client WhatsApp/PWA copy and ensure customer PWA links use production URL helpers with state-aware intents.

## Current-state findings

The central public URL helper already blocks localhost in production and existing tests cover that behavior. Customer ticket URL generation already uses `getPublicAppUrl`. Some notification links did not yet include explicit Client PWA intents, and shortlist-ready copy did not explicitly say customers can compare providers before choosing.

## Implementation completed

- Updated request-created ticket URLs to include `intent=matching_status`.
- Updated shortlist-ready ticket URLs to include `intent=shortlist`.
- Updated selected-provider accepted ticket URLs to include `intent=job_tracking`.
- Added shortlist-ready copy: “You can compare providers before choosing.”
- Re-ran public URL helper tests that prevent localhost in production.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/job-requests/create-job-request.ts` | Request-created ticket links now carry matching-status intent |
| `field-service/lib/customer-shortlists.ts` | Shortlist links now carry shortlist intent and clearer comparison copy |
| `field-service/lib/selected-provider-acceptance.ts` | Accepted-job customer ticket links now carry job-tracking intent |
| `docs/client-pwa-execution/011-client-pwa-notifications-copy-and-url-rules-output.md` | Step 11 required execution output |
| `docs/client-pwa-execution/000-client-pwa-execution-index.md` | Updated execution progress |

## Schema / migration changes

None.

## API / server action changes

None.

## UI changes

No UI component changed in this step.

## WhatsApp changes

Customer notification links now include state-aware PWA intents for submitted/matching, shortlist, and accepted-job states. Shortlist-ready customer copy now clearly explains that providers can be compared before choosing.

## Security and privacy impact

No privacy boundary changed. URL generation continues through the central public URL helper.

## Credit impact

None.

## Tests added or updated

No new test file was required. Existing URL, notification, request creation, shortlist, and selected-provider tests were rerun.

## Commands run

```bash
npm test -- --run __tests__/lib/job-request-access.test.ts __tests__/lib/create-job-request.test.ts __tests__/lib/customer-shortlists.test.ts __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/client-pwa-submission-notifications.test.ts __tests__/lib/provider-credit-copy.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- Focused Vitest run: passed, 6 files and 61 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 existing unrelated warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Request submitted links use public URL helper and matching intent.
- [x] Shortlist ready links use public URL helper and shortlist intent.
- [x] Provider accepted links use public URL helper and job-tracking intent.
- [x] Shortlist copy explains provider comparison.
- [x] URL tests prevent localhost in production helper output.
- [x] No localhost production ticket link introduced.

## Risks and follow-ups

Some older WhatsApp status flows still request a generic ticket link without an explicit intent. The backend resolver still routes those links by current state, so they remain safe; future copy passes can add explicit intent where helpful.

## OpenBrain note

Client PWA notification links now carry state-aware intents while still relying on backend state resolution and the central production URL helper.

# Execution Output — 14-whatsapp-template-and-url-audit.md

## Status

Partially completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/14-whatsapp-template-and-url-audit.md`

## Objective

Audit and update WhatsApp template copy and public app URL helpers so links and credit wording align with the Qualified Shortlist Model.

## Current-state findings

The central public URL helper already preferred `APP_PUBLIC_URL` over `NEXT_PUBLIC_APP_URL` and blocked localhost app URLs in production. Provider terms override URLs were not validated. Provider credit copy still described credit spend as initial lead acceptance instead of selected-job final acceptance.

Detailed findings were written to `docs/implementation-assessment/whatsapp-template-url-audit.md`.

## Implementation completed

- Validated configured provider terms URLs as absolute public URLs.
- Blocked localhost provider terms URLs in production.
- Made public URL path joining collapse duplicate leading slashes.
- Updated provider onboarding, submitted-application, opportunity preview, quick action, and insufficient-credit copy to reflect shortlist monetisation.
- Added tests for safe path joining and provider terms localhost blocking.
- Documented remaining WhatsApp wiring gaps for shortlist-ready and interested/not-interested events.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-credit-copy.ts` | URL validation and Qualified Shortlist credit copy updates |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | URL and copy tests updated/expanded |
| `docs/implementation-assessment/whatsapp-template-url-audit.md` | WhatsApp template and URL audit note |
| `docs/codex-execution/014-whatsapp-template-and-url-audit-output.md` | Step 14 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 14 |

## Schema / migration changes

None.

## API / server action changes

None.

## UI changes

None.

## WhatsApp/template changes

Provider-facing copy now says previewing/responding is free, credits are spent only when a customer selects the provider and the provider accepts the selected job, and full customer details unlock only after selected-job acceptance.

## Security and privacy impact

Production WhatsApp terms links now fail safely if configured to localhost. Public path joining avoids malformed double-slash paths from helper callers.

## Credit impact

No wallet behavior changed. Copy now matches the implemented credit timing from step 13.

## Tests added or updated

- `field-service/__tests__/lib/provider-credit-copy.test.ts`

## Commands run

```bash
npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-lead-access.test.ts __tests__/lib/job-request-access.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-lead-access.test.ts __tests__/lib/job-request-access.test.ts`: passed, 3 files, 39 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Provider terms URL production tests cover localhost blocking.
- [x] Provider portal URL helper tests cover production URL preference.
- [x] Provider lead URL tests remained passing.
- [x] Client ticket URL tests remained passing.
- [x] Provider copy explains selected-job credit timing.
- [ ] WhatsApp "Interested" / "Not interested" button flow is not fully wired yet.
- [ ] Automatic customer shortlist-ready outbound notification remains follow-up.

## Risks and follow-ups

Legacy sequential assignment messages still exist for compatibility. Before public shortlist rollout, route live WhatsApp opportunity buttons to the step 11 response service and add a customer shortlist-ready message when step 12 shortlists are generated automatically.

## OpenBrain note

WhatsApp template and URL audit completed. Public URL helper behavior now better protects production WhatsApp links, and provider credit copy has been updated to reflect the Qualified Shortlist Model: free preview and interest response, customer selection, then paid final acceptance.

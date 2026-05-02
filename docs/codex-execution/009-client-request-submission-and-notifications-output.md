# Execution Output — 09-client-request-submission-and-notifications.md

## Status

Completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/09-client-request-submission-and-notifications.md`

## Objective

Upgrade request submission, customer confirmation, and matching trigger so submitted requests have clear references, privacy copy, idempotent behavior, and matching starts once.

## Current-state findings

`createJobRequest` already wraps customer resolution, address creation/reuse, job request creation, and attachment linking in one Prisma transaction. It already rejects duplicate active requests by phone/category, opens a dispatch case, triggers matching post-commit through `orchestrateMatch`, and logs/handles notification failures in the WhatsApp flow.

## Implementation completed

- `createJobRequest` now returns the generated `requestRef` alongside `jobRequestId`.
- WhatsApp request submission confirmation now displays `result.requestRef` instead of deriving a ref from the database ID suffix.
- Existing request metadata persistence from step 8 remains the source for `requestRef`, `source`, `submittedAt`, urgency, provider preference, and budget preference.
- Existing duplicate submit behavior remains intact through `DuplicateActiveRequestError`.
- Existing post-commit matching trigger remains intact through `orchestrateMatch`.
- Existing notification fallback behavior remains intact:
  - CTA URL send attempted when ticket URL exists.
  - Falls back to buttons.
  - Falls back to text.
  - Logs notification errors without incorrectly telling the customer submission failed.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/job-requests/create-job-request.ts` | Return generated `requestRef` from shared request creation |
| `field-service/lib/whatsapp-flows/job-request.ts` | Use `requestRef` in WhatsApp submission confirmation |
| `field-service/__tests__/lib/create-job-request.test.ts` | Updated result assertions for returned request ref |
| `docs/codex-execution/009-client-request-submission-and-notifications-output.md` | Step 9 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 9 |

## Schema / migration changes

None. Uses `JobRequest.requestRef` from step 3.

## API / server action changes

`createJobRequest` result now includes:

```ts
requestRef: string
```

## UI changes

None in PWA.

WhatsApp submission confirmation now shows generated request reference.

## WhatsApp/template changes

No Meta template registry changes. Interactive confirmation copy uses `requestRef`.

## Security and privacy impact

Positive. Submission confirmation continues to state that phone/exact address are shared only after customer selection and provider acceptance.

## Credit impact

None.

## Tests added or updated

Updated `field-service/__tests__/lib/create-job-request.test.ts`.

## Commands run

```bash
npm test -- --run __tests__/lib/client-request-data.test.ts __tests__/lib/create-job-request.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

- `npm test -- --run __tests__/lib/client-request-data.test.ts __tests__/lib/create-job-request.test.ts`: passed, 2 files, 20 tests.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings.

## Manual verification checklist

- [x] Request can be submitted through existing transaction path.
- [x] Duplicate active submit behavior remains guarded.
- [x] Photos are linked before final submission completes.
- [x] Request reference is generated and returned.
- [x] Customer confirmation uses request reference.
- [x] Matching trigger remains post-commit.
- [x] Notification failures remain logged/fallback handled.

## Risks and follow-ups

Customer notifications are still sent from the WhatsApp flow, not a central notification service. That is acceptable for the current WhatsApp path, but PWA parity should use the same request ref and privacy copy.

## OpenBrain note

Request submission now returns and displays generated `requestRef` while preserving the existing transaction, duplicate-submit guard, attachment linking, case opening, and post-commit matching trigger. The current implementation already satisfied most step 9 requirements; this step aligned the customer-facing reference and confirmation copy with the Qualified Shortlist flow.

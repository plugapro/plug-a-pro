# Execution Output — 04-provider-onboarding-as-is-and-gap.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/04-provider-onboarding-as-is-and-gap.md`

## Objective

Perform a focused as-is and gap analysis of the current service provider onboarding journey.

## Current-state findings

Provider onboarding is WhatsApp-first and already includes duplicate role checks, skill capture, structured area capture, experience, availability, optional evidence note/files, admin approve/reject, provider record sync, Worker Portal identity creation/linking, starter promo credits through the wallet ledger, and approval/rejection WhatsApp notifications.

Major gaps are rates, references, structured trust evidence, profile photo capture, category-specific approval, more-info request workflow, and explicit KYC/trust-level semantics.

Detailed findings were written to `docs/implementation-assessment/provider-onboarding-gap.md`.

## Implementation completed

- Created `docs/implementation-assessment/provider-onboarding-gap.md`.
- Created this step-specific execution output file.
- Updated the master execution index.
- No production behavior changed.

## Files changed

| File | Change summary |
|---|---|
| `docs/implementation-assessment/provider-onboarding-gap.md` | Provider onboarding as-is and gap assessment |
| `docs/codex-execution/004-provider-onboarding-as-is-and-gap-output.md` | Step 4 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 4 |

## Schema / migration changes

None in this step.

## API / server action changes

None.

## UI changes

None.

## WhatsApp/template changes

None.

## Security and privacy impact

No behavior changed. The assessment identifies future need to classify identity documents, certifications, and previous work photos separately so sensitive onboarding evidence is not accidentally exposed in public provider profile or shortlist UI.

## Credit impact

No behavior changed. The assessment confirms starter credits are already awarded through wallet ledger infrastructure on approval.

## Tests added or updated

None. This was a documentation/gap assessment step.

## Commands run

```bash
sed -n '260,760p' lib/whatsapp-flows/registration.ts
sed -n '1,320p' app/(admin)/admin/applications/page.tsx
sed -n '1,280p' lib/provider-record.ts
sed -n '760,1320p' lib/whatsapp-flows/registration.ts
sed -n '1,360p' 'app/(admin)/admin/applications/page.tsx'
sed -n '280,560p' lib/provider-record.ts
sed -n '360,760p' 'app/(admin)/admin/applications/page.tsx'
```

## Test results

Not run for this documentation-only assessment step. No production code, schema, or tests were changed.

## Manual verification checklist

- [x] Current provider onboarding documented.
- [x] Current captured fields documented.
- [x] Current storage and statuses documented.
- [x] Current admin review process documented.
- [x] Current WhatsApp template/copy sources documented.
- [x] Missing trust/suitability fields identified.
- [x] Approval and category-review gaps identified.
- [x] Risks documented.

## Risks and follow-ups

The next implementation step should extend the existing WhatsApp flow carefully. The main product risk is making onboarding too long; a practical approach is to capture the minimum needed for shortlist eligibility first, then let providers complete richer trust/profile data in Worker Portal or follow-up WhatsApp steps.

## OpenBrain note

Provider onboarding as-is/gap assessment completed. Existing flow is WhatsApp-first and reusable. It already separates registration from approval and awards starter credits through the ledger on approval. Required shortlist readiness work is adding structured rates, references, profile/trust evidence, category-specific approval, and more-info review states without creating a parallel onboarding system.

# Execution Output — 10-provider-full-job-details-and-privacy-unlock-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/10-provider-full-job-details-and-privacy-unlock-flow.md`

## Objective

Ensure full customer and job details unlock only after selected-provider acceptance succeeds, one credit is deducted, and the provider is assigned the job.

## Current-state findings

The server-side privacy model was already in place:

- `acceptSelectedProviderJob` validates the selected lead/provider relationship before credit deduction or assignment.
- Credit deduction and job assignment happen in one transaction.
- Full customer details are sent after the transaction commits.
- `getProviderLeadDetailForProvider` fetches sensitive customer/address/access data only when the provider owns the lead and the lead is accepted with a provider unlock.
- The provider PWA lead-detail page uses the same server helper and does not expose exact customer details before unlock.

The remaining gap was WhatsApp detail completeness: the accepted message included customer contact, address, and access notes, but not all blueprint-required job-detail fields.

## Implementation completed

- Expanded the selected-job accepted WhatsApp message to include:
  - "Job accepted."
  - "1 credit used."
  - Available balance.
  - Customer name.
  - Customer phone.
  - Full service address.
  - Unit/complex/access notes when present.
  - Job reference.
  - Preferred time.
  - Job description.
  - Photo availability.
  - Next-step arrival time prompt with example `14:00`.
- Added job description, preferred window, and photo count to the post-acceptance notification payload.
- Updated the provider channel responsibility model to mark full customer details as an existing WhatsApp path instead of a blocker.
- Strengthened tests for WhatsApp full-detail delivery and PWA detail privacy.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/selected-provider-acceptance.ts` | Expanded WhatsApp accepted-job full-detail payload |
| `field-service/lib/provider-channel-responsibility.ts` | Marked full customer details as WhatsApp-existing |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Added assertions for credit copy, job reference, preferred time, description, photos, and arrival prompt |
| `field-service/__tests__/lib/provider-lead-detail.test.ts` | Added access-notes assertion for unlocked PWA details |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Updated channel model assertion for full customer details |
| `docs/provider-whatsapp-pwa-execution/010-provider-full-job-details-and-privacy-unlock-flow-output.md` | Step 10 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

After selected-provider acceptance succeeds, the provider receives full job details inline in WhatsApp. The PWA link remains optional for richer viewing and photos.

The message now follows the required structure:

```text
Job accepted.

1 credit used.
Available balance: {{available_credits}}

Customer details:
Name: {{customer_name}}
Phone: {{customer_phone}}
Address: {{full_address}}

Next step:
Reply with your arrival time.
Example: 14:00
```

Additional safe post-unlock details are included: job reference, preferred time, description, access notes, and photo availability.

## PWA route/screen changes

No new PWA route was created. The existing provider lead-detail screen continues to use `getProviderLeadDetailForProvider`, which withholds sensitive fields before accepted unlock and reveals them after accepted unlock.

## API/server changes

No new API route was added. Server-side unlock remains enforced by `acceptSelectedProviderJob` and `getProviderLeadDetailForProvider`.

## Credit impact

No credit rule changed. One credit is deducted only when the selected provider accepts the selected job. Full details are sent only after that succeeds.

## Security/privacy impact

- Customer phone, exact street address, unit/complex details, and access notes are still unavailable before accepted unlock.
- PWA detail access remains restricted to the lead-owning provider.
- WhatsApp full details are sent only to the selected provider phone after transaction commit.
- Logs touched by this flow continue to use lead/provider IDs and do not add customer phone/address content.

## Tests added or updated

- Selected-provider acceptance notification assertions.
- Provider lead-detail access-note unlock assertion.
- Provider channel responsibility full-detail status assertion.

## Commands run

```bash
npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/lib/provider-channel-responsibility.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/lib/provider-channel-responsibility.test.ts` | Passed; 3 files, 13 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Full details are not available before acceptance.
- [x] Full details are sent in WhatsApp after selected-provider acceptance.
- [x] Only the accepted/owning provider can access PWA full details.
- [x] Customer contact and exact address are server-gated.
- [x] One credit remains the selected-job acceptance cost.

## Risks and follow-ups

- Photos are surfaced in WhatsApp as an availability count plus the signed job link. Sending media directly through WhatsApp can be added later if product wants full media delivery in-channel.

## OpenBrain note

Provider full-detail unlock aligned. The selected-provider acceptance transaction remains the server-side gate for customer contact and exact address, WhatsApp now sends the complete accepted-job detail set after one-credit acceptance, and the optional PWA detail screen continues to use the same provider-owned unlock rule.

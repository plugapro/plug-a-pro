# Execution Output — 12-customer-shortlist-and-selection.md

## Status

Partially completed with warnings

## Blueprint file executed

`Plug A Pro/plugapro_codex_blueprint/12-customer-shortlist-and-selection.md`

## Objective

Implement customer shortlist generation, provider comparison cards, and customer provider selection without deducting provider credits or exposing full customer details.

## Current-state findings

The existing customer ticket access token flow was the right place to surface a shortlist because it already gives customers a secure request-specific URL. The schema had shortlist models from step 3 but did not yet have request statuses for shortlist-ready and selected-provider confirmation.

## Implementation completed

- Added additive request statuses for `SHORTLIST_READY` and `PROVIDER_CONFIRMATION_PENDING`.
- Added shortlist generation from interested provider responses with call-out fee and estimated arrival time.
- Filtered shortlist generation to active, verified providers with non-expired lead invites.
- Added customer shortlist read model for provider comparison cards.
- Added customer provider selection service that updates the request selected provider/lead fields and marks the lead invite with `customerSelectedAt`.
- Added selected-provider WhatsApp notification with available/remaining credit copy and a production signed lead URL when available.
- Added provider shortlist cards to the existing customer request access page.
- Added tests for interested-only shortlist generation, provider card fields, selection updates, provider notification, and no wallet ledger access.

## Files changed

| File | Change summary |
|---|---|
| `field-service/prisma/schema.prisma` | Added shortlist-ready and provider-confirmation-pending request statuses |
| `field-service/prisma/migrations/20260502151000_customer_shortlist_statuses/migration.sql` | Additive enum migration for new request statuses |
| `field-service/lib/customer-shortlists.ts` | Shortlist generation, read model, selection, and selected-provider notification |
| `field-service/app/requests/access/[token]/page.tsx` | Customer shortlist cards and selection form on secure request link |
| `field-service/components/shared/StatusBadge.tsx` | Labels for new request statuses |
| `field-service/__tests__/lib/customer-shortlists.test.ts` | Customer shortlist tests |
| `docs/codex-execution/012-customer-shortlist-and-selection-output.md` | Step 12 execution output |
| `docs/codex-execution/000-execution-index.md` | Updated after step 12 |

## Schema / migration changes

Added enum values to `JobRequestStatus`:

- `SHORTLIST_READY`
- `PROVIDER_CONFIRMATION_PENDING`

The migration is additive and does not alter or delete existing rows.

## API / server action changes

Added a server action on `app/requests/access/[token]/page.tsx` that validates the customer access token before selecting a shortlisted provider.

## UI changes

The customer request access page now shows provider shortlist cards when a published shortlist exists and no match has been created. Cards include provider name, profile photo when present, marketplace review label, bio, call-out fee, estimated arrival, rate/negotiable state, completed jobs, profile work links, and trust signals.

## WhatsApp/template changes

Added selected-provider WhatsApp notification copy from the selection service. It tells the provider the customer selected them, shows that final acceptance uses 1 credit, includes current/remaining credit balance, and links to the signed provider lead URL when available.

## Security and privacy impact

Customer shortlist cards show provider profile/business data only. Provider private personal data is not exposed in the customer card. Full customer details are still not revealed to providers at customer selection time.

## Credit impact

No credits are deducted at shortlist generation or customer selection. Tests assert the shortlist selection transaction has no wallet ledger entry surface.

## Tests added or updated

- `field-service/__tests__/lib/customer-shortlists.test.ts`

## Commands run

```bash
npx prisma generate
npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts
npx prisma validate
npx tsc --noEmit
npm run lint
```

## Test results

- `npx prisma generate`: passed with Prisma package config deprecation warning.
- `npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/lib/provider-opportunity-responses.test.ts`: passed, 2 files, 9 tests.
- `npx prisma validate`: passed with Prisma package config deprecation warning.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 unrelated existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.

## Manual verification checklist

- [x] Shortlist contains interested providers only.
- [x] Shortlist excludes declined providers through the interested-response filter.
- [x] Shortlist excludes expired provider invites.
- [x] Provider card renders call-out fee.
- [x] Provider card renders estimated arrival.
- [x] Customer can select provider from the secure request link.
- [x] Selected invite is marked with `customerSelectedAt`.
- [x] Request status updates to `PROVIDER_CONFIRMATION_PENDING`.
- [x] Selected provider notification is attempted.
- [x] No credit is deducted on selection.
- [ ] Dedicated ask-for-more-options action is not yet implemented.
- [ ] Dedicated customer cancel-request action is not yet implemented in this shortlist UI.

## Risks and follow-ups

The selected lead invite uses `customerSelectedAt` instead of a new `LeadStatus` enum value to avoid breaking legacy lead acceptance states. Step 13 must use `selectedLeadInviteId` plus `customerSelectedAt` as the final-acceptance gate and must debit exactly once through the wallet ledger.

## OpenBrain note

Customer shortlist foundation completed. Interested provider responses can now be promoted into a published shortlist, shown to customers through the secure request token, and selected without provider credit deduction. Selection moves the request to provider confirmation and notifies the chosen provider; final debit and full customer-detail unlock remain deferred to selected-provider final acceptance.

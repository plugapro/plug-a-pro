# Execution Output — 08-provider-customer-selected-and-acceptance-whatsapp-flow.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/08-provider-customer-selected-and-acceptance-whatsapp-flow.md

## Objective
Implement and align the WhatsApp flow for when a customer selects a provider and that provider must accept or decline. Ensure the customer-selected notification includes credit balance info, the acceptance transaction is atomic, duplicate acceptance is handled idempotently, and all failure messages match the blueprint spec exactly.

## Current-state findings

### Customer-selected notification (`lib/customer-shortlists.ts: notifySelectedProvider`)
- Message body was missing the `✅` emoji header.
- Used `Available credits:` label — blueprint specifies `Available balance:`.
- Otherwise structurally correct: shows `After acceptance:` balance, includes interactive Accept/Decline buttons, appends optional PWA CTA link.

### Acceptance transaction (`lib/selected-provider-acceptance.ts: acceptSelectedProviderJob`)
- Fully atomic: entire flow (credit debit via `unlockLeadForProviderInTransaction`, match, quote, booking, job, lead/request updates, audit log) runs inside a single `db.$transaction`.
- Duplicate acceptance handled correctly: if `lead.status === 'ACCEPTED'` and match already exists for this provider, returns `alreadyUnlocked: true` without calling `unlockLeadForProviderInTransaction`. No double deduction possible.
- Idempotency key `${source}:${providerId}:${leadId}:selected_accept` passed to `unlockLeadForProviderInTransaction`.
- Full customer details (name, phone, address, access notes, job description, photos count) sent inline in provider WhatsApp confirmation — PWA link is optional and supplementary only.

### WhatsApp-bot handler (`lib/whatsapp-bot.ts: handleSelectedProviderConfirmation`)
- `confirm_accept:${leadId}` button path present and wired to `acceptSelectedProviderJob`.
- `INSUFFICIENT_CREDITS` failure path: used `buildInsufficientCreditsMessage` but message was missing "No credit was deducted." per blueprint spec.
- `LEAD_EXPIRED` failure message said "⏰ This job has expired and can no longer be accepted. No credits used." — blueprint spec requires "This job is no longer available. No credit was deducted."
- `REQUEST_NOT_AWAITING_CONFIRMATION` failure message said "⚠️ This job is no longer awaiting your confirmation." — blueprint spec requires "This job is no longer available. No credit was deducted."
- Duplicate accept already returned "This job is already assigned to you. No additional credit was deducted." ✅

### `buildInsufficientCreditsMessage` (`lib/provider-credit-copy.ts`)
- Header was `⚠️ *Not enough credits*` with extra formatting.
- Message body said "accept this selected job" and "Your current credits balance is".
- Missing "No credit was deducted." line per blueprint spec.

## Implementation completed

1. **`lib/customer-shortlists.ts`**: Added `✅` emoji to notification header; changed `Available credits:` to `Available balance:` to match blueprint spec.
2. **`lib/provider-credit-copy.ts`**: Aligned `buildInsufficientCreditsMessage` copy — simplified header to `Not enough credits.`, changed "accept this selected job" to "accept this job", changed "Your current credits balance is" to "Your current balance is", added "No credit was deducted." line.
3. **`lib/whatsapp-bot.ts`**: Changed `LEAD_EXPIRED` and `REQUEST_NOT_AWAITING_CONFIRMATION` failure messages to "This job is no longer available. No credit was deducted."
4. **`__tests__/lib/provider-credit-copy.test.ts`**: Updated assertions to match new `buildInsufficientCreditsMessage` copy.
5. **`__tests__/lib/whatsapp-bot-stateless.test.ts`**: Updated assertion for old copy; added 3 new tests:
   - `LEAD_EXPIRED` on `confirm_accept` sends "no longer available" and "No credit was deducted"
   - `REQUEST_NOT_AWAITING_CONFIRMATION` on `confirm_accept` sends same
   - `INSUFFICIENT_CREDITS` on `confirm_accept` body contains "Not enough credits" and "No credit was deducted"

## Files changed

| File | Change summary |
|---|---|
| `lib/customer-shortlists.ts` | Added ✅ emoji header; changed `Available credits:` to `Available balance:` in notifySelectedProvider |
| `lib/provider-credit-copy.ts` | Aligned buildInsufficientCreditsMessage to blueprint spec; added "No credit was deducted." |
| `lib/whatsapp-bot.ts` | Fixed LEAD_EXPIRED and REQUEST_NOT_AWAITING_CONFIRMATION failure messages to "This job is no longer available. No credit was deducted." |
| `__tests__/lib/provider-credit-copy.test.ts` | Updated assertions to match new copy |
| `__tests__/lib/whatsapp-bot-stateless.test.ts` | Updated 1 existing assertion; added 3 new tests for blueprint failure-message coverage |

## WhatsApp flow changes

**Customer-selected notification (sent when customer picks a provider from shortlist):**
```
✅ Customer selected you

The customer selected you for this {category} job in {suburb}.

Accepting this job uses 1 credit.

Available balance: {N} credits
After acceptance: {N-1} credits
```
Interactive buttons: `Accept job` / `Decline`
Optional PWA CTA: `View details` → signed lead access URL

**Acceptance confirmation (sent to provider after successful accept):**
Full customer details inline: name, phone, address, access notes, job description, photos count, preferred time window, job reference. Optional PWA CTA with signed job handover URL.

**Customer notification after provider accepts:**
Provider name, expected arrival, call-out fee. Optional PWA CTA with signed request URL.

## PWA route/screen changes
None

## API/server changes
None — all changes are to message copy and test assertions. The acceptance transaction logic and structure were already compliant.

## Credit impact
CRITICAL — confirmed:
- **Atomicity**: Credit debit, match, quote, booking, job, lead/request updates, and audit log all run in a single `db.$transaction`. A failure in any step rolls back everything including the credit debit.
- **Idempotency**: `unlockLeadForProviderInTransaction` is gated on an idempotency key. If the same provider re-accepts a lead that is already `ACCEPTED` with a matching assignment, the early-exit branch returns `alreadyUnlocked: true` without calling the unlock function at all — 0 additional credits deducted.
- **Insufficient credits**: `debitCreditsForLeadUnlockInTransaction` uses an optimistic concurrency guard (`updateMany` with exact balance constraint). If another unlock raced, it throws `CONCURRENT_MUTATION` which bubbles up as `JOB_ASSIGNMENT_FAILED`, not a silent double-deduct.
- **Exactly 1 deduction**: Promo credits consumed first, then paid credits. Debit is for exactly `LEAD_UNLOCK_COST_CREDITS` = 1.

## Security/privacy impact
- Full customer details (phone, address, access notes) are only sent AFTER the credit deduction and job assignment commit inside the transaction. An uncommitted or rolled-back transaction produces no customer-detail leak.
- Provider must be the `selectedProviderId` on the job request AND the `providerId` on the lead to proceed — mismatches return early before any credit check.

## Tests added or updated

| Test file | Change |
|---|---|
| `__tests__/lib/provider-credit-copy.test.ts` | Updated `buildInsufficientCreditsMessage` assertions to match new copy |
| `__tests__/lib/whatsapp-bot-stateless.test.ts` | Updated 1 assertion; added 3 tests for LEAD_EXPIRED, REQUEST_NOT_AWAITING_CONFIRMATION, and INSUFFICIENT_CREDITS on `confirm_accept` path |

Existing tests already cover:
- Atomic acceptance with single credit deduction (`selected-provider-acceptance.test.ts`)
- Duplicate accept idempotency (`selected-provider-acceptance.test.ts`)
- Insufficient credits without creating assignment records (`selected-provider-acceptance.test.ts`)
- Non-selected provider blocked before credit deduction (`selected-provider-acceptance.test.ts`)
- Expired preview window still accepted if customer has selected (`selected-provider-acceptance.test.ts`)
- Explicit EXPIRED lead rejected (`selected-provider-acceptance.test.ts`)

## Commands run
```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -30
```

## Test results
158 test files passed | 1 skipped | 1616 tests passed | 4 todo — 0 failures.

## Manual verification checklist
- [ ] Provider accepts selected job in WhatsApp
- [ ] 1 credit deducted exactly once
- [ ] Job assigned
- [ ] Full customer details sent in WhatsApp after acceptance
- [ ] Customer notified
- [ ] Tests pass

## Risks and follow-ups
- `buildInsufficientCreditsMessage` is also used by the non-shortlist lead acceptance path (`sendLeadInsufficientCreditsMessage` in `whatsapp-bot.ts`). The updated copy ("accept this job") is accurate for both contexts.
- The "No credit was deducted" phrasing in the job-unavailable and insufficient-credits messages is now consistent across all failure paths on the `confirm_accept` route.

## OpenBrain note
Step 08 complete. Customer-selected notification aligned to blueprint spec (✅ header, `Available balance:` label). Failure messages for LEAD_EXPIRED, REQUEST_NOT_AWAITING_CONFIRMATION, and INSUFFICIENT_CREDITS now explicitly state "No credit was deducted." per spec. Atomicity and idempotency were already correct — no structural changes needed. 1616/1616 tests passing.

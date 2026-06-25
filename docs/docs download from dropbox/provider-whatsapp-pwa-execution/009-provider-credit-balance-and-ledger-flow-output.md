# Execution Output — 09-provider-credit-balance-and-ledger-flow.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/09-provider-credit-balance-and-ledger-flow.md`

## Objective

Align provider credit balance, credit explanations, and credit history across WhatsApp and the optional provider PWA.

## Current-state findings

The wallet implementation was already ledger-first:

- `ProviderWallet` stores cached paid and starter/promo balances for fast gating.
- `WalletLedgerEntry` is the immutable source-of-truth row for wallet mutations.
- Ledger metadata stores before/after paid and promo balances.
- PWA `/provider/credits` already shows total available credits, paid credits, starter/onboarding credits, and recent wallet activity.
- Selected-provider acceptance already deducts through the atomic unlock/job-assignment path.

The WhatsApp gap was presentation and routing: `credits` and `balance` reached provider status, but the message did not match the required "Your credits" summary and `credit history` was not an explicit command alias.

## Implementation completed

- Added reusable WhatsApp credit summary copy with:
  - Available credits.
  - Starter/onboarding credits.
  - Purchased credits.
  - Selected-job-only credit deduction rule.
  - Explicit no-credit events: preview, interest, shortlist, customer selection, decline, and expiry.
  - Optional PWA credit history link using the existing production-safe public URL helper.
- Updated provider status/credit command output to include the new credit summary.
- Added `credit history`, `credits history`, and `wallet history` command aliases to the canonical provider WhatsApp command model.
- Kept `/provider/credits` as the existing optional PWA credit dashboard/history route.
- Fixed a narrow TypeScript union issue in `provider-whatsapp-job-commands.ts` that surfaced during Step 9 typecheck.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-credit-copy.ts` | Added `buildProviderCreditSummaryMessage` |
| `field-service/lib/whatsapp-flows/provider-journey.ts` | Provider status/credits command now uses the required WhatsApp credit summary |
| `field-service/lib/provider-whatsapp-command-model.ts` | Added credit-history aliases to existing provider journey routing |
| `field-service/lib/provider-whatsapp-job-commands.ts` | TypeScript-only narrowing fix for non-arrival job command aliases |
| `field-service/__tests__/lib/provider-credit-copy.test.ts` | Added WhatsApp credit summary test |
| `field-service/__tests__/lib/provider-whatsapp-command-model.test.ts` | Added credit-history command routing assertion |
| `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts` | Added provider credit summary and PWA history link assertion |
| `docs/provider-whatsapp-pwa-execution/009-provider-credit-balance-and-ledger-flow-output.md` | Step 9 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

Providers can now type:

- `credits`
- `balance`
- `credit history`

These route into the existing provider journey and show:

```text
Your credits

Available: {{available_credits}}
Starter/onboarding: {{starter_credits}}
Purchased: {{purchased_credits}}

Credits are used only when you accept a customer-selected job.
```

The message also clarifies that previews, interest responses, shortlist generation, customer selection, declines, and expiry do not use credits.

## PWA route/screen changes

No new PWA route was added. The existing optional `/provider/credits` page remains the credit dashboard/history screen and is linked from WhatsApp when a production-safe public URL is configured.

## API/server changes

No new API route was added. Existing wallet services and ledger entries remain canonical.

## Credit and ledger impact

- No deduction is made for preview, interest response, shortlist, customer selection, decline, or expiry.
- The selected-provider acceptance path remains the only implemented one-credit deduction point for the qualified shortlist selected-job flow.
- Negative balances remain blocked by `ProviderWalletError('INSUFFICIENT_FUNDS')`.
- Existing ledger rows include provider ID, transaction type, amount, paid/starter balances after mutation, reference type/ID, reason/description, metadata, actor, and created timestamp. Request/job/lead references are represented through `referenceType`, `referenceId`, and metadata rather than separate physical columns.

## Security/privacy impact

No privacy surface changed. Credit summaries expose only provider wallet balances and do not include customer data.

## Tests added or updated

- Credit summary copy test.
- Provider command model test for `credit history`.
- Provider journey test for WhatsApp credit summary and optional PWA history link.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-credit-copy.test.ts __tests__/lib/provider-whatsapp-command-model.test.ts __tests__/lib/whatsapp-flows/provider-journey.test.ts` | Passed; 3 files, 58 tests |
| `npx tsc --noEmit` | Passed after TypeScript-only narrowing fix in `provider-whatsapp-job-commands.ts` |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Provider can check credits in WhatsApp.
- [x] Provider can request credit history in WhatsApp and is routed to the same provider journey.
- [x] WhatsApp copy shows available, starter/onboarding, and purchased credits.
- [x] WhatsApp copy states credits are used only after selected-job acceptance.
- [x] PWA `/provider/credits` remains the optional credit history screen.
- [x] No duplicate credit route or wallet system was created.
- [x] Typecheck and lint completed.

## Risks and follow-ups

- The ledger schema does not have separate physical columns for every blueprint-named reference such as `request_id`, `job_id`, and `lead_invite_id`; those are currently represented through `referenceType`, `referenceId`, and metadata. A future schema migration can add explicit nullable reference columns if finance/reporting needs direct SQL filtering.

## OpenBrain note

Provider credit balance flow aligned for WhatsApp-first operation. Credit commands now show the required available/starter/purchased summary, credit history routes through the existing provider journey with optional PWA handoff, and the ledger-first wallet model remains the canonical credit source.

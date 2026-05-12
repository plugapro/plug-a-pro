# Pay@ provider credit integration — 2026-05-12

## Context

Plug A Pro provider wallet top-ups now use Pay@ as the primary gateway for R100, R200, and R500 packages. The existing wallet architecture already used `PaymentIntent` plus immutable wallet ledger entries, so the Pay@ integration extends that flow instead of adding a parallel `WalletTopup` model.

## Decisions

1. `PaymentIntent` remains the source record for top-ups. Pay@ webhook references use `payment_intents.id`; `paymentReference` remains an internal reconciliation label.
2. `PaymentIntentMethod.PAYAT` identifies Pay@ intents, with a migration adding the enum value and a partial status index.
3. Provider credit pricing is now `1 credit = R20`, matching the Pay@ package model: R100 = 5 credits, R200 = 10 credits, R500 = 25 credits.
4. Pay@ webhook processing reuses the existing ledger-first gateway crediting path, with Pay@-specific source labels and idempotent `PENDING_PAYMENT` / `ITN_RECEIVED` to `CREDITED` handling.
5. Pay@ credentials stay server-only. `.env.local.example` documents required keys; real credentials must be set in Vercel and local `.env.local`.

## Validation

- `npx prisma generate`
- `npx tsc --noEmit`
- `npm run lint` — 0 errors, 3 pre-existing warnings
- `npm run test -- __tests__/api/provider-credit-top-up-intents.test.ts __tests__/lib/payat-token.test.ts __tests__/lib/payat-payment.test.ts __tests__/lib/provider-credit-payment-intents.test.ts __tests__/lib/provider-credit-payat-intents.test.ts __tests__/api/payat-webhook.test.ts`
- `npx vitest run --testTimeout=15000` — 209 files, 2353 tests passing

## Vercel

Production env vars added to `plug-a-pro-main`:

- `PAYAT_MERCHANT_ID`
- `PAYAT_WEBHOOK_SECRET`
- `PAYAT_API_BASE`
- `PAYAT_TOKEN_URL`

Blocked pending Pay@ email credentials:

- `PAYAT_CLIENT_ID`
- `PAYAT_CLIENT_SECRET`

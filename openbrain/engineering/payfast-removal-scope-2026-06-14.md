# Scope: removing PayFast as a payment provider (2026-06-14)

Scoping only — no app code changed. Goal: remove **PayFast**; **Pay@/PayAt stays**
as the platform PSP. Source + live-env review shows booking PayFast is currently
inert in production (`PAYMENT_COLLECTION_MODE` is not `checkout`), while provider
credit PayFast remains an unused-but-live authenticated surface. Removal is still
low-risk and additionally **moots three PayFast security findings**.

## Step 0 — confirm PayFast is unreachable in prod (NOT fully proven by source)

Corrected after source review (2026-06-14): PayFast is **config-gated and an
unused-but-live authenticated surface**, NOT dead code. Removal is still
low-risk, but live runtime state matters for booking checkout:

- **Booking checkout via PayFast is config-gated.** `initializeBookingPayment`
  (`lib/payments.ts:599`) calls `createCheckout()` when
  `PAYMENT_COLLECTION_MODE === 'checkout'`; it returns early (no checkout) when
  `mode === 'bypass'` (`:564`). Default is **bypass** (`:77`).
  `initializeBookingPayment` IS called after lead acceptance (fire-and-forget) at
  `lib/matching/service.ts:2823`. `.env.production.local` does **not** set
  `PAYMENT_COLLECTION_MODE` → would default to bypass, BUT the live Vercel value is
  authoritative. **DONE: live Vercel Production env pull (2026-06-14) returned
  `PAYMENT_COLLECTION_MODE=` (empty), so runtime defaults to `bypass`, not
  `checkout`.** If this is later changed to `checkout`, removing PayFast requires
  the booking PSP to fall back to a working provider.
- **Provider-credit top-up via PayFast: no UI, but a LIVE authenticated REST
  surface.** The credits UI (`components/provider/credits/index.tsx:180`) calls
  **only** Pay@, and the server action `createProviderPayfastTopUpIntent`
  (`actions.ts:1169`) has no UI caller — BUT the REST route
  `app/api/provider/wallet/top-up-intents/route.ts:106` still **accepts
  `PAYFAST_*` methods** and an authenticated provider could create a PayFast
  intent by calling it directly. So it's unused-but-reachable; removal closes a
  live surface (good), it is not merely dead code.
- **`lib/payfast.ts` has MORE importers than first stated.** Besides the webhook
  and `lib/provider-credit-payment-intents.ts`, it is also imported by
  `components/provider/PayfastCheckoutForwarder.tsx:4`
  (`type PayfastCheckoutPayload`) and referenced by `ProviderPayfastCheckoutResult`
  in `app/(provider)/provider/credits/actions.ts:886`. (PayfastCheckoutForwarder
  has no renderer — likely also dead; remove it.) Deleting `lib/payfast.ts`
  requires cleaning all of these.
- `PSP_PROVIDER="payfast"` (`.env.production.local:20`) is the factory default; it
  matters for the booking webhook verifier path.

Before deleting the webhook, verify **zero in-flight `PAYFAST_*` PaymentIntent
rows** in prod. If any exist, let the webhook drain them first.

## Security bonus

Deleting `lib/payfast.ts` + `app/api/webhooks/payfast/route.ts` **eliminates**
these findings entirely (the vulnerable code ceases to exist):
- 106344611 — forgeable PayFast ITN credits provider wallets
- 7a1438dc — PSP webhook fails open without passphrase
- c2796cee — PayFast IP allowlist trusts spoofable headers

So the held branch `fix/payfast-cf-ip-trust` (ace4d119) is **moot — drop it**
(done as part of this exercise).

## Data-model safety

- `PaymentIntentMethod` keeps `PAYFAST_CARD`, `PAYFAST_EFT`, `PAYFAST_SCODE`
  (`prisma/schema.prisma`). **House rule = additive-only: do NOT drop these enum
  values** (historical intents may reference them; a Postgres enum drop is
  destructive). Remove code paths only; leave the enum.
- `Payment.pspProvider` (booking side) is a free string → no schema change.

## Removal plan

PayFast has two independent surfaces; both are removable.

### A. Provider-credit PayFast (SA card top-up)
- **Delete:** `lib/payfast.ts`; `app/api/webhooks/payfast/route.ts`.
- **Edit (keep file, remove PayFast branch):**
  - `lib/provider-credit-payment-intents.ts` — remove `createPayfastTopUpIntent`
    (`:760`) + the `PAYFAST_*` method branches.
  - `app/(provider)/provider/credits/actions.ts` — remove `createPayfastTopUpIntent`
    import (`:16`) + `createProviderPayfastTopUpIntent` (`:1169`).
  - `app/api/provider/wallet/top-up-intents/route.ts` — remove the `payfast`
    method branch (`:106`). Keep the route only if `manual_eft` is still wanted;
    otherwise consider removing the whole route (verify manual_eft has a consumer).
  - `components/provider/PayfastCheckoutForwarder.tsx` — delete (imports
    `lib/payfast`; no renderer).
  - `app/(provider)/provider/credits/actions.ts` — also remove the
    `ProviderPayfastCheckoutResult` type (`:886`) that references
    `import('@/lib/payfast').PayfastCheckoutPayload`.
  - `lib/provider-credit-gateway-itn.ts` — **KEEP** the shared private helper
    `creditProviderWalletFromGatewayIntent` (`:59`) AND the Pay@ wrapper
    `creditProviderWalletFromPayatWebhook` (`:191`, which Pay@ actually calls).
    **REMOVE** only the PayFast wrapper `creditProviderWalletFromGatewayItn`
    (`:181`) together with the PayFast webhook.

### B. Booking-checkout PayFast (unused PSP abstraction)
- `lib/payments.ts` — remove the `PayFastProvider` class (`:226`) and the
  `case 'payfast'` in the factory (`:466-467`). **Repoint the default** in
  `resolvePspProviderName()` (`:85`) from `'payfast'` to `'peach'` so
  `getProvider()` (used by the `/api/webhooks/payments` verifier) still resolves.
  - Optional follow-up (broader than "remove PayFast"): the entire
    `createCheckout`/booking-PSP path is dead — could be removed wholesale later.

### Cross-cutting
- **Env:** remove all `PAYFAST_*` from Vercel after code removal
  (`PAYFAST_MERCHANT_ID/KEY/PASSPHRASE/NOTIFY_URL/RETURN_URL/CANCEL_URL/LIVE_URL/
  SANDBOX/LIVE_NOTIFY_IPS/METHODS/ALLOWED_AMOUNTS_CENTS/INTENT_EXPIRY_HOURS/
  PAYMENT_WITHOUT_LEDGER_LINK`). `PAYFAST_PASSPHRASE` was a fail-closed security
  env — moot once the webhook is gone.
- **Proxy:** no PayFast-specific public path; `/api/webhooks/payfast` is covered by
  the generic `/api/webhooks` prefix — leave that (still covers the Peach webhook).
- **Tests:** remove/update ~8 PayFast files: `lib/payfast.test.ts`,
  `lib/payments-payfast-config.test.ts`, `api/payfast-webhook.test.ts`,
  `api/provider-credit-top-up-intents.test.ts`, `provider/provider-credits-actions.test.ts`,
  `provider/cancel-payat-intent-action.test.ts` (mixed), `lib/provider-wallet-notifications.test.ts`,
  `lib/admin-console-ui.test.ts`.

## Recommended sequencing

1. (DONE) Step-0 dead-code confirmation + drop the held security branch.
2. Verify no in-flight `PAYFAST_*` PaymentIntent rows in prod.
3. PR 1 — remove surface A (credit top-up) + its tests.
4. PR 2 — remove surface B (booking PSP) + repoint default to `peach` + tests.
5. Retain the `PAYFAST_*` enum values; remove `PAYFAST_*` Vercel env vars last.
6. Each PR flag-light/additive-safe, smoke-tested, shipped separately (house rules).

## Effort

Low–moderate. The provider-credit PayFast path is reachable only by direct
authenticated API use, and the booking PayFast path is currently inert in
production because checkout mode is disabled. The only judgement call is surface
B's default repoint (→ `peach`) vs. removing the whole checkout abstraction.

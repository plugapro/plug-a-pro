# VodaPay channel rollout

Flags: `channel.vodapay.v1` (mini-program entry, login, UI mode), `payments.vodapay.v1`
(cashier PSP routing). Both registered in `field-service/lib/feature-flags-registry.ts`
with `defaultValue: false`. Both currently OFF everywhere — merging the branch this
runbook ships with changes nothing in production.

## Env (per environment; set via `printf '%s' 'VAL' | vercel env add NAME <env>` — NEVER echo)

`field-service/.env.example` already documents the full block (added in Task 13/14) —
this section is a rollout-ordered summary, not a duplicate source of truth.

| Var | Notes |
|---|---|
| `VODAPAY_CLIENT_ID` | Open-API client id, sent as the `Client-Id` header. |
| `VODAPAY_MERCHANT_ID` | Used on `payCashier` calls. |
| `VODAPAY_MINI_PROGRAM_APP_ID` | Console/bundle configuration only — not read by app code. |
| `VODAPAY_API_BASE` | Sandbox vs prod host — different value per environment. |
| `VODAPAY_PRIVATE_KEY` | Our RSA private key, PKCS8 PEM. Production secret — never commit. |
| `VODAPAY_PLATFORM_PUBLIC_KEY` | VodaPay's RSA public key, SPKI PEM — verifies their responses/notifies. |
| `VODAPAY_VERIFY_RESPONSES` | Default ON (see gate 2 below). |
| `VODAPAY_CSP_HOSTS` | Space-separated `https://` origins appended to CSP `connect-src` (`next.config.ts`). |
| `VODAPAY_AUTH_LIMIT_PER_IP_HOUR` | Optional, default 20/hr (see gate 3 below). |

Marketing project also needs (separate Vercel project, not `field-service`):
`NEXT_PUBLIC_VAT_NUMBER`, `NEXT_PUBLIC_REGISTERED_ADDRESS` — footer/contact identity
fields the VodaPay merchant checklist wants visible. `marketing/.env.local.example`
does not currently list these; add them there if this drifts further.

**Key generation:**

```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out vodapay.pem
openssl pkey -in vodapay.pem -pubout
```

Upload the PUBLIC key in the VodaPay console; the private key goes only into Vercel
env (`VODAPAY_PRIVATE_KEY`), never into git, never into Slack/email.

## Order of operations

1. Merge to `main`. Prod behaviour unchanged — flags OFF, env unset, `/vodapay` 404s,
   `/api/auth/vodapay` 404s, `/api/channel` 404s.
2. Workspace approved by VodaPay → set **sandbox** env vars in the relevant Vercel
   environment → run `prisma migrate deploy` (CI-standard; the only schema change in
   this branch is the additive `CustomerExternalIdentity` model + `Payment.vodapayAttempt`
   counter column — no drops, no renames).
3. Run the three **deployment gates** below. Do not flip `channel.vodapay.v1` until all
   three are confirmed.
4. Enable `channel.vodapay.v1` (DB flag row, not env) → sandbox device test: entry,
   login, address, waitlist copy, WhatsApp CTA suppressed.
5. Enable `payments.vodapay.v1` → sandbox cashier end-to-end incl. webhook + refund
   (VERIFY-IN-SANDBOX items in `lib/vodapay/client.ts`, checklist below).
6. VodaPay QA submission (Tue/Thu) using `docs/ops/marketplace-onboarding/vodapay-application.md`
   checklist.
7. Prod env vars → flags stay OFF until VodaPay Final Release; flip `channel.vodapay.v1`
   first, `payments.vodapay.v1` second (channel without payments is a safe intermediate
   state — login/browsing only, no PSP routing).

## Deployment gates (before flipping `channel.vodapay.v1`)

These came out of implementation review, not the original design spec — do not skip
them because they aren't in the task briefs.

### Gate 1 — Supabase Email auth provider must be enabled

The federated-login route (`POST /api/auth/vodapay`) mints a session via
`admin.generateLink({ type: 'magiclink', email })` → `verifyOtp({ token_hash, type:
'magiclink' })`. This is the only session-mint path available in the installed
`@supabase/supabase-js` SDK (`admin.createSession` does not exist — confirmed by
reading the compiled `@supabase/auth-js` types; see Task 14 report). `generateLink`
is GoTrue's `/admin/generate_link` endpoint — **if the project's Email auth provider
is disabled, GoTrue rejects the call and the route 500s (`session_mint_failed`)** for
every VodaPay login attempt.

Action: confirm **Email** is enabled under Authentication → Providers in the Supabase
project this deployment points at, before flipping the flag. No email is ever
delivered by this flow — `generateLink` only generates a link, which is consumed
in-process microseconds later. Confirming the provider is a project-setting check, not
a "start sending mail" decision.

### Gate 2 — synthetic email domain must be unroutable

Phone-only VodaPay customers get a derived, deterministic address
`vodapay-<sha256(externalId)[0:32]>@vodapay.users.plugapro.co.za` (attached to the
Supabase auth user only when it has no email already; a real existing email is never
replaced). Confirm `vodapay.users.plugapro.co.za` carries **no MX record** and is not
routable anywhere — this namespace exists purely so `generateLink` has a syntactically
valid `email` argument to hand GoTrue (every `GenerateLinkParams` variant requires
one; none accepts a phone). No mail must ever be able to deliver to this domain: if it
became routable, the derived addresses would become a phishing/account-recovery
surface for a domain that isn't actually attended.

### Gate 3 — closed: provider-profile WhatsApp CTA is channel-gated

Provider-profile WhatsApp CTAs (`app/(customer)/providers/[id]/page.tsx`) are now
channel-gated the same way as the home/booking flow CTAs (`channel !== 'vodapay'`)
as of this branch — no further action needed before flipping the flag.

## `VODAPAY_VERIFY_RESPONSES` — first thing to check on sandbox 401s

Default **ON**. Only the literal string `'false'` disables it (an empty/unset value
leaves verification on — the safe default). It gates **both** federated login
(`POST /api/auth/vodapay`) and every payment/refund/inquiry call through
`lib/vodapay/client.ts` — `applyToken`, `inquiryUserInfo`, `payCashier`,
`refundPayment`, `inquiryPayment` all verify the platform's RSA signature on the
response body (via `Signature` + `Response-Time` headers, falling back to
`Request-Time`) before trusting it. TLS alone authenticates the host, not the
payload — an intercepted/spoofed response otherwise decides who gets a session.

**If VodaPay's sandbox does not sign responses, every call fails closed** with
`VodapayApiError('RESPONSE_SIGNATURE_MISSING')`, surfacing as a 401
(`vodapay_auth_failed` on login; the equivalent PSP-layer error on payment calls).
This is the first thing to check when sandbox calls 401 with no other obvious cause.
Only set `VODAPAY_VERIFY_RESPONSES=false` once the sandbox has *provably* not signed
a response (not "assumed") — and record that as an accepted risk, since the toggle
also disables verification against tampered responses in production if left off.

## Rate limiting

`POST /api/auth/vodapay` has its own per-IP hourly limiter (`vodapayAuthByIp` in
`lib/rate-limit.ts`), separate from the OTP endpoints' bucket (sharing that bucket
from an unauthenticated route would let VodaPay traffic lock out unrelated OTP
users). Default `VODAPAY_AUTH_LIMIT_PER_IP_HOUR=20`, fail-**closed** (a limiter-store
outage 503s rather than admitting unlimited attempts).

Launch-tuning item: carrier-NAT WebView populations (many phones behind one mobile
carrier NAT IP, which is a realistic shape for VodaPay's mini-program traffic) may
share a public IP across far more than 20 distinct customers/hour. If sandbox or early
production testing shows legitimate logins getting 429'd, raise
`VODAPAY_AUTH_LIMIT_PER_IP_HOUR` rather than assuming abuse — this is a known
trade-off, not a bug.

## Before flipping the flag — flag-row and data checks

1. **Verify `feature_flags` DB rows.** The flag resolver order is DB row →
   `FEATURE_FLAGS` env JSON → registry default (`lib/flags.ts`). A DB row **wins over**
   the registry's `defaultValue: false`. Before assuming prod is inert, confirm there
   is no `feature_flags` row for `channel.vodapay.v1` / `payments.vodapay.v1` in prod,
   or that any existing row is `enabled: false`. A stray `enabled: true` row (e.g. from
   an earlier seed-group dry run pointed at the wrong database) would silently turn the
   channel on with no code deploy.
2. **Backfill `vodapayAttempt` if any staging rows carry the old metadata shape.** The
   checkout-retry counter is now the first-class `Payment.vodapayAttempt` column
   (`lib/payments/providers/vodapay.ts`), incremented atomically per mint attempt and
   embedded in `paymentRequestId` as `${bookingId}.${attempt}`. If any staging
   `Payment` row was created by an early build that stashed this under
   `metadata.vodapayAttempt` instead, backfill it onto the real column once before
   relying on the attempt-suffix idempotency scheme for that row.

## VodaPay QA submission

Use `docs/ops/marketplace-onboarding/vodapay-application.md` for the application pack
and the QA-item-to-Plug-A-Pro-test mapping table. Submit on VodaPay's Tue/Thu review
cadence.

## Sandbox-confirm checklist (built to spec, not yet confirmed against a live sandbox)

These were built following the Alipay+ open-API spec (VodaPay's mini-program gateway
itself is not publicly documented — research doc §7.1 Q5). Confirm each against the
real sandbox before trusting it in production:

- **`notify` `paymentAmount.value` is ZAR minor units** (cents) — `payCashier` sends
  `paymentAmount: { currency: 'ZAR', value: String(amountCents) }`; the notify handler
  assumes the same unit on the way back in.
- **`result.resultStatus === 'S'`** is the success discriminator for open-API calls
  (`applyToken`, `payCashier`, notify parsing) — distinct from the mini-program
  bridge's own `my.tradePay()` callback, which uses Alipay's numeric
  `resultCode === '9000'` (`lib/vodapay/checkout.ts#isTradePaySuccess`). Two different
  layers, two different success codes — don't conflate them when debugging.
- **Refund notifies the same destination/shape as payment notify** — `refundPayment`
  is marked `VERIFY-IN-SANDBOX` in `lib/vodapay/client.ts`; the refund API shape is
  unconfirmed.
- **`/v2/payments/pay` idempotency semantics post-expiry.** The attempt-suffix scheme
  (`paymentRequestId = ${bookingId}.${attempt}`, atomic per-mint increment on
  `Payment.vodapayAttempt`) assumes a fresh `paymentRequestId` is required to re-mint
  after a session expires (~30 min `paymentExpiryTime`). Confirm VodaPay's gateway
  actually requires this rather than allowing idempotent re-use of an expired id.
- **`Signature` header URI-encoding.** The signature value is
  `encodeURIComponent`-wrapped inside the `algorithm=RSA256, keyVersion=1,
  signature=<urlencoded-b64>` header; confirm VodaPay's gateway parses it with the
  same encoding convention on both request and response sides.
- **PWA-type acceptance for public release.** Confirm VodaPay's review process
  accepts a PWA-hosted mini-program (vs. a native/H5 bundle) for general release, not
  just sandbox testing.
- **Refund API shape** — see `lib/vodapay/client.ts` `VERIFY-IN-SANDBOX` markers on
  `refundPayment`.
- **Whether `inquiryUserInfo`'s phone is KYC-verified.** `resolveVodapayCustomer`
  trusts the returned `mobileNumber` as-is to link/create a `Customer` record and mint
  a session. Confirm VodaPay's `inquiryUserInfo` phone claim carries the same
  verification weight as, say, an OTP-verified number — this determines how much this
  flow can be trusted downstream (bookings, payments) without an additional check.

## Kill switch

Flip both flags OFF (`channel.vodapay.v1` and `payments.vodapay.v1`).

**In-flight payments still settle.** `POST /api/webhooks/vodapay` processes
regardless of either flag's state — a checkout session minted while
`payments.vodapay.v1` was on can still deliver its notify after the flag is flipped
off, and that in-flight payment must still land (see the comment block at the top of
`app/api/webhooks/vodapay/route.ts`). Flipping the flags stops *new* VodaPay
checkouts from being minted; it does not stop existing ones from completing.

**Watch for the duplicate-success marker.** Both the generic webhook route and the
VodaPay-specific one share the same amount/idempotency guards
(`lib/payments/webhook-guards.ts`). If a second "success" notify arrives for a
payment that's already marked paid but carries a **different** `pspReference` than
the one already stored, the handler logs:

```
[webhook/vodapay:<reqId>] DUPLICATE_SUCCESS_DIFFERENT_PSP_REFERENCE - possible double charge, manual refund needed
```

This is an **ops alert-worthy line** — it means VodaPay (or a retry/replay) sent two
different "this payment succeeded" notifications for the same booking, which is the
shape of a possible double charge. It does not auto-refund; someone has to look at
the booking's `Payment` rows and reconcile manually. Grep production logs for
`DUPLICATE_SUCCESS_DIFFERENT_PSP_REFERENCE` after any flag flip or VodaPay-side
incident.

## Watch after flip

- **`WorkflowEvent` rows with `source='vodapay'`.** There is no admin UI to browse
  these by source today: `lib/admin/funnel-aggregate.ts` never references `source` at
  all — the funnel view (`/admin/reports`) breaks down only by category and suburb.
  `vodapay` rows are silently included in the aggregate totals but are **not**
  observable by source anywhere in `/admin`. Watch via a direct DB query instead
  (table/column names verified against the `WorkflowEvent` model in
  `prisma/schema.prisma`: `@@map("workflow_events")`, and `occurredAt` has no
  `@map`, so it's the literal, case-sensitive column name):

  ```sql
  SELECT count(*) FROM workflow_events
  WHERE source = 'vodapay' AND "occurredAt" > now() - interval '1 day';
  ```

  or log inspection. A `source` breakdown in the funnel report is a small future
  enhancement — not something this branch ships.
- **`ServiceAreaWaitlist` rows with `source=vodapay`** — marketplace demand from
  outside the current service fence, surfaced through the VodaPay channel
  specifically. Distinct signal from WhatsApp/PWA waitlist volume; useful for deciding
  where to expand next.
- **`Payment` rows with `pspProvider=vodapay` stuck in `PENDING` for > 10 minutes.**
  A session was minted (`payCashier` succeeded) but no notify ever arrived — check
  whether VodaPay's notify delivery is failing, or whether the customer abandoned the
  mini-program cashier mid-flow.
- **Security audit events `auth.vodapay_session_issued` / `auth.vodapay_session_refused`**
  (`AdminAuditEvent`/`AuditLog`, written by `POST /api/auth/vodapay`). `_refused` rows
  carry a reason code (`blocked_metadata_role`, `staff_account`, `provider_account`,
  `ACCOUNT_LOCKED`, `security_gate_unavailable`, `STEP_UP_REQUIRED`) — a spike in any
  one reason is worth investigating (e.g. a wave of `staff_account` refusals could mean
  someone is testing the VodaPay login path against known staff phone numbers).

## Rollback

If a serious issue surfaces post-flip: flip both flags OFF first (immediate, no
deploy needed — DB flag row), then decide whether a code rollback is also needed.
Flipping the flags alone stops new VodaPay traffic; it does not undo anything already
written (customers created via `resolveVodapayCustomer`, payments already minted).
Those are ordinary `Customer`/`Payment`/`CustomerExternalIdentity` rows and do not
need cleanup unless something concrete is wrong with them.

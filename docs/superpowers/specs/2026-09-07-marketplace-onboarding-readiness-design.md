# Marketplace onboarding readiness — VodaPay host + FNB nav» listing (design)

Date: 2026-09-07 · Status: approved design, pending spec review · Owner: Shimane
Research basis: `docs/strategy/2026-09-07-super-app-listing-research.md`

## 1. Goal

Make Plug A Pro ready to (a) apply for a VodaPay Mini Program workspace and an FNB nav» Home Services profile, and (b) run the customer booking journey inside VodaPay's super app as a "PWA (HTML5)" mini program — with VodaPay login and VodaPay cashier payment — the week the workspace is approved, without any of it affecting WhatsApp or web customers until flags are flipped.

Decision taken: build the full VodaPay integration now behind flags (approach B), rather than waiting for Vodacom's commission answer.

## 2. Scope

In scope
- W0 Application pack (non-code)
- W1 Website compliance on plugapro.co.za (marketing app)
- W2 WebView unblock in app.plugapro.co.za (field-service app)
- W3 VodaPay runtime mode + marketplace attribution
- W4 VodaPay federated login
- W5 VodaPay cashier payments with per-channel PSP routing
- Sandbox QA checklist and Playwright smoke coverage

Out of scope
- Provider-side app inside VodaPay; native (AXML) mini program
- Any FNB or Telkom Yep! integration code (FNB is a listing profile only)
- VodaPay push / inbox notifications (send API not published)
- Service-area expansion beyond the jhb_west fence
- Refund UX beyond what the existing Peach path already supports in admin

## 3. Current state (verified 2026-09-07)

| Area | Today | Reference |
|---|---|---|
| First web screen | `/` customer home; `/book/[serviceId]` is public, auth enforced at submit | `app/(customer)/page.tsx:63`, `proxy.ts:64` |
| Identity | Supabase phone OTP only; `getSession()` verifies a Supabase JWT; inline OTP behind `customer.booking.inline_otp` | `lib/auth.ts:318`, `lib/customer-session.ts:66`, `components/customer/useInlineOtp.ts` |
| Session cookie | `sb-access-token`, HttpOnly, SameSite=Lax, 1 h default / 24 h cap | `lib/auth-session-cookie.ts:17-20` |
| Address + fence | Step 1 of 3 captures address client-side; fence enforced server-side at submit (waitlist for out-of-city/region, 422 for pilot gate) | `components/customer/BookingFlow.tsx:109`, `app/api/customer/bookings/route.ts:246-322`, `lib/service-area-guard.ts:15-27` |
| Attribution | `JobRequest.source`, `WorkflowEvent.source`, `ServiceAreaWaitlist.source` are strings with 2–3-way ternaries in code; `Customer.channel` PWA/WHATSAPP/BOTH; UTM/click ids on JobRequest | `lib/job-requests/create-job-request.ts:503,623`, `lib/customer-address-book.ts:128,242`, `lib/service-area-guard.ts:117` |
| Payments | Single global PSP from `PSP_PROVIDER` (peach or payat_go); `PAYMENT_COLLECTION_MODE` defaults to bypass; generic webhook delegates to the global provider | `lib/payments.ts:70-311`, `app/api/webhooks/payments/route.ts` |
| Security headers | CSP `script-src`/`connect-src` exclude VodaPay hosts; `frame-ancestors 'none'`; desktop-UA interstitial in proxy | `next.config.ts:23-56`, `proxy.ts:172-176`, `lib/admin-desktop-policy.ts:68` |
| Legal pages | `/privacy` ✓; refunds only as `/terms#refunds` (`/refund-policy` 301s); no service-fulfilment policy; `/contact` has no email/phone as text; in-app legal viewer iframes marketing, which marketing's frame headers block | `marketing/app/(marketing)/terms/page.tsx:367`, `marketing/next.config.ts:13,56-61`, `components/client/legal-screens.tsx:70` |
| Identity assets | Kgolaentle Solutions (Pty) Ltd, reg 2014/077326/07, +27 69 355 2447, support@/privacy@/legal@ — published. VAT, address, legal representative — not in repo | `marketing/lib/metadata.ts:6-7`, `Footer.tsx:52-54` |
| Flags | `isEnabled(key, ctx?)`; every key registered in `lib/feature-flags-registry.ts` | `lib/flags.ts:169` |
| Events | `recordWorkflowEvent()`; `eventType` is a Prisma enum, `source` is a free string; PII guard on metadata | `lib/workflow-events/record.ts:127` |

## 4. Design

### W0 — Application pack (non-code)

Deliverable: `docs/ops/marketplace-onboarding/` containing
- `identity-pack.md` — legal entity, CIPC number, VAT number, registered and physical address, legal representative, MCC business scope (proposed: 7349 "Cleaning, maintenance and janitorial services" or 1799 "Special trade contractors" — Vodacom to confirm), support contacts, website URLs, settlement bank account (reference only, never the number), app screenshots.
- `vodapay-application.md` — the partner-form answers, the 11 open questions to ask Vodacom, the sandbox tester roster (name, email, Apple ID/Gmail, device), and the QA checklist mapping (§7).
- `fnb-nav-listing.md` — profile copy (services, areas, images), address-gated first message script, and the open questions for FNB (commission, aggregator policy, Peach/Pay@ links in chat).
- `capitec-pay.md` — steps to enable Capitec Pay in the Peach dashboard and verify with a R1 test.

Inputs required from Shimane before submission: VAT number, address, legal representative name, confirmation of an FNB business account (or the decision to open one), preferred settlement account.

### W1 — Website compliance (marketing app)

1. `/refund-policy` becomes a real page: move §27 content into `app/(marketing)/refund-policy/page.tsx`, keep `/terms#refunds` as a short pointer, remove the 301 in `marketing/next.config.ts`.
2. New `/service-policy` page ("How service delivery works"): service area (JHB West / Roodepoort, waitlist elsewhere), response and arrival windows, rescheduling and no-show rules, what a completed job means, dispute window. Content drawn from existing Terms §§ on scheduling, cancellations and disputes; no new commercial terms.
3. `/contact` renders `support@plugapro.co.za` and `+27 69 355 2447` as text alongside the form and WhatsApp button.
4. Footer adds VAT number and registered address once supplied (props on the existing footer; renders nothing until set).
5. In-app legal viewer: replace the iframe in `components/client/legal-screens.tsx` with an external-link card per page. Marketing frame headers stay `DENY`.

### W2 — WebView unblock (field-service app)

1. CSP in `next.config.ts`: add `https://cdn.marmot-cloud.com` to `script-src`; add the VodaPay open-API gateway host(s) to `connect-src` (values from env at build time via `VODAPAY_CSP_HOSTS`, so sandbox and prod differ without a code change). `frame-ancestors 'none'` stays — a WebView is not a frame.
2. Proxy desktop interstitial: `isDesktopBrowserUserAgent()` gains an explicit allow for user agents containing `MiniProgram` or `AlipayClient`/`VodaPay`, and the `/vodapay` path is exempt from the interstitial outright.
3. `app/robots.ts`: allow `/vodapay` only (reviewers fetch the Entrance URL); everything else stays disallowed.
4. Session cookie: no SameSite change. Cashier return is handled by the bridge callback, not a cross-site POST (see W5).

### W3 — Runtime mode + attribution

Flag `channel.vodapay.v1` (registry, owner eng, default false).

- **Entry route** `app/(customer)/vodapay/page.tsx` — the Entrance URL. Server: if flag off → 404. Client bootstrap: load `hylid-bridge` (script tag, only on this route tree), detect `(/MiniProgram/.test(navigator.userAgent) || typeof window.my?.getAuthCode === 'function')`, then `POST /api/channel` which sets `pap_channel=vodapay` (HttpOnly, Lax, 30 d). Redirect to `/` in VodaPay mode.
- **Channel resolver** `lib/channel.ts`: `getRequestChannel()` reads the cookie → `'vodapay' | 'web'`. Available to Server Components and routes.
- **VodaPay mode UI**: customer home and booking flow read the channel and (a) hide WhatsApp CTAs, (b) keep address as step 1 and prefill via `my.getLocation` → existing `/api/customer/location-reverse`, (c) show the "Not in your area yet" waitlist screen with VodaPay-specific copy.
- **Attribution**: widen the unions to `'whatsapp' | 'pwa' | 'vodapay' | 'merged'` in `create-job-request.ts:503,623`, `customer-address-book.ts:128,242`, `service-area-guard.ts:117` (waitlist source), and pass `source: 'vodapay'` from the bookings route when the channel cookie says so. `Customer.channel` is unchanged (VodaPay customers are `PWA` at the customer level; the request-level source carries the marketplace). `WorkflowEvent.source = 'vodapay'` on REQUEST_STARTED/REQUEST_SUBMITTED. Funnel aggregate groups by source, so the admin funnel report shows a VodaPay column with no new event types.
- **Out-of-fence telemetry**: waitlist rows with `source='vodapay'` are the marketplace out-of-fence measure; the weekly acquisition snapshot script gains one count.

### W4 — Federated login

Flag reuse: gated by `channel.vodapay.v1` (no separate flag; login without runtime mode is meaningless).

Flow
1. Client (VodaPay mode, at the point inline OTP would open): `my.getAuthCode({ scopes: ['auth_user'] })` → `authCode`.
2. `POST /api/auth/vodapay { authCode }` (public path in proxy, rate-limited like OTP).
3. Server `lib/vodapay/auth.ts`: `applyToken(authCode)` → access token + `userId`; `inquiryUserInfo(accessToken)` → mobile number (E.164 normalised with the existing phone util) + name.
4. `lib/vodapay/identity.ts`: find `CustomerExternalIdentity(provider='VODAPAY', externalId=userId)` → Customer. Else find Customer by phone (reuse `resolveCustomerForSession` semantics) → link. Else create Customer `{ phone, name, channel: 'PWA' }` and link. Store the VodaPay access/refresh token encrypted in the identity row for later refund/inquiry calls.
5. Mint a Supabase session: ensure a Supabase user exists for the phone (`auth.admin.createUser({ phone, phone_confirm: true })` if missing, mirroring `provider-approval-auth-user.ts:78`), then `auth.admin.generateLink({ type: 'magiclink', ... })` → `verifyOtp({ token_hash, type: 'magiclink' })` server-side → session access token → set `sb-access-token` via `lib/auth-session-cookie.ts` (same path as `POST /api/auth/session`). `Customer.userId` linked via existing `linkCustomerAccount`.
6. Client continues the booking submit exactly as after OTP.

Fallback: if the bridge is absent or `getAuthCode` fails, the existing inline OTP dialog runs. `nextActionForAuthFailure()` gains a `'vodapay'` branch that returns `'open_vodapay'` before `'open_dialog'`.

Schema (additive)
```prisma
model CustomerExternalIdentity {
  id          String   @id @default(cuid())
  customerId  String
  provider    String   // 'VODAPAY'
  externalId  String   // VodaPay userId
  tokenCipher String?  // AES-GCM envelope, key VODAPAY_TOKEN_KEY
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  customer    Customer @relation(fields: [customerId], references: [id])
  @@unique([provider, externalId])
  @@index([customerId])
}
```

### W5 — Cashier payments

Flag `payments.vodapay.v1` (registry, owner eng, default false).

- **Signing** `lib/vodapay/signing.ts`: RSA-SHA256 over `METHOD PATH\nCLIENT_ID.REQUEST_TIME.BODY` per the VodaPay self-service docs; `sign(request)` with `VODAPAY_PRIVATE_KEY`, `verify(notifyHeaders, body)` with `VODAPAY_PLATFORM_PUBLIC_KEY`. Pure functions, fully unit-tested with a generated test key pair.
- **Client** `lib/vodapay/client.ts`: `applyToken`, `inquiryUserInfo`, `pay`, `inquiryPayment`, `refund` — thin fetch wrappers over `VODAPAY_API_BASE` with signing and typed responses. Refund shape follows the Alipay+ spec; flagged as sandbox-verify.
- **Provider** `lib/payments/providers/vodapay.ts` implementing `PspProvider`: `createCheckout` → `pay` (`CASHIER_PAYMENT`, ZAR cents, `paymentRequestId = payment.id`, notify `/api/webhooks/vodapay`, redirect `/bookings/[id]?paid=1`, 30 min expiry) returning `{ checkoutUrl: redirectActionForm.redirectUrl, checkoutId: paymentId }`; `verifyWebhook` → signing.verify; `parseWebhookEvent` → `{ paymentId, status: SUCCESS|FAIL, amountCents, paidAt }`; `createRefund` → `refund`.
- **Per-channel resolver** `lib/payments.ts`: `resolvePspProviderFor({ jobRequestSource })` returns `'vodapay'` when source is `vodapay` and the flag is on, else the global provider. `initializeBookingPayment` uses it and forces `collectionMode: 'checkout'` for `vodapay` regardless of `PAYMENT_COLLECTION_MODE`. `getProvider()` gains the `'vodapay'` case.
- **Webhook** `app/api/webhooks/vodapay/route.ts` (public in proxy): verify → parse → reuse the existing amount + idempotency guards from the generic route (extracted into `lib/payments/webhook-guards.ts` so both routes share them) → update Payment → ack `{ result: { resultCode: 'SUCCESS', resultStatus: 'S' } }`. Fail-closed on missing keys.
- **Client checkout**: in VodaPay mode the "Pay" action calls `my.tradePay({ paymentUrl })`; on `resultCode === '9000'` it polls `/api/payments/[id]` until the webhook lands (or 60 s), then shows paid state. Outside VodaPay mode nothing changes.
- **Admin**: Payments list shows `pspProvider = vodapay`; refund button routes through `createRefund` like Peach.

Env (Vercel, set with printf): `VODAPAY_CLIENT_ID`, `VODAPAY_MERCHANT_ID`, `VODAPAY_MINI_PROGRAM_APP_ID`, `VODAPAY_API_BASE`, `VODAPAY_PRIVATE_KEY`, `VODAPAY_PLATFORM_PUBLIC_KEY`, `VODAPAY_TOKEN_KEY`, `VODAPAY_CSP_HOSTS`.

## 5. Flags and rollout

| Flag | Gates | Flip when |
|---|---|---|
| `channel.vodapay.v1` | `/vodapay` entry, runtime mode, federated login | Workspace approved; sandbox tester devices enrolled |
| `payments.vodapay.v1` | VodaPay PSP selection + webhook processing | Sandbox cashier passes end-to-end; commission accepted |

Both default false in registry and DB. Production stays unchanged until flipped. Kill switch = flip off; existing payments in flight still process via the webhook route (it checks the Payment's `pspProvider`, not the flag).

## 6. Testing

- Unit (Vitest): signing sign/verify round-trip and tamper cases; provider `createCheckout`/`parseWebhookEvent` against fixture JSON from the self-service docs; PSP resolver matrix (source × flag × env); identity link/create/collision cases; UA detection; `nextActionForAuthFailure` new branch; channel cookie parsing.
- Contract: recorded sandbox responses become fixtures once credentials exist (`__tests__/fixtures/vodapay/`).
- Playwright smoke (`e2e/smoke.spec.ts` extension): `/vodapay` with an injected `window.my` stub covering entry → address → login → checkout → paid; runs with flags on in the smoke env only.
- Manual sandbox QA (VodaPay Tue/Thu): checklist in `docs/ops/marketplace-onboarding/vodapay-application.md` mapping each VodaPay QA item (auth positive/negative, full journey, all tenders, after-sales comms, MSISDN validation, no crashes) to a Plug A Pro test.

## 7. Sequencing and PRs

Each workstream is one PR from a worktree off `origin/main`; smoke coverage extended per house rule; additive migration only in W4.

1. W0 + W1 (gate the application; no app risk)
2. W2 + W3 (one PR: headers, proxy, entry route, channel, attribution)
3. W4 (identity table + login)
4. W5 (signing, client, provider, resolver, webhook, checkout UI)
5. Sandbox QA + flag flips (after workspace approval)

## 8. Risks and unknowns

- PWA-type acceptance for public release and the refund API shape are unconfirmed until sandbox; W5's refund path is built to the Alipay+ spec and marked verify-in-sandbox.
- VodaPay's WebView user agent may not carry the `MiniProgram` marker; detection also accepts bridge presence.
- `getAuthCode` requires a physical device in sandbox; CI covers it only via the stub.
- Commission unknown; nothing in this design changes pricing. If Vodacom's terms are rejected, the flags stay off and the code is inert.
- National discovery vs jhb_west: addressed by address-first plus waitlist telemetry, not by expansion.

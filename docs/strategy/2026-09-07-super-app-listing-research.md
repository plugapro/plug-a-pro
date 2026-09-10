# Hosting Plug A Pro inside SA super apps and listing platforms — research (2026-09-07)

**Question:** Platforms like VodaPay let service providers list their services. What is required to host Plug A Pro on those platforms?

**Scope checked:** VodaPay (Vodacom), Nedbank Avo, Standard Bank LookSee, FNB nav», Capitec, Discovery Bank, Absa, TymeBank, Bank Zero, MTN MoMo, MTN Chenosis, Ayoba, Telkom Yep!, Rain, Cell C, Google Business Profile / Local Services Ads, Gumtree, Bolt/Uber, Takealot/Superbalist, Sixty60 / PnP asap!. Snupit, Kandua and ProCompare are competitors, not hosts, and were not deep-dived.

**Method:** three parallel research passes (VodaPay; bank super apps; telco + SME platforms) reading the live developer/partner pages, T&Cs and 2025–26 news. Every claim below is tied to a URL in the Sources section. "Not published" means exactly that — no number was invented.

---

## TL;DR

1. **Only one platform can host the existing Plug A Pro web app as-is: VodaPay, via its "PWA (HTML5)" mini-program type.** It loads plugapro.co.za in VodaPay's WebView from an Entrance URL with no rebuild — but VodaPay login (OAuth) and VodaPay cashier payment are mandatory integrations, and the commission is not published.
2. **Three other platforms will list Plug A Pro as a business profile, not host the app:** FNB nav» Marketplace (free, needs an FNB business account), Telkom Yep! (free plan, 15% commission, PayFast mandatory) and Standard Bank LookSee via Whizzoh (10% fee, R3m insurance, their app only).
3. **Everything else is a dead end for services listing:** Nedbank Avo's services vertical is gone (partner app delisted), Ayoba shut down in March 2026, MTN MoMo SA has no third-party mini-apps yet (Ant platform is Nigeria-first, Q3 2026), Capitec/Discovery/Absa/TymeBank/Bank Zero have no route, Google Local Services Ads is not offered in South Africa.
4. **No platform publishes a marketplace/aggregator track.** All of them onboard *individual businesses*. Plug A Pro would enter as one business that dispatches its own vetted providers; whether that is allowed is unstated everywhere except Whizzoh (whose T&Cs contemplate employees/agents).
5. **Every route forces its own payment rail** (VodaPay cashier, FNB in-app pay, PayFast for Yep!, Whizzoh's app). Each bypasses Peach/Pay@ and the ratings → dispute → payout loop that the platform depends on. That, plus the national-discovery vs jhb_west-matching mismatch, is the real cost — not the paperwork.

**Recommendation:** do not build for any platform yet. Run two zero-engineering probes (VodaPay partner form to get the commission and discovery model; FNB nav» listing if an FNB business account exists), and switch on Capitec Pay through the existing Peach account as a pure payment win. Details in §6.

---

## 1. Routes ranked

| # | Platform / route | Hosts the app? | What you get | Hard requirements | Fees (published) | Status 2025–26 | Verdict |
|---|---|---|---|---|---|---|---|
| 1 | **VodaPay Mini Program — PWA (HTML5) type** | **Yes** (Entrance URL in WebView + JS bridge) | Sub-app inside VodaPay; zero-rated for Vodacom customers; VodaPay identity (incl. phone number) and wallet/card/coupon cashier; deep links from WhatsApp | Developer workspace (MCC business scope, registered address, legal rep; 5 business days), Merchant-ID + Client-ID, Alipay Singapore T&Cs, mandatory OAuth login + cashier payment, RSA-256 signing, domain whitelists, physical-device sandbox testing, QA Tue/Thu | **Not published** ("flat fee or a percentage commission on each transaction"; merchant pays build). Gateway (own-site acquiring) capped at 3.5% | Alive: app v3.10.0 (24 Aug 2026), 184k ratings 4.7★. Vodacom stopped publishing user numbers after FY24 (5.8m registered); Vodafone H1 FY26 says 14.1m, inflated by the MyVodacom merger | Technically cheap, commercially opaque, strategically marginal. Talk first, build later |
| 2 | **FNB nav» Marketplace / Home Services** | No (business profile + chat + in-app payment) | Free self-serve listing to FNB app users; plumbers are FNB's headline example | Active **FNB business banking profile**; in-app registration (business banking → nav-igate life → Home Services); logo/images/services/location | "Free" to list; commission on in-app payment **not published** | Live (rewards from 1 Dec 2025 referenced) | The one realistic bank-native listing; treat as free lead capture |
| 3 | **Telkom Yep!** (mall.yep.co.za) | No (storefront + quote requests in their Merchant Center) | Storefront, quote/booking flow, customer deposit, after-sales refunds | Account (email, +27 mobile, OTP), team approval, **own PayFast account**, Merchant T&Cs | Free plan + premium tiers (prices unpublished); **15% commission per transaction**; Telkom add-ons R330–R1,730 pm | Relaunched (FAQ 9 Mar 2026; app updated 1 Jul 2026). Thin consumer traction (233 Play reviews; featured providers show 0.0 ratings) | Cheap lead-capture listing at most; also a direct competitor |
| 4 | **Standard Bank LookSee → Whizzoh** | No (register as a service-provider company in Whizzoh's Partner app) | Jobs from LookSee/insurer demand, dispatched by Whizzoh | CIPC docs, director ID, **comprehensive insurance ≥ R3m**, OHS docs, bank confirmation letter, trade certificates, procurement vetting + training, rates capped at Whizzoh-agreed rates, **no off-app payment**, 50 km radius | **10%** transaction fee on rate and extras (min R50); T&Cs also define a **20% "Settlement Discount"** — conflict flagged; payout 3 business days after ≥3★ rating | LookSee active (solar, SANEDI May 2025); Whizzoh Partner app 500+ installs, 9 reviews (weak volume) | Feeding a competitor's dispatch network; only as a supply-saturation experiment |
| 5 | Nedbank Avo | No | — | — | — | Services vertical dead: Avo Business app delisted, avobusiness.africa redirects; Avo lives on as goods/auto/travel | Dead end (only wedge: sell an "inspection voucher" SKU via workwithus@avo.africa) |
| 6 | MTN MoMo SA | No (payments only today) | MoMo Pay QR/payment request at 0.5%; Open API collections | Merchant: 083 135 / momo@mtn.com, no paperwork | 0.5% per MoMo Pay txn | Ant International mini-app platform announced 9 Jun 2026, **Nigeria first Q3 2026, SA unscheduled** | Watch for 2027; payments-only now |
| 7 | Capitec | No (payments only) | Capitec Pay via TPPP; Pay@ "Pay Bills" biller name | Existing Peach / Pay@ relationships | Peach: 1.50% + R1.50 per Capitec Pay txn | Live | Cheap payment win, zero acquisition value |
| 8 | Ayoba (MTN) | Was yes (H5 microapps) | — | — | — | **Shut down 20 Mar 2026**; developer portal DNS dead | Gone — it was the only SA super app that embedded PWAs |
| 9 | Google Business Profile | Partial (profile only) | Local search presence | Must make in-person contact; **"lead generation agents or companies" ineligible** | Free | Live; Local Services Ads **not available in SA** | Keep as service-area business; profile must read as the service company, not a marketplace |
| 10 | Gumtree Services | Partial (free classifieds) | Free ads in Building & Trades (2,749 ads live) | — | Free; R99/listing for clickable URL; business packages "do not support service providers" | Live | Low-cost lead capture only |
| — | Discovery Bank, Absa, TymeBank, Bank Zero, Chenosis, Rain, Cell C, Bolt, Uber, Takealot, Superbalist, Sixty60, PnP asap! | No | — | — | — | — | No third-party services route |

---

## 2. VodaPay in detail (the only true "host" option)

### 2.1 Three ways in
| Route | What it is | Rebuild needed? |
|---|---|---|
| Native Mini Program | AXML/ACSS/JS app built in Mini Program Studio (Ant/Alipay framework, white-labelled; console loads from cdn.marmot-cloud.com; T&Cs are Alipay Singapore's, dated 2019–2020) | Full front-end rebuild |
| **PWA (HTML5) Mini Program** | Your HTTPS web app loaded via an "Entrance URL"; "The IDE is not required"; no package build; "the step of mini program quality review is not supported" | **No** — add the `hylid-bridge` script, detect `/MiniProgram/` in the user agent, call `my.*` for login/pay |
| Native shell + `<web-view>` | Thin native app with one full-page web-view per page carrying the H5; `my.postMessage`/`my.onMessage` bridge | Thin shell only |
| "Services Partner" / SMME portal | A lead-capture web form that starts the same mini-program conversation ("Apply → Simple Build → Test & Release") | — |
| VodaPay Gateway | Card / Ozow EFT / QR acquiring for your own website. Nothing inside the super app | — |

### 2.2 Requirements checklist
**Business / legal**
- [ ] Developer account → workspace application: workspace name, business scope (MCC codes), business address, representative contact. Platform takes 5 business days to provision the workspace and a customised Mini Program Studio.
- [ ] Workspace record: company registration address, legal representative name, verified/unverified status. **CIPC mandatory vs sole prop accepted: not published.**
- [ ] Accept Alipay Singapore's platform T&Cs (they may verify company officers/shareholders and suspend access if they cannot).
- [ ] Merchant-ID + Client-ID issued on onboarding (needed for login and payment). Vetting behind it is undocumented for mini programs; the Gateway's published vetting is the closest proxy: ID book/smart card, bank statement or confirmation letter, selfie, SA-located business, website URL, monthly turnover, settlement bank details; website must show refund/cancellation, delivery and privacy policies plus a support contact.
- [ ] Partner form fields: business name, nature of business (17 categories), product offering, contact, app URL, website URL.

**Technical (mandatory)**
- [ ] Login: `my.getAuthCode` → `POST /v2/authorizations/applyToken` (scopes `auth_base`/`USER_ID`, `auth_user`, `NOTIFICATION_INBOX`, `NOTIFICATION_PUSH`). Access token "can last up to 10 years". `inquiryUserInfo` returns name and **mobile number in clear** (KYC-verified status not stated).
- [ ] Payment: `POST /v2/payments/pay` (`CASHIER_PAYMENT` only, ZAR cents, notify + redirect URLs, expiry) → `my.tradePay({paymentUrl})` → webhook to `paymentNotifyUrl` ~2 minutes later. Tenders: wallet, linked card, coupons. **Refunds, recurring and payment-inquiry APIs are not publicly documented.**
- [ ] RSA-256 request signing; production requires your own key pair with the public key shared to VodaPay.
- [ ] Server whitelist + H5 domain whitelist for every domain the PWA touches (Supabase, Vercel Blob, analytics, fonts, `cdn.marmot-cloud.com`).
- [ ] Sandbox: Android `za.co.vodacom.vodapay.dev`, iOS TestFlight; testers supply name/email/Apple ID or Gmail/device; test OTP 88888; wallet top-ups via miniprogramsupport@vodacom.co.za. `getAuthCode` does not work in the simulator — physical devices only.
- [ ] Release: Apply to Release → QA (Tuesdays/Thursdays, submit before cut-off) → Final Release. QA rejects on any critical/high issue and requires the full sunny-day journey, positive and negative VodaPay authorisation, payment with all tenders (card, stored value, coupons), after-sales communication, MSISDN validation.
- [ ] Constraints for the PWA type: only a subset of `my.*` APIs; single WebView; no `pushWindow`; HTTPS everywhere.

**Commercial**
- Mini-program commission: "flat fee or a percentage commission on each transaction" — **rate not published**. Merchant bears build cost; "Vodacom provides technical support".
- Gateway (for reference): capped at 3.5%, free activation, next-business-day settlement.
- Zero-rating applies to Vodacom customers only.
- End-to-end lead time: not published (Vodacom's 2021 case studies say "record time" with no figure).

### 2.3 What Plug A Pro would have to build
1. **VodaPay runtime mode** in the customer PWA: load `hylid-bridge`, detect the mini-program UA, hide WhatsApp-only affordances, route login and payment through the bridge.
2. **VodaPay OAuth → Customer mapping**: `applyToken` → `inquiryUserInfo` → map `userId` (+ phone) onto the Supabase `Customer`; replaces inline OTP inside VodaPay. Needs RSA key management and request signing.
3. **VodaPay cashier as a fourth PSP** in `field-service/lib/payments.ts` (the `Payment` model already carries `pspProvider`/`pspReference`/`checkoutUrl`/`metadata`). Pay@ RTP and Peach links likely cannot be used inside the mini program if QA insists on VodaPay tenders.
4. Domain whitelisting and sandbox testers with physical devices.

Reusable untouched: server-side job/quote/booking logic, Prisma models, WorkflowEvents, admin, provider PWA (which has no reason to live in VodaPay).

### 2.4 Blockers
- **Economics unknown** until Vodacom quotes; expect at least card-rate given the 3.5% Gateway cap.
- **Channel mismatch**: the funnel is WhatsApp-first; VodaPay's value is in-app discovery. How mini programs are surfaced/ranked is not published, and no home-services mini program exists (all named partners are retail, food, travel, media; MyBroadband in 2022: "uptake … has been slow").
- **Geo fence**: national discovery vs jhb_west matching will generate out-of-fence demand unless the mini program gates by address at the first screen (same lesson as the provider-ad geo finding of 2026-08-03).
- **Undocumented essentials**: refunds/disputes and the push/inbox send API — core to a marketplace — have no public docs.
- **Platform dependency**: contract terms are Alipay Singapore's; Vodacom's own disclosures have gone quiet on VodaPay since FY24. Not a shutdown signal, but a "don't build the business on it" signal.

---

## 3. The listing-only platforms

### 3.1 FNB nav» Marketplace / Home Services
- **Route:** self-serve inside the FNB Business app; "plumber, accountant, graphic designer, car maintenance provider" named as examples.
- **Requirements:** active FNB business banking profile (the hard gate) → business banking → nav-igate life → Home Services → accept terms → guided profile (logo, images, services, location). Operate customer chat, quotes and in-app payment inside the FNB app; be rated/reviewed.
- **Not published:** CIPC/tax/insurance vetting beyond the bank account, commission on in-app payment, aggregator policy, any API or webhook.
- **Fit:** free and live; the cost is a second inbox (FNB chat) and a second payment rail invisible to the booking/dispute/ratings pipeline. List as "Plug A Pro" the business and route jobs to providers; expect to be treated as one SME profile.
- **Contact:** marketplace@fnb.co.za / 087 730 5790.

### 3.2 Telkom Yep! (mall.yep.co.za)
- **Route:** self-serve registration (username, email, +27 mobile, OTP, Merchant T&Cs) → team review → storefront with service list, quote requests, bookings, customer deposit (free cancellation >24h; 25% deposit fee <24h), built-in refund requests.
- **Requirements:** own PayFast account ("Yep! does not handle the money directly"); "verification and background checks where possible"; verified documents improve ranking; premium badge on paid tier.
- **Fees:** 15% commission per successful transaction; premium plan prices not published; optional Telkom add-ons (YepSync R469, Reputation R335, Social R330, Web R525–R1,085, Banners R440, Google Ads R1,730, Facebook Ads R1,150, Conversation AI R985, Campaign Pro R400, Local SEO free).
- **Fit:** it will not embed the PWA; economics stack badly (15% on top of the platform take, PayFast rail); consumer traction thin; homepage categories are Plug A Pro's categories. Free plan as lead capture only.
- **Open:** whether an aggregator may list and subcontract; whether fulfilment off-platform breaches T&Cs; commission on deposit or full job value.

### 3.3 Standard Bank LookSee → Whizzoh (Pty) Ltd
- **Route:** LookSee's home-maintenance portal is white-labelled Whizzoh; LookSee "oversees quality", Whizzoh "responsible for the service offerings". Register on Whizzoh's Partner portal/app as a service-provider company.
- **Requirements:** CIPC registration document, director/owner ID, insurance and liability cover (comprehensive insurance ≥ R3,000,000 with a registered insurer, proof on demand), OHS documentation, bank confirmation letter, trade certification/licences per service type, procurement vetting + platform training, 50 km operating radius, unlimited staff/vehicles can be added.
- **Commercials:** 10% Standard Transaction Fee on the agreed rate and on all extras including materials (min R50); T&Cs separately define a 20% "Settlement Discount" (applicability to LookSee jobs unclear — conflict flagged); rates capped at Whizzoh-agreed rates; no off-app payment; payout within 3 business days after a ≥3★ rating; 1–2★ jobs can forfeit the fee; 48-hour complaint response.
- **Solar sub-route:** 4-Sure panel (CIPC, VAT, SARS, BBBEE, public liability, director IDs, tax cert, vehicle/office/uniform photos); opportunity-driven, not open enrolment.
- **Fit:** technically possible (T&Cs contemplate employees/agents/consultants), economically poor, and it feeds a competitor's dispatch network with Plug A Pro holding the R3m cover. Volume signal is weak.
- **Contact:** info@whizzoh.co.za / 0861 944 996; spsupport@4-sure.net (solar).

### 3.4 Payment-only wins (no listing, low effort)
- **Capitec Pay via Peach Payments** — already on Peach; 1.50% + R1.50 per transaction. Native pay path for Capitec-banked customers and providers.
- **Pay@ "Pay Bills" biller name in the Capitec app** — via the existing Pay@ relationship; onboarding criteria and fees not published.
- **MTN MoMo Pay** — QR/payment request, 0.5% per transaction, "no paperwork, no registration fee"; only if the customer base overlaps MoMo's informal/unbanked target (513k MAU in SA at Sep 2024).

---

## 4. Common document pack (what every route asks for, union)
| Item | VodaPay | FNB nav» | Yep! | Whizzoh |
|---|---|---|---|---|
| CIPC registration docs / number | implied (registration address, legal rep); mandatory not stated | not stated (FNB account KYC covers it) | not stated | **yes** |
| Director / owner SA ID | Gateway proxy: yes | via FNB KYC | not stated | **yes** |
| Bank confirmation letter / statement | Gateway proxy: yes | FNB account itself | PayFast account | **yes** |
| SARS / tax | not stated | via FNB KYC | not stated | 4-Sure solar only |
| Insurance (public liability) | not stated | not stated | not stated | **≥ R3m comprehensive** |
| Trade certificates / licences | not stated | not stated | "verified documents" improve ranking | **yes, per trade** |
| OHS documentation | — | — | — | **yes** |
| Website policies (refund, privacy, support contact) | Gateway: **yes** before production | — | — | — |
| Platform-specific account | Developer workspace + Merchant-ID/Client-ID | FNB business banking profile | Yep! merchant + **PayFast** | Whizzoh SUPPLY CHAIN + Partner app |
| Contract | Alipay Singapore T&Cs + Vodacom commercial (unpublished) | FNB terms of use | Yep! Merchant T&Cs | Whizzoh SP T&Cs (20 Aug 2024) |

Plug A Pro already holds CIPC, ID, bank and tax documents; the only genuinely new items are the R3m insurance (Whizzoh only), a PayFast account (Yep! only), an FNB business account (FNB only), and the VodaPay developer workspace + RSA keys.

---

## 5. Cross-cutting constraints
1. **Aggregator status is unaddressed everywhere.** All routes onboard individual businesses. Plug A Pro enters as one business subcontracting to its providers; only Whizzoh's T&Cs explicitly allow agents/consultants. Ask each platform before listing.
2. **Payment rails conflict.** VodaPay cashier, FNB in-app pay, PayFast (Yep!) and Whizzoh's app each bypass Peach/Pay@ and therefore the ratings → dispute → payout loop, the Pay@ reliability work in PR #203, and funnel observability.
3. **Second inboxes.** FNB chat, Yep! Merchant Center and Whizzoh's app each become an ops surface outside WhatsApp and the admin.
4. **Geo mismatch.** Every platform is national; matching is jhb_west. Address gating must be the first screen on any listing or out-of-fence demand will dominate (the 2026-08-03 provider-ad finding applies to demand too).
5. **Google Business Profile risk.** "Lead generation agents or companies" are ineligible; the profile must present as the service company with real premises.

---

## 6. Recommendation and next actions
**Do not build for any platform now.** The only technically cheap host (VodaPay PWA type) has unpublished economics, undocumented refunds/push, and a discovery model nobody outside Vodacom can describe.

Zero-engineering probes, in order:
1. **VodaPay partner form** (vodapay.vodacom.co.za/vodapay/become-a-partner) with the open questions in §7.1 — the goal is the commission number, confirmation that a PWA-type mini program is accepted for public release, and the discovery/ranking model. Owner: Shimane. No commitment implied by the form.
2. **FNB nav» Home Services listing** — if Plug A Pro banks with FNB (or opening a business account is acceptable), register the free profile as a lead-capture channel; address-gate the first message. Owner: Shimane / ops.
3. **Capitec Pay via Peach** — enable in the Peach dashboard; a pure payment-completion win for Capitec-banked customers. Owner: engineering (config only; no code if Peach exposes it as a method).
4. Optional: **Yep! free plan** and **Gumtree Building & Trades ads** as lead capture, both routed into dispatch; measure before spending.

Watch list: MTN MoMo SA mini-app platform (Ant-built, Nigeria first Q3 2026); MTN's unnamed "unified digital platform" replacing Ayoba; Cell C Home Assist supplier (a B2B contractor-network contract, not a listing).

Not worth pursuing: Whizzoh/LookSee (competitor dispatch, R3m cover, 10–30% stack), Nedbank Avo (services dead), Discovery/Absa/TymeBank/Bank Zero (no route), Google LSA (not in SA).

---

## 7. Open questions only the platforms can answer

### 7.1 Vodacom / VodaPay
1. Commission or flat fee per transaction inside a mini program; settlement terms and bank account.
2. Is a PWA (HTML5) mini program accepted for public release, or does QA require Native? Does "quality review not supported" mean skipped or blocked?
3. Legal entity: CIPC mandatory? sole prop accepted? FICA documents for the Merchant-ID?
4. Can Peach / Pay@ be used for payment inside the mini program, or VodaPay cashier only?
5. Refund, partial refund and payment-inquiry APIs for mini programs.
6. The send API behind `NOTIFICATION_PUSH` / `NOTIFICATION_INBOX`, rate limits, template approval.
7. Is the phone number from `inquiryUserInfo` KYC-verified?
8. Discovery/ranking inside the consumer app; services category; can a mini program be geo-restricted to Gauteng/Johannesburg?
9. Current SA MAU and mini-program count (last: 5.8m registered FY24; "over 100 mini-apps" May 2023).
10. End-to-end lead time and the SMME mini-program onboarding owner (only address found: miniprogramsupport@vodacom.co.za).
11. Contract counterparty: Vodacom Financial Services, Alipay Singapore, or both?

### 7.2 FNB
Commission on in-app payments; aggregator/subcontracting policy; whether Peach/Pay@ links are permitted in chat; any partner API; provider count and Home Services usage; vetting beyond the business account.

### 7.3 Telkom Yep!
Aggregator policy; commission on deposit vs full job value; off-platform fulfilment; premium prices; "150K registered merchants" active vs cumulative.

### 7.4 Whizzoh / LookSee
Does the 20% Settlement Discount apply on LookSee jobs on top of the 10% STF? Marketplace dispatch under one SP account allowed? Per-trade minimum requirements; monthly job volume in jhb_west; any Standard Bank listing that bypasses Whizzoh.

### 7.5 MTN
Will the Ant mini-app platform reach SA, when, on what tech and rev share; SA MoMo Open API production fees; name/date of the post-Ayoba platform.

---

## Sources

### VodaPay
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/platform/miniprogramtype
- https://developer.vodapay.vodacom.co.za/self-service/docs/Integration%20Steps/integrationSteps
- https://developer.vodapay.vodacom.co.za/self-service/docs/QA%20test%20process/Quality%20Assurance
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/platform/workflow-procedures
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/platform/workspace
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/about/readme
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/mpdev/component_open_web-view
- https://developer.vodapay.vodacom.co.za/docs/miniprogram_vodacom/mpdev/v1_deeplink?pageVersion=2
- https://developer.vodapay.vodacom.co.za/self-service/docs/Login%20Flow/getAuthCode
- https://developer.vodapay.vodacom.co.za/self-service/docs/Login%20Flow/getAccessToken
- https://developer.vodapay.vodacom.co.za/self-service/docs/Login%20Flow/getUserInfo
- https://developer.vodapay.vodacom.co.za/self-service/docs/Payment%20Flow/Once%20Off%20Payments
- https://vodapay.vodacom.co.za/vodapay/become-a-partner
- https://vodapay.vodacom.co.za/vodapay/personal/faq
- https://docs.vodapaygateway.vodacom.co.za/
- https://www.vodacombusiness.co.za/business/solutions/financial-services/e-commerce
- https://www.vodacombusiness.co.za/business/solutions/ecommerce/resource-center
- https://miniprogram.alipay.com/docs-alipayconnect/miniprogram_alipayconnect/platform/transform-html5
- https://miniprogram.alipay.com/docs-alipayconnect/miniprogram_alipayconnect/solutions/develop
- https://gw.alipayobjects.com/os/basement_prod/95eb129b-c7bd-4b17-a3e3-786f14bf63b3.pdf (Alipay International platform T&Cs)
- https://www.vodacom.com/news-article.php?articleID=14025 (FY24: 10.4m downloads / 5.8m registered)
- https://investors.vodafone.com/~/media/Files/V/Vodafone-IR/documents/performance/financial-results/2026/vodafone-h1-fy26-results-announcement.pdf
- https://www.vodacom.com/pdf/investor/quarterly-results/2026/vodacom-trading-update-1q27.pdf
- https://mybroadband.co.za/news/cellular/458291-vodacom-all-in-on-super-app.html
- https://stlpartners.com/articles/consumer/can-vodapay-transfer-alipay-to-south-africa/
- https://techfinancials.co.za/2023/05/15/vodacom-super-app-vodapay-now-has-3-3-million-registered-users/
- https://apps.apple.com/za/app/vodapay/id1544702651

### Nedbank Avo
- https://www.avo.africa/
- https://play.google.com/store/apps/details?id=za.co.nedbank.avobusiness&hl=en_ZA&gl=ZA (Avo Business — "Not found")
- https://personal.nedbank.co.za/bank/digital-banking/channels/avo.html
- https://nedbank.co.za/content/dam/nedbank/site-assets/Terms/FINAL_T's%20and%20C's%20for%20Avo%20Customer%20App%20V9_09042021.pdf
- https://simplybiz.zendesk.com/hc/en-us/articles/4764879051793-Grow-your-business-online-with-Avo
- https://techfinancials.co.za/2026/03/03/nedbank-2025-results-avo-auto-sales-top-r1bn-heps-up-3/
- https://mybroadband.co.za/news/banking/553962-nedbank-avo-supershop-pumping.html

### Standard Bank LookSee / Whizzoh / 4-Sure
- https://www.looksee.co.za/looksee/home/products-services/home-maintenance-services
- https://www.looksee.co.za/looksee/home/about-us/terms-and-conditions
- https://www.whizzoh.co.za/for-pros/
- https://www.whizzoh.co.za/frequently-asked-questions/
- https://www.whizzoh.co.za/wp-content/uploads/2024/09/WHIZZOH-SERVICE-PROVIDER-TERMS-AND-CONDITIONS-Updated-20-August-2024.pdf
- https://prodza.whizzoh.co.za/whizzohpartnerportal/Home/Register
- https://play.google.com/store/apps/details?id=com.whizzoh.serviceprovider&hl=en_ZA&gl=ZA
- https://businesstech.co.za/news/industry-news/735691/looksee-and-standard-bank-are-transforming-the-solar-installer-landscape/
- https://4-sure.atlassian.net/servicedesk/customer/portal/15/group/31/create/141
- https://www.engineeringnews.co.za/article/standard-bank-looksee-partners-with-sanedi-for-home-energy-credit-rating-2025-05-12

### FNB
- https://www.fnb.co.za/business-banking/business-hub/info-hub/nav-HomeServices.html
- https://www.fnb.co.za/business-banking/nav/marketplace/index.html
- https://www.fnb.co.za/ways-to-bank/digital/navHome.html
- https://www.itweb.co.za/content/DZQ58MVPaJOvzXy2

### Capitec / Discovery / Absa / TymeBank / Bank Zero
- https://www.capitecbank.co.za/rewards/spend-better/
- https://www.peachpayments.com/capitec-pay-merchant-list
- https://payat.co.za/media/pay-and-capitec-a-shared-vision-for-financial-solutions/
- https://www.discovery.co.za/bank/home-partners
- https://www.absa.co.za/personal/bank/absa-rewards/cash-rewards-from-partners/
- https://www.tymebank.co.za/help/moretyme/
- https://www.bankzero.co.za/special-features/

### MTN MoMo / Chenosis / Ayoba
- https://www.mtnmomo.co.za/
- https://momodevelopercommunity.mtn.com/getting-started-in-the-community-2/how-to-become-a-momo-api-developer-197
- https://techcabal.com/2025/05/21/mtns-momo-pay-enters-the-payments-market-with-0-5-fee/
- https://techcentral.co.za/mtn-momo-fintech-battle-south-africa/250873/
- https://www.engineeringnews.co.za/article/mtn-momo-reaches-13-million-mark-2025-04-18
- https://techcentral.co.za/mtn-enlists-alipay-owner-to-turn-momo-into-a-super-app/282448/
- https://techmoonshot.com/2026/06/10/mtn-and-ant-international-partner-to-transform-momo-into-a-super-app-nigeria-goes-first/
- https://inform.tmforum.org/features-and-opinion/chenosis-aims-to-transform-software-engineering-in-africa-through-network-apis
- https://techcabal.com/2026/03/24/mtn-begins-shutdown-of-ayoba-as-it-shifts-to-unified-digital-platform/
- https://mybroadband.co.za/news/smartphones/635447-mtn-quietly-shuts-down-super-app.html

### Telkom Yep!
- https://mall.yep.co.za/article?id=198 (FAQ, 9 Mar 2026)
- https://seller.mall.yep.co.za/
- https://seller.mall.yep.co.za/business-products
- https://seller.mall.yep.co.za/login/index.html#/registration
- https://www.telkom.co.za/yep/products
- https://play.google.com/store/apps/details?id=com.connecto.yepMarketplace&hl=en
- https://www.accenture.com/us-en/case-studies/song/telkom-yep-digital-marketplace

### Google / Gumtree / others
- https://support.google.com/localservices/answer/6224841?hl=en-GB&co=GENIE.CountryCode%3DGB (LSA countries)
- https://support.google.com/business/answer/13763036?hl=en (GBP eligibility)
- https://www.gumtree.co.za/s-services/v1c9p1
- https://pages.gumtree.co.za/gumtree-for-business
- https://pages.gumtree.co.za/gumtree-protool-pricing
- https://www.cellc.co.za/cellc/home-assist
- https://bolt.eu/en-za/ · https://www.uber.com/za/en/ · https://sellers.takealot.com/
- https://techcentral.co.za/pick-n-pay-adds-clothing-to-asap-app-in-super-app-push/278417/
- https://www.snupit.co.za/ · https://kandua.com/ · https://www.procompare.co.za/ (competitors)

### Evidence notes
- Several pages are JS-rendered or bot-blocked (fnb.co.za, capitecbank.co.za, avo.africa, momodeveloper.mtn.com, chenosis.io); they were read in a live browser where needed. The VodaPay `mpdev/*` docs are a login-gated SPA; content quoted from them matches Ant's public mirror of the identical documentation.
- Stale/dead: avobusiness.africa (redirects), Avo consumer T&Cs (2021), developer.ayoba.me / business.ayoba.me (DNS dead), cellchomeassist.co.za (does not resolve), enterprisemarketplace.standardbank.co.za (DNS fails).
- Whizzoh's FAQ says 10% total; its T&Cs define an additional 20% "Settlement Discount". Both are quoted; the conflict is unresolved.
- A search-engine snippet claiming "VodaPay reached 4.8 million registered users" in the Q1 FY27 update is not in the actual PDF and was excluded.

# Marketing & Acquisition Readiness — Phased Engineering Brief

> **Status: AUDIT + PLAN ONLY.** Slice A is being implemented in the same session this brief is written; Slices B–I are scoped for follow-up PRs. No production deploys, no schema migrations, and no destructive actions are kicked off by writing this file.

**Goal:** make Plug A Pro technically ready for Google Search Ads, Google Display + Performance Max-style remarketing, organic SEO, and clean cross-channel attribution — without breaking the live Meta ads or the WhatsApp-first flow.

**Architecture:** add a richer client-side attribution module (UTMs + click IDs + referrer + landing path + first/last touch); mirror it to the marketing site so the attribution survives the `plugapro.co.za → app.plugapro.co.za` hop; persist whatever the current schema can hold and stash the rest in a JSON blob until an additive Prisma migration adds the columns; introduce a typed event taxonomy that the booking funnel + admin reporting can both subscribe to; add SEO surfaces (sitemap, robots, JSON-LD, service + area landing pages) on the marketing site only; layer server-side conversion events (Meta CAPI + GA4 Measurement Protocol) on top of the existing `quoteApproved` / `paymentSuccess` server paths, gated by idempotency keys we already have.

**Tech stack as found:** Next.js 16 App Router (two apps: `marketing/` + `field-service/`), Prisma + Supabase Postgres, `@next/third-parties/google` on marketing, custom `GoogleAnalytics` + `MetaPixel` components on app, Consent Mode v2 defaulted denied, `lib/utm.ts` first-touch UTMs persisted to `JobRequest.utm{Source,Medium,Campaign,Content}`. No GTM container. No Meta CAPI. No GA4 Measurement Protocol. No `sitemap.ts` / `robots.ts`. No JSON-LD anywhere. No click IDs captured. No customer-level attribution stamping.

---

## 1. Audit findings (one screen)

| Capability | Current state | Gap |
|---|---|---|
| GA4 tag (both apps) | Single property `G-R3RH07RQ3G`, prod-only, Consent v2 default-denied | ✅ in place |
| GTM container | none | spec requires `NEXT_PUBLIC_GTM_ID` scaffold |
| Meta Pixel (client) | `components/meta-pixel.tsx`, token-route suppressed | ✅ |
| Meta CAPI (server) | **none** | server-side event stream missing |
| GA4 Measurement Protocol (server) | **none** | server-side conversion events missing |
| Consent banner | binary accept/deny on both apps, Consent Mode v2 wired | spec wants 3 categories (essential / analytics / marketing) |
| UTM capture client | `lib/utm.ts`, first-touch only, 4 keys (no `utm_term`) | no last-touch, no click IDs, no referrer, no landing path |
| Attribution on Customer | **none** — only on `JobRequest` | customer-level first-touch stamping missing |
| Attribution on Booking / Payment / Quote / Match / Lead | **none** | spec wants the full chain to carry it |
| WhatsApp / phone click tracking | plain `<a href>`, no events | `whatsapp_click` + `phone_click` events |
| Server-side `quote_approved` / `payment_success` events | AuditLog + JobStatusEvent only | no conversion stream |
| robots.txt / sitemap.xml — marketing | static files in `public/` | needs `app/sitemap.ts` + `app/robots.ts`, generated from data |
| robots.txt / sitemap.xml — app | **none** | add minimal `disallow: /admin, /provider, …` + public-route sitemap |
| JSON-LD | **none** | `Organization`, `LocalBusiness`, `Service`, `FAQPage`, `BreadcrumbList` |
| Service landing pages | `/services/[slug]` exists on marketing, content matrix in `marketing/content/services/service-scope.ts` | needs SEO-grade per-city/per-service pages |
| Area landing pages | **none**; `LocationNode` table exists with slugs | needs `/areas/[citySlug]/[serviceSlug]` |
| Admin source reporting | **none** — UTMs invisible on Customer / Booking detail | spec requires acquisition view on detail pages + a reports surface |
| Service-category DB model | hardcoded TS array (`lib/service-categories.ts`) | OK for now; SEO content overlay can live in a separate content module |
| Code centralisation | `lib/analytics.ts` + `lib/meta-pixel.ts` are the only call sites; no scattered `gtag/fbq` in components | ✅ |

---

## 2. Event taxonomy

| Event | Surface (client / server) | Required params | Fires on |
|---|---|---|---|
| `page_view` | client | auto via gtag | route change (existing) |
| `service_viewed` | client | `service_slug`, `category`, `area?` | mount of `/services/[slug]` on marketing |
| `service_search_started` | client | `query?`, `category?` | first keystroke in `HomeServiceSearch` / `ProviderSearchInput` |
| `service_search_completed` | client | `query`, `category`, `result_count` | search results render |
| `quote_started` | client | `service_slug`, `category`, `area`, `customer_type` | mount of `/book/[category]` |
| `quote_submitted` | client | `job_request_id`, `service_slug`, `category`, `area`, `value?`, `currency:'ZAR'` | existing `requestSubmitted` site, renamed to `quote_submitted` |
| `booking_started` | client | `job_request_id`, `match_id?` | customer clicks "Accept quote" |
| `slot_selected` | client | `job_request_id`, `window_start`, `window_end` | window picker |
| `booking_confirmed` | server (Meta CAPI + GA4 MP) | `booking_id`, `value?`, `currency:'ZAR'` | post-commit in `createBookingArtifactsForApprovedQuote` |
| `payment_started` | client | `booking_id`, `value`, `currency` | PSP checkout redirect |
| `payment_success` | server | `booking_id`, `payment_id`, `value`, `currency` | post-commit in `handlePaymentSucceeded` |
| `payment_failed` | server | `booking_id`, `payment_id`, `failure_reason` | `handlePaymentFailed` |
| `whatsapp_click` | client | `source` (page slug), `cta_label` | every `wa.me` link |
| `phone_click` | client | `source`, `cta_label` | every `tel:` link |
| `quote_approved` | server | `quote_id`, `match_id` | `processQuoteDecision` post-commit |
| `job_completed` | server | `job_id`, `booking_id`, `value?` | `transitionJob` to `COMPLETED` |

**Sensitive payload rule:** none of these carry raw phone numbers, addresses, ID numbers, or job-note text. Pseudonymous IDs only. Server-side events MAY include hashed email/phone for Meta CAPI advanced matching — gated on consent.

**Idempotency rule:** every server-side event includes an `event_id` derived from the entity ID + transition timestamp (e.g. `payment_success:${paymentId}`), so a webhook retry never double-counts. Meta CAPI's `event_id` field dedupes against the client Pixel sibling event when both fire.

---

## 3. Attribution data flow (target state)

```
[ Marketing site landing ]
  └── AttributionCapture (NEW) writes:
        first_touch  ──► localStorage:pap_attribution_first_touch (never overwritten)
        last_touch   ──► localStorage:pap_attribution_last_touch (refreshed on every visit with attribution params)
  └── decorate outbound links to app.plugapro.co.za with utm + click_ids  (NEW)

[ App (app.plugapro.co.za) ]
  └── AttributionCapture reads its own URL, AND merges with what came via cross-domain linker
  └── On JobRequest submit:  form sets utmSource/Medium/Campaign/Content (legacy)
                              form sets attributionJson = JSON.stringify({first_touch, last_touch})  (NEW)

[ Server: POST /api/customer/bookings ]
  └── existing: persist utm* to JobRequest
  └── NEW (Slice B): parse attributionJson, persist:
        JobRequest.gclid, fbclid, gbraid, wbraid, msclkid, referrer, landingPath
        Customer.firstTouch{Source,Medium,Campaign,Content,Gclid,Fbclid,At} on first JobRequest only
        JobRequest.firstTouchAt, lastTouchAt
  └── NEW (Slice B): bubble to Booking on creation, to Payment on PSP init

[ Server: quoteApproved / paymentSuccess / jobCompleted ]
  └── NEW (Slice C): emit Meta CAPI + GA4 Measurement Protocol events with event_id for dedup
```

---

## 4. SEO route structure (marketing site)

| Route | Status today | Action | Generator |
|---|---|---|---|
| `/` | exists | improve metadata, add `Organization` + `LocalBusiness` JSON-LD | static |
| `/services` | exists (list of MVP scope) | add `BreadcrumbList`, enrich list metadata | static |
| `/services/[slug]` | exists, dynamic metadata | add `Service` JSON-LD, internal links to areas | `generateStaticParams` from `serviceScopeMatrix` |
| `/areas/[citySlug]` | **NEW** | city overview, top services, internal links | `generateStaticParams` from `LocationNode` where `nodeType='CITY' AND active=true` |
| `/areas/[citySlug]/[serviceSlug]` | **NEW** | service × area landing page, primary SEO surface | cross-product of cities × pilot services |
| `/faq`, `/how-it-works`, etc. | exist | add `FAQPage` JSON-LD where applicable | static |
| `app/sitemap.ts` | **NEW** | dynamic, sources all the above | runs at request time, cached |
| `app/robots.ts` | **NEW** | allow all on marketing; disallow `/api/`, `/onboarding/` | dynamic |

Field-service app: only add `app/robots.ts` that **disallows /admin, /provider, /customer, /requests, /quotes, /approve, /r, /track, /leads, /review, /ticket, /sign-in**. App is not an SEO surface — it's the booking PWA — but we want crawlers to stop trying.

---

## 5. Consent flow (target)

```
First visit (no stored choice):
  Consent Mode v2 default = all denied (already wired)
  Banner shown with 3 buttons:  [Reject all]  [Customise]  [Accept all]
  "Customise" reveals: essential (always on) / analytics / marketing
  Choice + version + ISO timestamp persisted in localStorage(pap_consent_v2)

Returning visit:
  Stored choice replayed via gtag('consent','update', ...) on app boot
  Settings link in footer re-opens the customise sheet

Operational guarantees:
  - Booking + payment flows never depend on consent being granted
  - Consent denied → no GA Pixel event, no Meta Pixel event; server-side
    events (CAPI / MP) still fire — they don't touch device storage and are
    legally distinct from cookie-set tags. Document this in /privacy.
```

Consent surface is mobile-first: bottom sheet on phones, dismissable overlay on desktop. Tested in browser before merge.

---

## 6. Phase plan

Each slice is **one PR**. Slice A is implemented in this session; B–I are queued.

### Slice A — Attribution capture v2 *(this session)*

- **Files created**
  - `field-service/lib/attribution.ts` (replaces `lib/utm.ts`)
  - `field-service/__tests__/lib/attribution.test.ts`
  - `marketing/lib/attribution.ts` (new — was completely missing)
  - `marketing/components/AttributionCapture.tsx`
- **Files modified**
  - `field-service/components/utm-capture.tsx` — import from new module, expand to capture click IDs
  - `field-service/components/customer/BookingFlow.tsx` — switch to `getStoredAttribution`, attach `attributionJson` form field
  - `marketing/app/layout.tsx` — mount `<AttributionCapture />`
- **Files deleted**
  - `field-service/lib/utm.ts` — replaced; only 2 importers, both updated
- **Schema:** none this slice
- **Env:** none
- **Acceptance:** Vitest covers first-touch persistence, last-touch refresh, click ID capture, referrer & landing path capture, legacy `getStoredUtm()` shape preserved. `tsc --noEmit` and `eslint` clean on changed files.

### Slice B — Prisma migration: persist click IDs + customer-level attribution

- **Schema (additive only):**
  - `JobRequest`: add `gclid String?`, `gbraid String?`, `wbraid String?`, `fbclid String?`, `msclkid String?`, `utmTerm String?`, `referrer String?`, `landingPath String?`, `firstTouchAt DateTime?`, `lastTouchAt DateTime?`
  - `Customer`: add `firstTouchSource String?`, `firstTouchMedium String?`, `firstTouchCampaign String?`, `firstTouchGclid String?`, `firstTouchFbclid String?`, `firstTouchAt DateTime?`, `firstTouchLandingPath String?`
  - `Booking`: add `acquisitionSource String?`, `acquisitionMedium String?`, `acquisitionCampaign String?` (copied from JobRequest on Booking creation, for fast aggregate)
  - `Payment`: add `acquisitionSource String?`, `acquisitionMedium String?` (mirrored from Booking on Payment creation)
- **Server changes:** `app/api/customer/bookings/route.ts`, `lib/job-requests/create-job-request.ts`, `lib/quotes.ts:createBookingArtifactsForApprovedQuote`, `lib/payments.ts:init`
- **House rule check:** additive only ✓ (CLAUDE.md §House rule 2)
- **Acceptance:** existing tests still pass; new test covers the bubble path JobRequest → Booking → Payment.

### Slice C — Server-side conversion stream (Meta CAPI + GA4 MP)

- **Files created**
  - `field-service/lib/marketing/server-events.ts` — typed wrapper around Meta CAPI + GA4 MP, with idempotent `event_id` derivation
  - `field-service/lib/marketing/event-id.ts` — pure function: `eventId(transition, entityId, timestamp)` so tests are trivial
- **Files modified**
  - `field-service/lib/quotes.ts` — fire `quote_approved` post-commit
  - `field-service/lib/payments.ts` — fire `payment_success` / `payment_failed`
  - `field-service/lib/quotes.ts:createBookingArtifactsForApprovedQuote` — fire `booking_confirmed`
  - `field-service/lib/jobs.ts:transitionJob` — fire `job_completed` on COMPLETED transition
- **Env required (production only):** `META_CAPI_PIXEL_ID`, `META_CAPI_ACCESS_TOKEN`, `META_CAPI_TEST_EVENT_CODE?`, `GA4_MEASUREMENT_PROTOCOL_SECRET`, `GA4_MEASUREMENT_ID`
- **Acceptance:** webhook replay test confirms idempotent — second invocation does not double-emit; integration test confirms `event_id` matches between client Pixel + server CAPI for client-fired events that have a server sibling (avoids Meta double counting).

### Slice D — SEO foundation

- `marketing/app/sitemap.ts` (dynamic, sources `serviceScopeMatrix` + `LocationNode`)
- `marketing/app/robots.ts`
- `field-service/app/robots.ts` (disallow everything non-public)
- JSON-LD helpers in `marketing/lib/jsonld.ts`: `organizationLd()`, `localBusinessLd()`, `serviceLd()`, `breadcrumbLd()`, `faqLd()`
- Drop into existing pages via inline `<script type="application/ld+json">`
- Add `alternates: { canonical }` to all marketing metadata
- **Acceptance:** Google Rich Results test passes for `/`, `/services/electrician`, `/areas/johannesburg/electrician`; sitemap fetches under 300 ms; lighthouse SEO ≥ 95.

### Slice E — Service × Area landing pages

- `marketing/app/(marketing)/areas/[citySlug]/page.tsx`
- `marketing/app/(marketing)/areas/[citySlug]/[serviceSlug]/page.tsx`
- `marketing/content/areas/area-content.ts` — generic intro/trust copy template, NOT per-city/per-service paragraphs (that would be thin-content doorway pages)
- Each page: H1, 2-paragraph intro, service description (from `serviceScopeMatrix`), list of covered suburbs (from `LocationNode` children), WhatsApp + Book CTAs, internal links to 3 related services + 3 nearby cities, JSON-LD `Service` + `BreadcrumbList`
- **Generator constraint:** only render pages where pilot service × active city ≥ minimum-quality-bar (template must have at least 2 covered suburbs to publish). Skip rather than ship a thin page.
- **Acceptance:** generated set ≤ ~120 pages on launch (pilot services × pilot cities), each unique enough to not get flagged as doorway.

### Slice F — Consent v2 (3 categories)

- `field-service/lib/consent.ts` + `marketing/lib/consent.ts` (mirrored)
- Replace both `ConsentBanner` components with 3-button banner + customise sheet
- `gtag('consent','update', {analytics_storage, ad_storage, ad_user_data, ad_personalization})` driven by 3-category choice
- Privacy policy paragraph documenting what's sent where
- **Acceptance:** rejecting marketing fires zero `ad_*` events; rejecting analytics fires zero `gtag('event', ...)`; booking + payment still work in both states.

### Slice G — Admin attribution visibility

- `field-service/app/(admin)/admin/customers/[id]/page.tsx` — add "Acquisition" section showing first-touch source/medium/campaign + first JobRequest's UTMs
- `field-service/app/(admin)/admin/bookings/[id]/page.tsx` — same, with booking-level fields
- `field-service/app/(admin)/admin/reports/page.tsx` — add tabs: "Acquisition source" + "Conversion funnel by source"
- Read-only aggregates: bookings by source, paid vs organic, Google vs Meta vs WhatsApp vs direct, conversion rate by campaign, revenue by source
- **Acceptance:** admin can filter bookings by source; PII not exposed.

### Slice H — Click-event wiring + remarketing event stream

- Wrap every `wa.me` link in a shared `<WhatsAppLink>` component that emits `analytics.whatsappClick({source, cta_label})`
- Same for `tel:` → `<PhoneLink>`
- Fire intermediate-state events from `BookingFlow.tsx`: `quote_started` on `/book/[category]` mount, `slot_selected` on window pick, `booking_started` on quote-accept click
- These are the events Marketing will use in Google Ads / Meta to build "abandoned at quote", "viewed but didn't book" audiences
- **Acceptance:** event taxonomy fully present in GA4 DebugView; Meta Events Manager shows all 16 events at least once during QA.

### Slice I — Google Ads conversion env scaffolding

- `field-service/lib/marketing/google-ads.ts` — `fireGoogleAdsConversion(event, params)` reads:
  - `NEXT_PUBLIC_GTM_ID`
  - `NEXT_PUBLIC_GOOGLE_ADS_ID`
  - `NEXT_PUBLIC_GOOGLE_ADS_QUOTE_CONVERSION_LABEL`
  - `NEXT_PUBLIC_GOOGLE_ADS_BOOKING_CONVERSION_LABEL`
  - `NEXT_PUBLIC_GOOGLE_ADS_PAYMENT_CONVERSION_LABEL`
  - `NEXT_PUBLIC_GOOGLE_ADS_WHATSAPP_CONVERSION_LABEL`
  - `NEXT_PUBLIC_GOOGLE_ADS_PHONE_CONVERSION_LABEL`
- If any label is unset, skip firing — never throw.
- Wire to: `quote_submitted`, `booking_confirmed`, `payment_success`, `whatsapp_click`, `phone_click`.
- **Acceptance:** dev + staging never fire (labels are unset / blank); prod fires once per real conversion; Google Tag Assistant validates each.

---

## 7. Risks & edge cases (called out from the spec)

| Risk | Mitigation |
|---|---|
| Duplicate conversion events | `event_id` on both client Pixel + server CAPI; Meta dedupes; payment webhook idempotency check unchanged from current code (`payments.ts:73-78` returns early if `status==='PAID'`) |
| Payment webhook fires twice | already idempotent; new event stream piggybacks on same status-transition guard, so events also fire once |
| User: paid ad → WhatsApp re-entry | first-touch persisted in `Customer.firstTouchSource` is the credit; sensitive-token-routes still suppress all client tags, so the WhatsApp link can't pollute attribution |
| Ad blockers | server-side CAPI + MP cover what the client blocks; we accept partial client-side loss |
| Existing Meta Pixel | preserved; CAPI adds, doesn't replace; `event_id` prevents double counting |
| PWA client-side rendering vs SEO | only marketing site is the SEO surface, and it's already SSR for all static metadata; app is correctly `noindex` via the new `robots.ts` |
| Thin doorway pages | Slice E generates only city × pilot-service combos where the location tree has ≥ 2 covered suburbs; otherwise the page is skipped |
| Staging firing prod conversions | every server-side helper gates on `VERCEL_ENV === 'production'`; Google Ads labels are env-vars that stay unset on preview |
| Sensitive data to ad platforms | event payloads explicitly only carry pseudonymous IDs; hashed email/phone for CAPI advanced matching ONLY if added later and gated on consent |
| WhatsApp operational links pollute attribution | already covered: WhatsApp resume/handoff routes are in `sensitive-token-routes.ts`, gtag + fbq are suppressed entirely |
| Open Graph previews in WhatsApp | already wired (per-page metadata + `opengraph-image.tsx` on marketing); Slice D verifies on `/services/[slug]` |

---

## 8. Manual setup checklist (marketer + ops)

Outside the code:

- [ ] Create / verify a Google Ads account; link the GA4 property `G-R3RH07RQ3G`
- [ ] Create / verify a Google Tag Manager container; set `NEXT_PUBLIC_GTM_ID` on Vercel prod env
- [ ] Create Google Ads conversion actions for: `quote_submitted`, `booking_confirmed`, `payment_success`, `whatsapp_click`, `phone_click`
- [ ] Copy each conversion label into `NEXT_PUBLIC_GOOGLE_ADS_*_CONVERSION_LABEL` env vars (printf, never echo — per OpenBrain memory entry)
- [ ] In GA4 Admin → Data Streams, configure cross-domain measurement: `plugapro.co.za` + `app.plugapro.co.za`
- [ ] In GA4 Admin → Data Streams, add to unwanted referrals: `plugapro.co.za`, `app.plugapro.co.za`
- [ ] Create / mint a Meta CAPI access token in Meta Business Suite → Events Manager → Settings → Conversions API; set `META_CAPI_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` on prod env
- [ ] Submit `https://plugapro.co.za/sitemap.xml` to Google Search Console (after Slice D ships)
- [ ] Connect Google Business Profile for "Plug A Pro" (Roodepoort headquarters); link to GA4
- [ ] Create remarketing audiences in Google Ads / Meta Ads Manager: "viewed service but didn't quote", "started quote but didn't submit", "submitted but didn't book", "selected slot but didn't pay", "booked successfully"
- [ ] Upload display banner creatives (separate brief)
- [ ] Validate with Google Tag Assistant + Meta Pixel Helper before opening the budget

---

## 9. Test plan

- **Slice A:** `attribution.test.ts` — first-touch wins, last-touch refresh, click ID capture, referrer + landing-path capture, legacy shape preserved
- **Slice B:** `bookings/route.test.ts` — `attributionJson` parsed; integration test JobRequest → Booking → Payment carries attribution
- **Slice C:** `server-events.test.ts` — idempotency via `event_id`; replay safety; Meta CAPI request body shape; GA4 MP request body shape; CSP unaffected (these are server→Meta/Google, not browser→)
- **Slice D:** Playwright smoke: `/sitemap.xml` returns 200 with the right URLs; `/robots.txt` returns 200; JSON-LD validates
- **Slice E:** snapshot test that generated landing pages contain expected H1 + JSON-LD blob
- **Slice F:** Playwright smoke: rejecting marketing leaves `analytics_storage='denied'`; accepting flips to `granted`
- **Slice G:** admin auth tests already cover access; add a smoke that source field renders
- **Slice H + I:** GA4 DebugView + Meta Events Manager + Google Tag Assistant — manual

---

## 10. OpenBrain logging

OpenBrain backend is currently unreachable (all three transports). When it's reachable, this brief becomes one knowledge entry: `engineering — marketing-acquisition-readiness brief (2026-06-20)`. Slice A's outcome becomes a second entry on completion. No `tracker.md` is created.

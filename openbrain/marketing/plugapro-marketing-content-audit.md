# Plug A Pro — Marketing Website Content Audit

Audited: 2026-05-06  
Auditor: Claude Code  
Scope: All marketing pages, components, metadata, navigation, CTAs, and copy blocks

---

## Summary

The marketing website is broadly well-built and correctly positioned for South African conditions. The core platform description, trust and safety copy, how-it-works detail, and FAQ content are strong and accurate. However, five recurring issues degrade the brand and persona alignment:

1. **"Workers" terminology** is used throughout instead of "service providers" or "local pros". The word "workers" carries informal, commodity connotations and does not position these people with the dignity the brief requires.
2. **WhatsApp greeting messages** hardcode `"Hi ServiceMen"` — a defunct brand name that is also gendered. This is a live user-facing bug.
3. **Navigation and footer label** says "For workers" instead of "For service providers" (or "For local pros").
4. **The `/for-workers` route URL** bakes "workers" into the address. The page title and metadata repeat it.
5. **Features page description** uses enterprise/SaaS language ("booking, dispatch, execution, invoicing — managed in one connected platform") that positions Plug A Pro as a software vendor rather than a community marketplace.

All other issues are lower priority and documented below.

---

## Audit Table

### 1. WhatsApp greeting messages — CRITICAL

| Field | Value |
|---|---|
| File | `marketing/lib/whatsapp.ts` |
| Lines | Audience options array, `message` fields |

**Current copy:**
- Customer: `"Hi ServiceMen, I'm looking for a service provider."`
- Worker: `"Hi ServiceMen, I'm looking for work opportunities."`
- Provider: `"Hi ServiceMen, I'd like to join as a service provider."`

**Issue:** "ServiceMen" is the old brand name. Every WhatsApp CTA on the entire site opens with the wrong brand. It is also gendered — "servicemen" excludes women from the trade persona. This is a live user-facing defect, not a copy preference.

**Recommended correction:**
- Customer: `"Hi Plug A Pro, I need help with a small job."`
- Service provider (job seeker): `"Hi Plug A Pro, I'd like to register as a service provider."`
- Service provider (partner): `"Hi Plug A Pro, I'd like to join as a service provider or partner."`

**Priority:** Critical  
**Reason:** Every user who taps "Chat on WhatsApp" sends "Hi ServiceMen" to the business number. Wrong brand on first contact.

---

### 2. Navigation label — "For workers"

| Field | Value |
|---|---|
| File | `marketing/components/shared/Nav.tsx` |
| Section | Desktop and mobile nav items |

**Current copy:** `For workers`

**Issue:** "Workers" is the recurring persona label the brief explicitly corrects. The nav label is the first impression every visitor gets of how Plug A Pro addresses service providers.

**Recommended correction:** `For service providers`  
Alternative if space is tight on mobile: `For local pros`

**Priority:** High  
**Reason:** Primary navigation. High visibility. Contradicts the positioning brief directly.

---

### 3. Footer label — "For workers"

| Field | Value |
|---|---|
| File | `marketing/components/shared/Footer.tsx` |
| Section | Platform links column |

**Current copy:** `For workers` (link to `/for-workers`)

**Issue:** Same as nav item — repeats the incorrect persona label.

**Recommended correction:** `For service providers`

**Priority:** High  
**Reason:** Footer reinforces nav — both need to change together.

---

### 4. Route and page: `/for-workers`

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/for-workers/page.tsx` |
| Metadata description | "Register as a home-job worker on Plug A Pro. Get matched to local customers, receive structured leads, submit quotes, and build your reputation." |
| Page header label | "For workers" |
| Page headline | "Your skills. Digital local demand." |

**Issues:**
- URL `/for-workers` embeds "workers" permanently
- Metadata says "home-job worker" — diminishes the persona
- Header label "For workers" repeats the problem
- Headline "Your skills. Digital local demand." is abstract and does not speak to the pain point (unpredictable income, hard to find customers)

**Recommended corrections:**
- Create `/for-service-providers` as the canonical route; redirect `/for-workers` to it (or keep `/for-workers` as the URL and only fix the visible labels if a redirect is not viable)
- Metadata: `"Register as a local service provider on Plug A Pro. Get matched to nearby customers for small home jobs, receive leads on WhatsApp, build your reputation with real reviews."`
- Header label: `"For service providers"`
- Headline: `"More jobs. Less waiting."` or see copy rewrite doc for full alternatives

**Priority:** High  
**Reason:** Persona positioning page for the supply side. Every word signals how Plug A Pro views these people.

---

### 5. FAQ page metadata description

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/faq/page.tsx` |
| Current | `"Frequently asked questions about Plug A Pro. For customers looking for home-job help and workers looking for local jobs."` |

**Issue:** "workers looking for local jobs" — should say "service providers" or "local pros seeking work opportunities".

**Recommended correction:** `"Frequently asked questions about Plug A Pro — for customers who need home job help and local service providers looking for steady work."`

**Priority:** Medium  
**Reason:** SEO metadata and Google snippet. Repeated use of "workers" in a prominent indexed field.

---

### 6. For Workers page — metadata description

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/for-workers/page.tsx` |
| Current | `"Register as a home-job worker on Plug A Pro. Get matched to local customers, receive structured leads, submit quotes, and build your reputation."` |

**Issue:** "home-job worker" is reductive. The people this is targeting are tradespeople, handymen, and skilled practitioners — not generic "workers".

**Recommended correction:** `"Join Plug A Pro as a local service provider. Get matched to nearby customers for small home jobs, receive WhatsApp lead alerts, submit quotes in writing, and build your reputation over time."`

**Priority:** High  
**Reason:** Google snippet for the provider acquisition page. First impression in search results.

---

### 7. WhoItsFor section — "For Workers" heading and benefit card title

| Field | Value |
|---|---|
| File | `marketing/components/marketing/WhoItsFor.tsx` |
| Section | Worker/provider column |

**Current copy:**
- Column label: "For workers" (implied from structure)
- Card title: "What you get as a worker"
- Body: references "workers" throughout

**Issue:** The persona label persists inside the component.

**Recommended corrections:**
- Column label: `"For service providers"`
- Card title: `"What you get as a service provider"`
- Replace "workers" with "service providers" or "local pros" throughout this component

**Priority:** High  
**Reason:** Homepage component — highest-traffic surface for provider messaging.

---

### 8. PricingCards — "For Workers" heading

| Field | Value |
|---|---|
| File | `marketing/components/marketing/PricingCards.tsx` |
| Section | Right/highlighted card heading |

**Current copy:** (emoji) `"For Workers"` (card heading implied from the worker card)  
Workers/CTA: `"I'm looking for work"`

**Issue:**
- Card heading uses "Workers" 
- CTA "I'm looking for work" is fine as an audience-selector label (it's conversational) but the card heading should be consistent with the rest

**Recommended corrections:**
- Card heading: `"For service providers"` or `"For local pros"`
- CTA button: `"Join as a service provider"` — this is more dignified than "I'm looking for work" in a card context

**Priority:** Medium  
**Reason:** Pricing page sets expectations for both sides. Persona language matters here.

---

### 9. Features page description — enterprise/SaaS tone

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/features/page.tsx` |
| Current description | `"WhatsApp booking, smart dispatch, technician PWA, auto-invoicing, extra work approval, and photo audit trail — all in one platform."` |
| Page body headline | `"Platform features"` |
| Page body subline | `"Every part of the job lifecycle — booking, dispatch, execution, invoicing — managed in one connected platform."` |

**Issues:**
- "smart dispatch", "technician PWA", "auto-invoicing", "photo audit trail" — this is internal operations language, not customer-facing value copy
- "Every part of the job lifecycle — booking, dispatch, execution, invoicing — managed in one connected platform" sounds like a B2B SaaS product page
- "technician PWA" uses "technician" (another persona label variation) and exposes internal platform architecture to the public

**Recommended corrections:**
- Description: `"See how Plug A Pro handles matching, quoting, job tracking, communication, and reviews — from first message to completed job."`
- Page headline: `"How the platform protects you"`  
  Or: `"Everything that makes the job work"`
- Page subline: `"From request to completion, Plug A Pro keeps the quote, status, photos, and records in one place — so both sides always know where things stand."`

**Priority:** Medium  
**Reason:** Features page is a trust signal. Enterprise language makes it feel like a software product, not a community service.

---

### 10. CTA Strip — audience quick-link labels

| Field | Value |
|---|---|
| File | `marketing/components/marketing/CTAStrip.tsx` |

**Current copy:**
- `"I need a service provider"`
- `"I'm looking for work"`
- `"I want to join as a service provider"`

**Issues:**
- "I'm looking for work" is the weakest label — it positions the service provider as a job seeker rather than a skilled professional seeking matched customers
- The third option ("I want to join as a service provider") overlaps with the second — not clear why both exist

**Recommended corrections:**
- `"I need help with a small job"` (customer)
- `"I want to offer my services"` (provider)
- Remove the third option or merge into a single provider CTA

**Priority:** Low  
**Reason:** Audience-selector labels on the CTA strip. Minor positioning issue.

---

### 11. About page — "workers" terminology

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/about/page.tsx` |

**Current copy excerpts:**
- "skilled independent workers in their area"
- "independent workers who earn their living job to job"
- "No app to download. No monthly fees. Work comes to them on the WhatsApp they already use."

**Issues:**
- "independent workers" is used 3 times — should be "service providers" or "local pros" in most instances
- "Work comes to them" reduces agency — better as "Matched job leads come to them"

**Recommended corrections:**
- Replace "skilled independent workers" → "skilled local service providers"
- Replace "independent workers who earn their living job to job" → "skilled local tradespeople and independent service providers who earn job to job"
- "Work comes to them" → "Matched job leads reach them"

**Priority:** Medium  
**Reason:** About page sets the brand story. Repeated use of "workers" undermines the positioning brief.

---

### 12. For Workers page — "Workers" used in benefit card labels

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/for-workers/page.tsx` |
| Section | Provider journey benefit cards |

**Current copy:**
- "Leads matched to your area" — fine
- "Works on your WhatsApp" — fine
- "Build a visible work record" — fine
- "Who We're Looking For" heading — fine
- **Worker types list** includes "General DIY workers" and "Installers" without context

**Issues:**
- "General DIY workers" could be misread as general labourers rather than tradespeople who do DIY assistance. Should be "DIY and assembly specialists" or "Handyman and DIY assistants"
- The section title "Who We're Looking For" sounds like a job ad. A marketplace doesn't "look for" people — it enables them.

**Recommended corrections:**
- "General DIY workers" → `"DIY and handyman specialists"`
- "Installers" → `"Furniture and fixture installers"`
- Section title: `"Who can join"` or `"Skills we match"`

**Priority:** Low  
**Reason:** Section is readable as-is, but "Who We're Looking For" has the wrong tone.

---

### 13. Social Proof — hidden with placeholder testimonials

| Field | Value |
|---|---|
| File | `marketing/components/marketing/SocialProof.tsx` |
| Status | Hidden on homepage (`<!-- SocialProof hidden until real reviews are collected -->`) |

**Current copy:** Three testimonials (Thandi M., Sipho D., Ryan K.) marked as hidden.

**Issue:** Social proof is absent from the homepage entirely. No trust signals from real users. The component exists and is ready — it just needs real reviews.

**Recommended action:** This is a content acquisition issue, not a copy issue. Collect 3–5 real testimonials from early users and replace the placeholders. Re-enable the component once reviews are real.

**Priority:** Medium  
**Reason:** Trust signals are critical for a two-sided marketplace. Once real reviews exist, they should be displayed prominently.

---

### 14. `/free-templates` page — misaligned with platform identity

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/free-templates/page.tsx` |
| Lead magnet types | `template-pack`, `dispatch-checklist`, `cashflow-tracker` |

**Issue:** "Free templates", "dispatch checklist", and "cashflow tracker" are SaaS / B2B lead magnet patterns. They feel completely out of place for a platform whose users are local tradespeople and homeowners. The `/free-templates` route is listed in nav/footer in some areas.

**Recommended action:** Remove from public navigation if it exists. Review whether this page serves any real user (a handyman is not downloading a cashflow tracker from a lead magnet form). If the templates are genuinely useful for provider business management, reframe them clearly:  
- Rename: `"Useful tools for independent service providers"`
- Content: quote template, job invoice template, job record sheet

**Priority:** Low  
**Reason:** Page is not in primary navigation. If it exists as a lead magnet experiment, it may be intentional. Flag for product review.

---

### 15. Hero section — "nearby workers" in subheading

| Field | Value |
|---|---|
| File | `marketing/components/marketing/Hero.tsx` |
| Current subheading | `"Describe your job. We match you with nearby independent workers, show you the provider profile and quote, and keep the decision in writing before anything starts."` |

**Issue:** "nearby independent workers" — the only instance where "workers" appears in the hero. Inconsistent with the rest of the subheading which already says "provider profile".

**Recommended correction:** `"Describe your job. We match you with a nearby local pro, share their profile and written quote, and keep everything confirmed in writing before work starts."`

**Priority:** Medium  
**Reason:** Hero is the highest-visibility copy on the site. "nearby local pro" is concise and on-brand.

---

### 16. Solutions/Services page — electrical note

| Field | Value |
|---|---|
| File | `marketing/app/(marketing)/solutions/page.tsx` |
| Section | Electrical (minor) service card |

**Current copy:** Includes a caveat note about COC requirements. The caveat is accurate and appropriate.

**Issue:** No issue with accuracy. The electrical card headline says "Electrical (minor)" with examples like "DB board trip investigation" and "Extending a power point or adding a switch" — both of which are actually medium-risk compliance items in South Africa.

**Recommended correction:** Remove "Extending a power point or adding a switch" from the examples list. Retain simpler examples: light fitting installation, plug socket fault-finding, sensor light fitting.

**Priority:** Medium  
**Reason:** Overpromising on electrical scope creates compliance risk and customer expectation mismatch.

---

### 17. Homepage Hero — tagline

| Field | Value |
|---|---|
| File | `marketing/components/marketing/Hero.tsx` |
| Current tagline | `"Local help. Real quotes. On WhatsApp."` |

**Issue:** No issue — this is good. Concise, platform-accurate, clearly communicates the value prop.

**Recommended action:** Keep as-is.

**Priority:** N/A

---

### 18. Homepage Hero — headline

| Field | Value |
|---|---|
| Current | `"Get home help done right. Nearby workers, quoted in writing, on WhatsApp."` |

**Issue:** "Nearby workers" again — minor inconsistency.

**Recommended correction:** `"Get home help done right. Nearby local pros, quoted in writing, on WhatsApp."`  
Or see copy rewrite doc for full hero alternatives.

**Priority:** Medium  
**Reason:** Hero headline is the most-read copy on the site.

---

## Summary of Issues by Priority

| Priority | Count | Main issues |
|---|---|---|
| Critical | 1 | WhatsApp greeting "Hi ServiceMen" |
| High | 4 | Nav/footer "For workers", For Workers page label/metadata/headline, WhoItsFor worker column labels |
| Medium | 7 | Hero headline, About page, Features page, FAQ metadata, electrical scope, PricingCards, hero subheading |
| Low | 3 | CTA strip labels, free-templates, For Workers "Who We're Looking For" |

---

## Files Requiring Changes

| File | Changes needed |
|---|---|
| `marketing/lib/whatsapp.ts` | Fix "Hi ServiceMen" in all 3 message strings |
| `marketing/components/shared/Nav.tsx` | "For workers" → "For service providers" |
| `marketing/components/shared/Footer.tsx` | "For workers" → "For service providers" |
| `marketing/app/(marketing)/for-workers/page.tsx` | Header label, headline, metadata |
| `marketing/components/marketing/WhoItsFor.tsx` | Worker column labels and card title |
| `marketing/components/marketing/Hero.tsx` | "nearby workers" → "nearby local pros" |
| `marketing/components/marketing/PricingCards.tsx` | "For Workers" heading |
| `marketing/app/(marketing)/faq/page.tsx` | Metadata description |
| `marketing/app/(marketing)/features/page.tsx` | Metadata, headline, subline |
| `marketing/app/(marketing)/about/page.tsx` | "workers" → "service providers" (3 instances) |
| `marketing/app/(marketing)/solutions/page.tsx` | Remove "Extending a power point" from electrical examples |

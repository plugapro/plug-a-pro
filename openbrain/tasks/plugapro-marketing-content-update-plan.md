# Plug A Pro — Marketing Website Content Update Plan

Created: 2026-05-06  
Depends on: `openbrain/marketing/plugapro-marketing-content-audit.md`, `openbrain/marketing/plugapro-marketing-copy-rewrite.md`  
Status: Ready for implementation — awaiting approval

---

## Overview

This plan covers engineering tasks to align the Plug A Pro marketing website with the correct product positioning and persona language. All copy replacements are defined in `plugapro-marketing-copy-rewrite.md`. Tasks are grouped by theme and ordered by priority. No new dependencies required.

---

## Group 1: Critical bug fix

### TASK-M01 — Fix "Hi ServiceMen" WhatsApp greeting messages

**Task to execute:**  
In `marketing/lib/whatsapp.ts`, update the `message` field in each of the three WhatsApp audience option objects:

- Customer: `"Hi Plug A Pro, I need help with a small job."`
- Provider (job seeker): `"Hi Plug A Pro, I'd like to register as a service provider."`
- Provider (join/partner): `"Hi Plug A Pro, I'd like to join as a service provider or partner."`

**Why it is needed:**  
Every WhatsApp CTA on the entire marketing site opens a pre-populated message that begins "Hi ServiceMen" — the old defunct brand name. This is a live user-facing defect. Every user who taps "Chat on WhatsApp" introduces themselves to the business under the wrong brand.

**Files likely affected:**  
- `marketing/lib/whatsapp.ts`

**What good output looks like:**  
All three WhatsApp CTAs (on hero, CTA strip, onboarding page, for-customers page, for-workers page, and any other component that calls these message configs) now open with the correct Plug A Pro greeting.

**Acceptance criteria:**  
- `lib/whatsapp.ts` audience options array contains no instance of "ServiceMen"
- Manual test: tap "Chat on WhatsApp" on homepage → WhatsApp opens with correct greeting
- `pnpm build` passes with no errors

**Risks:**  
None. Pure string replacement. No logic changes.

---

## Group 2: Persona language — navigation and footer

### TASK-M02 — Replace "For workers" with "For service providers" in navigation

**Task to execute:**  
In `marketing/components/shared/Nav.tsx`, change the nav label for the `/for-workers` link from `"For workers"` to `"For service providers"`.

**Why it is needed:**  
Primary navigation is the highest-visibility persona label on the site. "Workers" contradicts the positioning brief and is disrespectful to the people the platform is trying to serve.

**Files likely affected:**  
- `marketing/components/shared/Nav.tsx`

**What good output looks like:**  
Nav desktop and mobile both show "For service providers".

**Acceptance criteria:**  
- Visually confirmed on homepage at ≥375px and ≥1024px
- Link still routes to `/for-workers`
- `pnpm build` passes

**Risks:**  
Nav label change may affect mobile line wrapping if space is tight. Test on 375px. If "For service providers" is too long for mobile nav, use "For local pros" as the fallback.

---

### TASK-M03 — Replace "For workers" with "For service providers" in footer

**Task to execute:**  
In `marketing/components/shared/Footer.tsx`, update the Platform links column label for the `/for-workers` link from `"For workers"` to `"For service providers"`.

**Why it is needed:**  
Footer reinforces nav. Both must be consistent.

**Files likely affected:**  
- `marketing/components/shared/Footer.tsx`

**What good output looks like:**  
Footer "Platform" column shows "For service providers".

**Acceptance criteria:**  
- Confirmed visually on footer
- Link still routes to `/for-workers`
- `pnpm build` passes

**Risks:** None.

---

## Group 3: Persona language — For Workers / For Service Providers page

### TASK-M04 — Update `/for-workers` page header, headline, and metadata

**Task to execute:**  
In `marketing/app/(marketing)/for-workers/page.tsx`:

1. Update the page `metadata` object:
   - `title`: `"For Service Providers | Plug A Pro"`
   - `description`: `"Register as a local service provider on Plug A Pro. Get matched to nearby customers for small home jobs, receive WhatsApp lead alerts, submit quotes in writing, and build your reputation with real reviews."`

2. Update the page header section:
   - Label: `"For service providers"` (was `"For workers"`)
   - Headline: `"More jobs. Less waiting."` (was `"Your skills. Digital local demand."`)
   - Body: `"You have the skills. Getting steady, paying customers is the hard part. Plug A Pro matches you to nearby customers looking for exactly your trade — and delivers job lead previews to your WhatsApp. Register once. Set your areas. Start receiving matched jobs."` (was the generic "easier to find online" paragraph)

**Why it is needed:**  
The for-workers page is the primary acquisition page for the supply side. Every word in its header signals how Plug A Pro views service providers. The current headline ("Your skills. Digital local demand.") is abstract and does not address the real pain point (unpredictable income).

**Files likely affected:**  
- `marketing/app/(marketing)/for-workers/page.tsx`

**What good output looks like:**  
Page reads as respectful, practical, and pain-point-aligned. Persona label is "service providers" throughout header section.

**Acceptance criteria:**  
- Page title in browser tab: "For Service Providers | Plug A Pro"
- Header label, headline, and body match copy rewrite doc
- No "workers" in the page header section
- `pnpm build` passes

**Risks:**  
Note: the URL `/for-workers` is not changed in this task. A redirect from `/for-providers` or `/for-service-providers` can be added as a future improvement without urgency.

---

### TASK-M05 — Update "For workers" FAQ metadata description

**Task to execute:**  
In `marketing/app/(marketing)/faq/page.tsx`, update the `description` metadata:

Current: `"Frequently asked questions about Plug A Pro. For customers looking for home-job help and workers looking for local jobs."`

New: `"Frequently asked questions about Plug A Pro — for customers who need small home job help and local service providers looking for steady work."`

**Why it is needed:**  
Metadata is indexed by search engines. "Workers looking for local jobs" misrepresents the provider persona in Google results.

**Files likely affected:**  
- `marketing/app/(marketing)/faq/page.tsx`

**What good output looks like:**  
Metadata description contains no "workers" label.

**Acceptance criteria:**  
- `pnpm build` passes
- `<meta name="description">` content in page source matches new copy

**Risks:** None.

---

## Group 4: Homepage component persona labels

### TASK-M06 — Update WhoItsFor component — worker column labels

**Task to execute:**  
In `marketing/components/marketing/WhoItsFor.tsx`, update all instances where the provider/worker column heading and benefit card title use "workers":

- Worker column label: replace "For workers" → `"For service providers"`
- Benefit card title: replace "What you get as a worker" → `"What you get as a service provider"`
- Any body text instances of "worker" not in a quoted/example context: replace with "service provider" or "local pro"

**Why it is needed:**  
WhoItsFor is a homepage section. It is one of the first things visitors see. The worker column copy directly shapes the first impression of how Plug A Pro positions service providers.

**Files likely affected:**  
- `marketing/components/marketing/WhoItsFor.tsx`

**What good output looks like:**  
Worker column header says "For service providers". Benefit card title says "What you get as a service provider". No "workers" label in headings or card titles.

**Acceptance criteria:**  
- Verified on homepage at multiple breakpoints
- `pnpm build` passes

**Risks:**  
Check whether "workers" also appears in any `aria-label` or accessible text attributes in this component.

---

### TASK-M07 — Update PricingCards — worker card heading

**Task to execute:**  
In `marketing/components/marketing/PricingCards.tsx`, update the worker/provider card:

- Card heading: replace any instance of "For Workers" → `"For service providers"`
- CTA button: replace `"I'm looking for work"` → `"Join as a service provider"`
- Description (optional improvement): replace "Simple, fair access to work" → `"Simple, fair access to customers"`

**Why it is needed:**  
"I'm looking for work" is the weakest CTA on the site. In a card context (vs. a conversational audience selector) it positions skilled tradespeople as job seekers rather than business owners.

**Files likely affected:**  
- `marketing/components/marketing/PricingCards.tsx`

**What good output looks like:**  
Provider card reads cleanly as "For service providers / Simple, fair access to customers" with "Join as a service provider" CTA.

**Acceptance criteria:**  
- Verified on pricing page
- `pnpm build` passes

**Risks:** None.

---

## Group 5: Hero copy

### TASK-M08 — Update Hero — "nearby workers" in subheadline

**Task to execute:**  
In `marketing/components/marketing/Hero.tsx`, update the subheadline:

Current: `"Describe your job. We match you with nearby independent workers, show you the provider profile and quote, and keep the decision in writing before anything starts. No app downloads. Just WhatsApp."`

New: `"Describe your job. We match you with a nearby local pro, share their profile and written quote for your approval, and keep everything confirmed in writing before work starts. No app downloads. Just WhatsApp."`

**Why it is needed:**  
The hero headline also uses "Nearby workers" — update to "Nearby local pros" at the same time:

Current headline: `"Get home help done right. Nearby workers, quoted in writing, on WhatsApp."`  
New headline: `"Get home help done right. Nearby local pros, quoted in writing, on WhatsApp."`

**Files likely affected:**  
- `marketing/components/marketing/Hero.tsx`

**What good output looks like:**  
Hero headline and subheadline contain no "workers". Language is "local pro" / "local pros".

**Acceptance criteria:**  
- Verified on homepage
- `pnpm build` passes

**Risks:** None.

---

## Group 6: About page

### TASK-M09 — Update About page — "workers" instances

**Task to execute:**  
In `marketing/app/(marketing)/about/page.tsx`, replace three instances of "workers"/"independent workers":

| Current | New |
|---|---|
| "skilled independent workers in their area" | "skilled local service providers in their area" |
| "skilled independent workers across South Africa have the ability to do the work" | "skilled local tradespeople across South Africa have the ability to do the work" |
| "independent workers who earn their living job to job" | "independent local service providers who earn job to job" |
| "Work comes to them on the WhatsApp they already use" | "Matched job leads reach them on the WhatsApp they already use" |

**Why it is needed:**  
The About page is the brand story. It sets the authoritative voice of the company. It should not use the word "workers" as a persona label.

**Files likely affected:**  
- `marketing/app/(marketing)/about/page.tsx`

**What good output looks like:**  
About page contains no "workers" or "independent workers" as persona labels. Language uses "service providers", "local tradespeople", or "local pros" consistently.

**Acceptance criteria:**  
- `grep -n "workers" marketing/app/\(marketing\)/about/page.tsx` returns no primary persona label uses
- `pnpm build` passes

**Risks:** None.

---

## Group 7: Features page tone

### TASK-M10 — Update Features page — headline and metadata

**Task to execute:**  
In `marketing/app/(marketing)/features/page.tsx`:

1. Update metadata `description`:  
   Current: `"WhatsApp booking, smart dispatch, technician PWA, auto-invoicing, extra work approval, and photo audit trail — all in one platform."`  
   New: `"See how Plug A Pro handles matching, quoting, job tracking, communication, and reviews — from first message to completed job."`

2. Update page headline:  
   Current: `"Platform features"`  
   New: `"How Plug A Pro keeps the job on track"`

3. Update page subline:  
   Current: `"Every part of the job lifecycle — booking, dispatch, execution, invoicing — managed in one connected platform."`  
   New: `"From the first message to the final photo, Plug A Pro keeps the quote, job status, and communication in one place — for customers and service providers both."`

**Why it is needed:**  
The current copy uses internal operations language ("smart dispatch", "technician PWA", "auto-invoicing"). It sounds like a B2B SaaS product demo page, not a community marketplace. It also exposes internal architecture language ("technician PWA") to public visitors.

**Files likely affected:**  
- `marketing/app/(marketing)/features/page.tsx`

**What good output looks like:**  
Features page reads as customer and service provider-facing value copy, not internal product language.

**Acceptance criteria:**  
- "technician PWA", "auto-invoicing", "smart dispatch" not visible in page title, subline, or metadata
- `pnpm build` passes

**Risks:** None.

---

## Group 8: Electrical scope correction

### TASK-M11 — Remove over-scoped electrical examples from Solutions page

**Task to execute:**  
In `marketing/app/(marketing)/solutions/page.tsx`, remove "Extending a power point or adding a switch" from the electrical service card examples.

Current example list for Electrical (minor):
- Light fitting installation or replacement
- Plug and socket faults
- DB board trip investigation
- Outdoor light and sensor fitting
- **Extending a power point or adding a switch** ← remove this

**Why it is needed:**  
"Extending a power point or adding a switch" involves new wiring and potentially triggers COC requirements under South African law. Including it in a "minor electrical" list overpromises on scope and creates compliance risk.

**Files likely affected:**  
- `marketing/app/(marketing)/solutions/page.tsx`

**What good output looks like:**  
Electrical card examples are limited to fault-finding, light fitting replacement, and sensor light fitting. No wiring extension tasks listed.

**Acceptance criteria:**  
- "Extending a power point" not present in the solutions page
- `pnpm build` passes

**Risks:** None.

---

## Group 9: SEO metadata alignment

### TASK-M12 — Update homepage metadata description

**Task to execute:**  
In `marketing/lib/metadata.ts` or the homepage `page.tsx` (whichever holds the root description), update the homepage metadata description:

Current: `"Find nearby handymen and home-job workers via WhatsApp. Get written quotes, choose who to book, and keep the job record in one place."`

New: `"Find nearby local pros for small home jobs. Describe what you need on WhatsApp, get a written quote, and track the job to completion. Free for customers."`

**Why it is needed:**  
"home-job workers" in the homepage meta description repeats the incorrect persona label. The new copy is also more direct and specific about the value (small jobs, written quote, free for customers).

**Files likely affected:**  
- `marketing/lib/metadata.ts`

**What good output looks like:**  
Homepage meta description contains no "workers" label and clearly states the key value props.

**Acceptance criteria:**  
- `<meta name="description">` in homepage source matches new copy
- `pnpm build` passes

**Risks:** May affect Google indexing in a minor way (neutral change — the new copy is not less descriptive).

---

## Group 10: Tests and checks

### TASK-M13 — Copy regression grep check

**Task to execute:**  
After all copy changes are implemented, run:

```bash
grep -rn "ServiceMen\|Hi ServiceMen" marketing/
grep -rn '"For workers"\|>For workers<\|label.*workers' marketing/components/ marketing/app/
grep -rn 'home-job worker' marketing/
grep -rn 'smart dispatch\|technician PWA\|auto-invoicing' marketing/app/
grep -rn 'Extending a power point' marketing/
```

All searches should return zero results. If any remain, fix before committing.

**Why it is needed:**  
Ensures no old phrasing slipped through. A single grep check covers all tasks above.

**Files likely affected:**  
None directly — this is a verification step.

**Acceptance criteria:**  
- All five grep commands return zero results
- `pnpm build` passes
- `pnpm lint` passes with no new errors

**Risks:** None.

---

### TASK-M14 — Manual WhatsApp CTA smoke test

**Task to execute:**  
After TASK-M01 is deployed:

1. Open the marketing site homepage
2. Tap "Chat on WhatsApp" (primary CTA)
3. Confirm WhatsApp opens with: `"Hi Plug A Pro, I need help with a small job."`
4. Tap "Start on WhatsApp" on the `/for-workers` page
5. Confirm WhatsApp opens with: `"Hi Plug A Pro, I'd like to register as a service provider."`

**Why it is needed:**  
The WhatsApp greeting is the first thing the business sees from a new lead. This must be verified manually — no unit test covers a real WhatsApp deep link.

**Acceptance criteria:**  
- Both greetings confirmed correct on mobile

**Risks:** None.

---

## Group 11: OpenBrain documentation

### TASK-M15 — Log completed content update to OpenBrain

**Task to execute:**  
After all TASK-M01 through TASK-M14 are complete and pushed, add an OpenBrain knowledge entry:

```bash
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/MobileApps/OpenBrain/backend && \
pnpm brain -- knowledge add \
  --project "Plug A Pro" \
  --domain "marketing" \
  --title "content update — persona language and WhatsApp greeting fix (2026-05-06)" \
  --tags "marketing,content,persona,whatsapp,copy" \
  --content "Fixed critical bug: WhatsApp greeting was 'Hi ServiceMen' (old brand). Updated to 'Hi Plug A Pro'. Replaced 'workers' persona label with 'service providers'/'local pros' across nav, footer, WhoItsFor, PricingCards, Hero, About, FAQ, and Features pages. Removed over-scoped electrical examples. Updated homepage and for-workers page metadata. See openbrain/marketing/ for audit, strategy, and copy rewrite docs."
```

**Why it is needed:**  
OpenBrain persistence ensures future Claude Code sessions inherit this context.

---

## Implementation sequence

Recommended order:

| Step | Task | Why first |
|---|---|---|
| 1 | TASK-M01 | Critical live bug — fix immediately |
| 2 | TASK-M02 | High visibility nav label |
| 3 | TASK-M03 | Footer must match nav |
| 4 | TASK-M04 | Primary provider acquisition page |
| 5 | TASK-M06 | Homepage component — WhoItsFor |
| 6 | TASK-M08 | Homepage hero copy |
| 7 | TASK-M07 | PricingCards |
| 8 | TASK-M09 | About page |
| 9 | TASK-M05 | FAQ metadata |
| 10 | TASK-M10 | Features page |
| 11 | TASK-M11 | Solutions electrical scope |
| 12 | TASK-M12 | Homepage metadata |
| 13 | TASK-M13 | Grep regression check |
| 14 | TASK-M14 | Manual smoke test |
| 15 | TASK-M15 | OpenBrain log |

All changes are copy-only. No new components, no schema changes, no new dependencies. Each task can be committed individually.

# Marketing Site Audit (per route) — 2026-07-06

Scope: all public routes of `marketing/` (plugapro.co.za). "Changes" reference `COPY_CHANGE_REGISTER.md` IDs. General note: the site ships copy guardrails (`banned-copy.ts`, `claim-taxonomy.ts`, `claimGuard.ts`) and live copy complied with the banned list before this audit; findings were impression-level, not banned-literal.

---

### `/` — Homepage
- **Purpose:** primary landing; converts both customers and providers.
- **Main message:** "Tell Plug A Pro what needs fixing… We help you get a nearby service provider" (hero, `content/marketing/homepage.ts:24-26`); sections: ProviderStory, ProblemStatement, HowItWorks, WhoItsFor, TrustSafety, OperatingModel, Features, CTAStrip.
- **Risky wording found:** "Profile reviewed" feature card (mild OV — accurate); TrustSafety explicitly disclaims ("does not remove every risk"). `localBusinessLd()` JSON-LD emitted.
- **Changes made:** CC-14 (LocalBusiness description clarifier). Text copy unchanged — already compliant.
- **Remaining concerns:** none material. **Recommendation:** safe for paid traffic.

### `/about`
- **Purpose:** mission/positioning prose.
- **Risky wording:** "finding a trustworthy person… Plug A Pro solves that"; "We match customers with skilled local service providers"; missing customer-decision step.
- **Changes:** CC-16 (both reworded; decision step added). "skilled local tradespeople" retained where it describes the SA workforce (RC-19, accepted).
- **Remaining concerns:** none. **Recommendation:** done.

### `/areas/[citySlug]` and `/areas/[citySlug]/[serviceSlug]` (12 area pages + city×service)
- **Purpose:** SEO landing pages (3 static cities via `content/areas/area-content.ts`).
- **Risky wording:** none in prose; structured data was the issue — `localBusinessLd` (city pages) and `serviceLd` with `provider: Plug A Pro` (city×service). Metadata "Plug A Pro routes {service} requests across {city}" implies operational routing (accurate — the platform does route requests).
- **Changes:** CC-13 (`serviceLd` provider→broker), CC-14.
- **Remaining concerns:** monitor GSC rich-result eligibility after the broker change. **Recommendation:** safe.

### `/blog`, `/docs`, `/changelog` (+ `[slug]`)
- **Purpose:** content marketing; currently EMPTY at launch — all MDX placeholders are `draft: true` and filtered (`lib/content.ts`).
- **Risky wording:** none rendered. **Changes:** none. **Recommendation:** apply the positioning guide + claimGuard to future editorial content before publishing.

### `/contact`
- **Purpose:** contact form. **Risky wording:** none. **Changes:** none. **Recommendation:** fine.

### `/credits-policy`
- **Purpose:** Provider Credits Terms (legal). **Main message:** credits are provider-side platform units, 1 credit = R50, not cash/customer wallet.
- **Risky wording:** none — "approved independent service providers" is correct framing. **Changes:** none. **Remaining concerns:** CPA prepaid-value review (attorney). **Recommendation:** keep; attorney review per TERMS_POLICY_REVIEW_NOTES §5.7.

### `/faq`
- **Purpose:** customer + provider FAQ; also emitted to Google as FAQPage rich results (`faqLd`).
- **Main message:** independent providers, written quotes, approval before work, support reviews records, licensing responsibility on providers.
- **Risky wording:** none — FAQ avoids "vetted/verified/guaranteed" entirely; "Your application is reviewed before you start receiving leads" is accurate.
- **Changes:** none on the page. Note: the AI chatbot carried a thinner FAQ without these disclaimers — fixed via CC-17/CC-18.
- **Remaining concerns:** keep `chat-context.ts` in sync with this page (backlog P1). **Recommendation:** safe; attorney sign-off on vetting/liability answers before scale (they are public structured data).

### `/features`
- **Purpose:** feature list from `homepage.ts`. **Risky wording:** "the platform handles matching, communication, written quotes, job records and support" — correct facilitation framing. **Changes:** none. **Recommendation:** fine.

### `/for-customers`
- **Purpose:** customer acquisition; journey + protections.
- **Main message:** request → match → quote → approve → provider does the job → review.
- **Risky wording:** "How we protect you" heading + "Here's how Plug A Pro builds it [trust]" — implied protection duty. Step copy already correct ("Provider arrives and does the job"; "Applications are reviewed before activation - … not a warranty of credentials, safety or workmanship").
- **Changes:** CC-15 (heading + subline).
- **Remaining concerns:** add the regulated-work advisory line (backlog P1). **Recommendation:** safe.

### `/for-providers` (+ `/for-workers` redirect)
- **Purpose:** provider acquisition (content from `content/marketing/provider.ts`, `provider-economics.ts`, `reviews.ts`).
- **Risky wording:** "Marketplace access is reviewed / Your application is reviewed before live marketplace access" — accurate, kept. (The SLA problem was on the **field-service** `/for-providers` page — fixed via CC-09.)
- **Changes:** none needed on the marketing page. **Recommendation:** fine.

### `/how-it-works`
- **Purpose:** process explainer (`content/marketing/how-it-works.ts`). **Risky wording:** none found. **Changes:** none. **Recommendation:** fine.

### `/onboarding`
- **Purpose:** role-select onboarding form. **Risky wording:** none found. **Changes:** none. **Recommendation:** fine.

### `/pricing`
- **Purpose:** early-access pricing ("free during early access"). **Risky wording:** none; ensure future pricing changes honour "We will communicate any future pricing clearly before it takes effect." **Changes:** none. **Recommendation:** fine.

### `/privacy`
- **Purpose:** POPIA privacy policy (de-facto POPIA page; no separate `/popia`).
- **Risky wording:** none — describes identity verification factually (liveness, selfie match scores, vendors Didit + Smile ID).
- **Changes:** none. **Remaining concerns:** operator list currency (Didit vs Smile ID), retention basis — attorney review. **Recommendation:** keep; attorney review.

### `/services` and `/services/[slug]` (+ `/solutions` redirect)
- **Purpose:** MVP service-scope matrix and per-service detail (`content/services/service-scope.ts`).
- **Risky wording:** "Plumbing/Appliance requests are screened first" (RC-18 — refers to job-request scope control, accepted); regulated electrical correctly excluded ("Use an appropriately qualified provider outside this MVP flow"). `serviceLd` provider claim — fixed.
- **Changes:** CC-13. **Recommendation:** safe.

### `/terms`
- **Purpose:** Terms of Service incl. §27 Refunds and §28 Provider Terms.
- **Risky wording:** none — this is the strongest protective surface (§2, §19, §27, §28).
- **Changes:** none. **Remaining concerns:** attorney items in TERMS_POLICY_REVIEW_NOTES. **Recommendation:** keep; attorney review before scale.

### `/trust`
- **Purpose:** Trust & Safety page (`content/marketing/trust.ts`).
- **Main message:** "Trust is built from records, not broad promises"; explicit independence and no-employee disclaimers.
- **Risky wording:** none — this page is the positioning model done right. **Changes:** none. **Recommendation:** use as the canonical reference for future trust copy.

### AI chatbot (`/api/chat` via `lib/chat-context.ts`)
- **Purpose:** generative visitor assistant.
- **Risky wording:** structural — no positioning guardrails; FAQ block thinner than `/faq` (no vetting/employment/liability entries), so the bot could improvise.
- **Changes:** CC-17, CC-18. **Remaining concerns:** sync mechanism with `/faq` (P1); visible AI-disclaimer (attorney note). **Recommendation:** monitor transcripts early on.

---

**Overall:** 20 routes reviewed; 4 marketing surfaces amended (about, for-customers, JSON-LD builders, chatbot context); everything else already conformed to the banned-copy guardrail. The marketing site is consistent with the terms and safe for paid acquisition; the gating items (Meta template re-submission, attorney review) live outside this site.

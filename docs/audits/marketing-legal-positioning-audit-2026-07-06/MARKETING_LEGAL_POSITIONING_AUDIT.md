# Marketing, Legal-Positioning, Terms, Policy & Platform Messaging Audit

**Date:** 2026-07-06
**Scope:** `marketing/` (public marketing site, plugapro.co.za) and `field-service/` (app.plugapro.co.za: customer/provider screens, WhatsApp templates and flows, notification copy).
**Branch:** `chore/positioning-audit` (off `main` @ `72688eff`)
**Companion documents:** `COPY_CHANGE_REGISTER.md`, `RISKY_CLAIMS_REGISTER.md`, `PLATFORM_POSITIONING_GUIDE.md`, `TERMS_POLICY_REVIEW_NOTES.md`, `MARKETING_SITE_AUDIT.md`, `BACKLOG_RECOMMENDATIONS.md`

> This audit was performed by an AI engineering assistant. It is **not legal advice**. Every item marked "attorney review" requires review by a qualified South African attorney (POPIA / CPA / ECTA).

---

## Executive Summary

The platform's messaging is **substantially coherent and unusually well-guarded for its stage**. The marketing site already ships a copy-governance layer (`marketing/content/marketing/banned-copy.ts`, `claim-taxonomy.ts`, `marketing/lib/marketing/claimGuard.ts`) that bans "vetted", "verified pro", "guaranteed", "background check" and similar claims — and the live marketing copy complies with it. The Terms of Service (§2, §19, §27, §28) correctly frame Plug A Pro as a technology marketplace that does not employ providers, does not perform the work and does not warrant workmanship.

The residual risk was concentrated in **four places**, all now amended in the repo:

1. **Live WhatsApp template bodies** carrying employer framing — most notably `technician_on_the_way` telling customers *"your Plug A Pro technician {{2}} is heading your way"*. This was the single strongest employer-impression claim on the platform, sent directly to customers. Reworded in-repo; **the approved bodies at Meta still send the old wording until re-submitted (P0 backlog item)**.
2. **An unqualified "✓ verified" badge** in the WhatsApp customer shortlist, backed only by ID-KYC — changed to "✓ ID verified".
3. **Three mutually contradictory provider-review SLA promises** ("within 30 minutes" / "under 24 hours" / "within 24 hours" / "approval is not automatic") — all aligned to "most within one business day; approval is not automatic".
4. **Structured data (`serviceLd`)** asserting Plug A Pro as the schema.org `provider` of each service — changed to `broker`, which is schema.org's term for an entity arranging an exchange between buyer and seller.

18 copy amendments were made in total (see `COPY_CHANGE_REGISTER.md`). No banned-list literals ("fully vetted", "guaranteed workmanship", "background-checked", "insured") were found anywhere in live customer-facing copy.

---

## Current Messaging Assessment

**Verdict: coherent, with localized drift.** The platform speaks with one voice in its legal pages, trust page, FAQ and provider onboarding: marketplace, independent providers, application review + identity verification only, customer chooses, provider is responsible for the work. The drift was in operational copy written earlier in the product's life (the `technician_*` WhatsApp templates from April 2026, the provider-signup confirmation screen, the customer-app recruitment page) which predates the positioning discipline visible in the newer marketing content collections.

Strong existing assets (unchanged, worth protecting):

| Asset | Location | What it does |
|---|---|---|
| Banned-copy list + claim taxonomy + claimGuard | `marketing/content/marketing/banned-copy.ts`, `claim-taxonomy.ts`, `marketing/lib/marketing/claimGuard.ts` | Machine-checkable list of banned claims and approved claims |
| Terms §2 "Platform Operator, Not Service Provider" | `marketing/app/(marketing)/terms/page.tsx:47-52` | "We are not the supplier of any field service. We do not employ Providers." |
| Terms §19 Limitation of Liability | `terms/page.tsx:265-280` | Not liable for quality/safety/outcome/legality of provider work; preserves CPA/POPIA rights |
| Terms §28 Service Provider Terms | `terms/page.tsx:476+` | Independent-contractor status; provider insurance/licence obligations; "Plug A Pro is not your employer" |
| Trust page disclaimers | `marketing/content/marketing/trust.ts:76-104` | "Trust is built from records, not broad promises"; "Plug A Pro does not supply employees" |
| Provider-trust helpers | `field-service/lib/provider-trust.ts` | "…does not claim licensing, background checks or workmanship guarantees unless a specific field says so" |
| Identity-consent copy | `field-service/lib/identity-verification/consent-service.ts:62` | Scopes verification to identity only, names vendor, withdrawal path |
| /for-customers disclaimer | `for-customers/page.tsx:79` | Application review is "not a warranty of credentials, safety or workmanship" |

---

## Main Legal / Positioning Risks (pre-amendment)

| # | Risk | Severity | Status |
|---|---|---|---|
| 1 | "your Plug A Pro technician" in live customer WhatsApp sends (employer impression) | **Critical** | Reworded in repo; Meta re-submission required (P0) |
| 2 | Unqualified "✓ verified" badge in customer shortlist (overstated vetting — badge backed by ID-KYC only) | **High** | Changed to "✓ ID verified" |
| 3 | Conflicting review-SLA promises (30 min / 24 h / no promise) | **High** (consumer-expectation / CPA angle) | Unified |
| 4 | `serviceLd` JSON-LD listing Plug A Pro as `provider` of the service | **Medium-High** (durable structured-data claim to Google) | Changed to `broker` |
| 5 | "They're highly rated" puffery asserted regardless of rating data | Medium | Reworded (Meta re-submission required) |
| 6 | AI chatbot lacked positioning guardrails and vetting/liability FAQ | Medium (generative surface can invent claims) | Guardrails + 2 FAQ entries added |
| 7 | "How we protect you" heading implying platform protection duty | Medium | Reworded |
| 8 | "skilled" / "trusted" adjectives in about/services copy | Low-Medium | Reworded where platform-claim-like; left where describing the market |
| 9 | `LocalBusiness` JSON-LD typing the platform as a local service business | Low | `description` clarifier added; refinement in backlog (P3) |
| 10 | `technician_*` template names (internal, but two leaked into body copy) | Low | Bodies fixed; renaming deferred to next re-registration (P1) |

---

## Marketplace Positioning Findings

- **Terms are correct and explicit.** §2 states Plug A Pro is a "technology marketplace and booking facilitation platform… not the supplier of any field service. We do not employ Providers." The service contract is customer↔provider. This is the anchor; marketing copy must never outrun it.
- **Marketing copy is aligned.** The tagline is "Find Independent Local Service Providers"; the site-wide description says "connect with independent local service providers". Hero/how-it-works copy uses intermediary verbs ("we help match", "we help you get").
- **Operational copy drifted.** WhatsApp dispatch templates ("your Plug A Pro technician", "has been assigned to your…") and the possessive help-menu label "Our providers" read as employer/dispatch language. All amended.
- **Structured data contradicted the terms.** `serviceLd()` asserted `provider: Plug A Pro` to search engines on every `/services/[slug]` and `/areas/[city]/[service]` page — schema.org semantics for "the entity providing the service". Amended to `broker`.
- The invoice PDF correctly says "issued by Plug A Pro on behalf of the service provider" (`field-service/lib/invoice/pdf.tsx:199`) — good.

## Vetting / KYC Claims Findings

- What the platform actually does: **application review before marketplace access** + **identity (ID/KYC) verification via a third-party vendor (Didit; privacy policy also names Smile ID)** + **document review where supplied**. `provider.verified` is set true only on KYC VERIFIED.
- The long-form copy states this accurately and repeatedly: `provider-trust.ts` ("not a blanket licence, safety or workmanship certification"), registration flow ("Submitting proof does not automatically mean Plug A Pro has verified it"), `/for-customers` ("not a warranty of credentials, safety or workmanship"), consent copy (identity only).
- The **short-form surfaces** did not carry the qualification: the bare "✓ verified" shortlist badge (fixed → "✓ ID verified") and the legacy `pref_verified` "verified only" filter (already retired from the live flow — legacy ID kept only for in-flight conversations; low residual risk).
- No copy anywhere claims criminal/background checks, insurance verification, or trade certification of providers. High-risk certification is handled as an extra-proof nudge (`provider_high_risk_cert_nudge`) — correctly framed.

## Customer Responsibility Findings

- `/faq` and `/for-customers` place quote approval with the customer ("You approve before any work starts"; extra work requires a new request). Good.
- The about page previously jumped from problem to "Plug A Pro solves that" without the customer-decision step; amended to "Customers review the provider's details and quote, then decide who to appoint."
- **Gap (attorney review + copy backlog):** no prominent customer-facing line advising customers to request certification/insurance documents for regulated or high-risk work (it exists in the terms and now in the chatbot FAQ, but not on `/for-customers` or in the booking flow). Recommended as P1 copy addition — see `BACKLOG_RECOMMENDATIONS.md`.

## Provider Responsibility Findings

- Terms §28 covers independent status, no employment relationship, provider responsibility for licences, insurance, tax (no PAYE/UIF), tools and conduct, plus an indemnity in favour of Plug A Pro. Provider FAQ explicitly pushes licensing responsibility to the provider ("For trade work where South African law requires a licence — such as plumbing — you are responsible for holding the right credentials").
- Registration flow requires evidence submission and states review is not automatic.
- **Gap (attorney review):** confirm there is an explicit, logged acceptance of §28 (or a provider-terms link) at the point of provider signup — the audit found the terms content but did not verify an acceptance checkpoint in the signup flow. See `TERMS_POLICY_REVIEW_NOTES.md`.

## Liability and Warranty Wording Findings

- Terms §19 caps liability to the amount processed for the job, excludes indirect damages and expressly preserves statutory CPA/POPIA rights — the right shape (attorney must confirm enforceability, especially against CPA s61 supplier-liability arguments).
- §27/§421-427: "The provider is responsible for workmanship… Plug A Pro does not become the provider of the service and does not guarantee workmanship or outcome unless expressly stated otherwise." Consistent with marketing.
- Support/dispute copy is correctly framed as review-and-assist, not outcome guarantee ("We review the written quote, job history, photos… We aim to respond within 5 business days").
- No "guarantee", "warranty", "insured" claims found in marketing or app copy outside the terms' own disclaimers.

## Payment / Refund / Dispute Wording Findings

- Terms §8: payment facilitation via third-party PSPs, no card storage; §27 contains a full refund/cancellation matrix; provider credits are governed by a separate `/credits-policy` (1 credit = R50, provider-side units, not customer wallet, non-refundable with exceptions).
- WhatsApp payment templates ("payment_received", "payment_reminder", wallet templates) are transactional and neutral.
- **Attorney review items:** whether the refund matrix satisfies CPA cooling-off/refund provisions; whether "funds arrive in 1–2 business days" (`technician_payment_released`) is contractually safe; whether the credits non-refundability language is CPA-compatible.

## Privacy / POPIA Wording Findings

- `/privacy` (updated 29 May 2026) is a structured POPIA policy: responsible party, customer/provider categories, KYC data (liveness, selfie match scores), WhatsApp/Meta processing, ~5-year retention, POPIA rights, cross-border transfer, Information Regulator contact. It is the strongest legal surface on the site.
- **Verify operator list currency:** the policy names Didit and Smile ID as identity-verification vendors. Didit is the live KYC vendor (GA 2026-07-04/05); confirm whether Smile ID is still used, and whether all current operators (PSPs Peach/PayFast, Vercel/hosting, analytics/GA4, Meta WhatsApp) are adequately disclosed. **Attorney review required.**
- KYC consent copy in-product names the vendor and offers withdrawal — aligned with the policy.
- No privacy claims found in marketing copy that exceed the policy.

## WhatsApp / Notification Copy Findings

~50 templates in `field-service/lib/messaging-templates.ts` plus freeform flow copy. Findings:

- **Amended (repo):** `technician_assigned`, `technician_on_the_way`, `extra_work_approval`, `customer_match_found` bodies; `register-whatsapp-templates.mjs` divergent bodies for `technician_assigned` and `technician_application_received`; shortlist "✓ verified" label; help-menu "Our providers" label and body.
- **Critical operational note:** template bodies live at Meta once approved. The in-repo rewording does **not** change live sends until new bodies are submitted and approved at Meta. Until then customers still receive "your Plug A Pro technician…". This is the top P0 backlog item. Placeholder count/order was kept identical in every rewording, so no Meta error-132000 risk was introduced.
- **Divergences found:** `register-whatsapp-templates.mjs` carried older bodies for `technician_application_received` (24-hour SLA promise — now aligned) and still carries a stale `technician_welcome` body ("Download the app — jobs are waiting!") that diverges from `messaging-templates.ts`; flagged, not positioning-critical.
- Mitigating copy that already existed and was preserved: registration-flow proof disclaimers, `provider_kyc_nudge` identity framing, `no_technician_available` ("could not match a provider" — correctly humble).
- No email/SMS template system exists in the repo (WhatsApp + Supabase OTP only), so there was nothing further to audit there.

## Marketing Site Findings

Per-route detail in `MARKETING_SITE_AUDIT.md`. Summary: 20 public routes reviewed; blog/docs/changelog are empty at launch (placeholders `draft: true`); legal surfaces consolidated in `/terms`, `/privacy`, `/credits-policy`; amendments made on `/about`, `/for-customers`, JSON-LD builders and the AI chatbot context; everything else already compliant with the banned-copy list.

---

## Recommended Final Positioning

Canonical paragraph (use everywhere; long/short variants in `PLATFORM_POSITIONING_GUIDE.md`):

> Plug A Pro helps you find and connect with independent local service providers. You can request a job, review provider information and quotes, approve the work, and track progress through the platform and WhatsApp. Providers operate independently, and clients remain responsible for choosing the right provider for their job. Provider applications are reviewed and identity (ID/KYC) verification is performed before marketplace access — this confirms identity, not skill, licensing, insurance or workmanship. For regulated or high-risk work, ask the provider for the relevant certification or insurance documents before work begins.

## Legal Review Required (attorney, South Africa)

1. Terms §19 liability cap vs CPA s61 (product/service liability) and s51 (prohibited terms).
2. Refund/cancellation matrix (§27) vs CPA cooling-off and refund rights.
3. §28 independent-contractor framing vs Labour Relations Act deemed-employment risk (especially s200A presumption) given platform-mediated work.
4. POPIA: operator list completeness/currency (Didit vs Smile ID), retention (~5 yr) justification, cross-border transfer conditions (§72), WhatsApp/Meta processing disclosures.
5. Whether an explicit provider acceptance checkpoint of §28 exists and is logged at signup.
6. Marketing claims review under CPA s29/s41 (false, misleading or deceptive representations) — the amended copy was written to reduce this risk but has not been legally signed off.
7. Credits non-refundability vs CPA prepaid instruments rules.

## Final Recommendation

The messaging model is sound and now consistent in-repo. **Two things gate paid-acquisition scaling:** (1) re-submit the four reworded WhatsApp bodies to Meta so live customer sends stop saying "your Plug A Pro technician"; (2) attorney sign-off on the terms/privacy items above. The marketing site itself is safe to run traffic to today — its copy, guardrails and legal pages are aligned; the residual exposure is in the message channel, not the website.

---

## Addendum — 2026-07-06 execution (post-audit correction of record)

Direct inspection of the WABA (`GET /message_templates?fields=components`) after this audit was written revealed the approved bodies at Meta **differ from the repo's documented mirrors**:

| Template | Approved body at Meta (before this session's edits) | Correction to the findings above |
|---|---|---|
| `technician_on_the_way` | "Hi {{1}}, **your provider** {{2}} is heading your way now…" | **RC-01 downgrades from Critical**: "your Plug A Pro technician" existed only as a stale in-repo mirror and was **never sent to customers**. Live body was already positioning-safe. No Meta edit needed; repo example now mirrors the true live body. |
| `extra_work_approval` | "Hi {{1}}, **your provider** has found additional work needed: {{2}} ({{3}}). Approve or decline here: {{4}}…" (4 body params, no button) | Wording already safe, BUT a **latent functional bug** was found: code sends 3 body params + URL button → every live send failed Meta 132000. Fixed by editing the template to 3 params + URL button (`/approve/{{1}}`) and correcting `sendExtraWorkApproval` to pass the token suffix (`lib/whatsapp.ts`). |
| `technician_assigned` | "…{{2}} has been **assigned** to your {{3}}…" | Finding stands. Body edit submitted to Meta 2026-07-06 (id 1247377794223650). |
| `customer_match_found` | "They're **highly rated** and ready to assist you." | Finding stands. Body edit submitted to Meta 2026-07-06 (id 1508767677372957), URL button preserved. |

**P0-1 status: executed 2026-07-06.** Three template edits accepted by Meta (all `PENDING` review at time of writing; UTILITY edits typically auto-approve quickly). During the PENDING window sends of the three edited templates fail — accepted risk at pilot volume, and `extra_work_approval` was already failing 100% of sends due to the param mismatch. `customer_match_found` has a documented fallback chain in the post-match sender.

**Lesson recorded:** repo `example` strings are documentation, not source of truth — always verify approved bodies via the API before asserting what customers receive.

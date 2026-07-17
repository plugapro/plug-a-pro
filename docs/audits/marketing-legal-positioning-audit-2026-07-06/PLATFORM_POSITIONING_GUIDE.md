# Plug A Pro — Platform Positioning Guide

**Date:** 2026-07-06 · Internal copywriting reference. Applies to marketing site, app screens, WhatsApp/notification copy, ads, social, chatbot and future channels.

**Enforcement mechanism (already in repo):** `marketing/content/marketing/banned-copy.ts` (banned literals), `marketing/content/marketing/claim-taxonomy.ts` (approved claims), `marketing/lib/marketing/claimGuard.ts` (checker). New copy should pass claimGuard; extending enforcement to `field-service/` copy is backlog P2.

---

## 1. Approved descriptions

**One-liner (tagline):**
> Find Independent Local Service Providers

**Short description (meta/socials/ads):**
> Plug A Pro helps South Africans request small home jobs and connect with independent local service providers through WhatsApp and the PWA.

**Long description (canonical positioning paragraph):**
> Plug A Pro helps you find and connect with independent local service providers. You can request a job, review provider information and quotes, approve the work, and track progress through the platform and WhatsApp. Providers operate independently, and clients remain responsible for choosing the right provider for their job. Provider applications are reviewed and identity (ID/KYC) verification is performed before marketplace access — this confirms identity, not skill, licensing, insurance or workmanship. For regulated or high-risk work, ask the provider for the relevant certification or insurance documents before work begins.

## 2. Approved "How it works"

1. **Describe your job** — message Plug A Pro on WhatsApp or use the app. Photos help providers quote accurately.
2. **Get matched** — we help match your request to nearby independent providers based on skills and area.
3. **Review and approve** — the provider sends a written quote. Review the provider's details and the quote, then approve before any work starts. Extra work needs a new approval.
4. **Job happens, records kept** — the provider does the work; quotes, updates and communication stay on the platform as a written record.
5. **Rate and review** — your review is tied to the completed job and builds the provider's track record.

## 3. Approved client-facing disclaimer

> Providers on Plug A Pro are independent service providers, not employees of Plug A Pro. Application review and ID verification confirm identity and marketplace eligibility — they are not a warranty of credentials, safety or workmanship. Review the provider's details and quote before approving work, and for regulated or high-risk work (like fixed electrical installations or gas), ask the provider for the relevant certification, registration or insurance documents.

(Existing equivalents to keep: `for-customers/page.tsx:79`, `content/marketing/trust.ts:76-104`, `lib/provider-trust.ts` descriptions.)

## 4. Approved provider-facing disclaimer

> You are an independent service provider, not an employee, agent or partner of Plug A Pro. You are responsible for the accuracy of your profile, your qualifications and credentials, your tools, transport, insurance, taxes, the quality and safety of your work, and compliance with the laws that apply to your trade. Misleading information, unsafe work, fraud or poor conduct can lead to suspension or removal. Application review and identity verification are conditions of marketplace access — approval is not automatic.

(Anchored in Terms §28; keep signup flow copy consistent with it.)

## 5. Approved KYC / ID verification wording

- ✅ "Provider applications are reviewed before marketplace access."
- ✅ "Providers complete identity (ID/KYC) verification."
- ✅ "ID verified" (badge — never bare "verified")
- ✅ "Application reviewed by Plug A Pro" — only when paired with the no-guarantee qualifier
- ✅ "This review allows the provider to receive marketplace leads. It is not a blanket licence, safety or workmanship certification." (`provider-trust.ts:111`)
- ✅ "Submitting proof does not automatically mean Plug A Pro has verified it. Our review team will check it during application review." (registration flow)
- ✅ Consent copy naming the vendor and identity-only scope (`consent-service.ts:62`)

## 6. Approved WhatsApp wording patterns

| Situation | Use | Never |
|---|---|---|
| Match found | "We've matched your {service} request with {name}. You can review their details and quote before approving anything." | "They're highly rated and ready to assist you." |
| Provider confirmed | "Independent provider {name} is confirmed for your {service} on {date}." | "{name} has been assigned to you" |
| En route | "Your service provider {name} is heading your way now." | "Your Plug A Pro technician…" / "Your verified expert…" |
| Extra work | "Your service provider has identified additional work needed: … Approve or decline." | "Our technician found more problems" |
| No match | "We could not match a provider for your request." | anything implying dispatch failure of "our team" |
| Application received | "We will review your details and update you here. Approval is not automatic." | any fixed review-time promise |

## 7. Words and claims to AVOID (banned)

From `banned-copy.ts`, extended by this audit:
- "vetted", "fully vetted", "fully verified", "verified pro/provider/profile", bare "verified" badges
- "guaranteed", "guarantee", "guaranteed workmanship", "risk-free", "safe and risk-free"
- "certified", "approved tradesmen", "skill-approved", "background-checked", "screened providers"
- "insured", "all providers are insured"
- "our technician", "our plumber/electrician/handyman", "your Plug A Pro technician", "we send our…", "our team will fix"
- "we provide the service", "we fix", "we take responsibility for the job"
- "contractor", "worker", "gig", "job seeker" (positioning + tone), "unlimited earnings", "earn more"
- "fixed price", "instant booking", "on-demand", "AI-powered"
- Hard SLAs: "within 30 minutes", "within 24 hours" (use "most within one business day" + "approval is not automatic")

## 8. Words and claims that are ALLOWED

- "independent local service providers", "independent provider", "service provider"
- "we help match", "we connect", "request quotes", "review provider information"
- "application reviewed before marketplace access", "ID verified", "identity verification"
- "written quote", "written record", "job records", "ratings and reviews from completed jobs"
- "skilled local tradespeople" — only when describing the market/provider population, never as "our skilled providers"
- "Plug A Pro helps facilitate discovery, communication, booking and job tracking"
- "support reviews the records and helps resolve issues" (never "we'll make it right", never outcome guarantees)

## 9. Example copy

**Homepage hero:**
> Something broken at home? Tell Plug A Pro what needs fixing on WhatsApp. We help you get a written quote from a nearby independent service provider — you review it and approve before any work starts.

**Provider onboarding:**
> Turn your skills into steady local work. Apply once with your skills, areas and experience. Applications are reviewed before approval — most within one business day. Identity verification is required before you can receive leads. You stay independent: your work, your reputation, your business.

**Customer booking:**
> Pick a category and describe your job. We'll match you with independent local providers. Review each provider's details and written quote — you decide who to appoint, and nothing starts until you approve.

**FAQ — "Are providers vetted?":**
> Provider applications are reviewed before marketplace access, and providers complete ID verification. That confirms who they are and that they qualify to receive leads — it is not a guarantee of skill, licensing, insurance or workmanship. Review the provider's profile, ratings and quote before approving work. For regulated work (like fixed electrical installations), ask the provider for the relevant certification.

**FAQ — "Who is responsible for the work?":**
> The provider you appoint. Providers on Plug A Pro are independent service providers who are responsible for the quality, safety and legality of their work. Plug A Pro keeps the written record — the quote, updates and communication — and support will review those records and help if something goes wrong.

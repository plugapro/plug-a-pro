# Plug A Pro Platform Content Alignment Audit

Date: 2026-05-29
Status: Draft policy/content implementation completed for product alignment. Attorney review still required before treating the wording as final legal advice.

## Official legal sources checked

- Consumer Protection Act 68 of 2008, official gov.za page and SAFLII consolidated text: https://www.gov.za/documents/consumer-protection-act and https://www.saflii.org/za/legis/consol_act/cpa2008246/
- Electronic Communications and Transactions Act 25 of 2002, official gov.za page and SAFLII consolidated text: https://www.gov.za/documents/electronic-communications-and-transactions-act and https://www.saflii.org/za/legis/consol_act/ecata2002427/
- Information Regulator POPIA resources and complaints guidance: https://inforegulator.org.za/ and https://inforegulator.org.za/complaints/

Do not treat the implementation wording as final legal advice. CPA prepaid credit/voucher classification, ECTA online transaction cancellation rules, POPIA retention/security wording, payment processor chargebacks, and provider-credit accounting treatment require attorney review.

## Implemented product behaviour summary

| Area | Implemented behaviour | Evidence |
| --- | --- | --- |
| Customer request | Customer PWA captures structured address, job title/details, access notes, urgency, preferred timing, provider/budget preference, max call-out, photos, privacy acknowledgement, and terms acknowledgement. | `field-service/components/customer/BookingFlow.tsx` |
| Request creation | `POST /api/customer/bookings` creates a marketplace `JobRequest`, uploads customer photos, opens/defers matching depending on flags, and sends a WhatsApp request-submitted notification. | `field-service/app/api/customer/bookings/route.ts`, `field-service/lib/job-requests/create-job-request.ts` |
| Contact privacy | Customer WhatsApp copy states exact address and phone are shared only after the customer selects a provider and that provider accepts the job. | `field-service/lib/client-pwa-submission-notifications.ts` |
| Provider selection/acceptance | Credit flow runs after customer selection and provider final acceptance, with identity and wallet checks before accepted-lock. | `field-service/lib/selected-provider-acceptance.ts` |
| Credit deduction | `LEAD_UNLOCK_DEBIT` is created only during selected-provider credit application. Preview, interest, shortlist, decline, expiry, insufficient balance, and failed acceptance do not debit credits. | `field-service/lib/provider-credit-application.ts`, `field-service/lib/provider-wallet.ts` |
| Credit wallet | Wallet is ledger-first, separates paid and promo credits, consumes promo first, and records credits, debits, refunds, admin adjustments, and reversals. | `field-service/lib/provider-wallet.ts` |
| Credit top-up | Paid top-ups are R100/R200/R500 packages, may require identity verification, and credit only after processor/manual reconciliation confirmation. | `field-service/lib/provider-credit-payment-intents.ts`, `field-service/lib/provider-credit-reconciliation.ts`, `field-service/lib/provider-credit-gateway-itn.ts` |
| Credit disputes | Refundable lead-credit dispute reasons are invalid customer number, duplicate lead, wrong category, wrong location, customer did not request, and cancellation before unlock. Approved disputes restore credits through ledger entries. | `field-service/lib/lead-unlock-disputes.ts` |
| Trust signals | Provider profile details are mostly provider-supplied. Marketplace review is lead eligibility, not blanket licence, safety, or workmanship certification. | `field-service/lib/provider-trust.ts` |
| Privacy flows | Marketing captures name/WhatsApp/email/message depending on form, stores marketing leads in Supabase, uses Google Analytics, and operational app uses WhatsApp/Meta, Supabase, Vercel, payment processors, Google location services, and Sentry/logging where enabled. | `marketing/app/api/leads/route.ts`, `marketing/app/layout.tsx`, `field-service/next.config.ts`, payment/provider wallet files |

## Page-by-page audit

| Route | File | Previous headline/key claims | Issue found | Replacement implemented |
| --- | --- | --- | --- | --- |
| `/free-templates` | `marketing/app/(marketing)/free-templates/page.tsx` | "WhatsApp Template Pack for Service Businesses"; "technician dispatched"; "3-15 technicians" | Implied Plug A Pro serves service companies/technicians rather than marketplace providers. | Reframed as templates for independent service providers and small service teams; replaced technician copy with provider copy. |
| `/trust` | `marketing/app/(marketing)/trust/page.tsx` | "Before and after photos on every job"; dispute "resolution" wording; inconsistent "Plug a Pro" casing | Overstated photo requirement and sounded like Plug A Pro decides legal outcomes. | Softened to photos/job notes where available, manual support review, platform-facilitated next steps, no guarantee of identity/licensing/safety/workmanship unless a specific check is shown. |
| `/refund-policy` | `marketing/app/(marketing)/refund-policy/page.tsx` | Customer Credits, Credits-funded bookings, mixed credit/card refunds | Incorrectly implied a customer credit wallet and mixed customer credit checkout. | Rebuilt policy to separate platform-facilitated customer payments, direct/off-platform payments, provider credit purchase reversals, lead-credit deductions, settlement deductions, and statutory-rights caveats. |
| `/provider-terms` | `marketing/app/(marketing)/provider-terms/page.tsx` | "Credits and Credit-Funded Bookings" with Customer Credits | Conflicted with implemented provider-only credit wallet. | Replaced with Provider Credits section covering provider-side units, deduction trigger, no-deduction cases, non-refund caveat, and link to credit rules. |
| `/terms` | `marketing/app/(marketing)/terms/page.tsx` | Generic Credits definition; credits applied at checkout; named stale payment processors | Implied customer credits and stale payment processor model. | Replaced with Provider Credits definition, customer/payment separation, direct-payment caveat, generic processor wording, and provider-credit abuse language. |
| `/solutions` | `marketing/app/(marketing)/solutions/page.tsx` | "Small jobs done right"; "trusted local provider" | Could imply outcome guarantee or unsupported trust claim. | Reframed as finding independent providers for small jobs and added concise platform-role disclaimer. |
| `/privacy` | `marketing/app/(marketing)/privacy/page.tsx`, `marketing/next.config.ts` | "marketing site uses no cookies"; limited data/processor list | Conflicted with Google Analytics and omitted implemented job/credit/payment/support data flows. Local browser QA also showed the CSP blocked Google Analytics even though the layout loaded it. | Rebuilt policy around actual customer/provider data, WhatsApp, photos, credits, payments, support, analytics, processors, POPIA rights, retention, breach notification, and opt-out. Updated marketing CSP to allow the configured Google Analytics endpoints. |
| `/credits-policy` | `marketing/app/(marketing)/credits-policy/page.tsx` | Thin provider-credit rules | Missing purchase/refund exceptions, promo vs paid split, expiry/legal review, dispute reasons, and audit logs. | Expanded provider credit rules with exact deduction trigger, no-deduction cases, paid/promo/voucher distinction, non-refund caveat, expiry caution, audit logs, and support query process. |
| `/credit-terms` | `field-service/app/credit-terms/page.tsx` | Non-refundable once consumed, promo expiry 90 days, automatic return if customer cancels within 2 hours | Automatic 2-hour refund was not found in implemented credit logic; wording was too absolute. | Updated in-app terms to match selected-provider acceptance, legal caveats, dispute reasons, expiry caveat, and audit records. |
| `/provider/terms/credits` | `field-service/app/provider/terms/credits/page.tsx` | Provider-credit terms with incomplete refund/expiry/audit detail | Needed same canonical rules as public credit policy. | Updated to match provider-side credit model and legal caveats. |
| Provider wallet note | `field-service/components/provider/credits/index.tsx` | "Credits never expire." | Absolute expiry claim needs legal review. | Changed to "Purchased credits do not currently expire" and separated promo/voucher campaign rules. |
| Footer | `marketing/components/shared/Footer.tsx` | "Services" | Link was correct but label was less precise. | Renamed to "Service categories"; existing legal footer links remain present. |
| `/for-customers`, `/faq` | Public linked support pages | "before-and-after photos every job"; "our providers" | Same overclaim/platform-role issue outside the requested list. | Softened photos wording and provider ownership language. |

## Recommended legal/policy information architecture

1. `/terms` - umbrella platform terms for customers and providers.
2. `/provider-terms` - provider-specific obligations and marketplace participation rules.
3. `/credits-policy` - canonical provider credit rules for public/legal use.
4. `/credit-terms` and `/provider/terms/credits` - in-app provider credit summaries aligned to `/credits-policy`.
5. `/refund-policy` - customer payment refunds, provider credit reversals, settlement deductions, and direct/off-platform payment caveats.
6. `/privacy` - POPIA-facing privacy policy covering marketing site, PWA, WhatsApp, payments, provider verification, credits, support, and analytics.
7. `/trust` - practical trust/safety explanation, with no unsupported verification or workmanship claims.

## Draft copy rules now applied

- Use "independent service provider", "provider", "platform", "customer", "lead", "booking", "quote", and "provider credits" consistently.
- Say Plug A Pro facilitates intake, matching, quote flow, communication, job records, support, and payments/credits where implemented.
- Do not say Plug A Pro performs, repairs, dispatches employed technicians, guarantees workmanship, guarantees safety, guarantees licensing, or guarantees provider conduct.
- State that independent providers are responsible for their own work, tools, licensing, insurance, tax, safety compliance, site conduct, and workmanship.
- State that written quotes, job records, approvals, photos where available, status updates, and WhatsApp messages help reduce disputes.
- State that extras must be approved in writing through the Platform before work proceeds.
- State that provider credits are used by providers to accept customer-selected opportunities, not by customers to buy services from Plug A Pro.

## Legal-review checklist

- CPA classification of provider credits: B2B platform access fee vs prepaid certificate/credit/voucher, including whether small providers may be treated as protected consumers.
- CPA section 63/64 treatment of prepaid credits, expiry, unredeemed value, and "generally non-refundable" wording.
- ECTA online transaction, disclosure, cancellation, and cooling-off impact on provider top-ups and customer bookings.
- Enforceability of non-refund wording for purchased provider credits and permitted exception wording.
- Whether promotional, starter, onboarding, or voucher credits can expire and what notice is required.
- Accounting/tax treatment for admin credit reversals, payment reversals, chargebacks, and goodwill adjustments.
- Whether payment processor chargebacks or Pay@/PayAt/PayFast rules override platform refund wording.
- Whether Plug A Pro holds customer funds, only facilitates payment, or both, and how this changes refund/settlement wording.
- Whether provider identity, licence, certification, or insurance checks are actually performed before any "verified" or "reviewed" claim appears.
- POPIA treatment of provider identity numbers, licence/certification documents, WhatsApp conversations, photos, support records, analytics, logs, and retention periods.
- WhatsApp consent, transactional vs marketing message split, direct marketing opt-out implementation, and consent evidence.
- Dispute language: confirm it does not make Plug A Pro an arbitrator, guarantor, service supplier, employer, agent, partner, or subcontractor.

## QA checklist

- Confirm `/free-templates`, `/trust`, `/refund-policy`, `/provider-terms`, `/terms`, `/solutions`, `/privacy`, `/credits-policy`, `/credit-terms`, and `/provider/terms/credits` render on desktop and mobile.
- Confirm footer links route to `/privacy`, `/terms`, `/credits-policy`, `/refund-policy`, `/provider-terms`, and `/trust`.
- Confirm metadata titles/descriptions render and do not describe Plug A Pro as a service provider.
- Search public source for "Customer Credits", "Credits-funded", "paid with Credits", "technician dispatched", "we send a technician", "trusted local provider", "credits never expire", and absolute "no refunds" wording.
- Run marketing lint/test/build.
- Run field-service typecheck/lint and provider-wallet/lead-unlock-dispute focused tests.
- Confirm no mobile text overflow on long legal headings and provider credit notes.

## OpenBrain implementation note template

Title: legal-content - platform positioning and provider credit policy alignment (2026-05-29)

Tags: legal-content, marketing-copy, provider-credits, refund-policy, privacy, platform-positioning

Content:

```
Root cause
- Marketing/legal pages still carried older service-provider and generic/customer-credit assumptions after the platform was rebuilt around customer requests, provider selection, WhatsApp/PWA handoff, and provider-side credits.

Fix applied
- Rewrote public credit, refund, terms, provider terms, privacy, trust, solutions, and free-template copy to describe Plug A Pro as a marketplace/platform.
- Updated in-app provider credit terms and wallet note to match selected-provider credit deduction logic.
- Added audit artifact with legal-review and QA checklists.

Result
- Public and in-app copy now separates customer service payment refunds from provider credit purchase/lead-credit reversals.
- Provider credits are consistently described as provider-side platform units.
- Unsupported verification, workmanship, safety, technician, and customer-credit claims were removed or softened.

Outstanding legal review
- CPA/ECTA treatment of provider credits and expiry.
- Non-refund enforceability and chargeback/payment processor overrides.
- POPIA retention/security wording and WhatsApp marketing consent implementation.
```

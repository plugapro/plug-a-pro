# Terms & Policy Review Notes — 2026-07-06

> Written by an AI engineering assistant. **This is not legal advice.** Every item below marked "attorney review" requires a qualified South African attorney (POPIA / CPA / ECTA / LRA). The notes describe intent in plain English so the attorney brief is efficient.

Legal surfaces reviewed: `/terms` (Terms of Service, 29 sections, last updated 29 May 2026), `/privacy` (POPIA Privacy Policy, 15 sections), `/credits-policy` (Provider Credits Terms). Provider terms = Terms §28 (`#provider-terms`); refunds = §27 (`#refunds`). No standalone `/popia`, `/provider-terms` or `/client-terms` routes — content is consolidated, which is acceptable if linked correctly (it is).

---

## 1. Clauses that appear sound (keep; confirm at attorney review)

| Clause | Location | Why it appears sound |
|---|---|---|
| Platform role: "Platform Operator, Not Service Provider… We are not the supplier of any field service. We do not employ Providers." | Terms §2 (`terms/page.tsx:47-52`) | Directly establishes intermediary status; matches marketing |
| Vetting disclaimer: no promise of "identity, qualifications, licensing, legality, safety or quality… except where expressly stated in writing" | Terms §2 (`:60-64`) | Correctly scopes onboarding checks |
| Workmanship: "The provider is responsible for workmanship… does not guarantee workmanship or outcome" | Terms (`:421-427`) | Matches marketplace model |
| Independent-contractor status; "Plug A Pro is not your employer"; no PAYE/UIF; provider insurance/licence obligations; indemnity | Terms §28 (`:476-517, 627, 647`) | Pushes work responsibility to provider |
| Limitation of liability: cap at amount processed for the job; excludes indirect damages; preserves CPA/POPIA statutory rights | Terms §19 (`:265-280`) | Right structure; enforceability needs attorney confirmation |
| Payments: facilitation via third-party PSPs; no card storage | Terms §8 | Matches implementation (Peach/PayFast) |
| Refund/cancellation matrix | Terms §27 | Exists and is detailed |
| POPIA policy structure: responsible party, data categories incl. KYC biometrics/scores, WhatsApp/Meta processing, retention, rights, Information Regulator | `/privacy` | Comprehensive for stage |
| Credits: platform units, not cash/wallet; deduction and expiry rules | `/credits-policy` | Clear scoping |

## 2. Clauses that are missing or unverified

1. **Provider acceptance checkpoint (unverified).** The audit found §28 content but did not verify that provider signup captures explicit, logged acceptance of §28/terms at registration (web + WhatsApp registration paths). *Intent:* provider cannot receive leads without a recorded terms acceptance (timestamp, version). **Attorney review + engineering verification.**
2. **Chatbot output disclaimer.** The marketing AI chat has positioning guardrails (added 2026-07-06) but no user-visible "AI assistant — answers are informational, terms prevail" disclaimer. *Intent:* generative answers do not create contractual representations. **Attorney review.**
3. **Customer high-risk-work advisory outside terms.** The "ask for certification/insurance for regulated work" advisory lives in terms + (new) chatbot FAQ, but not in the booking flow or /for-customers. *Intent:* the customer sees the advisory where the decision happens, not only in legal pages. Copy backlog P1; wording exists in the positioning guide.
4. **Dispute-process definition.** FAQ says support reviews records and "aims to respond within 5 business days", terms say Plug A Pro may assist; there is no documented end-to-end dispute procedure (stages, outcomes, escalation to CGSO/ombud where applicable). *Intent:* a customer knows what dispute support can and cannot result in. **Attorney review.**
5. **Payment-failure edge cases.** Terms cover refunds/cancellations; verify explicit coverage of "payment succeeded but job not completed / provider no-show after payment" including who holds funds and release conditions. *Intent:* money-flow outcomes are defined for every failure mode. **Attorney review.**

## 3. Clauses that are unclear

1. **"except where expressly stated in writing" (Terms §2)** — now that "✓ ID verified" badges and "Application reviewed by Plug A Pro" labels exist, do those constitute "expressly stated in writing" representations of identity? Probably intended yes for identity only; the boundary should be stated. **Attorney review.**
2. **Liability cap reference point** — "amount processed for the job" is unclear for jobs cancelled pre-payment or credits-only interactions (provider side). **Attorney review.**
3. **Retention "~5 years"** in privacy policy — confirm the statutory basis per data category (FICA-adjacent KYC data vs chat logs vs job photos). **Attorney review.**

## 4. Contradictions with marketing copy (found and resolved in-repo)

| Contradiction | Resolution |
|---|---|
| Terms: "we do not employ Providers" vs WhatsApp: "your Plug A Pro technician" | Template bodies reworded (CC-01–03); Meta re-submission pending (P0) |
| Terms: no promise of qualifications/quality vs "They're highly rated" blanket claim | Reworded (CC-04) |
| Terms: review-based onboarding vs "within 30 minutes"/"within 24 hours" SLA promises | Unified to "most within one business day; approval is not automatic" (CC-06, CC-08, CC-09) |
| Terms: not the supplier of services vs `serviceLd` `provider: Plug A Pro` structured data | Changed to `broker` (CC-13) |

No remaining marketing↔terms contradictions are known after the amendments.

## 5. Items needing South African attorney review (consolidated brief)

1. **CPA s29/s41** — review amended marketing + WhatsApp copy for misleading-representation exposure; sign off the positioning guide.
2. **CPA s51/s48-49** — enforceability of the §19 liability cap and §28 indemnity; whether any term is a prohibited/unfair term; plain-language requirements.
3. **CPA s61** — supplier-liability chain analysis: can Plug A Pro be treated as "supplier" for defective services facilitated through the platform despite §2?
4. **LRA s200A / deemed employment** — platform-mediated work, credits-to-access model and matching control vs independent-contractor framing in §28.
5. **POPIA** — operator register completeness (Didit live since 2026-07-04/05; policy also names Smile ID — confirm current), biometric special-personal-information conditions, retention schedule justification, cross-border transfers (§72), Meta/WhatsApp joint-processing disclosures.
6. **ECTA** — electronic contracting formalities for terms/§28 acceptance and quote approvals via WhatsApp.
7. **Credits (prepaid value)** — CPA s63 prepaid certificates/vouchers implications for non-refundable credits and expiry.
8. **FAQ rich results** — FAQ answers are published to Google via FAQPage JSON-LD; confirm attorney-reviewed wording for the vetting/liability answers before scaling.

## 6. Plain-English legal intent per gap (for drafting)

- *Provider acceptance:* "No provider receives leads before recorded acceptance of the provider terms, versioned and timestamped."
- *Verification boundary:* "Where the platform displays a verification or review status, it represents only the specific check named; all other attributes are provider-supplied."
- *Dispute support:* "Support reviews platform records and mediates; it does not adjudicate workmanship or award compensation beyond the refund matrix, except where law requires."
- *Money-flow failure modes:* "For every payment state (paid/failed/refunded) and job state (completed/cancelled/no-show/disputed) combination, the terms define who holds funds and what triggers release or refund."
- *SLA language:* "All time indications in copy are non-binding estimates unless the terms state a committed service level."

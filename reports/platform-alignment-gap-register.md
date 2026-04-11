# Plug-A-Pro Platform Alignment Gap Register

Date: 2026-04-10

## 1. Classification Legend

- `Aligned`
- `Partially aligned`
- `Misaligned`
- `Missing`
- `Dangerous / misleading`

## 2. Gap Register

| ID | Severity | Area | Finding | Classification | Evidence | Status |
|---|---|---|---|---|---|---|
| PAG-001 | Critical | Product copy | Public runtime copy implied Plug-A-Pro had vetted or strongly assured providers | Dangerous / misleading | Marketing hero, trust page, customer landing, WhatsApp help, provider page labels pre-fix | `Fixed` |
| PAG-002 | Critical | Provider trust semantics | `verified` semantics were easy to read as public verification although implementation only supported internal marketplace approval | Dangerous / misleading | `field-service/prisma/schema.prisma`, provider/admin surfaces | `Fixed in copy and labels; residual model gap remains` |
| PAG-003 | High | Customer decision support | Provider profile did not sufficiently explain what was provider-supplied versus platform-recorded | Misaligned | Customer provider page and request surfaces pre-fix | `Fixed with provider trust note` |
| PAG-004 | High | Payments | Launch-mode payment bypass could be read as real payment authorisation | Misaligned | `field-service/lib/payments.ts`, admin payment surfaces | `Fixed for current model and UI; residual legacy-record interpretation risk remains` |
| PAG-005 | High | Terms and policy posture | Terms overstated refund certainty and provider assurance language relative to implementation | Misaligned | `marketing/app/(marketing)/terms/page.tsx` pre-fix | `Fixed` |
| PAG-006 | Medium | Provider onboarding realism | Informal-worker fit is directionally correct, and optional evidence note capture now exists, but evidence structures remain limited | Partially aligned | onboarding/application path and schema | `Residual` |
| PAG-007 | Medium | Profile trust depth | Platform now shows provenance, optional provider evidence notes, and portfolio links, but still lacks richer reference / document review support | Partially aligned | provider profile capabilities and schema | `Residual` |
| PAG-008 | Medium | Quote acceptance | Customer quote approval is traceable and structured | Aligned | `field-service/app/api/quotes/[token]/route.ts`, `QuoteApproval` | `No change required` |
| PAG-009 | Medium | Job lifecycle traceability | Job state model supports acceptance, arrival, completion confirmation, and disputes | Aligned | `field-service/lib/jobs.ts`, customer/admin booking pages | `No change required` |
| PAG-010 | Medium | Customer issue handling | Dispute intake and issue reporting exist, but must avoid implying stronger adjudication power than operations can deliver | Partially aligned | customer booking page, admin disputes | `Residual wording/ops discipline item` |
| PAG-011 | Medium | Messaging / WhatsApp | WhatsApp flows support coordination, but trust language in help copy was overstated | Misaligned | `field-service/lib/whatsapp-flows/help.ts` | `Fixed` |
| PAG-012 | Low | Analytics / future risk | Coarse internal flags could be reused by future UI or analytics in misleading ways | Partially aligned | `Provider.verified`, payment `AUTHORISED` launch mode | `Residual` |

## 3. Major Flow Assessment

| Flow | Assessment | Notes |
|---|---|---|
| Provider onboarding | `Partially aligned` | Supports lightweight marketplace entry, but trust/evidence modelling remains limited |
| Provider profile | `Partially aligned` | Better after provenance note; still thin on evidence depth |
| Customer intake and matching | `Partially aligned` | Real-world problem capture is there, but provider-evaluation richness can improve |
| Quote and scope agreement | `Aligned` | Stronger than many other areas; explicit quote approval exists |
| Messaging and coordination | `Partially aligned` | Operationally practical, but relies on ongoing honesty discipline |
| Booking / dispatch / arrival / completion | `Aligned` | Lifecycle states and completion confirmation are appropriate to a marketplace |
| Ratings / reviews / complaints | `Partially aligned` | Reviews and dispute capture exist; enforcement expectations must stay realistic |
| Payments | `Partially aligned` | Honest enough after fixes, but status semantics remain coarse |
| Platform copy / labels | `Dangerous / misleading` pre-fix -> `Aligned` in accessible runtime scope post-fix | High-priority remediation completed |
| Safety / de-risking controls | `Partially aligned` | Reasonable baseline controls exist, but no broad safety claim should be made |

## 4. Immediate Launch-Critical Items

These are the items that mattered most for launch honesty and were remediated or require near-term follow-up:

1. Remove unsupported trust and vetting language.  
Status: `Fixed`

2. Clarify that provider profile claims are not automatically platform-verified.  
Status: `Fixed`

3. Clarify launch-mode payment semantics internally.  
Status: `Fixed in current implementation`

4. Keep legal/policy language within actual operating capability.  
Status: `Fixed`

## 5. Residual Product Decisions

The following still need human product/legal/ops decisions:

1. Should Plug-A-Pro introduce formal verification tiers later?
2. Should launch-mode payment records be split into a separate state from online authorisation?
3. What provider evidence types should be customer-visible in the next release?
4. How much dispute mediation should the platform operationally promise?
5. Should team-provider bookings expose worker-level identity separate from business-level profile?

## 6. Closure Statement

There are no remaining untriaged material overclaim issues in the accessible runtime scope reviewed during this sweep.

There are, however, residual material product-model gaps:

- coarse verification semantics
- limited provider evidence richness
- payment-state modelling that still relies on an overloaded status concept

Those are not launch-blocking in the same way the pre-fix copy issues were, but they should remain on the active remediation roadmap.

# Deadlineed — Gap Analysis

> **Status:** Current state as of 2026-05-03
> **Related:** [As-Is Journey](deadlineed-as-is-journey.md) · [To-Be Journey](deadlineed-to-be-journey.md)
>
> **Severity key:** 🔴 Blocker (prevents Deadlineed from using the platform effectively) · 🟡 Major (significant friction, repeat workarounds) · 🟢 Minor (polish, nice-to-have)

---

## Surface 1 — Customer PWA

| # | Step | Current state | Gap | Severity | Source file |
|---|------|---------------|-----|----------|-------------|
| C1 | Booking creation | Address fields typed fresh every time | No saved address book; no multi-site management | 🔴 | `components/customer/BookingFlow.tsx:103–113` |
| C2 | Booking creation | Single address per job request | No way to book for different sites under one account | 🔴 | `prisma/schema.prisma` – `Customer` has no `addresses` plural concept surfaced in booking UI |
| C3 | Booking creation | No repeat-booking shortcut | No "book again" CTA that pre-fills from a previous request | 🟡 | `app/(customer)/bookings/page.tsx` |
| C4 | Booking creation | No recurring job support | No cron rule or recurrence model on `JobRequest` | 🟡 | `prisma/schema.prisma` – `JobRequest` has no `recurringRule` field |
| C5 | Job description | Manual title + description each time | No job template library ("monthly HVAC service") | 🟡 | `components/customer/BookingFlow.tsx:113–130` |
| C6 | Category browsing | `/services` requires auth; no browsing before sign-in | Deadlineed cannot explore categories on landing page without logging in | 🟢 | `app/(customer)/services/page.tsx:11` |
| C7 | Provider discovery | No public provider browse page | `components/shared/ProviderCard.tsx` exists but is unused; provider profile at `/providers/[id]` requires prior match | 🟡 | `app/(customer)/providers/[id]/page.tsx:34–44` |
| C8 | Bookings dashboard | Flat undifferentiated list of all jobs | No grouping by site, category, date, or status; no search/filter | 🟡 | `app/(customer)/bookings/page.tsx` |
| C9 | Business identity | Single phone OTP = personal account | No company account; no principal + operator model; multiple staff cannot share one booking history | 🔴 | `lib/auth.ts` – `getSession()` resolves user by Supabase UID, not org |
| C10 | Billing | No invoice or receipt download | B2B customers need a paper trail for expense claims | 🔴 | `app/(customer)/bookings/[id]/page.tsx` – no invoice CTA |
| C11 | Team members | No team member access | Multiple staff cannot book under one company account | 🔴 | No `CustomerMember` or `OrgMembership` model in schema |
| C12 | Cancel reasons | Cancel reason list is homeowner-centric | "Found another provider", "No longer needed" don't map to B2B cancellation reasons | 🟢 | `app/(customer)/bookings/[id]/page.tsx:489–497` |
| C13 | Quote approval | Quote approve/decline only via PWA link | No WhatsApp-native quote approval path for mobile-first users | 🟡 | `components/quotes/QuoteHistoryTimeline.tsx` (no WA CTA) |
| C14 | Notifications | No match-found notification | Customer learns of match by polling; no WhatsApp push when provider accepts | 🟡 | `lib/whatsapp.ts` – no `notifyCustomerMatchFound` function |
| C15 | Notifications | No booking created notification | Customer has no WhatsApp confirmation when their request transitions to `MATCHED` | 🟡 | Matching engine sends no customer notification on match |
| C16 | Business cohort | No Deadlineed / B2B cohort flag | Cannot A/B test B2B features separately; no `isBusinessAccount` field | 🟢 | `lib/internal-test-cohort.ts` – only `internal_staff_test` cohort defined |

---

## Surface 2 — Customer WhatsApp

| # | Step | Current state | Gap | Severity | Source file |
|---|------|---------------|-----|----------|-------------|
| W1 | Inbound bot | Job-request flow works via WA | No saved address reuse on second booking; `WhatsAppSavedAddress` saved after first booking but only partially surfaced | 🟡 | `lib/whatsapp-flows/job-request.ts` + `lib/whatsapp-identity.ts` |
| W2 | Rebook | No rebook keyword | "I need the same job again" has no shortcut; full flow re-entry required | 🟡 | `lib/whatsapp-bot.ts:183–205` – no `rebook` in keyword lists |
| W3 | Quote approval | No WA-native quote approve/decline | Customer receives quote via PWA link only; cannot approve inline via WA buttons | 🔴 | `lib/whatsapp.ts` – no `sendQuoteApprovalButtons` function |
| W4 | Match notification | No customer match-found notification | Customer WhatsApp templates: only `slot_available` and `no_technician_available`; no "provider matched" template | 🟡 | `lib/whatsapp.ts:706–742` |
| W5 | Job-start notification | No "provider en route" customer notification | Provider sends `EN_ROUTE` WhatsApp command but customer is not notified | 🟡 | `lib/provider-whatsapp-job-commands.ts` – no customer notify on `EN_ROUTE` |
| W6 | Extra-work approval | Link sent in WhatsApp but approval is a separate PWA page | No inline WA button for extra work (as opposed to full quote) | 🟡 | `/approve/[token]` page – no WA button wrapper |
| W7 | Multi-site WA booking | Saved address is a single last-used address | Multiple site addresses cannot be selected from a WA list | 🟡 | `lib/whatsapp-identity.ts` – `WhatsAppSavedAddress` is a single object |
| W8 | Opt-in / opt-out | Marketing opt-in/out keywords exist | Service notification opt-out inadvertently possible via `stop` keyword (also a reset); policy handled in `lib/whatsapp-policy.ts` | 🟢 | `lib/whatsapp-bot.ts:197` – `'stop'` is in RESET_KEYWORDS |

---

## Surface 3 — Provider PWA

| # | Step | Current state | Gap | Severity | Source file |
|---|------|---------------|-----|----------|-------------|
| P1 | Lead management | No lead inbox | Provider cannot see open leads, accepted leads, or job queue on PWA | 🔴 | `app/(customer)/providers/` is customer-facing only; no `app/(provider)/` route group |
| P2 | Profile management | No PWA profile editor | Provider cannot update skills, service areas, bio, portfolio URLs, or rates on PWA | 🔴 | No provider-facing profile edit route |
| P3 | Availability | Availability only manageable via WA keywords | Provider cannot toggle availability or set a break via PWA | 🟡 | `lib/whatsapp-flows/provider-journey.ts:36–41` |
| P4 | Earnings | No earnings dashboard | Provider cannot see credit balance, job history, or payment records on PWA | 🔴 | `lib/provider-wallet.ts` exists but has no PWA surface |
| P5 | Document management | No document re-upload via PWA | Provider must restart registration WA flow to update ID / evidence docs | 🟡 | `lib/whatsapp-flows/registration.ts` – evidence only collected during onboarding |
| P6 | Job progress | All job status commands via WhatsApp text | Provider cannot update job status (en-route, arrived, complete) from PWA | 🟡 | `lib/provider-whatsapp-job-commands.ts` |
| P7 | Reviews | Provider cannot see their own reviews on PWA | Customer-facing `ProviderCard.tsx` and `/providers/[id]` show reviews but are not accessible to providers | 🟢 | `components/shared/ProviderCard.tsx` |

---

## Surface 4 — Provider WhatsApp

| # | Step | Current state | Gap | Severity | Source file |
|---|------|---------------|-----|----------|-------------|
| Q1 | Pause / resume | `PROVIDER_JOURNEY_TRIGGERS` includes `offline` / `available` | No named pause keywords (e.g., `pause`, `break`, `back in 2 hours`) that set a timed `breakUntil`; currently `available`/`offline` are binary toggles only | 🟡 | `lib/whatsapp-flows/provider-journey.ts:36–41` |
| Q2 | Location share | No on-accept location share | Provider does not send current GPS location after accepting a lead; customer gets no ETA signal | 🟡 | `lib/whatsapp-bot.ts` – no location message handling |
| Q3 | Late-arrival comms | No "running late" keyword | Provider cannot easily notify customer of delay via WA | 🟡 | No `late`, `running late` keyword or template |
| Q4 | Dispute trigger | Dispute can only be raised by customer on PWA | Provider cannot raise a dispute via WhatsApp | 🟡 | `app/(customer)/bookings/[id]/page.tsx:168–228` – customer-only dispute form |
| Q5 | Invoice | No post-job invoice keyword | Provider cannot trigger an invoice send to the customer via WA after job completion | 🟡 | `lib/whatsapp.ts` – no invoice template or keyword |
| Q6 | Interest rate negotiation | `parseProviderInterestRateText()` exists | Rate capture during onboarding only; no re-rate keyword after approval | 🟢 | `lib/provider-whatsapp-interest-capture.ts` |

---

## Cross-Cutting Gaps

| # | Area | Current state | Gap | Severity | Source file |
|---|------|---------------|-----|----------|-------------|
| X1 | Business identity | No `Organization` / `BusinessAccount` model | All bookings tied to a personal phone number; Deadlineed cannot separate business from personal | 🔴 | `prisma/schema.prisma` – no org model |
| X2 | Audit trail visibility | `AuditLog` has rich data but no customer-facing view | Deadlineed cannot export a job history report or see who did what | 🟡 | `lib/audit.ts` – ops-only consumption via admin dashboard |
| X3 | Notifications de-dup | `approvalWhatsappSentAt` + `approvalWhatsappSendStartedAt` guard on provider approval | No equivalent idempotency guard on customer notifications | 🟡 | `lib/provider-application-notifications.ts` – dedup only for provider |
| X4 | Feature flags | `lib/flags.ts` has per-user `enabledForUsers` support | No B2B / Deadlineed feature flag cohort defined | 🟢 | `lib/flags.ts:25–30` |
| X5 | SLA visibility | Matching engine runs on cron; no ETA shown to customer | Customer has no indication of how long matching will take | 🟡 | `lib/matching/orchestrator.ts` – no ETA calculation |
| X6 | No-match follow-up | `notifyExpiredJobParties` fires when job expires | No intermediate "we're still looking" message for long-running requests | 🟡 | `lib/matching/customer-recontact.ts` |
| X7 | WA conversation TTL | 30 min default (`WHATSAPP_SESSION_TIMEOUT_MS`) | No grace-period recovery if Deadlineed picks up a 45-min-old WA thread | 🟢 | `lib/whatsapp-bot.ts:58` |

---

## Gap Priority Summary

| Priority | Count | Description |
|----------|-------|-------------|
| 🔴 Blocker | 7 | C1, C2, C9, C10, C11, W3, P1 |
| 🟡 Major | 18 | C3–C8, C13–C16, W1, W2, W4–W7, P2–P6, Q1–Q5, X2, X3, X5, X6 |
| 🟢 Minor | 7 | C6, C12, C16, W8, P7, Q6, X4, X7 |

Blockers define the minimum-viable Deadlineed product. Major gaps define the full B2B experience. Minor gaps are polish.

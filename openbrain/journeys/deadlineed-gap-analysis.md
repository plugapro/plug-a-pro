# Deadlineed — Gap Analysis

> **Status:** Updated 2026-05-05 — reflects M4 (provider PWA), M5 (WA enhancements), M6 (provider browse) delivery
> **Related:** [As-Is Journey](deadlineed-as-is-journey.md) · [To-Be Journey](deadlineed-to-be-journey.md)
>
> **Severity key:** 🔴 Blocker (prevents Deadlineed from using the platform effectively) · 🟡 Major (significant friction, repeat workarounds) · 🟢 Minor (polish, nice-to-have)
> **Status key:** ✅ Closed · 🔄 Partial · ⬜ Open

---

## Surface 1 — Customer PWA

| # | Step | Current state | Gap | Severity | Status | Source file |
|---|------|---------------|-----|----------|--------|-------------|
| C1 | Booking creation | `CustomerAddress` model exists; `/account/sites` page live; BookingFlow loads saved addresses | WA multi-site picker not yet wired; address auto-select UI flag still not on by default | 🔴 | 🔄 | `field-service/app/(customer)/account/sites/page.tsx` |
| C2 | Multi-site | `CustomerAddress` table exists in schema | BookingFlow address-step picker needs confirmation it's shipping with flag | 🔴 | 🔄 | `field-service/prisma/schema.prisma` |
| C3 | Repeat booking | "Book again" CTA on completed rows → `/book/[cat]?template=[id]` | Rebook shortcut implemented; no cron recurring-job rule | 🟡 | ✅ | `field-service/app/(customer)/bookings/page.tsx` |
| C4 | Recurring jobs | No `recurringRule` field | Not planned for MVP; rebook shortcut is the workaround | 🟡 | ⬜ | `field-service/prisma/schema.prisma` |
| C5 | Job templates | `?template=<id>` pre-fills title + description from past job | Implemented via `?template` param in BookingFlow | 🟡 | ✅ | `field-service/app/(customer)/book/[serviceId]/page.tsx` |
| C6 | Category browsing | `/services` requires auth | First category grid visible on unauthenticated landing page; `/services` still auth-gated | 🟢 | 🔄 | `field-service/app/(customer)/services/page.tsx:11` |
| C7 | Provider discovery | `/providers` catalogue exists; `/providers/[id]` accessible without prior match | Gated by `feature.customer.provider_browse` flag; ranking is rating-only (no availability/distance) | 🟡 | ✅ | `field-service/app/(customer)/providers/page.tsx` |
| C8 | Bookings dashboard | Flat undifferentiated list | No grouping by site, category, date, or status; no search/filter | 🟡 | ⬜ | `field-service/app/(customer)/bookings/page.tsx` |
| C9 | Business identity | `CustomerMember` model exists in schema | Operator auth resolution not yet wired in `getSession()`; no principal → operators login flow | 🔴 | 🔄 | `field-service/lib/auth.ts` |
| C10 | Billing | No invoice or receipt download for completed jobs | B2B customers need a paper trail for expense claims | 🔴 | ⬜ | `field-service/app/(customer)/bookings/[id]/page.tsx` |
| C11 | Team members | `CustomerMember` schema exists | No UI to invite/manage team members; no auth flow for operators | 🔴 | 🔄 | `field-service/prisma/schema.prisma` |
| C12 | Cancel reasons | Cancel reason list is homeowner-centric | "Found another provider", "No longer needed" don't map to B2B cancellation reasons | 🟢 | ⬜ | `field-service/app/(customer)/bookings/[id]/page.tsx:489–497` |
| C13 | Quote approval | PWA `QuoteHistoryTimeline` shows Approve / Decline inline buttons | Works on PWA; WA-native quote accept not yet handler-wired | 🟡 | 🔄 | `field-service/components/quotes/QuoteHistoryTimeline.tsx` |
| C14 | Match-found notification | `sendCustomerMatchFoundNotification()` wired in matching orchestrator | Template `customer_match_found` must be submitted to Meta for approval | 🟡 | ✅ | `field-service/lib/matching/orchestrator.ts` |
| C15 | Booking created notification | `customer_quote_ready` template wired in `/api/technician/quotes` | Template must be submitted to Meta; WA accept/decline handler not wired | 🟡 | 🔄 | `field-service/app/api/technician/quotes/route.ts` |
| C16 | Business cohort flag | `feature.deadlineed.b2b_landing` seeded | Flag exists; landing page B2B variant not yet built | 🟢 | 🔄 | `field-service/scripts/seed-flags.ts` |

---

## Surface 2 — Customer WhatsApp

| # | Step | Current state | Gap | Severity | Status | Source file |
|---|------|---------------|-----|----------|--------|-------------|
| W1 | Saved address reuse | `WhatsAppSavedAddress` saved after first booking | Single last-used address; multi-site list picker not wired in `job-request.ts` | 🟡 | 🔄 | `field-service/lib/whatsapp-flows/job-request.ts` |
| W2 | Rebook keyword | No rebook keyword in bot | `rebook`, `book again`, `same job`, `repeat` not yet added to keyword list | 🟡 | ⬜ | `field-service/lib/whatsapp-bot.ts:183–205` |
| W3 | Quote approval | `quote_accept_*` / `quote_decline_*` payloads recognised in `isStatelessNotificationReply()` | Handler functions not yet wired; payloads fall through silently | 🔴 | 🔄 | `field-service/lib/whatsapp-bot.ts` |
| W4 | Match notification | `sendCustomerMatchFoundNotification()` wired; `customer_match_found` registered in templates | Meta approval for template still pending | 🟡 | ✅ | `field-service/lib/whatsapp.ts` |
| W5 | En-route notification | `sendCustomerEnRouteNotification()` wired; triggers on provider location share | Meta approval for `customer_provider_en_route` template pending | 🟡 | ✅ | `field-service/lib/whatsapp-bot.ts` |
| W6 | Extra-work approval | `/approve/[token]` page sends WhatsApp link; no inline WA button | Approval still a separate PWA page; no WA button version | 🟡 | ⬜ | `field-service/app/(customer)/approve/[token]/page.tsx` |
| W7 | Multi-site WA booking | Not yet wired; single saved address still used in flow | Requires `collect_site` step in `job-request.ts` after `collect_name` | 🟡 | ⬜ | `field-service/lib/whatsapp-flows/job-request.ts` |
| W8 | Opt-in / opt-out edge | `stop` keyword is in both RESET_KEYWORDS and opt-out group | Low risk but `stop` as reset could inadvertently cancel marketing prefs | 🟢 | ⬜ | `field-service/lib/whatsapp-bot.ts:197` |

---

## Surface 3 — Provider PWA

| # | Step | Current state | Gap | Severity | Status | Source file |
|---|------|---------------|-----|----------|--------|-------------|
| P1 | Lead inbox | `/provider/leads` and `/provider/leads/[leadId]` fully implemented | None — closed | 🔴 | ✅ | `field-service/app/(provider)/provider/leads/page.tsx` |
| P2 | Profile editor | `/provider/profile` implemented with full skill + area + schedule editing | None — closed | 🔴 | ✅ | `field-service/app/(provider)/provider/profile/page.tsx` |
| P3 | Availability toggle | `/provider/availability` implemented with ALWAYS_AVAILABLE / SCHEDULE / PAUSED modes | Timed pause (e.g., "back in 2 hours") only via datetime picker; no quick duration buttons on PWA | 🟡 | ✅ | `field-service/app/(provider)/provider/availability/page.tsx` |
| P4 | Earnings dashboard | `/provider/earnings` implemented | None — closed | 🔴 | ✅ | `field-service/app/(provider)/provider/earnings/page.tsx` |
| P5 | Document management | Profile re-upload via PWA: creates amendment `ProviderApplication` | No streamlined doc re-upload without WA flow; ops review still required | 🟡 | 🔄 | `field-service/app/(provider)/provider/profile/page.tsx` |
| P6 | Job status via PWA | `<JobStatusControls>` component in `/provider/jobs/[id]` | All status transitions available via PWA — closed | 🟡 | ✅ | `field-service/app/(provider)/provider/jobs/[id]/page.tsx` |
| P7 | Provider reviews on PWA | Reviews visible in `/provider/profile` rating section | None — closed | 🟢 | ✅ | `field-service/app/(provider)/provider/profile/page.tsx` |

---

## Surface 4 — Provider WhatsApp

| # | Step | Current state | Gap | Severity | Status | Source file |
|---|------|---------------|-----|----------|--------|-------------|
| Q1 | Pause with duration | `/provider/availability` supports PAUSED mode with datetime picker | WA `offline` keyword is binary toggle; no WA quick-duration buttons (30 min, 1 h, etc.) | 🟡 | 🔄 | `field-service/lib/whatsapp-flows/provider-journey.ts` |
| Q2 | Location share on accept | `sendCustomerEnRouteNotification()` wired; triggers when provider shares location after accepting | Automatic location prompt after WA lead acceptance not yet added to bot flow | 🟡 | 🔄 | `field-service/lib/whatsapp-bot.ts` |
| Q3 | Running-late comms | `handleRunningLateFlow()` wired; `customer_provider_running_late` template registered | Meta template approval pending | 🟡 | ✅ | `field-service/lib/whatsapp-flows/provider-journey.ts` |
| Q4 | Provider dispute trigger | `handleProviderDisputeFlow()` wired | None — closed | 🟡 | ✅ | `field-service/lib/whatsapp-flows/provider-journey.ts` |
| Q5 | Post-job invoice | `handleInvoiceFlow()` + `sendProviderInvoiceTemplate()` wired; `Job.invoiceWhatsappSentAt` idempotency | Meta template approval pending | 🟡 | ✅ | `field-service/lib/whatsapp-flows/provider-journey.ts` |
| Q6 | Interest rate re-capture | Rate captured during onboarding only | No re-rate keyword after approval | 🟢 | ⬜ | `field-service/lib/provider-whatsapp-interest-capture.ts` |

---

## Cross-Cutting Gaps

| # | Area | Current state | Gap | Severity | Status | Source file |
|---|------|---------------|-----|----------|--------|-------------|
| X1 | Business identity | `CustomerAddress` + `CustomerMember` models in schema | Operator auth resolution not wired in `getSession()`; no team invite UI | 🔴 | 🔄 | `field-service/prisma/schema.prisma` |
| X2 | Audit trail visibility | `/account/activity` page lists last 50 AuditLog events for customer | Customer cannot export or filter activity log | 🟡 | ✅ | `field-service/app/(customer)/account/activity/page.tsx` |
| X3 | Notification de-dup | Customer notification idempotency: `matchFoundWhatsappSentAt` on JobRequest; `approvalWhatsappSentAt` on Quote; `enRouteWhatsappSentAt` on JobRequest; `invoiceWhatsappSentAt` on Job | All 5 M5 templates have idempotency guards | 🟡 | ✅ | `field-service/lib/whatsapp.ts` |
| X4 | Feature flags | `feature.deadlineed.b2b_landing`, `feature.customer.address_book`, `feature.provider.pwa_inbox`, `feature.customer.provider_browse` all seeded | No per-user B2B cohort auto-applied | 🟢 | 🔄 | `field-service/scripts/seed-flags.ts` |
| X5 | SLA visibility | Hour-of-day matching ETA callout on `/requests/[id]` | Implemented — closed | 🟡 | ✅ | `field-service/app/(customer)/requests/[id]/page.tsx` |
| X6 | No-match follow-up | `notifyExpiredJobParties` fires when job expires | No intermediate "we're still looking" WhatsApp message for long-running requests | 🟡 | ⬜ | `field-service/lib/matching/customer-recontact.ts` |
| X7 | WA session TTL | 30 min default (`WHATSAPP_SESSION_TIMEOUT_MS`) | No grace-period recovery | 🟢 | ⬜ | `field-service/lib/whatsapp-bot.ts:58` |
| X8 | Meta template approval | 5 new templates wired in code | All 5 must be submitted to Meta Business Suite before live sends succeed | 🔴 | ⬜ | `field-service/lib/messaging-templates.ts` |

---

## Gap Priority Summary

| Priority | Open / Partial count | Key items |
|----------|---------------------|-----------|
| 🔴 Blocker | 4 | C10 (invoice download), W3 (WA quote handler), X8 (Meta templates), C9/X1 (operator auth) |
| 🟡 Major | 8 | C4, C8, W1, W2, W6, W7, Q1, Q2, X6 |
| 🟢 Minor | 4 | C6, C12, W8, Q6, X4, X7 |

**Closed since 2026-05-03:** C3, C5, C7, C14, P1–P7, Q3, Q4, Q5, W4, W5, X2, X3, X5 — representing completion of M4, M5, and M6 milestones plus M7-T3.

**Remaining blockers** define the next sprint: Meta template submission (ops task, parallel), WA quote accept/decline handler (M3-T3), customer invoice download (M3/M7 new), and operator auth wiring (M1 remainder).

# Plug A Pro — As-Is Assessment

> Generated: 2026-05-07  
> Scope: `field-service/` monorepo

---

## 1. Architecture Summary

Plug A Pro is a Next.js 16 App Router monorepo with:

- **Framework**: Next.js 16 (App Router), TypeScript, Tailwind CSS v4
- **Database**: PostgreSQL via Prisma ORM (`field-service/prisma/schema.prisma`)
- **Auth**: Supabase Auth (phone OTP for customers/providers; email/password for admin via Supabase invite)
- **File storage**: Vercel Blob (`field-service/lib/storage.ts`)
- **Messaging**: Meta WhatsApp Cloud API (`field-service/lib/whatsapp.ts`, `lib/whatsapp-interactive.ts`)
- **Payments (customer)**: Peach Payments (primary), PayFast (alternate), Yoco (referenced but inactive)
- **Payments (provider credits)**: PayFast + manual EFT (`lib/payfast.ts`, `lib/provider-credit-payment-intents.ts`)
- **Route groups**: `(admin)`, `(customer)`, `(provider)`, plus unauthenticated public routes under `app/`
- **Proxy/auth guard**: `field-service/proxy.ts` enforces `/admin` and `/provider` route access

Three parallel user channels exist:
1. **WhatsApp bot** — both customer service-request journeys and provider registration/lead management
2. **Customer PWA** — authenticated web app under `app/(customer)/`
3. **Provider Worker Portal** — authenticated web app under `app/(provider)/`
4. **Admin panel** — full CRUD/ops under `app/(admin)/admin/`

---

## 2. Data Model Summary

Key Prisma models and their purpose (`prisma/schema.prisma`):

| Model | Purpose | Key States / Enums |
|---|---|---|
| `Customer` | Platform customer; nullable `userId` (WhatsApp-only start) | `isBlocked`, `suspendedUntil`, `archivedAt`, `channel` |
| `Address` | Structured address with sensitive `accessNotes` (hidden until LeadUnlock exists) | — |
| `Provider` | Service provider; `verified` = lead-eligible flag | `ProviderStatus`: APPLICATION_PENDING, UNDER_REVIEW, ACTIVE, SUSPENDED, ARCHIVED, BANNED |
| `ProviderApplication` | Application submitted via WhatsApp or Worker Portal | `ApplicationStatus`: PENDING, MORE_INFO_REQUIRED, APPROVED, REJECTED, CANCELLED |
| `JobRequest` | Customer service request, anchors the matching pipeline | `JobRequestStatus`: PENDING_VALIDATION → OPEN → MATCHING → SHORTLIST_READY → PROVIDER_CONFIRMATION_PENDING → MATCHED → EXPIRED / CANCELLED |
| `Lead` | An invite dispatched to a specific provider for a JobRequest | `LeadStatus`: SENT → VIEWED → INTERESTED → SHORTLISTED → CUSTOMER_SELECTED → ACCEPTED / DECLINED / EXPIRED / SUPERSEDED / CANCELLED |
| `LeadUnlock` | Credit debit record; also gates address visibility | `LeadUnlockStatus`: UNLOCKED, REFUNDED, DISPUTED, REVERSED |
| `Match` | Created when provider accepts and pays for the lead | `MatchStatus`: MATCHED → INSPECTION_SCHEDULED → QUOTED → QUOTE_APPROVED → CANCELLED |
| `Quote` | Provider's formal price offer | `QuoteStatus`: PENDING → APPROVED / DECLINED / EXPIRED / REVISED |
| `Booking` | Confirmed job appointment created on quote approval | `BookingStatus`: SCHEDULED → RESCHEDULED / COMPLETED / CANCELLED |
| `Job` | Execution record with GPS and lifecycle events | `JobStatus`: SCHEDULED → EN_ROUTE → ARRIVED → STARTED → COMPLETED / FAILED |
| `Payment` | Customer payment for the booking | Peach / PayFast / offline modes |
| `ProviderWallet` | Credit wallet with two buckets: `paidCreditBalance`, `promoCreditBalance` | `ProviderWalletStatus`: ACTIVE, SUSPENDED, CLOSED |
| `WalletLedgerEntry` | Immutable ledger row; source of truth for credit accounting | Entry types: TOPUP_CREDIT, PROMO_CREDIT, LEAD_UNLOCK_DEBIT, LEAD_REFUND_CREDIT, ADMIN_ADJUSTMENT |
| `ProviderPromoAward` | One-per-milestone promo credit award record | Types: MOBILE_VERIFIED (3), PROFILE_COMPLETED (2), KYC_APPROVED (5), FIRST_TOPUP (2), FIRST_COMPLETED_JOB (3) |
| `ProviderShortlist` / `ProviderShortlistItem` | Qualified shortlist for customer comparison | `status`: DRAFT, PUBLISHED, SUPERSEDED |
| `DispatchDecision` | Records matching run including mode, ranked candidates, filter summary | `DispatchDecisionStatus`: RANKED → OFFERING → ASSIGNED / NO_MATCH / OVERRIDDEN |
| `MatchAttempt` | Per-provider offer attempt within a dispatch run | `MatchAttemptStage`: FILTERED_OUT, RANKED, OFFERED, ACCEPTED, TIMED_OUT, REJECTED, OVERRIDDEN |
| `AssignmentHold` | Active offer window to a specific provider; expires in ~15 min | `AssignmentHoldStatus`: ACTIVE → ACCEPTED / REJECTED / EXPIRED / RELEASED |
| `CandidatePool` | Precomputed index: (categorySlug × locationNodeId) → eligible providers | rebuilt on profile change and every 5 min |
| `ProviderLiveStatus` | Heartbeat-updated online/offline state | `isOnline`, `availabilityMode` |
| `ProviderCapacity` | Active hold count to prevent overloading | `maxConcurrent` default 2 |
| `Category` | Managed service categories (slug, label, regulated, etc.) | `CategoryRequiredCertification`, `CategoryRequiredEquipment`, `CategoryRequiredVehicleType` |
| `ProviderCategory` | Per-provider category enrollment with admin approval status | `approvalStatus`: PENDING_REVIEW, APPROVED, REJECTED |
| `AuditLog` / `AdminAuditEvent` | Full audit trail for all admin mutations | — |
| `Case` / `CaseEvent` / `CaseNote` | Ops queue case management with SLA | `CaseState`: OPEN, IN_PROGRESS, RESOLVED, CANCELLED, REOPENED |
| `Conversation` | WhatsApp bot session state per phone number (30 min TTL) | `flow`, `step`, `data` |
| `InboundWhatsAppMessage` | Deduplicated inbound WAMID log for webhook idempotency | `processedAt`, `duplicateCount` |

---

## 3. Provider Onboarding Flow

### Channels

Both WhatsApp and Worker Portal (PWA) are active for provider registration.

**WhatsApp registration** (`lib/whatsapp-flows/registration.ts`):

Triggered by keywords including `register`, `join`, `apply`, `i want to work` and equivalents in Afrikaans and Zulu (registration.ts:55–61). Flow steps:

1. Name capture
2. Skill selection (multi-select from `SERVICE_CATEGORY_OPTIONS`) — `registration.ts:65`
3. Service area selection (structured LocationNode-based or legacy string)
4. Experience capture (free text, e.g. "3–5 years")
5. Availability capture
6. Rates capture (call-out fee, hourly rate, rate negotiable flag) — `provider-onboarding-data.ts`
7. For HIGH_RISK categories (electrical, pest control, air conditioning, roofing): certification proof upload requested — `service-category-policy.ts:38–68`
8. ID number capture — `ProviderApplication.idNumber` (POPIA §26 flagged)
9. Alternate mobile, preferred language, references (optional)
10. Evidence file upload (up to 5 files via `whatsapp-media.ts`)
11. Submit: creates `ProviderApplication` (status = PENDING) + `Attachment` records; does NOT create a `Provider` row yet

**Worker Portal registration** (`app/(provider)/provider/apply/page.tsx`):

A web form that creates a `ProviderApplication`. Parallel path to WhatsApp.

### Fields captured

Stored in `ProviderApplication` (`schema.prisma:321–366`):
- `phone`, `name`, `email` (optional), `skills[]`, `serviceAreas[]`, `experience`, `availability`
- `callOutFee`, `hourlyRate`, `rateNegotiable`, `quoteAfterInspection`, `emergencyAvailable`, `sameDayJobs`, `weekendJobs`
- `evidenceNote`, `evidenceFileUrls[]`, `idNumber` (POPIA special personal info)
- `alternateMobileE164`, `preferredLanguage`, `reference1Name/Mobile`, `reference2Name/Mobile`
- `isTestUser`, `cohortName`, `status`

### What "approved" means

Approval creates a `Provider` row via `syncProviderRecord()` (`provider-record.ts:1`) and sets the application `status = APPROVED` and `providerId` on the application. The provider is set `active = true`, `availableNow = true`, `verified = true` — making them immediately eligible for lead dispatch (`provider-auto-approve.ts:859–875`).

`ProviderCategory` rows are upserted for each approved skill with `approvalStatus = 'APPROVED'` (`provider-auto-approve.ts:887–905`).

### Auto-approval vs manual

Auto-approval runs via cron (`app/api/cron/provider-auto-approve/route.ts`). All **PENDING** applications where `hasAutoApprovalBlockingServiceSelection(skills)` is false are auto-approved (`service-category-policy.ts:314–316`).

Categories that block auto-approval: `electrical`, `pest_control`, `air_conditioning`, `roofing` (`service-category-policy.ts:38–68`). These route to manual review via the ops queue.

Manual admin approval is in `app/(admin)/admin/applications/page.tsx:158–325` (behind feature flag `admin.applications.v2`).

### Worker Portal login

On approval, `syncProviderRecord()` creates the `Provider` row linked to the Supabase user ID (`provider-record.ts`). However, a Supabase auth account is not automatically created by the approval flow — the provider must authenticate separately via phone OTP on the Worker Portal. The approval WhatsApp notification (`provider-application-notifications.ts:200`) includes a Worker Portal CTA link.

### Starter credits on approval

On approval, `awardPromoCreditsForMilestone(..., 'MOBILE_VERIFIED', ...)` is fired as a Phase B side-effect (`provider-auto-approve.ts:418–438`). `MOBILE_VERIFIED` awards **3 promo credits** (`provider-promo-awards.ts:20`). This is the starter credit.

Pre-payment promo cap: 10 credits max before first paid top-up (`provider-promo-awards.ts:17`). Additional milestone awards: `PROFILE_COMPLETED` (2 credits), `KYC_APPROVED` (5 credits), `FIRST_TOPUP` (2 credits), `FIRST_COMPLETED_JOB` (3 credits).

---

## 4. Client Request Flow

### Channels

Both WhatsApp and Customer PWA are active.

**WhatsApp job request** (`lib/whatsapp-flows/job-request.ts`):

Triggered by a job category selection from the main menu. Steps:

1. Category selection
2. Area/suburb selection (LocationNode-based or free text)
3. Issue description (free text)
4. Timing preference (urgency, date, window)
5. Provider preference (fastest_available, most_experienced, best_rated, budget_friendly, verified_only)
6. Photo upload (optional, batched with 3 s window)
7. Summary confirmation
8. Submission: creates `Customer` (if new), `Address`, `JobRequest` (status = OPEN), `Attachment` records

**Customer PWA** (`app/(customer)/`):

Route `(customer)/book/[serviceId]/page.tsx` leads to a multi-step request creation form. Form validation in `lib/client-request-flow.ts` (title 6–120 chars, description ≤1200 chars, privacy/terms acknowledgment required).

Job request creation: `lib/job-requests/create-job-request.ts`. Fields: `category`, `title`, `description`, `addressId`, `urgency`, `budgetPreference`, `providerPreference`, `requestedWindowStart/End`, `requiredSkillTags`, `accessNotes`.

### Photos storage

Photos are uploaded to **Vercel Blob** via `lib/storage.ts:54` (`uploadJobRequestPhoto`). The `Attachment` model records `url`, `blobKey`, `mimeType`, `sizeBytes`, `label`, `safeForPreview`. The `safeForPreview` flag controls whether provider safe-preview payloads include the photo (`schema.prisma:848`).

### Address data storage

Structured address stored in `Address` model (`schema.prisma:71–102`): `street`, `addressLine1/2`, `complexName`, `unitNumber`, `suburb`, `city`, `province`, `postalCode`, `lat`, `lng`, `locationNodeId`. Sensitive `accessNotes` are stored separately and **only revealed to the provider after a `LeadUnlock` record exists for that lead** (`provider-lead-detail.ts:65`, `schema.prisma:88`).

Legacy `CustomerAddress` model also exists (`schema.prisma:104–124`).

### Address privacy before provider acceptance

Address privacy is explicitly enforced at multiple layers:
1. WhatsApp copy confirms: "Your phone number and exact address will only be shared after you select a provider and that provider accepts the job." (`whatsapp-flows/job-request.ts:1262`, `customer-shortlists.ts:149`)
2. `provider-lead-detail.ts` returns `unlockedDetails: null` when no `LeadUnlock` exists; only `preview` data (area-level: suburb + city, no street) is exposed to providers pre-unlock.
3. `accessNotes` on `Address` is explicitly gated behind unlock (`provider-lead-detail.ts:65`, `selected-provider-acceptance.ts:346`).

### Request lifecycle states

`JobRequestStatus` enum (`schema.prisma:1450–1459`):
- `PENDING_VALIDATION` → `OPEN` → `MATCHING` → `SHORTLIST_READY` → `PROVIDER_CONFIRMATION_PENDING` → `MATCHED` → `EXPIRED` / `CANCELLED`

---

## 5. Matching and Lead Flow

### How providers are matched

Matching is a multi-layer pipeline:

**Layer 1 — CandidatePool lookup** (`lib/matching/candidate-pool.ts`): precomputed index by `(categorySlug, locationNodeId)`. Rebuilt on profile change and by cron every 5 min. Avoids full provider table scan.

**Layer 2 — Filter** (`lib/matching/filter.ts`): hard filters (active, verified, status=ACTIVE, skills match, location coverage, capacity, schedule fit, cert/equipment requirements).

**Layer 3 — Scoring/ranking** (`lib/matching/scoring.ts`): composite score from reliability, rating, completion count, punctuality, acceptance rate, etc.

**Layer 4 — Dispatch** (`lib/matching/dispatch.ts`): selects top-ranked candidate(s), creates `DispatchDecision`, `MatchAttempt`, and `AssignmentHold`. Offer TTL is ~15 minutes.

**Legacy fallback** (`lib/matching-engine.ts:120`): string-based service area matching still active during migration window, controlled by `MATCHING_CONFIG.allowLegacyStringFallback`.

**Coverage tiers** (`lib/matching/service.ts:645`): SUBURB_EXACT → REGION_FALLBACK → LEGACY_STRING.

Orchestrator (`lib/matching/orchestrator.ts`) handles sequential offer dispatch: if provider #1 times out, offer moves to provider #2.

### Simultaneous provider dispatch (Qualified Shortlist)

Yes — multiple providers are dispatched simultaneously in the **Qualified Shortlist** mode. Providers respond with `INTERESTED` + call-out fee + estimated arrival time (`provider-whatsapp-interest-capture.ts`, `provider-opportunity-whatsapp.ts`). `generateCustomerShortlistForRequest()` (`customer-shortlists.ts:36`) collects up to 5 INTERESTED responses and creates a `ProviderShortlist` with items ranked by arrival time, then price. Job request status → `SHORTLIST_READY`.

In **auto-assign mode** (legacy), a single offer is dispatched sequentially.

### Lead invites vs jobs

Lead invites (`Lead` model) are separate from jobs. The flow is:

1. `Lead` created (status = SENT) → dispatched to provider
2. Provider previews lead (free, no credits) → status = VIEWED
3. Provider expresses interest (Qualified Shortlist mode) → status = INTERESTED
4. Customer selects from shortlist → `Lead.status = CUSTOMER_SELECTED`, `JobRequest.status = PROVIDER_CONFIRMATION_PENDING`
5. Provider accepts selected job → `LeadUnlock` created (1 credit deducted) → `Match` created → `Job` created → Lead status = ACCEPTED
6. All other leads for same request → SUPERSEDED

### Expiry

`AssignmentHold.expiresAt` defaults to ~15 min from offer. `processPendingAssignmentWorkflows()` (`lib/matching/service.ts`) runs via cron, expires stale holds, and triggers next candidate dispatch or `NO_MATCH`. `JobRequest.expiresAt` controls overall request TTL.

On expiry with no match: `lib/matching/customer-recontact.ts` sends a no-match notification and, optionally, alternative slot options (`lib/matching/alternative-slots.ts`, `altSlotNegotiationSentAt` on JobRequest).

---

## 6. Credit Flow

### Ledger

A full double-entry ledger exists. `ProviderWallet` holds cached balances (`paidCreditBalance`, `promoCreditBalance`). Every credit mutation writes an immutable `WalletLedgerEntry` row with `balanceAfterPaidCredits` and `balanceAfterPromoCredits` (`provider-wallet.ts:140–164`).

`recomputeWalletBalance()` (`provider-wallet.ts:720`) can replay the ledger and detect drift between cached and replayed balances.

### Credit price

1 credit = R50 (`provider-wallet.ts:10: PROVIDER_CREDIT_PRICE_ZAR = 50`). The messaging template at `messaging-templates.ts:254` confirms this.

### Credit deduction atomicity

Credit debit is atomic with lead unlock. `unlockLeadForProviderInTransaction()` (`lead-unlocks.ts`) and `debitCreditsForLeadUnlockInTransaction()` (`provider-wallet.ts:236`) run inside the same Prisma `$transaction`. An optimistic concurrency guard (`updateMany` with `where` on both balances) prevents double-spend (`provider-wallet.ts:266–281`). If `updated.count !== 1`, a `CONCURRENT_MUTATION` error is thrown and the caller retries.

Credit deduction happens at **final provider acceptance** (when customer has selected the provider and the provider accepts), not at interest expression or shortlist placement.

### Promo vs paid credits

Two separate buckets in the wallet. Promo credits are consumed first in lead unlock (`provider-wallet.ts:258`). Pre-payment promo cap is 10 credits (`provider-promo-awards.ts:17`). Once the provider has made a paid top-up, the cap no longer applies.

### Milestone promo awards

Defined in `provider-promo-awards.ts:19–25`:
- `MOBILE_VERIFIED`: 3 credits (awarded on application approval)
- `PROFILE_COMPLETED`: 2 credits (80%+ profile completeness + avatar required)
- `KYC_APPROVED`: 5 credits
- `FIRST_TOPUP`: 2 credits (bonus on first paid top-up)
- `FIRST_COMPLETED_JOB`: 3 credits (first customer-rated job)

### Admin adjustments

`adjustProviderCreditsInTransaction()` (`provider-wallet.ts:469`) allows positive or negative adjustments; requires a non-empty reason; writes `ADMIN_ADJUSTMENT` ledger entry. Admin UI: `app/(admin)/admin/provider-wallets/actions.ts:67`.

---

## 7. WhatsApp Template Inventory

### Freeform / interactive messages (programmatic, no pre-approved template)

| Template name | Trigger | Direction |
|---|---|---|
| `freeform:text` | Generic text messages throughout all flows | Outbound |
| `interactive:text` | Interactive text with buttons/lists | Outbound |
| `interactive:buttons` | Button menus | Outbound |
| `interactive:list` | List selectors | Outbound |
| `interactive:cta_url` | Single CTA link button | Outbound |
| `interactive:journey_recovery` | Session-recovery nudge | Outbound |

### Customer-facing

| Template name | Trigger | Idempotency guard |
|---|---|---|
| `customer_match_found` | Provider accepted lead → match created | `JobRequest.matchFoundWhatsappSentAt` (`whatsapp.ts:884`) |
| `customer_quote_ready` | Provider submitted quote | `Quote.approvalWhatsappSentAt` (`whatsapp.ts:952`) |
| `customer_provider_en_route` | Provider status EN_ROUTE | `JobRequest.enRouteWhatsappSentAt` (`whatsapp.ts:1026`) |
| `customer_provider_running_late` | Provider late | `Job.runningLateWhatsappSentAt` |
| `interactive:client_shortlist_ready` | Shortlist generated | — |
| `interactive:client_shortlist_ready_cta` | Shortlist CTA button | — |
| `interactive:client_pwa_request_submitted` | PWA request submission confirmed | — |
| `interactive:client_pwa_request_tracker_cta` | Job tracker CTA | — |
| `interactive:job_request_no_match` | No provider found | — |
| `interactive:job_request_rematch_check` | Rematch check with customer | — |
| `interactive:request_received_no_match` | Immediate no-match | — |
| `interactive:completion_signoff_cta` | Job completion sign-off | — |
| `interactive:job_started_tracker_cta` | Job started tracker | — |
| `interactive:selected_job_accepted_customer` | Provider confirmed selected job | — |
| `interactive:selected_job_accepted_customer_cta` | Customer CTA after provider acceptance | — |
| `post_match_customer_arrival_planned` | Arrival time confirmed | — |
| `post_match_customer_provider_accepted` | Provider accepted post-match | — |
| `post_match_customer_provider_on_the_way` | Provider en route | — |
| `post_match_customer_provider_arrived` | Provider on site | — |
| `post_match_customer_provider_started` | Work started | — |
| `post_match_customer_provider_completed` | Work completed | — |
| `slot_available` | Inspection slot available | — |

### Provider-facing

| Template name | Trigger | Idempotency guard |
|---|---|---|
| `provider_application_approved` | Application approved | `ProviderApplication.approvalWhatsappSentAt` |
| `interactive:provider_application_submitted_terms_cta` | Application submitted confirmation | — |
| `interactive:provider_onboarding_terms_cta` | Terms CTA during onboarding | — |
| `interactive:new_lead_available` | New lead dispatched | — |
| `interactive:new_lead_actions` | Lead action buttons | — |
| `interactive:lead_expired` | Lead offer expired | — |
| `interactive:provider_selected_for_confirmation` | Customer selected this provider | — |
| `interactive:provider_selected_for_confirmation_cta` | Provider confirmation CTA | — |
| `interactive:selected_job_accepted_provider` | Provider accepted selected job | — |
| `interactive:selected_job_accepted_provider_cta` | Provider job handover CTA | — |
| `dispatch:job_lead` | Lead dispatch (legacy path) | — |
| `dispatch:job_lead_actions` | Lead action buttons (legacy) | — |
| `post_match_provider_job_accepted` | Match accepted confirmation | — |
| `post_match_provider_next_actions` | Next steps after acceptance | — |
| `post_match_provider_fresh_job_link` | Fresh signed job link | — |
| `post_match_provider_contact_customer` | Customer contact details | — |
| `post_match_provider_fallback` | Fallback notification | — |
| `provider_arrival_time_confirmed` | Arrival time acknowledged | — |
| `provider_location_prompt` | Location sharing request | — |
| `provider_invoice_send` | Invoice sent | `Job.invoiceWhatsappSentAt` |
| `technician_job_reminder` | Job day reminder | — |
| `technician_payment_released` | Payment released notification | — |
| `interactive:provider_auto_paused_timeout` | Auto-paused due to consecutive timeouts | — |
| `interactive:provider_credit_history_cta` | Credit history CTA | — |
| `interactive:provider_timeout_admin_alert` | Admin alerted to provider timeout | — |
| `interactive:booking_cancelled_provider` | Booking cancelled | — |
| `job_offer` | Job offer (legacy booking flow) | — |
| `lead_unlock:customer_intro` | Customer intro after unlock | — |
| `lead_unlock:provider_confirmation` | Provider confirmation after unlock | — |

### Wallet / credit messages

| Template name | Trigger |
|---|---|
| `wallet:low_balance` | Low credit balance warning |
| `wallet:zero_balance_lead_available` | Lead available but zero credits |
| `wallet:payment_intent_created` | Credit top-up intent created |
| `wallet:payfast_topup_initiated` | PayFast checkout initiated |
| `wallet:payment_credited` | Credits added to wallet |

### Relay messages

| Template name | Purpose |
|---|---|
| `interactive:relay_customer_to_provider` | Customer → provider relay |
| `interactive:relay_provider_to_customer` | Provider → customer relay |
| `interactive:relay_ack_customer` | Relay acknowledgment to customer |
| `interactive:relay_ack_provider` | Relay acknowledgment to provider |

### URL handling

- All URLs travel via `sendCtaUrl()` or template URL button components — **never inline in message body** (`whatsapp-copy.ts:103–154`).
- `getPublicAppUrl()` reads `APP_PUBLIC_URL` → `NEXT_PUBLIC_APP_URL` (`provider-credit-copy.ts:10–184`).
- Localhost guard: logs error and blocks in production if host is `localhost` or `127.0.0.1` (`provider-credit-copy.ts:47–48`, `135–137`).
- `getWorkerPortalUrl()` reads `NEXT_PUBLIC_PROVIDER_LEAD_APP_URL`.

---

## 8. Admin Capability Inventory

### Provider management

| Capability | Location | Feature Flag |
|---|---|---|
| View applications list | `app/(admin)/admin/applications/page.tsx` | `admin.applications.v2` |
| Approve application | `applications/page.tsx:158` | `admin.applications.v2` |
| Reject application | `applications/page.tsx:459` | `admin.applications.v2` |
| Request more info | `applications/page.tsx:~390` | `admin.applications.v2` |
| View/edit provider profile | `admin/providers/[id]/page.tsx` (re-exports `technicians/[id]`) | `admin.crud.providers` |
| Suspend/archive provider | `admin/providers/actions.ts` | `admin.crud.providers` |
| View/add provider notes | `admin/technicians/[id]/page.tsx` | — |
| Category approval per provider | `provider-applications.ts:updateProviderApplicationCategoryApproval` | — |

### Credit / wallet management

| Capability | Location |
|---|---|
| View wallet balance + ledger | `admin/provider-wallets/[providerId]/page.tsx` |
| Admin credit adjustment (+ or −) | `admin/provider-wallets/actions.ts:adjustProviderCreditsInTransaction` |
| Suspend wallet | `admin/provider-wallets/actions.ts:111` |
| Reactivate wallet | `admin/provider-wallets/actions.ts:153` |
| View credit payment proofs | `admin/provider-credit-payments/[id]/page.tsx` |
| Credit provider on payment confirmation | `admin/provider-credit-payments/actions.ts` |

### Matching / dispatch

| Capability | Location |
|---|---|
| View pending job requests + dispatch queue | `admin/dispatch/page.tsx` |
| Trigger auto-assign | `dispatch/page.tsx:110` (`dispatch.auto_assign`) |
| Re-rank candidates | `dispatch/page.tsx:139` (`dispatch.rerank`) |
| Manual override assignment | `dispatch/page.tsx:181` (`dispatch.override_assignment`) |
| View match results / shortlists | `admin/matches/page.tsx`, `admin/shortlists/page.tsx` |

### Other admin capabilities

| Capability | Location |
|---|---|
| Block/unblock customer | `admin/customers/actions.ts` |
| View / create locations (LocationNode) | `admin/locations/page.tsx`, `actions.ts` |
| Manage categories | `admin/categories/page.tsx`, `actions.ts` |
| Resolve lead-unlock disputes | `admin/lead-unlock-disputes/page.tsx` |
| View/resolve disputes | `admin/disputes/page.tsx` |
| Manage bookings | `admin/bookings/[id]/page.tsx` |
| View messages log | `admin/messages/page.tsx` |
| View audit log | `admin/audit-log/page.tsx` |
| Manage team (invite, roles) | `admin/team/page.tsx`, `actions.ts` |
| Feature flags management | `admin/settings/page.tsx` |
| Ops queue (breached SLA) | `admin/breached/page.tsx` |
| Case management | via `Case` model and `_actions/case/` |
| Validation queue | `admin/validation/page.tsx` |

---

## 9. Test Coverage Summary

**Framework**: Vitest (unit/integration), Playwright (E2E smoke)

**Test counts** (by directory):
- `__tests__/lib/`: 119 test files covering matching engine, wallet, shortlists, notifications, auth, location nodes, jobs, cases, provider applications, credits, etc.
- `__tests__/api/`: 25 test files covering webhooks, provider job actions, payment flows, credit intents, customer bookings
- `__tests__/admin/`: 5 test files covering booking actions, case actions, lead-unlock disputes, credit payment actions, wallet actions
- `__tests__/app/`: 3 test files covering customer/provider page access
- `__tests__/integration/`: 1 file covering provider credit wallet lead monetisation
- `__tests__/components/`: 4 test files covering CRUD kit, OTP input, design system

Notable test files relevant to this pack:
- `matching-engine.test.ts`, `matching-dispatch.test.ts`, `matching-filter.test.ts`, `matching-orchestrator.test.ts`, `matching-service.test.ts`, `matching-scheduling.test.ts`
- `customer-shortlists.test.ts`
- `provider-applications.test.ts`, `provider-auto-approve.test.ts`
- `provider-credit-balance-and-ledger-flow.test.ts`
- `lead-unlocks.test.ts`, `lead-unlock-disputes.test.ts`
- `client-pwa-state.test.ts`, `client-pwa-handoff.test.ts`, `client-request-flow.test.ts`

**E2E smoke** (`e2e/smoke.spec.ts`): references `/admin/breached` and `/admin/supply` — both routes exist in the admin route tree now. Smoke runs only on push when `E2E_BASE_URL` secret is set; does not run on PRs by default.

---

## 10. Gaps Against Qualified Shortlist Model

| Gap | Current State | Required |
|---|---|---|
| **Provider can express free interest** | EXISTS — `INTERESTED` lead status + `ProviderLeadResponse` with `callOutFee` + `estimatedArrivalAt` | Operational |
| **Shortlist published to customer** | EXISTS — `generateCustomerShortlistForRequest()` + `ProviderShortlist` + WhatsApp notification | Operational |
| **Customer selects provider from shortlist** | EXISTS — `selectShortlistedProviderForRequest()` (`customer-shortlists.ts:232`) + `CUSTOMER_SELECTED` lead status | Operational |
| **Provider final acceptance with credit deduction** | EXISTS — `acceptSelectedProviderJob()` (`selected-provider-acceptance.ts:85`) + `unlockLeadForProviderInTransaction()` | Operational |
| **Address hidden until final acceptance** | EXISTS — `accessNotes` gated behind `LeadUnlock`; preview returns suburb/city only | Operational |
| **Customer PWA shortlist view** | EXISTS — `app/(customer)/requests/[id]/page.tsx` | Partial — needs verification of all edge cases |
| **Provider PWA opportunity response** | EXISTS — `app/(provider)/provider/opportunities/[leadInviteId]/page.tsx` | Partial |
| **Promo/starter credits at approval** | EXISTS — `MOBILE_VERIFIED` award (3 credits) via `provider-auto-approve.ts` | Operational |
| **Pre-payment promo cap** | EXISTS — 10-credit cap before first paid top-up (`provider-promo-awards.ts:17`) | Operational |
| **Category model** | EXISTS — `Category`, `CategoryRequiredCertification`, `CategoryRequiredEquipment` Prisma models | Needs seeding and admin UI wiring |
| **ProviderCategory approval per category** | EXISTS — `ProviderCategory.approvalStatus` | Admin UI partial |
| **Admin manual dispatch override** | EXISTS — `dispatch.override_assignment` action | Operational |
| **Starter credit = 3 credits on MOBILE_VERIFIED** | EXISTS | Note: promo-awards README says MOBILE_VERIFIED = 3 credits, but May/June 2026 promo spec says "3 promo credits on approval" — matches |
| **KYC flow** | PARTIAL — `Provider.kycStatus` enum + `KYC_APPROVED` promo type exist; no active KYC collection form | KYC UI not implemented |
| **Worker Portal Supabase auth auto-creation** | MISSING — approval does not create a Supabase auth account automatically | Provider must self-register on portal separately |
| **WhatsApp PWA handoff** | EXISTS — `lib/client-pwa-handoff.ts`, `lib/provider-pwa-handoff.ts` | — |

---

## 11. Reuse Recommendations

1. **`crudAction()`** (`lib/crud-action.ts`) — already handles auth, audit, role checks. All new admin mutations MUST use it.
2. **`WalletLedgerEntry` system** — fully operational for any new credit type. Add new `WalletLedgerEntryType` enum values rather than building a separate ledger.
3. **`ProviderPromoAward` + `awardPromoCreditsForMilestoneInTransaction()`** — idempotent, duplicate-safe milestone system. Any new promo events should use this path rather than calling `creditPromoCreditsInTransaction()` directly.
4. **`CandidatePool` precomputed index** — extend this before adding new matching filters to avoid full-table scans.
5. **`Case` / `CaseEvent`** — ops queue and SLA already modelled. New queue types should register in `OpsQueueType` enum rather than creating new tables.
6. **`QualifiedShortlistState`** (`lib/qualified-shortlist-state.ts`) — central state machine for lead invite / provider / request transitions. Use `canProviderAcceptSelectedJob()`, `canCustomerSelectProvider()` etc. as guards rather than inline status checks.
7. **`ProviderAutoApproveSideEffectMarker`** — retryable side-effect system already exists. New approval side-effects (e.g. new promo types) should use this pattern.
8. **`InboundWhatsAppMessage` dedupe** — WAMID-based idempotency already in place. Do not add a second dedupe layer.
9. **`Attachment.safeForPreview`** — use this flag for all new attachment types that may reach provider safe-preview payloads.

---

## 12. Change Recommendations

1. **Supabase auth creation on approval**: The auto-approve flow (`provider-auto-approve.ts`) creates the `Provider` DB row but does not create a Supabase auth user. A provider who only registered via WhatsApp cannot log in to the Worker Portal without a separate sign-up step. Consider sending a portal invite (Supabase `inviteUserByEmail` or phone-OTP link) as a Phase B side-effect.

2. **KYC collection UI**: `Provider.kycStatus` and `KYC_APPROVED` promo award exist but there is no active form or flow to collect/verify KYC documents on the Worker Portal. This is needed before the `KYC_APPROVED` promo award can fire.

3. **Category seeding**: The `Category`, `CategoryRequiredCertification`, and `CategoryRequiredEquipment` models exist in the schema but are likely empty in production. The current category slugs in `lib/service-categories.ts` and `lib/service-category-policy.ts` need to be migrated into DB rows via a seed script.

4. **`ProviderCategory` admin UI**: The per-provider category approval UI in `/admin/applications` is partial. A dedicated admin view per approved provider is needed.

5. **Multi-role admin users**: `AdminUser.role` is a single enum. The CLAUDE.md notes multi-role is planned but not yet implemented.

6. **OWNER safety invariants**: No "last OWNER" guard or self-deactivate guard in `admin/team/actions.ts`.

7. **CI smoke alignment**: `e2e/smoke.spec.ts` references `/admin/breached` and `/admin/supply`. `/admin/breached` exists; `/admin/supply` does not. Smoke test should be updated.

8. **Observability**: Error boundaries use `console.error`. No Sentry/OpenTelemetry integration found. Add structured error reporting before GA.

9. **`idNumber` encryption**: `ProviderApplication.idNumber` is flagged as POPIA §26 special personal info (`schema.prisma:341`). The schema comment says "Encrypt at rest before GA." This is not yet done.

---

## 13. Risks and Unknowns

| Risk | Severity | Notes |
|---|---|---|
| `idNumber` stored as plaintext | HIGH | POPIA §26 special personal info. Schema comment says "Encrypt at rest before GA." Not done. |
| No Supabase auth account created on WhatsApp approval | MEDIUM | Provider can't access Worker Portal without separate auth; manual intervention or second sign-up required. |
| Legacy string service area fallback | MEDIUM | `MATCHING_CONFIG.allowLegacyStringFallback` in `matching-engine.ts:121`. If still `true` in production, matching quality degrades for providers without structured `TechnicianServiceArea` rows. |
| `Category` DB table likely empty | MEDIUM | All category logic uses string slugs. Schema models exist but are probably unseeded. Breaking existing matching if slug→ID lookup is added without migration. |
| `admin.applications.v2` flag state unknown | MEDIUM | Without this flag enabled, application approve/reject is UI-disabled. Unknown if flag is set in production. |
| Smoke test references non-existent route `/admin/supply` | LOW | CI smoke job silently passes or fails depending on environment. |
| `ProviderShortlist` published notification uses `sendText` | LOW | `notifyCustomerShortlistReady()` (`customer-shortlists.ts:143`) sends the shortlist text body, then a separate `sendCtaUrl`. If the first succeeds but the second fails, the customer receives the text with no actionable button. |
| Alternative-slot negotiation partial | LOW | `altSlotNegotiationSentAt` and `altSlotNegotiationOutcome` exist on `JobRequest`; `DispatchDecision.alternativeSlotOptions` exists. Flow is implemented in `lib/matching/alternative-slots.ts` but customer-side selection may not be fully wired in PWA. |
| `reservedCreditBalance` commented out | LOW | Comment in `ProviderWallet` (`schema.prisma:956`) notes it was intentionally omitted. Multi-step reservation holds will need this field before pooled dispatch. |
| `Job.runningLateWhatsappSentAt` idempotency | LOW | Field exists in schema; idempotency guard should be verified to exist in the runtime send path (analogous to `matchFoundWhatsappSentAt`). |

---

## OpenBrain Note

This assessment was generated from direct inspection of the production codebase as of commit `98da02e`. The system is substantially further along than a blank slate — the qualified shortlist model, credit ledger, matching engine v2 foundations, and WhatsApp bot are all operational. The highest-priority gaps before a production readiness review are: (1) `idNumber` encryption, (2) Supabase auth creation on WhatsApp-only approval, (3) Category DB seeding, and (4) KYC UI. The codex implementation pack should treat all existing patterns documented here as the canonical implementation reference and avoid re-implementing them.

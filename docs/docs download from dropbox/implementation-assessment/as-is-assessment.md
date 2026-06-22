# As-Is Assessment

## Current architecture summary

Plug A Pro's field-service application is a Next.js App Router app in `field-service/`. It uses Prisma/PostgreSQL for the marketplace domain, Supabase-auth-style sessions through `lib/auth.ts`, WhatsApp webhook flows in `lib/whatsapp-bot.ts` and `lib/whatsapp-flows/*`, Vercel Blob-backed attachments through `lib/storage.ts` and `lib/whatsapp-media.ts`, and PWA/admin/provider routes under `field-service/app`.

The app already has substantial implementations for:

| Area | Current implementation |
|---|---|
| Provider onboarding | WhatsApp provider registration in `field-service/lib/whatsapp-flows/registration.ts`; admin review in `field-service/app/(admin)/admin/applications/page.tsx`; provider sync in `field-service/lib/provider-record.ts` |
| Client request intake | WhatsApp request flow in `field-service/lib/whatsapp-flows/job-request.ts`; shared request creation in `field-service/lib/job-requests/create-job-request.ts`; customer PWA booking/service routes under `field-service/app/(customer)` |
| Matching | Matching v2 service in `field-service/lib/matching/service.ts`; compatibility wrapper in `field-service/lib/matching-engine.ts`; orchestrator in `field-service/lib/matching/orchestrator.ts` |
| Lead preview and unlock | Provider lead pages under `field-service/app/(provider)/provider/leads`; signed lead access in `field-service/lib/provider-lead-access.ts`; privacy-shaped lead detail in `field-service/lib/provider-lead-detail.ts` |
| Provider credits | Wallet service in `field-service/lib/provider-wallet.ts`; unlock debit in `field-service/lib/lead-unlocks.ts`; payment intents and Payfast support in `field-service/lib/provider-credit-payment-intents.ts`, `field-service/lib/provider-credit-gateway-itn.ts`, and `field-service/app/api/provider/wallet/top-up-intents/route.ts` |
| Admin | Admin console routes under `field-service/app/(admin)/admin`; provider, application, dispatch, matches, wallets, credit payments, disputes, customers, categories, locations, cases |
| Notifications | Template registry in `field-service/lib/messaging-templates.ts`; interactive WhatsApp helpers in `field-service/lib/whatsapp-interactive.ts`; public URL helpers in `field-service/lib/provider-credit-copy.ts` |

## Current data model summary

Primary schema: `field-service/prisma/schema.prisma`.

| Concept | Current table/model | Notes |
|---|---|---|
| Customers | `Customer` / `customers` | Phone-unique, WhatsApp opt-in fields, lifecycle/moderation fields |
| Addresses | `Address` / `addresses` | Structured street/suburb/city/province/postal/lat/lng plus `locationNodeId`; exact address fields are separate from locality |
| Providers | `Provider` / `providers` | Phone/user identity, skills, service areas, trust metrics, `verified`, `status`, `kycStatus`, profile metadata |
| Provider applications | `ProviderApplication` / `provider_applications` | Phone/name/skills/service areas/experience/availability/evidence/id number/status/review fields |
| Structured provider skills | `TechnicianSkill` / `technician_skills` | Provider category tags with proficiency/year fields available |
| Structured provider areas | `TechnicianServiceArea` / `technician_service_areas` | Location-node-backed area coverage with city/province/region/suburb keys and radius support |
| Availability | `ProviderSchedule`, `TechnicianAvailability`, `TechnicianScheduleItem` | Weekly schedule, live availability, and active commitments/holds |
| Client request | `JobRequest` / `job_requests` | Category/title/description/time window/equipment/certs/preferred provider/assignment mode/status/expiry/customer token |
| Attachments | `Attachment` / `attachments` | Linkable to job request, job, inspection slot, provider application; stores URL/blobKey/mime/label/uploader |
| Lead invite | `Lead` / `leads` | One row per job request/provider; statuses `SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED`; unique `(jobRequestId, providerId)` |
| Lead unlock | `LeadUnlock` / `lead_unlocks` | One unlock per lead; credits charged, credit type breakdown, dispute/refund status |
| Match | `Match` / `matches` | One selected provider per request after acceptance |
| Matching audit | `DispatchDecision`, `MatchAttempt`, `AssignmentHold` | Ranked decisions, provider attempts, active offer holds and expiry |
| Jobs | `Job`, `Booking`, `Quote`, `InspectionSlot` | Post-match execution and quote/booking lifecycle |
| Wallet | `ProviderWallet`, `WalletLedgerEntry`, `PaymentIntent`, `ProviderPromoAward` | Separate paid/promo balances with immutable ledger rows |
| Notifications | `MessageEvent`, `InboundWhatsAppMessage`, `Conversation`, `WhatsappPreferenceLog` | Message logging, idempotency, conversation state, preference audit |
| Admin/audit | `AdminUser`, `AdminAuditEvent`, `AuditLog`, `Case`, `CaseEvent`, `CaseNote` | Admin roles, audit, support queues |

Current important enum values:

| Enum | Values |
|---|---|
| `ProviderStatus` | `APPLICATION_PENDING`, `UNDER_REVIEW`, `ACTIVE`, `SUSPENDED`, `ARCHIVED`, `BANNED` |
| `KycStatus` | `NOT_STARTED`, `IN_PROGRESS`, `SUBMITTED`, `VERIFIED`, `REJECTED`, `EXPIRED` |
| `ApplicationStatus` | `PENDING`, `APPROVED`, `REJECTED` |
| `JobRequestStatus` | `PENDING_VALIDATION`, `OPEN`, `MATCHING`, `MATCHED`, `EXPIRED`, `CANCELLED` |
| `LeadStatus` | `SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED` |
| `LeadUnlockStatus` | `UNLOCKED`, `REFUNDED`, `DISPUTED`, `REVERSED` |
| `MatchStatus` | `MATCHED`, `INSPECTION_SCHEDULED`, `INSPECTION_COMPLETE`, `QUOTED`, `QUOTE_APPROVED`, `QUOTE_DECLINED`, `CANCELLED` |
| `DispatchDecisionStatus` | `RANKED`, `OFFERING`, `ASSIGNED`, `NO_MATCH`, `OVERRIDDEN`, `CANCELLED` |
| `MatchAttemptStage` | `FILTERED_OUT`, `RANKED`, `OFFERED`, `REJECTED`, `TIMED_OUT`, `ACCEPTED`, `SKIPPED`, `OVERRIDDEN` |
| `AssignmentHoldStatus` | `ACTIVE`, `ACCEPTED`, `REJECTED`, `EXPIRED`, `RELEASED`, `CANCELLED` |
| `WalletLedgerEntryType` | `TOPUP_CREDIT`, `PROMO_CREDIT`, `LEAD_UNLOCK_DEBIT`, `LEAD_REFUND_CREDIT`, `ADMIN_ADJUSTMENT`, `WALLET_SUSPENDED`, `WALLET_REACTIVATED`, `PROMO_EXPIRY`, `PAYMENT_REVERSAL` |
| `WalletCreditType` | `PAID`, `PROMO` |

## Current provider onboarding flow

Provider onboarding starts in WhatsApp. Trigger keywords include `register`, `join`, `technician`, `provider`, `apply`, `find work`, and related phrases in `field-service/lib/whatsapp-flows/registration.ts`.

Current WhatsApp steps:

| Step | Purpose |
|---|---|
| `reg_start` | Intro and duplicate provider/application checks |
| `reg_collect_name` | Captures provider name |
| `reg_collect_skills` / `reg_collect_skills_more` | Captures service categories from `SERVICE_CATEGORY_OPTIONS` |
| `reg_collect_area`, `reg_collect_city`, `reg_collect_region`, `reg_collect_suburb_select`, `reg_collect_suburb_text` | Captures structured or fallback service areas |
| `reg_collect_experience` | Captures experience text |
| `reg_collect_availability` | Captures availability options |
| `reg_collect_evidence` | Captures up to 5 evidence files through WhatsApp media storage |
| `reg_confirm` | Confirms and submits |
| `reg_pending` | Keeps application in review state |

Data is stored in `ProviderApplication`, with linked evidence files in `Attachment.providerApplicationId`. On submission the flow calls `syncProviderRecord`, `syncProviderSkills`, `upsertStructuredServiceAreas`, and application notification helpers. The application remains reviewable; registration does not equal approval.

Current approval meaning:

| Current condition | Effect |
|---|---|
| `ProviderApplication.status = APPROVED` | Application reviewed positively |
| `Provider.active = true`, `Provider.verified = true`, `Provider.status = ACTIVE` | Provider is eligible for matching and Worker Portal access |
| `Provider.kycStatus` | Exists, but matching currently gates on `verified` and `status` rather than requiring `KycStatus.VERIFIED` |

Worker Portal login is phone OTP based through `/provider-sign-in`, `/provider-verify`, `/api/auth/provider/send-code`, and `/api/auth/provider/verify-code`. `field-service/proxy.ts` enforces provider route access and calls `checkWorkerPortalAccess`.

Starter credits are awarded through promo credit infrastructure. `scripts/manual-approve-provider.ts` calls `awardMobileVerifiedPromoCreditsInTransaction`, and the wallet foundation uses immutable ledger entries.

## Current client request flow

Client request intake exists primarily through WhatsApp in `field-service/lib/whatsapp-flows/job-request.ts`, with PWA customer routes under `field-service/app/(customer)`.

WhatsApp request steps include category browse, name, structured address capture, issue description, availability, photo collection, and confirmation. The shared creation service is `field-service/lib/job-requests/create-job-request.ts`.

Current captured request fields:

| Field group | Current storage |
|---|---|
| Customer identity | `Customer.phone`, `Customer.name`, optional `Customer.userId` |
| Category | `JobRequest.category` |
| Summary/details | `JobRequest.title`, `JobRequest.description` |
| Timing | `JobRequest.requestedWindowStart`, `requestedWindowEnd`, `requestedArrivalLatest`, `estimatedDurationMinutes` |
| Address | `Address.street`, `addressLine1`, `addressLine2`, `complexName`, `unitNumber`, `suburb`, `region`, `city`, `province`, `postalCode`, `lat`, `lng`, `locationNodeId` |
| Requirements | `requiredSkillTags`, `requiredCertificationCodes`, `requiredEquipmentTags`, `requiredVehicleTypes` |
| Preference/assignment | `preferredProviderId`, `assignmentMode`, `customerAcceptedAmount`, `customerAcceptedScope`, `autoCreateBookingOnAssignment` |
| Photos | `Attachment` rows with `jobRequestId` after transactional linking |

Photos are app-controlled once stored and linked. `createJobRequest` links previously uploaded WhatsApp photos by `photoAttachmentIds` inside the request transaction and fails if expected attachments are not linked.

Exact address and customer contact are separated in the schema. Provider preview services intentionally select suburb/city/province/region only until unlock.

## Current matching and lead flow

Current matching is sequential assignment, not a customer shortlist.

Flow:

1. `createJobRequest` creates `JobRequest.status = OPEN`.
2. It schedules `orchestrateMatch` after creation.
3. `runAssignmentForJobRequest` ranks providers using `rankCandidatesForJobRequest`.
4. It writes `DispatchDecision` and `MatchAttempt` rows.
5. In auto mode, it offers the top candidate only by creating `AssignmentHold` and upserting a `Lead`.
6. Provider receives WhatsApp preview/action buttons.
7. Provider can accept or decline.
8. Decline or expiry can offer the next ranked provider.
9. Acceptance creates `LeadUnlock`, debits credits, creates `Match`, sets `JobRequest.status = MATCHED`, and expires other pending leads.

Provider selection inputs include provider active/verified/status, skills, structured service areas, availability, scheduling commitments, category requirements, travel/radius checks, reliability metrics, and preferred provider signal.

Multiple providers can exist as ranked attempts for a request, but the system currently keeps one active offer/hold at a time. There is no provider response object for rate/arrival and no customer shortlist model.

## Current credit flow

Credits are ledger-first and split into paid and promo buckets.

| Concern | Current implementation |
|---|---|
| Balance table | `ProviderWallet.paidCreditBalance`, `promoCreditBalance`, `status` |
| Immutable ledger | `WalletLedgerEntry` with type, credit type, amount, balance after fields, reference, metadata |
| Paid top-up | `creditPaidCreditsInTransaction` and payment intent reconciliation |
| Promo/starter | `creditPromoCreditsInTransaction`, `ProviderPromoAward`, `awardMobileVerifiedPromoCreditsInTransaction` |
| Lead debit | `debitCreditsForLeadUnlockInTransaction` via `unlockLeadForProviderInTransaction` |
| Refund | `refundCreditsInTransaction` and lead unlock dispute handling |
| Atomicity | Lead acceptance wraps unlock debit, match creation, and request updates in a Prisma transaction |

Current commercial timing does not match the Qualified Shortlist Model: credits are deducted when the provider accepts a sequential lead offer, before any customer shortlist selection.

## Current WhatsApp template inventory

Template registry: `field-service/lib/messaging-templates.ts`.

Current template names:

| Group | Templates |
|---|---|
| Booking lifecycle | `booking_confirmation`, `booking_reminder`, `booking_rescheduled`, `booking_cancelled` |
| Payment | `payment_reminder`, `payment_received` |
| Dispatch/job | `technician_assigned`, `technician_on_the_way`, `technician_arrived`, `technician_job_reminder`, `job_offer` |
| Quote/extra work | `quote_ready`, `extra_work_approval` |
| Completion/follow-up | `job_completed`, `follow_up` |
| Availability/no match | `slot_available`, `no_technician_available` |
| Provider onboarding | `technician_application_received`, `technician_welcome`, `technician_application_declined` |
| Wallet/lead unlock | `wallet_low_balance`, `wallet_zero_balance_lead`, `wallet_payment_intent_created`, `wallet_payment_credited`, `wallet_payfast_topup_initiated`, `lead_unlock_provider`, `lead_unlock_customer_intro` |

Interactive message names are also used through `sendText`, `sendButtons`, and `sendCtaUrl`, including `interactive:new_lead_actions`, `interactive:lead_expired`, `interactive:request_received_no_match`, and provider registration/request flow messages.

Public URL helper: `field-service/lib/provider-credit-copy.ts`.

Important behavior:

- Resolves `APP_PUBLIC_URL` then `NEXT_PUBLIC_APP_URL`.
- Provider lead links can use `PROVIDER_LEAD_APP_URL` or `NEXT_PUBLIC_PROVIDER_LEAD_APP_URL`.
- Blocks localhost in production.
- Provides `getProviderTermsUrl`, `getWorkerPortalUrl`, and `getProviderLeadPublicAppUrl`.

## Current admin capability inventory

Admin routes exist under `field-service/app/(admin)/admin`.

| Capability | Current route/files |
|---|---|
| Provider applications | `applications/page.tsx` |
| Provider records | `providers/page.tsx`, `providers/[id]/page.tsx`, `providers/actions.ts`, `providers/new/page.tsx` |
| Provider wallets | `provider-wallets/page.tsx`, `provider-wallets/[providerId]/page.tsx`, `provider-wallets/actions.ts` |
| Provider credit payments | `provider-credit-payments/page.tsx`, `provider-credit-payments/[id]/page.tsx`, `provider-credit-payments/actions.ts` |
| Dispatch/matching | `dispatch/page.tsx`, `matches/page.tsx` |
| Lead unlock disputes | `lead-unlock-disputes/page.tsx`, `lead-unlock-disputes/actions.ts` |
| Customers | `customers/page.tsx`, `customers/[id]/page.tsx`, `customers/actions.ts`, export API |
| Categories/locations | `categories/*`, `locations/*` |
| Cases/ops queues | case actions and components under `admin/_actions/case` and `_components` |
| Team/permissions | `team/*` |

Known admin gaps for shortlist target: category-specific provider approval is partially represented by skill/certification/category tables but is not yet a first-class provider category approval workflow for shortlist eligibility.

## Current API routes and server actions

Key API routes found:

| Route | Purpose |
|---|---|
| `/api/webhooks/whatsapp` | WhatsApp inbound webhook |
| `/api/webhooks/payfast`, `/api/webhooks/payments` | Payment/webhook handling |
| `/api/auth/provider/send-code`, `/api/auth/provider/verify-code` | Provider OTP login |
| `/api/auth/phone-exists`, `/api/auth/link`, `/api/auth/session` | Auth/session support |
| `/api/attachments/[id]` | Protected attachment proxy |
| `/api/provider/wallet/top-up-intents` | Provider wallet top-up intent creation |
| `/api/internal/match`, `/api/cron/match-leads`, `/api/internal/cron/rebuild-candidate-pool` | Matching and candidate pool processing |
| `/api/customer/bookings`, `/api/customer/services/[serviceId]`, `/api/customer/preferences`, `/api/customer/slots`, `/api/customer/location-reverse` | Customer PWA support |
| `/api/admin/customers/export`, `/api/admin/providers/export`, `/api/admin/locations/*` | Admin APIs |

Important server actions:

- Provider lead accept/decline/dispute actions in `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`.
- Provider credit actions in `field-service/app/(provider)/provider/credits/actions.ts`.
- Admin provider, wallet, credit payment, dispute, customer, category, location, booking, quote, team actions under `field-service/app/(admin)/admin`.

## Current test coverage

The test suite is broad and uses Vitest. Relevant files include:

| Area | Tests |
|---|---|
| Wallet/credits | `__tests__/lib/provider-wallet.test.ts`, `provider-promo-awards.test.ts`, `provider-credit-payment-intents.test.ts`, `provider-credit-gateway-itn.test.ts`, `provider-credit-reconciliation.test.ts`, admin/provider credit action tests |
| Lead unlock | `__tests__/lib/lead-unlocks.test.ts`, `lead-unlock-disputes.test.ts`, integration test `provider-credit-wallet-lead-monetisation.test.ts` |
| Matching | `matching-engine.test.ts`, `matching-service.test.ts`, `matching-orchestrator.test.ts`, `matching-expiry.test.ts`, `matching-dispatch.test.ts`, `matching-filter.test.ts`, `matching-scheduling.test.ts`, `candidate-pool.test.ts` |
| Provider onboarding | `provider-applications.test.ts`, `provider-application-notifications.test.ts`, `provider-record.test.ts`, `provider-trust.test.ts` |
| Request/privacy | `create-job-request.test.ts`, `job-request-access.test.ts`, `attachments-authz.test.ts`, `structured-address.test.ts` |
| WhatsApp | `webhooks.test.ts`, `webhooks-security.test.ts`, `whatsapp-idempotency.test.ts`, `whatsapp-media.test.ts`, `whatsapp-menu-routing.test.ts`, `whatsapp-policy.test.ts` |
| Admin | provider wallet/payment/dispute/case/booking/customer action tests |

## Gaps against the Qualified Shortlist Model

| Target requirement | Current state | Gap |
|---|---|---|
| Providers receive safe opportunity preview without charge | Safe preview exists | Current action is "accept lead", not "interested with rate/availability" |
| Multiple top providers receive preview | Matching ranks many providers | Auto mode offers only one active provider at a time |
| Provider response includes call-out fee/rate/arrival | No dedicated response model | Need provider lead response fields/table or extension |
| Customer receives shortlist | No shortlist table/page found | Need shortlist generation, customer comparison UI, selection |
| Customer selection precedes provider final acceptance | Current provider acceptance comes first | Need new state order and guards |
| Credits deducted only on selected provider final acceptance | Current debit occurs on lead acceptance | Must move debit to selected-job acceptance path |
| Full customer details unlock after selected provider accepts | Unlock exists after current accept | Keep privacy pattern but change unlock trigger |
| KYC-approved providers only may unlock full lead details | `KycStatus` exists | Current unlock checks `verified` and `status`, not explicit `kycStatus = VERIFIED` |
| Provider categories approved separately | Category/skill/cert tables exist | Need category-level approval semantics |
| Request has urgency/budget/preference fields | Timing and accepted amount exist | Need explicit urgency, subcategory, budget preference, provider preference |

## Reuse recommendations

Reuse these systems rather than creating duplicates:

1. Reuse `Provider`, `ProviderApplication`, `TechnicianSkill`, `TechnicianServiceArea`, `TechnicianAvailability`, and provider trust/certification/equipment models for provider onboarding.
2. Reuse `Customer`, `Address`, `JobRequest`, and `Attachment` for client service requests.
3. Reuse `DispatchDecision`, `MatchAttempt`, and ranking/scoring functions for explainable matching.
4. Extend `Lead` as the lead invite anchor, or add child response/shortlist tables keyed to `Lead`, rather than creating a parallel lead system.
5. Reuse `ProviderWallet` and `WalletLedgerEntry` for all credit changes.
6. Reuse `LeadUnlock` as the unlock marker, but change the business trigger to selected-provider final acceptance.
7. Reuse `provider-credit-copy.ts` for public URL creation and production-localhost guards.
8. Reuse the protected attachment proxy route for all preview images.

## Change recommendations

1. Add official state-machine helpers that map current enum values to the Qualified Shortlist Model.
2. Add schema support for provider response details and customer shortlist items.
3. Extend `JobRequest` with explicit request reference, source, urgency, subcategory, budget preference, provider preference, and selected provider/invite fields.
4. Change matching dispatch from one active sequential offer to top-N safe opportunity previews for shortlist-enabled requests.
5. Add provider interested/not-interested responses without wallet debit.
6. Add customer shortlist view and selection flow.
7. Move credit debit/unlock/job assignment to selected provider final acceptance.
8. Enforce `kycStatus = VERIFIED` or an approved mapped KYC policy before full detail unlock.
9. Update WhatsApp templates/copy from "lead accepted/unlocked" to "opportunity, shortlist, customer selected, final accept".
10. Keep legacy sequential assignment compatible during migration until shortlist flow is fully cut over.

## Risks and unknowns

| Risk | Impact |
|---|---|
| Existing production data uses current statuses | Migration must map without breaking active leads |
| Current credits are charged at provider lead acceptance | Changing timing affects revenue recognition and support expectations |
| One-active-hold matching is deeply integrated | Top-N previews require careful capacity and expiry changes |
| No explicit shortlist tables found | Customer selection needs new persistence and idempotency |
| KYC gate is not the current unlock predicate | Product must confirm whether `Provider.verified` is sufficient or `KycStatus.VERIFIED` is mandatory |
| WhatsApp template names still use technician/lead language | Meta template approval may be needed for renamed flows |
| Attachments are visible to invited providers before acceptance | This matches the blueprint if photos are safe preview, but all unsafe media needs moderation or `safe_for_preview` semantics |

## OpenBrain note

As-is assessment completed for the Qualified Shortlist Model. The current app already has ledger-first provider wallets, protected lead preview/unlock, sequential matching with `DispatchDecision`/`MatchAttempt`/`AssignmentHold`, WhatsApp onboarding/request flows, and admin provider/wallet support. The major architectural change is not adding matching from scratch; it is converting current one-provider sequential paid unlock into top-N provider opportunity responses, customer shortlist selection, and credit deduction only when the selected provider accepts. No production behavior changed in this assessment step.

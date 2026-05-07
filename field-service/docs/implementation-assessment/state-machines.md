# Plug A Pro — State Machines and Product Decisions

> Generated: 2026-05-07
> Source of truth for all state-transition guards and UI rules in the Qualified Shortlist Model.

---

## Qualified Shortlist Model Decision

Plug A Pro uses the **Qualified Shortlist Model**:

```
Client submits a service request
  → System matches approved, available providers
  → Providers express interest with a call-out fee and arrival window (free)
  → System builds a shortlist of responding providers
  → Client reviews shortlist and selects a provider
  → Selected provider confirms the job
  → 1 credit is deducted from provider wallet (atomic with confirmation)
  → Full customer contact and address details unlock
```

This model was chosen over direct-assign or auction approaches because:
- Customers choose from qualified candidates rather than receiving a single assignment
- Providers commit to a rate and arrival window before the customer selects, eliminating hidden negotiation
- The credit-deduction gate is tied to customer selection confirmation, not lead delivery, so providers have no cost for expressing interest

---

## Provider Application States

Mapped from `ApplicationStatus` enum (Prisma) plus the `ProviderApplication` record lifecycle.

| State | Prisma source | Meaning |
|---|---|---|
| `PENDING` | `ApplicationStatus.PENDING` | Submitted, awaiting first admin review |
| `MORE_INFO_REQUIRED` | `ApplicationStatus.MORE_INFO_REQUIRED` | Admin requested additional documents or clarification |
| `APPROVED` | `ApplicationStatus.APPROVED` | Application approved; triggers `Provider` record creation |
| `REJECTED` | `ApplicationStatus.REJECTED` | Application declined; provider cannot re-apply under same phone without ops override |
| `CANCELLED` | `ApplicationStatus.CANCELLED` | Provider withdrew their own application |

**Allowed transitions:**

```
PENDING → MORE_INFO_REQUIRED → PENDING
PENDING → APPROVED
PENDING → REJECTED
PENDING → CANCELLED
MORE_INFO_REQUIRED → PENDING (provider resubmits)
MORE_INFO_REQUIRED → APPROVED
MORE_INFO_REQUIRED → REJECTED
```

---

## Provider Profile States

Mapped from `ProviderStatus` enum and `Provider.verified`/`Provider.active` fields.

| Target state | Prisma source | Receive leads | Appear in shortlist | Worker Portal access |
|---|---|:---:|:---:|---|
| `draft_application` | No `Provider` record | No | No | None |
| `application_submitted` | `ProviderStatus.APPLICATION_PENDING` | No | No | Limited |
| `pending_review` | `ProviderStatus.UNDER_REVIEW` or unverified ACTIVE | No | No | Limited |
| `more_info_required` | `ApplicationStatus.MORE_INFO_REQUIRED` (not first-class on Provider) | No | No | Limited |
| `approved` | `ProviderStatus.ACTIVE` + `verified = true` + `active = true` | Yes | Yes | Full |
| `trusted` | `approved` + `kycStatus = VERIFIED` + completed jobs + rating ≥ 4.5 | Yes | Yes (boosted) | Full |
| `suspended` | `ProviderStatus.SUSPENDED` or `BANNED` | No | No | Read-only or blocked |
| `rejected` | `ApplicationStatus.REJECTED` on linked application | No | No | None |
| `inactive` | `Provider.active = false` or `ProviderStatus.ARCHIVED` | No | No | Read-only or blocked |

Mapper: `lib/qualified-shortlist-state.ts:107` — `mapProviderToQualifiedState()`

Rules table: `lib/qualified-shortlist-state.ts:91` — `QUALIFIED_PROVIDER_STATE_RULES`

---

## JobRequest States

Enum: `JobRequestStatus` (Prisma). Full lifecycle from submission through assignment.

| State | Prisma value | Meaning | Allowed transitions |
|---|---|---|---|
| `draft` | (no record) | Not yet submitted | → `submitted` |
| `submitted` | `PENDING_VALIDATION` | Submitted; platform validating address and category | → `matching` |
| `matching` | `OPEN` | Validated; leads being broadcast | → `awaiting_provider_responses` |
| `awaiting_provider_responses` | `MATCHING` | At least one lead sent; waiting for interest | → `shortlist_ready`, `expired`, `cancelled` |
| `shortlist_ready` | `SHORTLIST_READY` | Interested providers compiled into shortlist for customer | → `customer_selection_pending` |
| `customer_selection_pending` | (resolved from `SHORTLIST_READY`) | Shortlist published; waiting for customer to select | → `provider_confirmation_pending`, `cancelled` |
| `provider_confirmation_pending` | `PROVIDER_CONFIRMATION_PENDING` | Customer selected a provider; awaiting final acceptance | → `assigned`, `shortlist_ready` (if declined) |
| `assigned` | `MATCHED` | Provider accepted; `Match` created | → `scheduled` |
| `scheduled` | `MATCHED` + `Match.status = QUOTE_APPROVED` | Quote approved; `Booking` created | terminal from request perspective |
| `in_progress` | Inferred from `Job.status` | Active job execution | — |
| `completed` | Inferred from `Job.status = COMPLETED` | Job finished | terminal |
| `cancelled` | `CANCELLED` or `Match.status = CANCELLED` | Cancelled at any pre-assignment stage | terminal |
| `expired` | `EXPIRED` | No provider accepted within the window | terminal |

Mapper: `lib/qualified-shortlist-state.ts:135` — `mapRequestToQualifiedState()`

---

## Lead Invite States

Enum: `LeadStatus` (Prisma). An invite tracks a single provider's engagement with a specific `JobRequest`.

| State | Prisma value(s) | Meaning | Allowed transitions |
|---|---|---|---|
| `created` | (pre-send) | Invite record created, not yet delivered | → `sent` |
| `sent` | `SENT` | Delivered to provider via WhatsApp | → `viewed`, `expired` |
| `viewed` | `VIEWED` | Provider opened the lead preview | → `interested`, `not_interested`, `expired` |
| `interested` | `INTERESTED` | Provider submitted call-out fee and arrival window | → `shortlisted`, `not_interested`, `expired` |
| `not_interested` | `DECLINED` | Provider declined the opportunity | terminal |
| `expired` | `EXPIRED` or past `expiresAt` | Provider did not respond in time | terminal |
| `shortlisted` | `SHORTLISTED` or `shortlistItem` exists | Included in customer-visible shortlist | → `customer_selected`, `superseded` |
| `customer_selected` | `CUSTOMER_SELECTED` or `customerSelectedAt` set | Customer chose this provider; awaiting confirmation | → `provider_accepted`, `not_interested` (provider declines after selection) |
| `provider_accepted` | `ACCEPTED` or `providerAcceptedAt` set | Provider confirmed and credits deducted | terminal (Match created) |
| `provider_declined_after_selection` | (future explicit status) | Provider declined after being customer-selected | → shortlist re-evaluation |
| `superseded` | `SUPERSEDED` or `supersededAt` set | Customer chose a different provider from the shortlist | terminal |
| `cancelled` | `CANCELLED` or `cancelledAt` set | Customer cancelled before final acceptance | terminal |

Mapper: `lib/qualified-shortlist-state.ts:156` — `mapLeadInviteToQualifiedState()`

---

## Job States

Enum: `JobStatus` (Prisma). Enforced by `lib/jobs.ts` — `VALID_TRANSITIONS` table at line 16.

| State | Prisma value | Meaning | Allowed next states |
|---|---|---|---|
| `pending_assignment` | (no job record) | Match created, job not yet created | — |
| `assigned` | `SCHEDULED` | Job confirmed and scheduled | `EN_ROUTE`, `CALLBACK_REQUIRED`, `CANCELLED` |
| `on_the_way` | `EN_ROUTE` | Provider is travelling to site | `ARRIVED`, `CALLBACK_REQUIRED`, `CANCELLED` |
| `arrived` | `ARRIVED` | Provider on site | `STARTED`, `CALLBACK_REQUIRED`, `CANCELLED` |
| `in_progress` | `STARTED`, `PAUSED`, `AWAITING_APPROVAL`, `PENDING_COMPLETION_CONFIRMATION` | Work underway or awaiting customer confirmation | `COMPLETED`, `FAILED`, `CANCELLED` (see full matrix) |
| `completed` | `COMPLETED` | Customer confirmed completion | terminal |
| `cancelled` | `CANCELLED`, `FAILED` | Job did not reach completion | terminal (unless `FAILED` → `CALLBACK_REQUIRED`) |
| `disputed` | `CALLBACK_REQUIRED` | Follow-up needed; admin can reassign | `SCHEDULED` (re-assign) |

Full transition table (from `lib/jobs.ts:16–28`):

```
SCHEDULED         → EN_ROUTE, CALLBACK_REQUIRED, CANCELLED
EN_ROUTE          → ARRIVED, CALLBACK_REQUIRED, CANCELLED
ARRIVED           → STARTED, CALLBACK_REQUIRED, CANCELLED
STARTED           → PAUSED, AWAITING_APPROVAL, PENDING_COMPLETION_CONFIRMATION, FAILED, CANCELLED
PAUSED            → STARTED, AWAITING_APPROVAL, FAILED, CANCELLED
AWAITING_APPROVAL → STARTED, PENDING_COMPLETION_CONFIRMATION, FAILED, CANCELLED
PENDING_COMPLETION_CONFIRMATION → COMPLETED, STARTED
COMPLETED         → (terminal)
CANCELLED         → (terminal)
FAILED            → CALLBACK_REQUIRED, CANCELLED
CALLBACK_REQUIRED → SCHEDULED (admin re-assign)
```

Mapper: `lib/qualified-shortlist-state.ts:179` — `mapJobToQualifiedState()`

---

## State Helper Functions

All helpers live in `lib/qualified-shortlist-state.ts`. All were present before this step — no new file was required.

| Helper | Line | Description |
|---|---|---|
| `mapProviderToQualifiedState` | `:107` | Maps raw `Provider` fields to `QualifiedProviderState` |
| `mapRequestToQualifiedState` | `:135` | Maps `JobRequest.status` + `Match.status` to `QualifiedRequestState` |
| `mapLeadInviteToQualifiedState` | `:156` | Maps `Lead` fields and timestamps to `QualifiedLeadInviteState` |
| `mapJobToQualifiedState` | `:179` | Maps `Job.status` to `QualifiedJobState` |
| `canProviderReceiveLeads` | `:192` | Returns `true` if provider is approved/trusted and active |
| `canProviderAppearInShortlist` | `:196` | Returns `true` if provider can be included in a customer shortlist |
| `canProviderAccessWorkerPortal` | `:200` | Returns `true` unless state is `none` (rejected or draft) |
| `canRequestRunMatching` | `:204` | Returns `true` if request is in `submitted`, `matching`, or `awaiting_provider_responses` |
| `canLeadInviteReceiveProviderResponse` | `:209` | Returns `true` if invite is `sent`, `viewed`, or `interested` (not expired, not already responded) |
| `canCustomerSelectProvider` | `:214` | Returns `true` if invite is `interested` or `shortlisted` |
| `canProviderAcceptSelectedJob` | `:219` | Returns `true` if invite is `customer_selected`, request is `provider_confirmation_pending`, and provider can receive leads (credits ≥ 1 checked downstream in `lead-unlocks.ts`) |
| `canProviderViewFullJobDetails` | `:231` | Returns `true` if the provider has an active unlock or accepted assignment on this job |
| `canShowExpiryCountdown` | `:242` | Returns `true` only for `sent`, `viewed`, `interested` — countdown hidden once responded or expired |

---

## UI Rules

### Provider Worker Portal

| Condition | Portal behaviour |
|---|---|
| State = `draft_application` or `rejected` | No portal access; redirect to landing or rejection screen |
| State = `application_submitted`, `pending_review`, `more_info_required` | Limited access: status screen only; no lead feed |
| State = `approved` or `trusted` | Full access: lead feed, credit wallet, active jobs |
| State = `suspended` or `inactive` | Read-only or blocked: can view history but cannot act on leads |

### Lead/Opportunity Feed

| Condition | Display rule |
|---|---|
| Invite is `sent` or `viewed` | Show opportunity card with expiry countdown |
| Invite is `interested` | Show "Awaiting shortlist" state — countdown hidden |
| Invite is `shortlisted` | Show "You're on the shortlist" card |
| Invite is `customer_selected` | Show accept/decline CTA with job and credit cost |
| Invite is `expired`, `not_interested`, `superseded`, `cancelled` | Show archived/closed state; no action available |
| Invite is `provider_accepted` | Show full job card with customer contact details |

### Customer-facing

| Condition | Display rule |
|---|---|
| Request is `matching` or `awaiting_provider_responses` | Show "Finding providers" spinner |
| Request is `shortlist_ready` or `customer_selection_pending` | Show shortlist with provider profiles, rates, arrival windows |
| Request is `provider_confirmation_pending` | Show "Confirming with provider" state |
| Request is `assigned` | Show confirmed provider card |
| Request is `expired` | Show expiry notice with re-submit option |

### Credit and address unlock

- Full customer address and contact details are only shown after `LeadUnlock` exists with `status = UNLOCKED` AND the unlock's `providerId` matches the requesting provider (`canProviderViewFullJobDetails`)
- Credit cost is 1 credit per accepted job. Cost is deducted atomically inside the `unlockLeadForProviderInTransaction` call in `lib/lead-unlocks.ts`
- Promo credits are consumed before paid credits (wallet debit order is enforced in `lib/provider-wallet.ts`)

---

## OpenBrain Decision Note

State-machine foundation implemented as a compatibility layer in `lib/qualified-shortlist-state.ts`. The Prisma schema remains authoritative for persisted values. The qualified-state types and guard helpers provide a stable contract for UI and service code to depend on as shortlist-specific fields land incrementally. No schema drops or renames were introduced in this step. An existing partial draft at `docs/qualified-shortlist-state-machines.md` is superseded by this file.

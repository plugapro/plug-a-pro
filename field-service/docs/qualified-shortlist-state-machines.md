# Qualified Shortlist State Machines

## Product decision

Plug A Pro will use the Qualified Shortlist Model:

```text
Client submits request
System matches suitable approved providers
Providers confirm interest, rate, and availability
Client receives shortlist
Client selects provider
Selected provider accepts job
1 credit is deducted
Full customer details unlock
```

## Current-to-target mappings

These mappings are implemented in `lib/qualified-shortlist-state.ts`.

### Provider application / provider profile

| Target state | Current source values | Receive leads | Appear in shortlist | Worker Portal |
|---|---|---:|---:|---|
| `draft_application` | No provider/application record | No | No | No |
| `application_submitted` | `Provider.status = APPLICATION_PENDING` | No | No | Limited |
| `pending_review` | `Provider.status = UNDER_REVIEW` or unverified active provider | No | No | Limited |
| `more_info_required` | Not first-class yet | No | No | Limited |
| `approved` | `Provider.status = ACTIVE`, `active = true`, `verified = true` | Yes | Yes | Full |
| `trusted` | Approved plus `kycStatus = VERIFIED`, completed jobs, high rating | Yes | Yes, boosted | Full |
| `suspended` | `Provider.status = SUSPENDED` or `BANNED` | No | No | Read-only or blocked |
| `rejected` | `ProviderApplication.status = REJECTED` | No | No | No |
| `inactive` | `active = false` or `Provider.status = ARCHIVED` | No | No | Read-only or blocked |

### Client service request

| Target state | Current source values |
|---|---|
| `draft` | No persisted `JobRequest` yet |
| `submitted` | `JobRequest.status = PENDING_VALIDATION` |
| `matching` | `JobRequest.status = OPEN` |
| `awaiting_provider_responses` | `JobRequest.status = MATCHING` |
| `shortlist_ready` | Future shortlist status |
| `customer_selection_pending` | Future shortlist published state |
| `provider_confirmation_pending` | Future selected-provider state |
| `assigned` | `JobRequest.status = MATCHED` |
| `scheduled` | Current match with approved quote/booking |
| `cancelled` | `JobRequest.status = CANCELLED` or cancelled match |
| `expired` | `JobRequest.status = EXPIRED` |

### Lead invite

| Target state | Current source values |
|---|---|
| `created` | Future pre-send invite |
| `sent` | `Lead.status = SENT` |
| `viewed` | `Lead.status = VIEWED` |
| `interested` | Future provider response state |
| `not_interested` | `Lead.status = DECLINED` |
| `expired` | `Lead.status = EXPIRED` or past `expiresAt` |
| `shortlisted` | Future shortlist item exists |
| `customer_selected` | Future `customerSelectedAt` exists |
| `provider_accepted` | `Lead.status = ACCEPTED` or future `providerAcceptedAt` exists |
| `provider_declined_after_selection` | Future selected-provider decline state |
| `superseded` | Future `supersededAt` exists |
| `cancelled` | Future `cancelledAt` exists |

### Job

| Target state | Current source values |
|---|---|
| `pending_assignment` | No job yet |
| `assigned` | `Job.status = SCHEDULED` |
| `on_the_way` | `Job.status = EN_ROUTE` |
| `arrived` | `Job.status = ARRIVED` |
| `in_progress` | `STARTED`, `PAUSED`, `AWAITING_APPROVAL`, `PENDING_COMPLETION_CONFIRMATION` |
| `completed` | `COMPLETED` |
| `cancelled` | `CANCELLED`, `FAILED` |
| `disputed` | `CALLBACK_REQUIRED` |

## Transition helper policy

The helper module exposes:

- `canProviderReceiveLeads`
- `canProviderAppearInShortlist`
- `canProviderAccessWorkerPortal`
- `canRequestRunMatching`
- `canLeadInviteReceiveProviderResponse`
- `canCustomerSelectProvider`
- `canProviderAcceptSelectedJob`
- `canProviderViewFullJobDetails`
- `canShowExpiryCountdown`

UI and service code should call these helpers as shortlist behavior is added, rather than inferring business state only from raw expiry timestamps or one-off string comparisons.

## OpenBrain note

State-machine foundation created as a compatibility layer over existing Prisma enums. The current schema remains authoritative for persisted values while `lib/qualified-shortlist-state.ts` defines target Qualified Shortlist states and guard helpers for new implementation work. This avoids introducing duplicate persisted statuses before the migration plan is finalized.

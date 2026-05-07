# Customer Shortlist and Selection

## Shortlist generation (confirmed)

`lib/customer-shortlists.ts` — `generateCustomerShortlistForRequest(requestId, limit=5)`:

- Queries `ProviderLeadResponse` for `INTERESTED` responses with a non-null `callOutFee` and `estimatedArrivalAt`, tied to non-expired leads (`SENT` or `VIEWED`) from active, verified providers.
- Orders by `estimatedArrivalAt ASC`, then `callOutFee ASC`, then `createdAt ASC` — fastest and cheapest responses rank first.
- Creates a `ProviderShortlist` row with status `PUBLISHED` and child `ProviderShortlistItem` rows, superseding any prior `PUBLISHED` shortlist atomically.
- Advances `JobRequest.status` → `SHORTLIST_READY` in the same transaction.
- Sends a WhatsApp notification to the customer with a CTA URL pointing to the token-based shortlist page.

Suspended providers are excluded at query time via `provider.active: true` and `provider.status: 'ACTIVE'`.

## Token-based shortlist page (existing)

`app/requests/access/[token]/page.tsx` — full shortlist journey:

- Calls `getCustomerShortlistForRequest(requestId)` to load the published shortlist with all provider card fields.
- Renders provider cards with: name, profile photo (`avatarUrl`), verification badge, bio, experience, category, call-out fee, estimated arrival, rate / negotiable flag, jobs completed, rating, skills, portfolio links, and trust signals.
- Selection form uses inline server action `selectShortlistProvider` → `selectShortlistedProviderForRequest`.
- "Ask for more options" form and "Cancel request" form are also present.
- After selection, redirects with `?selection=provider-confirming` query param to show the confirmation banner on page reload.
- Provider confirmation pending screen (`destination.screen === 'provider_confirmation'`) shows a warning banner with the selected provider name.

## Authenticated shortlist page — G2 fix

**Gap confirmed:** `app/(customer)/requests/[id]/page.tsx` did not query or render the shortlist at all when the request status was `SHORTLIST_READY` or `PROVIDER_CONFIRMATION_PENDING`.

**Fix applied:**

1. Added `getCustomerShortlistForRequest` import from `lib/customer-shortlists`.
2. Added three new server action imports from `./actions`:
   - `selectShortlistProviderAction`
   - `requestMoreShortlistOptionsAction`
   - `cancelRequestFromShortlistAction`
3. Added conditional shortlist fetch in the page's data section:
   - Only fetches when `jobRequest.status` is `SHORTLIST_READY` or `PROVIDER_CONFIRMATION_PENDING` and no `match` exists yet.
   - Derives `selectedShortlistItem` from `item.customerSelectedAt` or `jobRequest.selectedLeadInviteId === item.leadInviteId`.
   - `canRequestMoreOptions` and `canCancelRequest` are both `true` only while `SHORTLIST_READY`.
4. Added provider confirmation banner (warning tone) for `PROVIDER_CONFIRMATION_PENDING` state showing the selected provider's name.
5. Added shortlist section with full provider card grid including: category, experience, call-out fee, estimated arrival, rate/negotiable, jobs completed, rating (1 decimal / "New"), skills, portfolio links, trust signals, trust note, and select form.
6. Select button uses `.bind(null, requestId, itemId)` pattern — idiomatic for Next.js App Router server action binding.
7. Added `formatCurrency`, `formatDateTime`, and `MiniStat` helper functions (matching the token page equivalents).

**No schema changes required.** `JobRequest.selectedLeadInviteId` is already a scalar field returned by default from Prisma `findUnique` — it is present in `ClientPwaDestinationRequest` without needing an explicit select entry.

### New server actions (`app/(customer)/requests/[id]/actions.ts`)

| Action | Library function | Auth enforcement |
|---|---|---|
| `selectShortlistProviderAction(requestId, shortlistItemId)` | `selectShortlistedProviderForRequest` | session + request ownership |
| `requestMoreShortlistOptionsAction(requestId)` | `requestMoreShortlistOptions` | session + request ownership |
| `cancelRequestFromShortlistAction(requestId)` | `cancelRequestFromShortlist` | session + request ownership |

All three actions:
- Verify the authenticated session has `role === 'customer'`.
- Resolve the `Customer` record for the session via `resolveCustomerForSession`.
- Verify `jobRequest.customerId === customer.id` before proceeding.
- Forward `CustomerShortlistError.message` to the caller as `{ error }`.
- Call `revalidatePath('/requests/{id}')` on success; `cancelRequestFromShortlistAction` also revalidates `/bookings`.

## Provider card fields

Both the token page and the authenticated page render the following fields per shortlist item:

| Field | Source |
|---|---|
| Name | `item.provider.name` |
| Profile photo | `item.provider.avatarUrl` (backgroundImage, hidden if null) |
| Verification badge | `item.provider.verified` → "Application reviewed" / "Provider-supplied profile" |
| Bio | `item.provider.bio` |
| Category | `jobRequest.category` |
| Experience | `item.provider.experience` |
| Call-out fee | `item.displayCallOutFee` → `response.callOutFee` (ZAR formatted) |
| Estimated arrival | `item.displayArrivalTime` → `response.estimatedArrivalAt` (date+time formatted) |
| Rate / negotiable | `response.rateAmount` / `response.negotiable` |
| Jobs completed | `item.provider.completedJobsCount` |
| Rating | `item.provider.averageRating` (1 decimal / "New" if null) |
| Skills | `item.provider.skills` (up to 5) |
| Portfolio links | `item.provider.portfolioUrls` (up to 3–4) |
| Trust signals | `buildProviderTrustSignals(...)` |
| Trust note | `ProviderTrustNote` |

## Selection flow verification

`selectShortlistedProviderForRequest` in `lib/customer-shortlists.ts`:

1. Loads the shortlist item with its shortlist, lead, and provider.
2. Guards: item must exist and belong to the request; shortlist must be `PUBLISHED`; lead must not be `EXPIRED`; request must be in `SHORTLIST_READY` — any other state throws `REQUEST_NOT_AWAITING_SELECTION`.
3. In a single transaction:
   - `JobRequest.status` → `PROVIDER_CONFIRMATION_PENDING`
   - `JobRequest.selectedProviderId` = item.providerId
   - `JobRequest.selectedLeadInviteId` = item.leadInviteId
   - `Lead.customerSelectedAt` = now
   - `ProviderShortlistItem.customerSelectedAt` = now
   - `AuditLog` entry written with action `shortlist.provider_selected`
4. Notifies the selected provider via WhatsApp buttons (`confirm_accept:{leadId}` / `confirm_decline:{leadId}`) with their current credit balance and a CTA URL to the offer.
5. Returns `{ selectedItem, provider, notification }`.

**Lead status transition:** The `Lead` record does NOT get a status change at selection time — it gets `customerSelectedAt` set. The lead status transitions to `DECLINED` only if the provider declines (via `declineSelectedProviderJob`). Final acceptance is handled in Step 13.

**"Waiting for provider confirmation" message:** The customer is not sent a separate WhatsApp message at selection time. The confirmation state is surfaced in the UI when the page re-renders with `PROVIDER_CONFIRMATION_PENDING` status.

## Files changed

- `field-service/app/(customer)/requests/[id]/page.tsx` — added shortlist query, provider confirmation banner, full shortlist card grid, select/more-options/cancel forms
- `field-service/app/(customer)/requests/[id]/actions.ts` — added three shortlist server actions with session + ownership guard

## Tests added

`field-service/__tests__/app/customer/request-shortlist-actions.test.ts` — 9 new tests:

| Test | What it verifies |
|---|---|
| selectShortlistProviderAction — success | delegates to lib function with correct args, returns `{}` |
| selectShortlistProviderAction — no session | returns `{ error }`, lib not called |
| selectShortlistProviderAction — wrong customer | returns `{ error }`, lib not called |
| selectShortlistProviderAction — CustomerShortlistError | forwards message to caller |
| requestMoreShortlistOptionsAction — success | delegates to lib, returns `{}` |
| requestMoreShortlistOptionsAction — no session | returns `{ error }`, lib not called |
| requestMoreShortlistOptionsAction — CustomerShortlistError | forwards message |
| cancelRequestFromShortlistAction — success | delegates to lib, returns `{}` |
| cancelRequestFromShortlistAction — wrong customer | returns `{ error }`, lib not called |
| cancelRequestFromShortlistAction — CustomerShortlistError (provider confirming) | forwards message |

## Test results

```
Test Files  165 passed | 1 skipped (166)
     Tests  1780 passed | 4 todo (1784)
```

All tests pass. 9 new tests were added in the new file.

## Remaining gaps

- **Customer "waiting" WhatsApp notification at selection time:** The customer receives no outbound WhatsApp message when they select a provider. They only see the UI change. If they close the browser before the provider confirms, they have no push notification. This is an enhancement for a later step.
- **`CUSTOMER_SELECTION_PENDING` status:** The state machine has `SHORTLIST_READY` for the customer selection state. The task description mentions `CUSTOMER_SELECTION_PENDING` but that status does not exist in the schema — `SHORTLIST_READY` is the correct value.
- **Inline server action pattern note:** The authenticated page uses `.bind()` for form actions rather than inline `'use server'` closures in `.map()`. Both are valid in Next.js App Router; `.bind()` was chosen for clarity and consistency with how Next.js documents progressive-enhancement forms.
- **Token page parity:** The token page has a profile deep-link feature (`?view=shortlist&provider={id}`) for viewing an expanded provider card. The authenticated page does not yet have this profile deep-link. This is a cosmetic enhancement.

## OpenBrain Note

Log domain: `engineering`. Project: `PlugAPro`. Title: `engineering — G2 authenticated shortlist page fix (2026-05-07)`.

# Provider Opportunity Preview and Response

## Safe preview implementation

Safe preview is implemented in `lib/provider-opportunity-responses.ts:40–118` via `getSafeProviderOpportunityPreview()`.

The Prisma query selects only the following address fields: `suburb`, `region`, `city`, `province`. The returned shape wraps these under `request.area` with normalised display names via `normaliseLocationDisplayName()`.

Preview-body copy is built in `lib/provider-credit-copy.ts:310–363` via `buildProviderLeadPreviewMessage()`. It receives `area` (suburb), optional `city`, `province`, `subcategory`, `urgency`, `matchingPreference`, and `photosCount`. It never receives `street`, `unit`, `complex`, or `accessNotes`.

The WhatsApp dispatch path in `lib/matching/dispatch.ts:92–111`:
- fetches the wallet balance and counts only `safeForPreview = true` attachments
- passes `photosCount` to `buildProviderLeadPreviewMessage()`
- sends the body as a `sendCtaUrl` message (never inline raw URL)

Description is truncated to 180 characters via `previewNotes()` in `lib/provider-lead-detail.ts:106–109`.

## Protected field enforcement

The following fields are explicitly excluded from all preview paths:

| Field | Exclusion mechanism |
|---|---|
| `customer.phone` | Not selected in `getSafeProviderOpportunityPreview()` query |
| `customer.email` | Not selected |
| `address.street` | Not selected |
| `address.addressLine1/2` | Not selected |
| `address.unitNumber` | Not selected |
| `address.complexName` | Not selected |
| `address.accessNotes` | Not selected |
| `address.latitude/longitude` | Not present on Address model; not selected |
| Attachments with `safeForPreview = false` | `where: { safeForPreview: true }` in query |

The comment at `lib/provider-opportunity-responses.ts:88–90` is the canonical intent note:
> This return shape intentionally excludes customer, phone, email, street, unit, complex, access notes, and GPS fields. Do not broaden without a matching privacy test.

Full sensitive details (name, phone, full address, access notes, all attachments) are fetched in a separate second query only after `isUnlocked === true` in `getProviderLeadDetailForProvider()` (`lib/provider-lead-detail.ts:194–240`).

## Interest response flow

The WhatsApp interest capture is a 4-step conversational flow in `lib/whatsapp-bot.ts:3152–3327`:

1. **interested: button** — stores `pendingOpportunityLeadId` and `providerOpportunityStep: 'callout'` to conversation, sends call-out fee prompt
2. **callout step** — validates fee using `validateProviderOnboardingRates()`; re-prompts on invalid; advances to `arrival` step on success
3. **arrival step** — parses arrival time using `parseProviderOpportunityArrivalText()`; re-prompts on null; advances to `negotiable` step
4. **negotiable step** — Yes/No buttons; re-prompts on unexpected ID; advances to `note` step
5. **note step** — Skip or Add note; free-text note captured on add; submits via `respondToProviderOpportunity()`; sends structured confirmation

All steps accept `cancel` or `back_home` to abort cleanly with "No credits were used".

The single-step not-interested path (`not_interested: button`) calls `respondToProviderOpportunity()` directly with `response: 'NOT_INTERESTED'` and confirms "No credits used".

`respondToProviderOpportunity()` in `lib/provider-opportunity-responses.ts:120–265`:
- validates the idempotency key first (short-circuits if duplicate)
- validates lead ownership, status, and expiry
- validates call-out fee via `validateProviderOnboardingRates()`
- requires `callOutFee` and `estimatedArrivalAt` for INTERESTED responses
- stores or updates a `ProviderLeadResponse` row in a transaction
- advances lead status to `VIEWED` (interested) or `DECLINED` (not_interested)
- writes an `AuditLog` entry
- returns `{ response, creditsDeducted: 0 }` in all cases

## Credit rule confirmation (no deduction)

No credits are deducted at any point in the interest response flow. This is enforced at three layers:

1. `respondToProviderOpportunity()` always returns `creditsDeducted: 0` (hardcoded at `lib/provider-opportunity-responses.ts:264`)
2. The WhatsApp bot confirmation message always includes "No credits were used" (confirmed by test in `provider-whatsapp-interest-flow.test.ts:433–440`)
3. The preview message body states "Previewing and responding is free" and "You spend 1 credit only if the customer selects you and you accept" (`lib/provider-credit-copy.ts:357–358`)

The `buildProviderCreditSummaryMessage()` and `buildProviderOnboardingIntroMessage()` copy functions also state explicitly that previewing, showing interest, shortlisting, and declining do not use credits.

## Shortlist generation from responses

Shortlist generation in `lib/customer-shortlists.ts:36–130` uses `ProviderLeadResponse` rows as its source:

- Filters: `response = INTERESTED`, `callOutFee IS NOT NULL`, `estimatedArrivalAt IS NOT NULL`, lead `status IN (SENT, VIEWED)`, lead not expired, provider `active AND status = ACTIVE AND verified`
- Orders: `estimatedArrivalAt ASC`, then `callOutFee ASC`, then `createdAt ASC`
- Each `ProviderShortlistItem` gets `displayCallOutFee` and `displayArrivalTime` copied directly from the response

Auto-trigger logic in `lib/provider-opportunity-responses.ts:267–304`:
- Only fires when `qualified_shortlist.auto_trigger` feature flag is on
- Checks `interestedCount >= SHORTLIST_AUTO_TRIGGER_THRESHOLD` (default 2, overridable via `SHORTLIST_AUTO_TRIGGER_THRESHOLD` env var)
- Counts only valid interested responses from active/verified providers on non-expired leads
- Best-effort: failure does not roll back the interest response

`getCustomerShortlistForRequest()` (`lib/customer-shortlists.ts:167–230`) returns shortlist items with `callOutFee` sourced from `displayCallOutFee ?? response.callOutFee` and `estimatedArrivalAt` from `displayArrivalTime ?? response.estimatedArrivalAt`.

## Coverage from provider blueprint run

The following were confirmed closed in prior blueprint steps (06 and 07):

- `safeForPreview: true` enforcement on attachment counts in dispatch (step 06)
- `photosCount` passed to `buildProviderLeadPreviewMessage()` (step 06)
- 8 privacy regression tests in `provider-opportunity-whatsapp.test.ts` (step 06)
- Full interest/rate response WhatsApp flow including negotiable flag and optional note (step 07)
- `parseProviderInterestRateText()` in `lib/provider-whatsapp-interest-capture.ts` (step 07)
- 13 test cases for interest rate text parsing in `provider-whatsapp-interest-capture.test.ts` (step 07)

## Remaining gaps

No functional gaps were found. The following minor observations are noted:

1. **`providerPreference` field**: The `getSafeProviderOpportunityPreview()` query returns `providerPreference` and `budgetPreference` on the request object. These are preference enums (e.g. `save_money`, `best_value`), not customer PII, so their inclusion in preview is acceptable.

2. **`parseProviderOpportunityArrivalText` vs `parseArrival` in interest capture**: Two separate arrival parsers exist — `parseProviderOpportunityArrivalText()` (used by the arrival step in the WhatsApp bot) and `parseArrival()` inside `parseProviderInterestRateText()` (used for single-message combined responses). The `parseArrival()` implementation in `provider-whatsapp-interest-capture.ts` is significantly richer (handles relative times, `asap`, `in N hours`, `noon`, etc.). The `parseProviderOpportunityArrivalText()` in `provider-opportunity-whatsapp.ts` only handles `today/tomorrow + morning/afternoon/evening` and ISO dates. This is a known divergence but not a bug: the conversational multi-step flow always goes through the bot's arrival step which uses `parseProviderOpportunityArrivalText`, and providers who send structured single-message responses use the richer parser. No gap to close.

3. **Lead page alias**: `/provider/lead/[token]/page.tsx` is a thin alias of `/provider/handoff/[token]/page` — existing WhatsApp deep links continue to work. The handoff page is the canonical provider lead view.

## Files changed (if any)

None. This step is documentation-only. All items on the verification checklist were confirmed as already implemented.

## Tests (if any)

No new tests added. Existing test coverage verified at 1770 passing, 0 failing:

| File | Tests | Coverage |
|---|---|---|
| `__tests__/lib/provider-opportunity-whatsapp.test.ts` | 8 | Privacy regression, photo count, URL enforcement |
| `__tests__/lib/provider-opportunity-responses.test.ts` | 11 | Preview field safety, interest/not-interest, idempotency, auto-trigger |
| `__tests__/lib/provider-whatsapp-interest-capture.test.ts` | 13 | Rate text parsing, edge cases |
| `__tests__/lib/provider-whatsapp-interest-flow.test.ts` | ~20 | Full 4-step flow, credit invariant, error handling, cancel |

## OpenBrain Note

Log entry should be created for this session under project `PlugAPro`, domain `engineering`, covering Step 11 completion.

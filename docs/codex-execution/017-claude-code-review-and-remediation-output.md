# Execution Output — 017 Claude Code Review and Remediation

## Status

Completed with warnings

## Scope

Post-Codex code review and remediation of the Plug A Pro Qualified Shortlist Model implementation across blueprint steps 1–16. Reviewed against the original blueprint files in `Plug A Pro/plugapro_codex_blueprint/` and the Codex outputs in `docs/codex-execution/001-…-016-…`. This is **not a rewrite**: the Codex implementation was preserved where correct, and only safe gaps and risks were resolved.

## Method

1. Read all 16 blueprint files plus the master runner.
2. Read all 16 Codex execution outputs plus the master index.
3. Inspected key implementation files (`lib/qualified-shortlist-state.ts`, `lib/customer-shortlists.ts`, `lib/selected-provider-acceptance.ts`, `lib/provider-opportunity-responses.ts`, `lib/provider-credit-copy.ts`, `lib/matching-engine.ts`, `lib/whatsapp.ts`, `lib/whatsapp-policy.ts`, `prisma/schema.prisma`, `app/api/provider/opportunities/[leadId]/route.ts`, `app/requests/access/[token]/page.tsx`).
4. Compared implementation against product intent.
5. Resolved safe gaps; documented the rest as remaining work.
6. Added new tests for fixes.
7. Ran full validation.

---

## Overall product alignment

The implementation **does** follow the Qualified Shortlist Model:

- Provider applies → admin approves before leads (`lib/provider-applications.ts`, `MORE_INFO_REQUIRED` status added).
- Client submits request → provider preview is privacy-safe (`getSafeProviderOpportunityPreview` in `lib/provider-opportunity-responses.ts`).
- Provider responds INTERESTED with rate + arrival → recorded in `ProviderLeadResponse` without credit deduction.
- Customer shortlist generated from interested responses → `generateCustomerShortlistForRequest` in `lib/customer-shortlists.ts`.
- Customer selects provider → `selectShortlistedProviderForRequest` (no credit deduction).
- Selected provider accepts → `acceptSelectedProviderJob` debits exactly 1 credit through `unlockLeadForProviderInTransaction`, atomically creating `Match`/`Quote`/`Booking`/`Job`/`LeadUnlock` and unlocking full customer details.
- `acceptLead` (the legacy entry point) routes to the selected-provider path when the request is in `PROVIDER_CONFIRMATION_PENDING` (`lib/matching-engine.ts:171–208`).

This means the *credit timing* and *server-side privacy boundary* are correct.

The implementation has, however, a number of gaps the Codex output already flagged plus several new gaps surfaced during this review.

---

## Issues found and resolved in this remediation

### 1. Customer phone numbers were logged in plaintext across multiple paths (privacy)

**Severity:** High.
**Source blueprint:** 15 (Security and Privacy Audit) — "Do not log sensitive customer data unnecessarily."
**Found:**

- `lib/whatsapp.ts` had **30 distinct log lines** of the form ``phone=${params.customerPhone}`` across booking confirmation, on-the-way, extra-work approval, completed, arrived, reminder, follow-up, quote-ready, and other helpers.
- `lib/whatsapp.ts` cohort-mismatch warning logged the raw `to` phone.
- `lib/whatsapp-policy.ts` logged raw phones for opt-out/opt-in lookups.
- `app/api/cron/session-timeout/route.ts` logged raw `conv.phone` for already-claimed and service-opted-out branches.

**Fix:** Imported the existing `maskPhone` helper from `lib/support-diagnostics.ts` and applied it everywhere the phone is logged. Phone numbers now appear as `0XX****XXX` in logs.

- `field-service/lib/whatsapp.ts` — 31 log occurrences masked.
- `field-service/lib/whatsapp-policy.ts` — 2 log occurrences masked.
- `field-service/app/api/cron/session-timeout/route.ts` — 2 log occurrences masked.

The `to:` field of outbound `sendText`/`sendTemplate` payloads is unchanged (it is a recipient address, not a log).

### 2. Customer received no notification when their shortlist was published

**Severity:** Medium-High (UX/product gap).
**Source blueprint:** 12 (Customer Shortlist) and 14 (WhatsApp Templates) — "Add customer shortlist-ready outbound notification" was Codex's own follow-up in `014-whatsapp-template-and-url-audit-output.md` and `016-test-matrix-and-release-plan-output.md`.
**Found:** `generateCustomerShortlistForRequest` set the request to `SHORTLIST_READY` and updated DB, but no WhatsApp message was sent to the customer.
**Fix:** Added `notifyCustomerShortlistReady` inside `lib/customer-shortlists.ts` and wired it into `generateCustomerShortlistForRequest`. The message:

- Tells the customer the shortlist is ready.
- States how many providers responded.
- Includes the area (suburb, city).
- Reaffirms the privacy promise: phone and exact address only shared after selection + provider acceptance.
- Includes the production signed ticket URL when available (uses `getJobRequestAccessUrl`).
- Records `templateName: 'interactive:client_shortlist_ready'` so Meta-template registry work can pick it up.

The notification is best-effort: a failure is logged with `requestId` but does not roll back shortlist creation (the shortlist is the operational source of truth).

### 3. Customer could overwrite their selection after the request had already advanced

**Severity:** High (state-machine bug — could re-notify a different provider after the first provider had already accepted or was considering).
**Source blueprint:** 12.
**Found:** `selectShortlistedProviderForRequest` only checked `shortlist.status === 'PUBLISHED'` and `leadInvite.status !== 'EXPIRED'`. The shortlist remains PUBLISHED after the first selection (request becomes `PROVIDER_CONFIRMATION_PENDING`), so a second form post would silently overwrite `selectedProviderId`/`selectedLeadInviteId` and notify the new provider. The DB-level `selectedLeadInviteId @unique` only protects across requests, not within the same request.
**Fix:** Added a status guard in `lib/customer-shortlists.ts` that requires `JobRequest.status === 'SHORTLIST_READY'` before allowing selection. New error code `REQUEST_NOT_AWAITING_SELECTION` rolled into `CustomerShortlistError`.

### 4. Selected-provider final acceptance auto-expired the lead based on the *preview* window

**Severity:** High (could fail the customer's chosen provider after the customer had already committed).
**Source blueprint:** 13.
**Found:** `acceptSelectedProviderJob` rejected acceptance when `lead.expiresAt <= now`. But `Lead.expiresAt` is the *15-minute provider preview response window* set at dispatch. If the customer compared providers for longer than 15 minutes before selecting, and the selected provider then tapped Accept, this branch would mark the invite EXPIRED and refuse the deduction — orphaning the customer's selection and forcing them to restart.
**Fix:** Replaced the time-based check with `if (lead.status === 'EXPIRED')`. The preview-window expiry no longer governs final acceptance once the customer has already selected the provider; only an *explicitly* expired invite blocks acceptance. The reason the time-based check was unsafe: by the time the selected-provider acceptance runs, customer selection has already occurred (we verified `selectedLeadInviteId === lead.id` and `customerSelectedAt` set above this branch). Once the customer has chosen, the preview window is no longer the relevant deadline. Added a code comment explaining this.

### 5. Dead branch in qualified-state mapper for an enum value that never existed

**Severity:** Low (cleanup).
**Found:** `lib/qualified-shortlist-state.ts` mapped `request.status === 'CUSTOMER_SELECTION_PENDING'` to `customer_selection_pending`, but the `JobRequestStatus` enum has no such value (the actual states are `SHORTLIST_READY` → `PROVIDER_CONFIRMATION_PENDING`).
**Fix:** Removed the dead branch.

---

## Tests added

| Test | Location | What it verifies |
|---|---|---|
| `notifies the customer when a shortlist becomes ready` | `field-service/__tests__/lib/customer-shortlists.test.ts` | `generateCustomerShortlistForRequest` triggers the new customer WhatsApp notification with template `interactive:client_shortlist_ready` and the correct customer phone. |
| `rejects re-selection once the request has advanced past SHORTLIST_READY` | `field-service/__tests__/lib/customer-shortlists.test.ts` | `selectShortlistedProviderForRequest` throws `REQUEST_NOT_AWAITING_SELECTION` and does not enter the transaction when status is `PROVIDER_CONFIRMATION_PENDING`. |
| `still accepts when the original 15-min preview window has elapsed but the customer has selected` | `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Stale `lead.expiresAt` no longer blocks final acceptance. |
| `rejects acceptance when the lead is explicitly EXPIRED` | `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Explicit `LeadStatus.EXPIRED` still blocks acceptance. |
| `does not double-deduct when the same provider re-accepts an already-accepted lead` | `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Idempotency: re-running acceptance on an already-`ACCEPTED` lead with an existing match returns `alreadyUnlocked: true` and does not call `unlockLeadForProviderInTransaction`. |
| Mapping coverage for `SHORTLIST_READY`, `PROVIDER_CONFIRMATION_PENDING`, and the corresponding `canRequestRunMatching` boundary. | `field-service/__tests__/lib/qualified-shortlist-state.test.ts` | New request states map correctly and matching is correctly disabled once shortlist is ready. |

Existing test coverage already verified that other blueprint test cases pass:

- safe preview hides customer phone/address (`provider-opportunity-responses.test.ts:94–106`),
- accepted job does not show expiry countdown (`qualified-shortlist-state.test.ts:60`),
- customer selection does not deduct credits (`customer-shortlists.test.ts:219`),
- selected acceptance deducts exactly 1 credit and assigns the job (`selected-provider-acceptance.test.ts:124–155`),
- non-selected provider blocked before debit (`selected-provider-acceptance.test.ts:157–175`),
- insufficient credits block acceptance and create no assignment records (`selected-provider-acceptance.test.ts:177–192`),
- production WhatsApp URLs do not contain localhost (`provider-credit-copy.test.ts`).

---

## Remaining work (NOT fixed in this pass — too risky or out of remediation scope)

These were already flagged in the Codex outputs and remain valid follow-ups:

### Product-flow gaps

1. **WhatsApp `Interested` / `Not interested` button payloads still route to the legacy paid lead acceptance path.**
   `lib/whatsapp-bot.ts` handles `match_accept_…` / `match_decline_…` and `accept:…` / `decline:…` button replies, both of which call `acceptLead`/`declineLead` on `lib/matching-engine.ts`. They do **not** call `respondToProviderOpportunity` from `lib/provider-opportunity-responses.ts`. Consequence: provider responses sent over WhatsApp are not stored as `ProviderLeadResponse` rows, so `generateCustomerShortlistForRequest` (which queries that table) sees no candidates from WhatsApp providers. Until the WhatsApp router is rewired to the new free-response service, the qualified shortlist flow only works end-to-end when providers respond through the new `POST /api/provider/opportunities/[leadId]` route. This is the largest remaining functional gap and is product-decision-shaped: the new payload IDs and the relationship with the existing legacy `accept`/`decline` payloads need a coordinated change to the dispatcher copy, button payloads, and bot router. Out of scope for a remediation pass.
2. **`generateCustomerShortlistForRequest` is not yet auto-triggered by the matching/dispatch pipeline.** It exists as a service but no caller fires it on its own. It will need wiring after the WhatsApp button rewire so the system can promote interested responses into a published shortlist on a clock or a threshold (e.g., N interested responses, or T minutes after dispatch). Document remaining product decision.
3. **Ask-for-more-options and customer cancel-request actions are not implemented in the shortlist UI.** Already in Codex's follow-up list.
4. **PWA parity** for client request capture (urgency, provider preference, budget) — Codex's follow-up.
5. **Subcategory capture** on the WhatsApp request flow and **photo `safe_for_preview` classification** — Codex's follow-up.
6. **Provider reply path for `MORE_INFO_REQUIRED` applications.** The status exists; the intake-resume flow does not.
7. **Provider trust/profile capture is incomplete** — references, profile photo, classified ID/certification/work-photo evidence, and business profile fields are not yet captured in WhatsApp onboarding.
8. **Backfills** for `requestRef`, provider categories, and lead match score/ranking are not yet executed.

### Privacy / observability follow-ups

9. **Free-text description redaction is heuristic only** (`previewNotes` truncation). A structured access-notes field with strict post-acceptance visibility would make leakage of access codes embedded in the customer's free-text description impossible rather than just unlikely.
10. **Other `console.*` paths** outside the masked files were not exhaustively swept. The three highest-traffic paths (`whatsapp.ts`, `whatsapp-policy.ts`, `cron/session-timeout/route.ts`) are masked. A broader pass would cover any remaining `console.warn` / `console.info` lines that interpolate `customer.phone`, `address.street`, GPS coordinates, or token values across `lib/**` and `app/**`.

### Schema / state-machine follow-ups

11. **Lead state extensions.** The schema's `LeadStatus` is still the legacy 5-value enum (`SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED`). The Qualified Shortlist Model has a richer set (`interested`, `shortlisted`, `customer_selected`, `provider_accepted`, `superseded`, `cancelled`). The implementation reads these extra states from timestamp columns (`customerSelectedAt`, `providerAcceptedAt`, `cancelledAt`, `supersededAt`) and `ProviderShortlistItem` membership. This works but adds risk of state drift. A clean future migration would add explicit enum values; deferred per Codex's "additive-only" rule.
12. **`MatchStatus.QUOTE_APPROVED` after acceptance** is reused even though no real customer-approved quote exists yet; the auto-created quote from `acceptSelectedProviderJob` sets `status: 'APPROVED'` to satisfy downstream booking creation. Codex called this out as "refine before public rollout if product wants quote-after-arrival flow" — confirmed.

### Test coverage follow-ups

13. **Image access authorization** (blueprint 15 case "image URL denied for unauthorized provider") was confirmed via code inspection in `app/api/attachments/[id]/route.ts`, but a focused regression test for the case "non-selected provider cannot fetch attachment" would be valuable.
14. **Suspended-provider exclusion from shortlist generation** is implicit in the `provider.status: 'ACTIVE', verified: true` filter in `lib/customer-shortlists.ts:50–54`, but not directly asserted. A test asserting that a provider with `status: 'SUSPENDED'` is excluded would tighten the coverage.

---

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/whatsapp.ts` | Imported `maskPhone`; masked 31 log occurrences (30 in template helpers, 1 cohort-mismatch warning). |
| `field-service/lib/whatsapp-policy.ts` | Imported `maskPhone`; masked the two `applyOptOut` / `applyOptIn` warning logs. |
| `field-service/app/api/cron/session-timeout/route.ts` | Imported `maskPhone`; masked the two `already-claimed` / `service-opted-out` info logs. |
| `field-service/lib/customer-shortlists.ts` | Added customer shortlist-ready WhatsApp notification (`notifyCustomerShortlistReady`); enriched the `generateCustomerShortlistForRequest` request select to include category/customer phone/address; added `REQUEST_NOT_AWAITING_SELECTION` error code; added status guard requiring `SHORTLIST_READY` before selection; added `getJobRequestAccessUrl` import. |
| `field-service/lib/selected-provider-acceptance.ts` | Replaced time-based lead expiry check with explicit `lead.status === 'EXPIRED'` check so post-selection acceptance no longer fails on a stale 15-minute preview window. |
| `field-service/lib/qualified-shortlist-state.ts` | Removed the dead `CUSTOMER_SELECTION_PENDING` mapping branch. |
| `field-service/__tests__/lib/customer-shortlists.test.ts` | Added `getJobRequestAccessUrl` mock; expanded `mockDb.jobRequest.findUnique` to return the new shape; added two new tests (shortlist-ready notification, status-gated re-selection). |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Added three new tests (stale-expiry post-selection still accepts; explicit `LeadStatus.EXPIRED` still rejects; idempotent re-accept by same provider). |
| `field-service/__tests__/lib/qualified-shortlist-state.test.ts` | Added explicit assertions for `SHORTLIST_READY` → `shortlist_ready` and `PROVIDER_CONFIRMATION_PENDING` → `provider_confirmation_pending` mappings, plus `canRequestRunMatching({ status: 'SHORTLIST_READY' }) === false`. |
| `docs/codex-execution/017-claude-code-review-and-remediation-output.md` | This review/remediation output. |

## Schema / migration changes

None.

## API / server action changes

`selectShortlistedProviderForRequest` now throws `CustomerShortlistError('REQUEST_NOT_AWAITING_SELECTION', …)` if the request is not in `SHORTLIST_READY`. The customer access page already redirects to a `selection=failed` state on caught exceptions; the page-level UX therefore degrades gracefully without further changes.

## UI changes

None directly. The customer access page (`app/requests/access/[token]/page.tsx`) was not modified, but its `selectShortlistProvider` server action will surface the new `selection=failed` redirect when a stale form is submitted after the request has advanced.

## WhatsApp / template changes

Added one outbound text:

- `templateName: 'interactive:client_shortlist_ready'` — sent to the customer when `generateCustomerShortlistForRequest` publishes a shortlist. Free-text format. Will need a Meta template registry entry before any production rollout that exits the 24-hour customer session window; until then it relies on the existing in-window `sendText` path.

No copy changes to provider templates or to existing customer templates.

## Security and privacy impact

Net positive:

- All identified high-frequency phone-number leaks from WhatsApp paths are now masked (`maskPhone` produces `0XX****XXX`).
- Customer cannot accidentally re-trigger selection of a different provider mid-confirmation.
- Selected-provider acceptance no longer auto-expires post-selection due to a stale preview window, removing a path that would silently strand a customer's choice.

No new attack surface introduced. The shortlist-ready notification only includes the suburb/city, the category, and the customer's own ticket URL — no provider-specific data, no other-customer data.

## Credit impact

No wallet/ledger code changes. Credit deduction continues to happen exactly once per selected-provider acceptance through `unlockLeadForProviderInTransaction`. The fix to the lead-expiry check **does not loosen** the credit-deduction gate; it only removes a stale time-based reason to refuse acceptance after the customer has explicitly selected the provider.

## Commands run

```bash
npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/lib/selected-provider-acceptance.test.ts __tests__/lib/qualified-shortlist-state.test.ts
npx tsc --noEmit
npx prisma validate
npm run lint
npm test -- --run
```

## Test results

| Command | Result |
|---|---|
| Targeted (3 affected files) | 16 tests passed, 0 failed. |
| `npx tsc --noEmit` | Passed. |
| `npx prisma validate` | Passed (with the same Prisma `package.json#prisma` deprecation notice already documented by Codex). |
| `npm run lint` | Passed with the same 3 pre-existing unrelated warnings (`components/admin/crud/form.tsx`, `components/shared/AttachmentThumbnail.tsx`). |
| `npm test -- --run` (full suite) | **117 files passed, 1135 tests passed**, 1 skipped, 4 todo. Up 5 tests from the Codex-end baseline of 1130, no regressions. |

## Manual verification checklist

- [x] Phone numbers masked in WhatsApp template helper logs.
- [x] Phone numbers masked in WhatsApp policy opt-in/opt-out logs.
- [x] Phone numbers masked in session-timeout cron logs.
- [x] Customer receives a shortlist-ready WhatsApp message when shortlist publishes.
- [x] Customer cannot overwrite their selection once request is `PROVIDER_CONFIRMATION_PENDING`.
- [x] Selected-provider acceptance no longer auto-expires after the preview window.
- [x] Explicitly `EXPIRED` invites still cannot be accepted.
- [x] Same provider re-accepting an already-accepted lead does not double-deduct credits.
- [x] Full test suite passes.
- [x] TypeScript and Prisma validate clean.
- [ ] Production lint cleanup of the 3 known unrelated warnings remains a separate task.
- [ ] WhatsApp `Interested`/`Not interested` button rewire — still required before the qualified shortlist flow works end-to-end via WhatsApp.
- [ ] Auto-trigger of `generateCustomerShortlistForRequest` on N interested responses — still required.

## Risks and follow-ups

- The single biggest remaining functional gap is the WhatsApp button wiring (item 1 under "Remaining work"). Until that is closed, providers responding via WhatsApp will continue to flow through `acceptLead`, which routes to `acceptSelectedProviderJob` only when the request has *already* been moved to `PROVIDER_CONFIRMATION_PENDING` by another path. With no auto-trigger, that path will not fire, and the qualified shortlist will only be exercised by API-driven providers and ops tooling. Pilot rollout should be gated on closing this gap, or restricted to providers responding through the new API route.
- The free-text redaction in `previewNotes` is still heuristic. A structured `accessNotes` field on `Address` (visible only after `LeadUnlock`) would be a stronger guarantee than truncating the description. Tracked as a privacy follow-up.
- The auto-created quote/booking inside `acceptSelectedProviderJob` uses the provider's call-out fee as the approved amount. If product policy is "quote after inspection", this short-circuits the customer's quote-approval step. Codex flagged this — keep in mind for the pilot.

## OpenBrain note

Post-Codex remediation pass closed five concrete safety/privacy gaps in the Qualified Shortlist Model implementation: customer-phone log leakage, missing customer shortlist-ready notification, missing request-status guard on customer selection, a stale-preview-window race that could strand selected-provider acceptance, and a dead-state-mapping branch. Five new tests assert these behaviors. The largest remaining gap before pilot is rewiring the WhatsApp `Interested`/`Not interested` buttons to the free `respondToProviderOpportunity` service so provider responses captured over WhatsApp populate `ProviderLeadResponse` rows and become eligible for `generateCustomerShortlistForRequest`. Credit timing, atomicity, and the privacy boundary between safe preview and full unlock all checked out and remain unchanged.

---

# Second-pass remediation — resolve all identified gaps

After the initial pass above, the user requested that the remaining gaps be resolved. The work below was added on top of the first pass. The first-pass narrative above is retained verbatim for traceability. The validation at the bottom of the first pass (1135 tests) is now superseded by the second-pass numbers at the end of this section (1154 tests).

## Additional issues resolved in the second pass

### 6. WhatsApp button payloads now have new free-interest and selected-provider variants

**Source blueprint:** 11, 12, 13, 14.
**Found:** The bot router only handled the legacy paid `accept:<holdId>` / `decline:<holdId>` payloads (which still go to the legacy paid path when not in `PROVIDER_CONFIRMATION_PENDING`). The selected-provider notification was a plain `sendText` with no buttons, leaving the provider with no native WhatsApp action; they had to dig out a previous lead message.

**Fix (additive — legacy buttons keep working):**

- `lib/customer-shortlists.ts` now sends the selected-provider notification via `sendButtons` with two new payloads: `confirm_accept:<leadId>` and `confirm_decline:<leadId>`.
- `lib/whatsapp-bot.ts`:
  - Added new payloads to the `isProviderResponseButton` whitelist: `confirm_accept:`, `confirm_decline:`, `not_interested:`, `interested:`.
  - Added router branches that dispatch to three new handlers:
    - `handleSelectedProviderConfirmation` — for `confirm_accept:` / `confirm_decline:`. Calls `acceptSelectedProviderJob` directly on confirm; calls the new `declineSelectedProviderJob` on decline (resets request to `SHORTLIST_READY` so the customer can re-select).
    - `handleProviderOpportunityNotInterested` — calls `respondToProviderOpportunity` with `NOT_INTERESTED`. No credit deducted.
    - `handleProviderOpportunityInterested` — captures the leadId and prompts the provider for call-out fee + earliest arrival in plain text. Full conversational rate-capture flow remains a follow-up; this minimal-viable handler unblocks WhatsApp providers without adding a new flow state machine.
- `lib/customer-shortlists.ts` exports `declineSelectedProviderJob`, `cancelRequestFromShortlist`, and `requestMoreShortlistOptions` for use from the bot and the customer access page.

### 7. Dispatcher can now send free-interest buttons under a feature flag

**Source blueprint:** 11, 14.
**Found:** Even with the new bot handlers wired, no dispatcher actually sent `interested:<leadId>` / `not_interested:<leadId>` payloads. Until that happens, providers responding via WhatsApp continue to use the legacy paid flow.

**Fix:**

- `lib/flags.ts`: added `qualified_shortlist.dispatch_v2` and `qualified_shortlist.auto_trigger` flag keys.
- `scripts/seed-flags.ts`: added the corresponding flag rows so they can be enabled in the DB.
- `lib/matching/dispatch.ts`: when `qualified_shortlist.dispatch_v2` is enabled, dispatch sends `[interested:<leadId>, not_interested:<leadId>]` instead of `[accept:<holdId>, decline:<holdId>]`. Default off — pilot can enable it deliberately. In-flight legacy buttons keep working because the legacy router handlers are unchanged.

### 8. Auto-trigger of the customer shortlist on the Nth interested response

**Source blueprint:** 12.
**Found:** `generateCustomerShortlistForRequest` was a service with no caller. Without a trigger, requests would never advance to `SHORTLIST_READY` automatically.

**Fix:**

- `lib/provider-opportunity-responses.ts:respondToProviderOpportunity` now calls `maybeAutoTriggerShortlist(jobRequestId)` after every `INTERESTED` response, in a non-blocking try/catch.
- `maybeAutoTriggerShortlist`:
  - Short-circuits when the `qualified_shortlist.auto_trigger` flag is off.
  - Only fires if the request is still `OPEN` or `MATCHING` (prevents regenerating a shortlist that is already published or already advanced past selection).
  - Counts complete `INTERESTED` responses (with both `callOutFee` and `estimatedArrivalAt`) for active providers on non-expired invites.
  - Promotes the request via `generateCustomerShortlistForRequest` once the count reaches `SHORTLIST_AUTO_TRIGGER_THRESHOLD` (env override; default 2).

### 9. Customer ask-for-more-options and cancel-request actions

**Source blueprint:** 12.
**Found:** Customer access page only had a "Select provider" button per shortlist item.

**Fix:**

- New service helpers in `lib/customer-shortlists.ts`:
  - `requestMoreShortlistOptions({ requestId })` — supersedes the current published shortlist and resets request to `MATCHING` so dispatch can find more providers. Existing provider responses remain valid for the next shortlist.
  - `cancelRequestFromShortlist({ requestId })` — only allowed before any provider has been confirmed; supersedes the active shortlist, expires pending lead invites, and sets the request to `CANCELLED`. No credit deducted (none ever was).
- New server actions in `app/requests/access/[token]/page.tsx`:
  - `askForMoreShortlistOptions` and `cancelRequestAction` (token-scoped, redirect on failure).
- New UI in the same page: under the shortlist cards (only when status is `SHORTLIST_READY`), the customer sees a 2-button row (`Ask for more options` / `Cancel request`). Two new banner cards display the post-action confirmation states (`selection=more-options`, `selection=cancelled`).

### 10. Structured access-notes field on Address — gated behind unlock

**Source blueprint:** 8 (privacy), 13 (full-detail unlock), 15 (audit).
**Found:** Sensitive access details (gate codes, building access, dog warnings) lived inside the free-text job request `description` and were heuristically truncated by `previewNotes`. Truncation is not a guarantee.

**Fix:**

- `prisma/schema.prisma`: added `Address.accessNotes String?`.
- `prisma/migrations/20260502160000_address_access_notes/migration.sql`: additive `ALTER TABLE` adds the column.
- `lib/job-requests/create-job-request.ts`: `CreateJobRequestParams.accessNotes` now flows into `Address.create.data.accessNotes` (both the existingAddressId fallback path and the new-address path).
- `app/api/customer/bookings/route.ts`: PWA booking POST accepts `accessNotes` in JSON or `multipart/form-data` and forwards it to `createJobRequest`.
- `lib/provider-lead-detail.ts`: only the **unlocked** sensitive query selects `accessNotes`, and the response shape exposes it as `unlockedDetails.accessNotes`. The non-unlocked preview path never selects this column.
- `lib/provider-opportunity-responses.ts:getSafeProviderOpportunityPreview`: the address selector still only picks `suburb / region / city / province` — `accessNotes` is structurally unreachable in safe preview because the column is not in the `select` clause.

### 11. Photos can be marked unsafe-for-preview

**Source blueprint:** 8 (privacy).
**Found:** Every customer-uploaded photo was returned in provider safe preview. There was no way to flag a sensitive upload (e.g., an ID document mistakenly attached to a job request).

**Fix:**

- `prisma/schema.prisma`: added `Attachment.safeForPreview Boolean @default(true)`.
- `prisma/migrations/20260502163000_attachment_safe_for_preview/migration.sql`: additive `ADD COLUMN ... DEFAULT true` (existing rows remain visible — no behaviour change for clean data).
- `lib/provider-opportunity-responses.ts`: `attachments` selector now includes `where: { safeForPreview: true }`.
- `lib/provider-lead-detail.ts` (preview path only): same `where` filter applied so the unlocked path can choose to expose all attachments while the preview path is filtered.

### 12. Lead state enum extended (additive)

**Source blueprint:** 2.
**Found:** The schema's `LeadStatus` enum had only the legacy 5 values (`SENT`, `VIEWED`, `ACCEPTED`, `DECLINED`, `EXPIRED`). The Qualified Shortlist Model called for explicit `INTERESTED`, `SHORTLISTED`, `CUSTOMER_SELECTED`, `SUPERSEDED`, `CANCELLED` states. Codex deferred this to avoid migration risk.

**Fix:**

- `prisma/schema.prisma:LeadStatus`: added `INTERESTED`, `SHORTLISTED`, `CUSTOMER_SELECTED`, `SUPERSEDED`, `CANCELLED`.
- `prisma/migrations/20260502161500_lead_status_shortlist_extensions/migration.sql`: 5 additive `ALTER TYPE … ADD VALUE IF NOT EXISTS` statements. No data is rewritten. Existing code paths continue to read/write the legacy values.
- `lib/qualified-shortlist-state.ts:mapLeadInviteToQualifiedState`: new branches map the new enum values to the qualified states. Backwards-compat fallback for legacy values is preserved.

This unlocks future work that wants explicit state writes (e.g., the bot's "Interested" handler writing `LeadStatus.INTERESTED`), without forcing it now. Today's code does not yet write the new values.

### 13. Provider MORE_INFO_REQUIRED reply path

**Source blueprint:** 6.
**Found:** Codex added `ApplicationStatus.MORE_INFO_REQUIRED` and the admin `requestMoreInfo` action, but no provider-side path could turn the application back into `PENDING`.

**Fix:**

- `lib/provider-applications.ts`: new `resumeMoreInfoApplication(client, { applicationId, providerNote, actorId })` helper that:
  - Refuses if the application is missing or not in `MORE_INFO_REQUIRED`.
  - Appends the provider's reply to the existing notes with a timestamped header so admins see both the request and the answer in one column.
  - Writes an `application.more_info_resumed` audit log.
  - Sets status back to `PENDING`.
- New focused tests in `__tests__/lib/provider-applications-resume.test.ts` cover the happy path, invalid-status refusal, and not-found refusal.

The bot wiring that picks this up on inbound free-text from a provider whose latest active application is `MORE_INFO_REQUIRED` is intentionally left as a small follow-up for the bot owner — the helper is the integration point.

### 14. PWA booking POST captures shortlist-relevant fields

**Source blueprint:** 8.
**Found:** The PWA `POST /api/customer/bookings` did not accept `urgency`, `providerPreference`, `budgetPreference`, `maxCallOutFee`, `verifiedOnly`, `subcategory`, or `accessNotes`. Codex flagged this as an open follow-up.

**Fix:**

- `app/api/customer/bookings/route.ts`: the request body type and the JSON/multipart extraction now accept these fields and forward them into `createJobRequest`. The booking flow front-end (`components/customer/BookingFlow.tsx`) is untouched in this pass — the API surface is now ready and a UI follow-up can wire user-facing inputs without re-touching the API.

### 15. Tests added in the second pass

| Test file | Tests added | Covers |
|---|---|---|
| `__tests__/lib/customer-shortlists.test.ts` | `selects a provider …notifies the provider with confirm buttons`; `cancels a request before any provider has been confirmed`; `refuses cancellation once a provider is being confirmed`; `returns the request to MATCHING when more options are requested`; `refuses ask-more when the request is not in SHORTLIST_READY`; `reopens shortlist when the selected provider declines after selection`; `shortlist generation excludes suspended providers via the provider filter` | New buttons on selected-provider notification; new ask-more / cancel actions; decline-after-selection; suspended-provider filter coverage. |
| `__tests__/lib/provider-opportunity-responses.test.ts` | `auto-triggers shortlist generation when threshold is met and flag is on`; `does not auto-trigger when feature flag is off`; `does not auto-trigger when interested count is below threshold`; `safe-preview excludes attachments flagged safeForPreview = false` | Auto-trigger gating + threshold; `accessNotes` and `safeForPreview` privacy coverage. |
| `__tests__/lib/provider-applications-resume.test.ts` (new file) | 3 tests | More-info → PENDING flow, invalid-status refusal, not-found refusal. |

## Files changed (second pass only)

| File | Change summary |
|---|---|
| `field-service/lib/customer-shortlists.ts` | Switched selected-provider notification from `sendText` → `sendButtons` with `confirm_accept:` / `confirm_decline:` payloads; added `declineSelectedProviderJob`, `cancelRequestFromShortlist`, `requestMoreShortlistOptions`. |
| `field-service/lib/provider-opportunity-responses.ts` | Auto-trigger of `generateCustomerShortlistForRequest` after the Nth INTERESTED response, gated by `qualified_shortlist.auto_trigger` flag. Added `where: { safeForPreview: true }` filter to the safe-preview attachments selector. |
| `field-service/lib/whatsapp-bot.ts` | Added router branches and three new handlers (`handleSelectedProviderConfirmation`, `handleProviderOpportunityNotInterested`, `handleProviderOpportunityInterested`); added new payloads to the `isProviderResponseButton` whitelist. |
| `field-service/lib/matching/dispatch.ts` | Sends free-interest buttons when `qualified_shortlist.dispatch_v2` is enabled; legacy paid buttons remain when off. |
| `field-service/lib/flags.ts` | Added `SHORTLIST_DISPATCH_V2` and `SHORTLIST_AUTO_TRIGGER` flag keys. |
| `field-service/scripts/seed-flags.ts` | Added DB seed entries for the two new flags. |
| `field-service/lib/qualified-shortlist-state.ts` | New mapping branches for the additive LeadStatus values. |
| `field-service/lib/provider-applications.ts` | Added `resumeMoreInfoApplication` helper. |
| `field-service/lib/provider-lead-detail.ts` | `safeForPreview` filter on preview attachments; `accessNotes` exposed only on `unlockedDetails`. |
| `field-service/lib/job-requests/create-job-request.ts` | `accessNotes` accepted on `CreateJobRequestParams` and persisted into `Address.accessNotes`. |
| `field-service/app/api/customer/bookings/route.ts` | Accepts `subcategory`, `accessNotes`, `urgency`, `providerPreference`, `budgetPreference`, `maxCallOutFee`, `verifiedOnly` on the request body. |
| `field-service/app/requests/access/[token]/page.tsx` | New `askForMoreShortlistOptions` and `cancelRequestAction` server actions; new UI buttons under the shortlist; new banner states for `more-options` / `cancelled`. |
| `field-service/prisma/schema.prisma` | Added `Address.accessNotes`, `Attachment.safeForPreview`, and 5 additive `LeadStatus` enum values. |
| `field-service/prisma/migrations/20260502160000_address_access_notes/migration.sql` | Additive column add. |
| `field-service/prisma/migrations/20260502161500_lead_status_shortlist_extensions/migration.sql` | Additive enum values. |
| `field-service/prisma/migrations/20260502163000_attachment_safe_for_preview/migration.sql` | Additive column add (defaults to true). |
| `field-service/__tests__/lib/customer-shortlists.test.ts` | New tests; updated provider-selection test for `sendButtons`. |
| `field-service/__tests__/lib/provider-opportunity-responses.test.ts` | New auto-trigger and `safeForPreview` tests; existing `lead.update` assertions relaxed via `expect.objectContaining` to allow the new `select` clause. |
| `field-service/__tests__/lib/provider-applications-resume.test.ts` | New file. |

## Schema / migration changes (second pass)

Three additive migrations added. None are destructive; existing data is untouched.

| Migration | Reason |
|---|---|
| `20260502160000_address_access_notes` | New nullable `accessNotes` column on `addresses`. |
| `20260502161500_lead_status_shortlist_extensions` | Added enum values to `LeadStatus`: `INTERESTED`, `SHORTLISTED`, `CUSTOMER_SELECTED`, `SUPERSEDED`, `CANCELLED`. |
| `20260502163000_attachment_safe_for_preview` | New `safeForPreview` boolean on `attachments`, default `true`. |

## Final validation (second pass — replaces the first-pass numbers)

| Command | Result |
|---|---|
| `npx prisma generate` | Passed (Prisma `package.json#prisma` deprecation notice — same as the Codex baseline). |
| `npx tsc --noEmit` | Passed clean. |
| `npx prisma validate` | Passed. |
| `npm run lint` | Passed with the same 3 pre-existing unrelated warnings. |
| `npm test -- --run` | **120 files, 1154 passed**, 1 skipped, 4 todo. Net **+24 tests** vs. the 1130 Codex baseline (5 from the first pass + 19 from the second). Zero regressions. |

## What remains as out-of-scope follow-ups (genuine product or operational work)

1. **Conversational rate capture for WhatsApp `Interested` flow.** The minimal handler accepts the interested signal and prompts the provider to reply with a structured fee + arrival message. A first-class conversation flow that walks the provider through (a) call-out fee number prompt, (b) arrival-window list reply, (c) optional negotiable toggle, then writes a complete `ProviderLeadResponse`, is a separate piece of bot work. Until that is built, the auto-trigger threshold should be adjusted to account for partial responses.
2. **Bot wiring for `resumeMoreInfoApplication`.** The helper is shipped, audited, and tested. The bot still needs a small recognizer that, on inbound from a provider whose most-recent application is `MORE_INFO_REQUIRED`, invokes the helper.
3. **PWA UI inputs for the new request fields.** The API now accepts urgency / preference / budget / accessNotes / subcategory; the React form (`components/customer/BookingFlow.tsx`) is unchanged and still does not collect them.
4. **Backfills.** `requestRef`, provider categories, and lead match score/ranking remain unbackfilled. They are operationally important but require a DB pass; they are not safe to run from a code change alone.
5. **Provider trust/profile capture.** References, profile photo, classified ID/cert/work-photo evidence, business profile fields. This is a multi-step WhatsApp flow refactor and a product decision (which fields are mandatory at submission vs. requested via more-info).
6. **Quote-after-arrival product decision.** Today `acceptSelectedProviderJob` synthesises an `APPROVED` quote at the provider's call-out fee. If product wants a quote-after-inspection step, this short-circuits that — call out to product before pilot.
7. **Broader logging sweep.** Outside `whatsapp.ts` / `whatsapp-policy.ts` / `cron/session-timeout/route.ts`, I have not exhaustively swept every `console.*` line in `lib/**` and `app/**` for phone/address logging.
8. **Meta template registration.** The new `interactive:` `templateName`s used here (`client_shortlist_ready`, `provider_selected_for_confirmation`) are tagged for the message_events log. They function inside the WhatsApp 24-hour session window without registration; outside that window, Meta-approved templates would need to be registered first.

## Pilot rollout posture

With the second pass landed, the safest pilot configuration is:

- `qualified_shortlist.dispatch_v2` = **off** initially. Pilots can enable it by region or test cohort to switch dispatched leads to free-interest buttons.
- `qualified_shortlist.auto_trigger` = **off** initially. Once enough providers are routinely returning `INTERESTED` responses (via the API today; via WhatsApp once dispatch_v2 is on), this flag promotes the request automatically.

Both flags can be flipped via `pnpm tsx scripts/seed-flags.ts --flag=qualified_shortlist.dispatch_v2 --enable` (or via the `feature_flags` DB row directly).

## Final OpenBrain note (second pass)

Second-pass remediation closed every product-flow gap that was reachable without a product decision: WhatsApp button rewiring (additive — legacy buttons still work), customer ask-more/cancel actions, selected-provider confirm/decline buttons with a backout path to the shortlist, structured `accessNotes` and `safeForPreview` privacy controls (with additive migrations), `LeadStatus` extended (additive), provider `MORE_INFO_REQUIRED` reply helper, PWA API parity, and an auto-trigger for shortlist generation. 19 new tests cover the new behaviour; full suite is 1154 tests, zero regressions. Two feature flags (`qualified_shortlist.dispatch_v2`, `qualified_shortlist.auto_trigger`) gate the new dispatch and auto-trigger so the pilot can ramp deliberately. Remaining out-of-scope items all require either a product decision or operational work (backfills, conversational fee-capture flow, full trust/profile capture, broader logging sweep) and are listed above.

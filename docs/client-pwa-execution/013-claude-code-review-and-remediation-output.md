# 013 — Claude Code Review and Remediation Output (Client Journey)

## Status

Completed with warnings

## Review scope

### Client PWA blueprint files reviewed
- `Plug A Pro/plugapro_client_pwa_blueprint/00-CLIENT-PWA-MASTER-RUNNER.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/01-client-pwa-as-is-assessment.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/02-client-pwa-channel-and-handoff-model.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/03-client-pwa-route-map-and-state-resolver.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/04-client-pwa-request-creation-flow.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/05-client-pwa-photo-address-and-privacy-flow.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/06-client-pwa-submission-and-matching-status-flow.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/07-client-pwa-shortlist-profile-and-selection-flow.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/08-client-pwa-provider-confirmation-and-job-tracking-flow.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/09-client-pwa-exception-and-recovery-states.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/10-client-pwa-security-privacy-and-token-rules.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/11-client-pwa-notifications-copy-and-url-rules.md`
- `Plug A Pro/plugapro_client_pwa_blueprint/12-client-pwa-test-matrix-and-release-plan.md`

### Codex execution outputs reviewed
All 13 files in `docs/client-pwa-execution/` (000–012).

### Provider WhatsApp-complete blueprints reviewed for client-impact
- `00-PROVIDER-WHATSAPP-PWA-MASTER-RUNNER.md`
- `06-provider-opportunity-preview-whatsapp-flow.md`
- `07-provider-interest-rate-response-whatsapp-flow.md`
- `08-provider-customer-selected-and-acceptance-whatsapp-flow.md`
- `10-provider-full-job-details-and-privacy-unlock-flow.md`
- `11-provider-arrival-and-job-execution-whatsapp-flow.md`
- `12-provider-completion-photos-notes-and-history-flow.md`

## Executive review result

**Implementation is mostly aligned with the blueprint.** Codex landed a state-aware WhatsApp-to-PWA handoff resolver, a centralized state-to-screen mapping, structured PWA request capture, photo `safeForPreview` filtering, address privacy copy, recovery states, and submission/matching/shortlist/job-tracking screens — all without breaking the WhatsApp-first flow or the Qualified Shortlist credit boundary.

**The single most important gap surfaced during this review** is that the client journey assumes the provider will open the PWA after customer selection in order to see the customer's phone, name, and exact address. The post-acceptance WhatsApp message only said "Full customer details are now unlocked" with a link, instead of including those details inline. That violates the **Provider WhatsApp-complete** principle: the *client journey* may push a provider to PWA, but the *provider's core execution actions* (acceptance + reading customer details) must work entirely in WhatsApp. **Fixed in this remediation.**

Two further provider WhatsApp-complete gaps remain (arrival confirmation, on-the-way / arrived / start / complete in WhatsApp, work-photo upload). These are documented as out-of-scope for this client-journey pass but block full pilot rollout.

## Blueprint-to-implementation gap analysis

| Area | Requested | Implemented | Gap | Remediation |
|---|---|---|---|---|
| WhatsApp-first journey | Customer can start in WhatsApp, continue in PWA, return to WhatsApp updates | `whatsapp-flows/job-request.ts` + `/book/[serviceId]` query prefill + WhatsApp confirmation on PWA submit | None for the customer side | — |
| State-aware route resolver | One central resolver returning screen/route/request/job/allowedActions/accessLevel/reason | `lib/client-pwa-destination.ts` + `lib/client-pwa-state.ts` + `lib/client-pwa-handoff.ts` | None | — |
| Stale WhatsApp links | Resolve to current backend state | Token route uses resolver; authenticated request route redirects matched jobs to bookings | None | — |
| Request creation | Subcategory, urgency, preferred time, provider preference, budget, max call-out, privacy/terms ack | `client-request-flow.ts` helpers + `BookingFlow.tsx` capture; PWA API forwards all fields | None | — |
| Photo safe-preview | Customer photos default safe, provider safe preview filters by `safeForPreview` | `Attachment.safeForPreview` (added in earlier 017 pass), `customer_photo` label, server-side filter | None | — |
| Address privacy | Suburb/city/province/region public; street/unit/complex/access notes/GPS hidden until acceptance | Server-side `select` lists exclude protected fields; structured `accessNotes` only revealed on `unlockedDetails` | None | — |
| Submission notifications | WhatsApp confirmation after PWA submit | `notifyCustomerPwaRequestSubmitted` wired into `/api/customer/bookings` | None | — |
| Shortlist & selection | Compare cards, view profile, select, ask-more, cancel; no credit deduction | Implemented on `/requests/access/[token]` with `?view=shortlist&provider=…` profile panel and `selectShortlistedProviderForRequest` (no debit) | None | — |
| Provider confirmation panel | "Waiting for provider confirmation" state + provider name | Renders `destination.screen === 'provider_confirmation'` with `selectedShortlistItem.provider.name` | None | — |
| Job tracking timeline | Submitted → matched → selected → accepted → arrival → on-the-way → arrived → in-progress → completed | `jobTrackingSteps()` covers all transitions; reads from `booking.job.status` | Provider must update statuses for the timeline to advance | See "Provider WhatsApp-complete" findings below |
| Customer notification copy | Production URLs, intent-aware ticket links, no localhost | `getJobRequestAccessUrl(requestId, intent)` for matching/shortlist/job-tracking intents; localhost blocked in production by helper | None | — |
| Exception/recovery states | invalid/expired/cancelled/no-providers/unauthorized | All present on `/requests/access/[token]` with controlled copy and trace IDs | None | — |
| Security & access | Token-scoped, server-side enforced, image authz | `attachments-authz` tests cover the boundary | None | — |
| **Provider WhatsApp-complete acceptance** | Provider receives customer name, phone, full address inline in WhatsApp after acceptance — does not need PWA | Pre-fix: only "Full customer details are now unlocked" + a link | **HIGH PRIORITY GAP** | **Fixed in this pass — full inline details + access notes + arrival prompt** |
| Provider WhatsApp arrival confirmation | "Reply with arrival time" → updates `scheduledArrivalAt` / `arrivalTimeConfirmedAt` | Not implemented; bot has `tech_job_view`/`accept`/`decline` only | Documented; out of scope for client-journey pass |
| Provider WhatsApp on-the-way / arrived / start / complete | WhatsApp commands transition `JobStatus` between `EN_ROUTE`, `ARRIVED`, `STARTED`, `COMPLETED` | Not implemented; provider must open PWA via signed job link | Documented; out of scope for client-journey pass |
| Provider WhatsApp work photos & notes | Provider uploads on-site photos, completion notes via WhatsApp | Not implemented; PWA-only today | Documented; out of scope for client-journey pass |

## WhatsApp-first client journey review

### Findings
- The customer can start a request via WhatsApp (`whatsapp-flows/job-request.ts`), continue in PWA via `/book/[serviceId]?...prefill`, receive a WhatsApp confirmation after PWA submit, and re-open the same `/requests/access/[token]` URL across the lifecycle.
- The token route resolves through `resolveClientPwaDestination` so a stale shortlist link opens the current job-tracking screen.
- The customer's `(customer)/requests/[id]` route also runs through the resolver and redirects matched jobs to the booking page.
- The dispatch flow already uses the central public URL helper; `qualified_shortlist.dispatch_v2` is a feature flag and can be enabled per cohort.

### Issues fixed
None in this pass — Codex's wiring is correct for the customer side.

### Remaining risks
- The `BookingFlow.tsx` form is unchanged in this review pass. The API surface accepts all the new fields, but the React form does not yet present urgency/provider-preference/budget inputs to the user. This is tracked in the prior 017 follow-up list.

## PWA handoff and state resolver review

### Findings
- `resolveClientPwaDestination` accepts `token`, `requestId`, or `jobId` and returns a fully-populated destination including `screen`, `route`, `request`, `job`, `allowedActions`, `accessLevel`, and `reason`.
- Token resolution rejects invalid tokens and routes expired tokens to the dedicated recovery route.
- The PWA token route renders `view=` driven panels for submitted/matching/providers-reviewing/shortlist/provider-confirmation/job-tracking states — old WhatsApp links work without redirecting away.

### Issues fixed
None in this pass.

### Remaining risks
- The resolver does not yet model `provider_declined_after_selection`; if the selected provider declines, the bot now (after the prior 017 pass) calls `declineSelectedProviderJob` which resets the request to `SHORTLIST_READY`. The client UI then naturally lands on the shortlist screen with the declined provider's `customerSelectedAt` cleared. This is correct and matches blueprint 09 ("choose another provider").

## Client request creation review

### Findings
- All required fields are captured: category, subcategory, description, urgency, preferred date, time window, provider preference, budget preference, optional max call-out, privacy ack, terms ack.
- WhatsApp draft → PWA continuation works via query string prefill into `/book/[serviceId]`.
- Local PWA save-and-continue exists; server-side draft persistence is intentionally deferred (`JobRequestStatus` has no `DRAFT` value yet).

### Issues fixed
None in this pass.

### Remaining risks
None.

## Photo, address, and privacy review

### Findings
- Customer photos are uploaded with `label: 'customer_photo'` and `safeForPreview: true`.
- Provider safe preview (`getSafeProviderOpportunityPreview`) selects only `suburb / region / city / province` from `Address` and filters attachments by `safeForPreview: true`.
- `Address.accessNotes` is read **only** from the unlocked-detail Prisma `select` in `provider-lead-detail.ts`; the preview path never selects it.
- Privacy copy is shown on the address-capture and review steps in the booking flow.

### Issues fixed
None in this pass — the privacy boundary holds.

### Remaining risks
- Photo MIME/size validation is correct, but there is no explicit moderation flow for an admin to flip `safeForPreview` to `false` retroactively. Documented in the prior 017 pass as a follow-up.

## Submission and matching status review

### Findings
- `createJobRequest` is the single entry point and triggers matching once. PWA submit → WhatsApp confirmation via `notifyCustomerPwaRequestSubmitted`.
- Token ticket page renders `request_submitted`, `matching_progress`, `providers_reviewing` panels from backend state.

### Issues fixed
None.

### Remaining risks
- There is no durable client idempotency key on `/api/customer/bookings`. The UI prevents double-clicks; backend duplicate-active-request guards prevent re-creates. Acceptable for pilot; idempotency-key support is the next step.

## Shortlist and provider selection review

### Findings
- Shortlist generation filters to `INTERESTED` responses with `callOutFee` + `estimatedArrivalAt`, status `SENT`/`VIEWED`, non-expired, and only providers with `active: true && status === 'ACTIVE' && verified: true`.
- Customer card hides provider phone, private address, ID/passport, private documents, reference contacts, and admin notes — only shows name, bio, experience, skills, evidenceNote, portfolioUrls, avatarUrl, verified, averageRating, completedJobsCount, serviceAreas.
- `selectShortlistedProviderForRequest` runs in a transaction, requires status `SHORTLIST_READY`, sets `customerSelectedAt`, and notifies the selected provider via `sendButtons` with `confirm_accept:` / `confirm_decline:` buttons (added in the prior 017 pass).
- No credit is deducted at selection — the test for that is asserted explicitly.

### Issues fixed
None in this pass; this surface was already remediated in the 017 pass.

### Remaining risks
None.

## Provider WhatsApp-complete alignment review

This is the most critical area for the client journey because every transition the customer expects to see (provider accepted, on-the-way, arrived, completed) depends on the provider taking action.

### Findings

**Acceptance via WhatsApp — works, but the post-acceptance message was incomplete.**
- The customer-selected provider receives a `sendButtons` message with `confirm_accept:<leadId>` / `confirm_decline:<leadId>`. The bot router (after the prior 017 pass) calls `acceptSelectedProviderJob` directly. This is correct.
- The post-acceptance message previously said "Full customer details are now unlocked" with a link only. **Provider had to open the PWA to see name/phone/address.** That violates "WhatsApp-complete".

**Arrival, on-the-way, arrived, start, complete via WhatsApp — not implemented.**
- `lib/whatsapp-bot.ts` has `tech_job_view` / `accept_job_<id>` / `decline_job_<id>` for the legacy paid flow only. There is no inbound recognizer for `arrive HH:MM`, no on-the-way/arrived/start/complete commands, and no provider work-photo upload on completed jobs via WhatsApp.
- The provider is forced to the PWA via the signed `getProviderSignedJobHandoverUrlByLeadId(...)` link to drive these transitions.

**Customer impact of those gaps.**
- The customer's `/requests/access/[token]` job-tracking timeline shows the eight steps (submitted → completed) and reads `booking.job.status`. If the provider never opens the PWA, the customer sees `SCHEDULED` indefinitely and never advances to `EN_ROUTE`/`ARRIVED`/`COMPLETED`. The client UI is correct; the provider-side update path is the blocker.

### Issues fixed
- **Inline customer details in the post-acceptance WhatsApp message.**
  - `lib/selected-provider-acceptance.ts:notifySelectedAcceptanceCommitted` now formats and sends:
    - Customer name
    - Customer phone
    - Full address (`unitNumber, complexName, street, addressLine1, addressLine2, suburb, city, province`)
    - `Access notes:` line if present
    - "Next step: reply with your arrival time, e.g. 'arrive 14:00'."
  - The PWA "View job" link is still appended for richer screens, but is no longer required for the provider to act.
  - `notificationPayload` extended to include `customerName` and `address` (fully typed); these come from the same Prisma `include` block already used by the acceptance transaction.
- A new test assertion validates that the provider WhatsApp message contains the customer name, phone, full address (including unit + complex), access notes, and the arrival prompt — locked in by `__tests__/lib/selected-provider-acceptance.test.ts:124`.

### Remaining risks
- **Provider arrival confirmation via WhatsApp is not implemented.** A provider replying `arrive 14:00` does nothing today. The scheduled arrival time is whatever was captured in the provider's interest response or the request's preferred window. To complete WhatsApp-complete, the bot needs a free-text recognizer that:
  1. Looks up the most recent active job for the inbound provider phone.
  2. Parses `arrive HH:MM` (and `eta HH:MM`, `arrival HH:MM`) into a same-day or next-day `Date`.
  3. Updates `Job.scheduledArrivalAt` and `Job.arrivalTimeConfirmedAt`, writes a `JobStatusEvent`, and notifies the customer.
- **`on the way`, `arrived`, `start`, `pause`, `complete` WhatsApp commands** need parallel handlers transitioning `Job.status` between `SCHEDULED → EN_ROUTE → ARRIVED → STARTED → … → COMPLETED`.
- **Work-photo upload via WhatsApp on completed jobs** needs the existing media upload pipeline to attach to `Job.photos` (today the upload pipeline is wired for customer request photos and provider evidence at registration).
- **Customer's job-tracking timeline accuracy depends on these provider WhatsApp commands existing.** The client UI is implemented correctly; the data source (provider activity) is the bottleneck.

These three items are the largest remaining work for the *Provider WhatsApp + PWA* blueprint. They are out of scope for this client-journey review pass but should be the first items in the next provider-side remediation.

## Provider confirmation and job tracking review

### Findings
- `provider_confirmation` panel renders with the selected provider's name (when shortlist data is still cached) and a Contact-support fallback action.
- `provider_accepted` panel surfaces provider, expected arrival, and call-out fee with Track-job and View-provider actions.
- Timeline reads from `booking.job.status`. The 8-step ladder is shown with done/current/pending styling.
- Completed jobs show Rate provider, Book again, and Report-issue/View-receipt actions.
- Old WhatsApp ticket links resolve to the current job state through `resolveClientPwaDestination`.

### Issues fixed
None in this pass.

### Remaining risks
- The "Arrival time confirmed" timeline step is shown when status is `SCHEDULED` (rank 4). This is technically correct (the `scheduledDate` is set from the provider's response), but no separate `JobStatusEvent` records when the *provider explicitly confirms* arrival in WhatsApp. Once a real arrival-confirmation command exists, the timeline can split that step.

## Customer notifications and URL review

### Findings
- All three customer ticket links carry intent: `intent=matching_status` (created), `intent=shortlist` (shortlist ready), `intent=job_tracking` (provider accepted).
- `lib/provider-credit-copy.ts:getPublicAppUrl` blocks localhost in production; tests assert this.
- Customer copy in shortlist-ready notification explicitly says "compare providers before choosing" and reiterates the privacy promise.

### Issues fixed
None in this pass.

### Remaining risks
- Two new `interactive:` template names introduced for the new shortlist flow (`client_shortlist_ready`, `provider_selected_for_confirmation`) work inside the WhatsApp 24-hour session window. For pilot continuity outside the session window, both need Meta-approved templates registered.

## Credit-rule review

### Findings
- Selection is free: `selectShortlistedProviderForRequest` does not touch `ProviderWallet` or write a `WalletLedgerEntry`.
- Preview, interest response, and not-interest response all return `creditsDeducted: 0`.
- Selected-provider acceptance debits exactly 1 credit through `unlockLeadForProviderInTransaction` inside the same transaction that creates `Match`/`Quote`/`Booking`/`Job`/`LeadUnlock` and marks the lead `ACCEPTED`.
- Duplicate accept by the same provider on an already-accepted lead returns `alreadyUnlocked: true` with **no** call to `unlockLeadForProviderInTransaction` (asserted in tests).
- Insufficient credits short-circuit before any assignment artefact is created (asserted in tests).

### Issues fixed
None.

### Remaining risks
None on the customer side. Provider-side credit pressure (when provider has zero credits and is selected) results in a clear WhatsApp insufficient-credits message; the customer is then expected to ask for more options or wait. This is correct.

## Security and access-control review

### Findings
- Customer access tokens are scoped to a single `JobRequest` and have an `expiresAt`. Expired tokens route to the recovery destination.
- `attachments-authz` tests cover: provider job ownership, invited provider preview, cancelled match revocation, customer ticket token, lead access token, expired/invalid tokens.
- Provider preview (`getSafeProviderOpportunityPreview`) explicitly excludes `customer`, exact street/unit/complex/postal, lat/lng, `accessNotes`, and protected attachments.
- `provider-lead-detail.ts:unlockedDetails` is gated on `lead.status === 'ACCEPTED' && providerUnlock` and includes `accessNotes` only on that path.
- `customer-shortlists.ts:getCustomerShortlistForRequest` excludes provider phone, private addresses, ID/passport, private documents, reference contacts, admin notes from the customer-facing shortlist payload.

### Issues fixed
None.

### Remaining risks
- Free-text job description redaction is heuristic (`previewNotes` truncation). The structured `accessNotes` field added in the prior 017 pass shifts the strongest sensitive case off the description; remaining residual leakage risk is low but real.

## Exception and recovery states review

### Findings
All required states render with controlled UI: invalid token, expired token, failed selection, failed cancel, failed more-options, no-providers (`request.status === 'EXPIRED'`), cancelled request. Each state hides protected data. Trace IDs are included where appropriate.

### Issues fixed
None.

### Remaining risks
None.

## Technical debt review

### Findings
- Old `evidence` photo label is rendered alongside new `customer_photo` label in token resolver and destination resolver. This dual-render keeps backwards-compat with WhatsApp-uploaded images. Acceptable for the migration window.
- The `(customer)/requests/[id]` page renders matched-status leads with raw lowercased status strings. Cosmetic only.

### Issues fixed
- `lib/whatsapp-flows/registration.ts:410`: a TS type mismatch (`string | null` returned by `validateOptionalProviderEmail` vs. the conversation-state type expecting `string | undefined`) caused `tsc --noEmit` to fail. Coerced `null → undefined` at the assignment site.
- `lib/selected-provider-acceptance.ts`: extended `notificationPayload`'s declared type to include `customerName` and the structured address shape now passed into the WhatsApp message — needed for the inline customer-details fix to typecheck.

### Remaining risks
None for the client journey.

## Files changed (013 review pass)

| File | Change summary |
|---|---|
| `field-service/lib/selected-provider-acceptance.ts` | (1) Notification payload type extended with `customerName` and structured `address`. (2) Built the unlocked customer payload from the existing transaction-level `lead.jobRequest.customer` + `lead.jobRequest.address` selects. (3) Added `formatProviderHandoffAddress` helper. (4) Rewrote provider WhatsApp acceptance message to include name, phone, full address (incl. unit + complex), access notes, and an inline arrival prompt — provider no longer needs the PWA to act. |
| `field-service/lib/whatsapp-flows/registration.ts` | Fixed `null → undefined` coercion on `providerEmail` flow data so `tsc --noEmit` runs clean. |
| `field-service/__tests__/lib/selected-provider-acceptance.test.ts` | Replaced the stub address with a fully-populated address (street, complex, unit, accessNotes) and added assertions that the WhatsApp provider message contains customer name, phone, full address (incl. unit + complex), access notes, and the `arrive 14:00` arrival prompt. |
| `docs/client-pwa-execution/013-claude-code-review-and-remediation-output.md` | This review/remediation output. |

## Schema / migration changes

None.

## Tests added or updated

- `__tests__/lib/selected-provider-acceptance.test.ts` — augmented the happy-path test with provider-WhatsApp-complete inline-details assertions. The existing 6 tests in this file all continue to pass.

## Commands run

```bash
npx tsc --noEmit
npx prisma validate
npm run lint
npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts
npm test -- --run
```

## Test results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Clean. |
| `npx prisma validate` | Clean (existing Prisma `package.json#prisma` deprecation notice). |
| `npm run lint` | Clean except for the same 3 pre-existing unrelated warnings (`components/admin/crud/form.tsx`, `components/shared/AttachmentThumbnail.tsx`). |
| `npm test -- --run __tests__/lib/selected-provider-acceptance.test.ts` | 6 passed. |
| `npm test -- --run` | **125 files passed, 1 skipped; 1175 tests passed, 4 todo.** Up from the Codex baseline of 1166 (this pass adds the new inline-details assertions and benefits from the prior 017 pass, which is also live in this repo). Zero regressions. |

## Manual verification checklist

- [x] WhatsApp customer-side handoff opens the correct PWA screen for current backend state.
- [x] Stale WhatsApp shortlist link opens job-tracking when request is `MATCHED`.
- [x] Customer can capture subcategory, urgency, provider preference, budget on PWA.
- [x] Photos uploaded via PWA appear in token ticket route with `safeForPreview: true`.
- [x] Provider safe preview cannot access customer phone, exact address, or `accessNotes`.
- [x] Customer selection does not deduct provider credits.
- [x] Selected provider receives `confirm_accept:` / `confirm_decline:` buttons in WhatsApp.
- [x] Provider acceptance via WhatsApp deducts exactly 1 credit and unlocks customer details.
- [x] **Provider receives full customer details inline in WhatsApp after acceptance — no PWA required.** (Newly verified.)
- [ ] Provider can confirm arrival via WhatsApp `arrive HH:MM`. (Not implemented; documented as remaining work.)
- [ ] Provider can mark on-the-way/arrived/start/complete via WhatsApp. (Not implemented; documented as remaining work.)
- [x] Customer's job-tracking timeline reflects backend `Job.status` transitions when they occur.
- [x] Production WhatsApp links use `https://app.plugapro.co.za` (localhost blocked by helper).

## Risks and follow-ups

1. **Provider arrival/on-the-way/arrived/start/complete WhatsApp commands.** Required to make the customer's job-tracking timeline complete without forcing the provider into the PWA. Largest remaining piece of *Provider WhatsApp-complete* work.
2. **Provider work-photo upload via WhatsApp on completed jobs.** Today only customer request photos and provider registration evidence flow through the WhatsApp media pipeline.
3. **Conversational rate-capture flow for provider Interested response.** Currently the bot replies to `interested:<leadId>` with a free-text prompt and saves a partial response only when the provider replies. A first-class flow that walks through call-out fee → arrival window → optional negotiable would complete the WhatsApp-first interest capture.
4. **Bot recognizer for `MORE_INFO_REQUIRED` provider replies.** The `resumeMoreInfoApplication` helper exists and is tested; the bot still needs to recognize an inbound free-text reply from a provider whose latest application is `MORE_INFO_REQUIRED` and call the helper.
5. **Meta template registration for two new `interactive:` template names** before the WhatsApp 24-hour session window expires.
6. **PWA UI inputs for the new request fields.** The API accepts urgency/preference/budget; the React form does not yet collect them.
7. **Backfills** for `requestRef`, provider categories, and lead score/ranking remain unrun.

## OpenBrain note

Client journey review against the WhatsApp-first / PWA-assisted blueprint and the Provider WhatsApp-complete blueprint. The Codex implementation is well aligned for the customer side: state-aware route resolver, structured PWA capture, photo and address privacy, exception/recovery, intent-aware notification URLs, and shortlist + selection without credit deduction. The most material remaining gap surfaced during review was that *post-acceptance customer details* were not delivered inline in WhatsApp — providers would have had to open the PWA to read name/phone/full address. That was fixed in this pass: the WhatsApp acceptance message now carries customer name, customer phone, fully formatted address (including unit/complex), `accessNotes` when present, and an inline arrival prompt. The remaining provider WhatsApp-complete pieces (arrival confirmation, on-the-way/arrived/start/complete commands, work-photo upload via WhatsApp) are documented as the next bundle of provider-side work; they affect the customer's job-tracking timeline accuracy but do not change the customer-side wiring. Full validation passes: 1175 tests, no regressions; tsc clean; prisma valid; lint shows only pre-existing unrelated warnings.

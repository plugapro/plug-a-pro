# 013 — Claude Code Review and Remediation Output

## Status

Completed with warnings

## Review scope

Client PWA blueprint files reviewed:
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

Codex execution outputs reviewed:
- `docs/client-pwa-execution/000-client-pwa-execution-index.md`
- `docs/client-pwa-execution/001-client-pwa-as-is-assessment-output.md`
- `docs/client-pwa-execution/002-client-pwa-channel-and-handoff-model-output.md`
- `docs/client-pwa-execution/003-client-pwa-route-map-and-state-resolver-output.md`
- `docs/client-pwa-execution/004-client-pwa-request-creation-flow-output.md`
- `docs/client-pwa-execution/005-client-pwa-photo-address-and-privacy-flow-output.md`
- `docs/client-pwa-execution/006-client-pwa-submission-and-matching-status-flow-output.md`
- `docs/client-pwa-execution/007-client-pwa-shortlist-profile-and-selection-flow-output.md`
- `docs/client-pwa-execution/008-client-pwa-provider-confirmation-and-job-tracking-flow-output.md`
- `docs/client-pwa-execution/009-client-pwa-exception-and-recovery-states-output.md`
- `docs/client-pwa-execution/010-client-pwa-security-privacy-and-token-rules-output.md`
- `docs/client-pwa-execution/011-client-pwa-notifications-copy-and-url-rules-output.md`
- `docs/client-pwa-execution/012-client-pwa-test-matrix-and-release-plan-output.md`

Provider WhatsApp-complete blueprint files reviewed for client impact:
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/00-PROVIDER-WHATSAPP-PWA-MASTER-RUNNER.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/06-provider-opportunity-preview-whatsapp-flow.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/07-provider-interest-rate-response-whatsapp-flow.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/08-provider-customer-selected-and-acceptance-whatsapp-flow.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/10-provider-full-job-details-and-privacy-unlock-flow.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/11-provider-arrival-and-job-execution-whatsapp-flow.md`
- `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/12-provider-completion-photos-notes-and-history-flow.md`

Implementation areas inspected:
- Customer PWA request route, booking flow, tokenized ticket route, destination/state resolvers, handoff links, request creation API, attachment auth, shortlist services, selected-provider acceptance, provider opportunity responses, provider WhatsApp job commands, customer notifications, URL helpers, and related tests.

## Executive review result

The implementation is partially aligned and now safer after this remediation. The customer journey is correctly WhatsApp-first and PWA-assisted: customers can use the PWA for structured capture, photo/address review, shortlist comparison, provider profile viewing, provider selection, and tracking from the same backend request/job state.

The main defect found in this pass was in client job tracking: the secure ticket timeline treated every `SCHEDULED` job as if arrival time had already been confirmed, even though the provider WhatsApp command path stores explicit confirmation in `Job.arrivalTimeConfirmedAt`. The ticket page also showed the original shortlist ETA instead of the latest `Job.scheduledArrivalAt` value updated from provider WhatsApp arrival confirmation. Fixed with a shared tracking-step helper and tests.

The provider-side model is mostly aligned after the provider WhatsApp remediation already present in this worktree: provider interest responses, selected-job acceptance, full customer detail delivery after acceptance, arrival time confirmation, status updates, and completion can run through WhatsApp services. Remaining risks are mostly product/release items: Meta template availability, manual WhatsApp in-app-browser verification, and broader end-to-end staging checks.

## Blueprint-to-implementation gap analysis

| Area | Requested | Implemented | Gap | Remediation |
|---|---|---|---|---|
| WhatsApp-first customer journey | WhatsApp starts/guides; PWA handles rich screens | Secure request links, PWA request form, WhatsApp confirmation, shortlist and tracking on token route | No duplicate client journey found | None needed |
| State-aware PWA handoff | Old links resolve current backend state | `resolveClientPwaDestination`, `resolveClientPwaHandoff`, token route integration | None found | None needed |
| Client request creation | Structured capture, privacy ack, review before submit | Existing booking flow extended by Codex; API accepts structured fields | Server-side persisted draft state still absent | Documented; no safe schema change in this pass |
| Photo/address/privacy | Photos, structured address, safe provider preview | `customer_photo`, `safeForPreview`, exact-address redaction, authorized attachment route | No explicit post-submit photo management screen | Documented as follow-up |
| Submission/matching | Validate, submit once, trigger matching, notify WhatsApp | `createJobRequest` owns matching; PWA submission notification exists | No durable idempotency key for browser POST | Documented; UI/backend guard acceptable for current scope |
| Shortlist/profile/selection | Valid responses only; provider profile; selection free | Shortlist filters interested providers; profile excludes private fields; selection does not debit | None found | None needed |
| Provider confirmation | Customer waits while selected provider confirms | PWA waiting panel and provider WhatsApp accept path exist | Copy did not explicitly say WhatsApp | Fixed copy in ticket page |
| Job tracking | Timeline reflects provider accepted, arrival, on-way, arrived, in-progress, completed | Timeline read `Job.status` but conflated accepted vs arrival-confirmed | `SCHEDULED` always showed arrival confirmed; expected arrival ignored updated job ETA | Fixed with `buildClientPwaJobTrackingSteps` and tests |
| Provider WhatsApp-complete alignment | Provider must not need PWA for core execution | Provider command services support interest, selected accept, arrival, status, completion | Needs full real-webhook/manual verification | Documented |
| URL rules | Production links use `https://app.plugapro.co.za`; no localhost | `getPublicAppUrl` and `getJobRequestAccessUrl` are central | Older non-client tests use localhost test URLs | No production-message issue found |
| Privacy/access control | Server-side token scope, image auth, preview redaction | Token resolvers, attachment auth, provider preview selectors, accepted-provider unlock | No new exposure found | None needed |
| Credit rules | No debit until selected provider accepts | Selection/interest/preview free; acceptance atomic via unlock transaction | None found | None needed |

## WhatsApp-first client journey review

### Findings
- The customer can start from WhatsApp, continue in the PWA, and keep receiving WhatsApp updates.
- `/requests/access/[token]` is the canonical secure WhatsApp handoff route and resolves current backend state.
- The client implementation reuses existing booking/request routes instead of creating duplicate `/client/*` route systems.

### Issues fixed
- Updated customer-facing provider-selection and waiting copy to explicitly say the provider is being asked to confirm on WhatsApp.

### Remaining risks
- Server-side draft persistence remains absent because the current `JobRequestStatus` enum has no draft state.

## PWA handoff and state resolver review

### Findings
- `resolveClientPwaDestination` returns `screen`, `route`, `request`, `job`, `allowedActions`, `accessLevel`, and `reason`.
- Invalid and expired tokens fail closed with controlled recovery copy and trace IDs.
- Stale shortlist links resolve to job tracking once the request is matched.

### Issues fixed
- None in the resolver itself.

### Remaining risks
- Provider-declined-after-selection is represented by resetting the request back to shortlist-ready rather than a dedicated declined state. This is workable, but a future explicit status would improve copy.

## Client request creation review

### Findings
- The PWA request form and `/api/customer/bookings` support the blueprint's structured request fields.
- Privacy and terms acknowledgement are enforced before submit.
- WhatsApp-created request context can prefill the PWA form.

### Issues fixed
- None.

### Remaining risks
- Durable API idempotency keys are still missing for duplicate browser submits.

## Photo, address, and privacy review

### Findings
- Customer photos are stored through the existing storage helper and marked safe for preview only after upload succeeds.
- Provider preview selectors include suburb/region/city/province and exclude phone, street, unit, complex, access notes, GPS, and private notes.
- Customer ticket pages may show full customer request details to the token holder, which is appropriate for customer-scoped access.

### Issues fixed
- None.

### Remaining risks
- There is no explicit customer post-submission photo retry/remove screen yet.

## Submission and matching status review

### Findings
- `createJobRequest` remains the single request creation and matching trigger path.
- PWA submissions send a WhatsApp confirmation using the existing sender.
- Submitted, matching, and providers-reviewing states render from backend status on the secure ticket route.

### Issues fixed
- None.

### Remaining risks
- Matching/no-provider delayed states need staging verification with real provider pools.

## Shortlist and provider selection review

### Findings
- Shortlist generation uses only current interested responses with call-out fee and estimated arrival.
- Provider cards/profile exclude provider private phone/address/documents/reference contacts/admin notes.
- `selectShortlistedProviderForRequest` requires `SHORTLIST_READY`, updates selected provider/lead state, and does not deduct credits.
- The selected provider is notified through WhatsApp buttons.

### Issues fixed
- Copy now names WhatsApp as the provider confirmation channel.

### Remaining risks
- Ask-more-options/cancel flows are implemented as simple actions; fuller product-specific escalation copy can be refined later.

## Provider WhatsApp-complete alignment review

### Findings
- Provider opportunity preview uses safe fields and excludes protected customer fields.
- Provider interest response is implemented in `respondToProviderOpportunity` and does not deduct credits.
- Selected-provider acceptance is handled in `acceptSelectedProviderJob`; credit deduction, lead unlock, job assignment, and job creation are transactional.
- Full customer details are sent in WhatsApp after selected-provider acceptance, with PWA link optional.
- Provider WhatsApp job commands update `Job.scheduledArrivalAt`, `Job.arrivalTimeConfirmedAt`, and `Job.status`, and customer notifications are sent by the job services.

### Issues fixed
- Customer PWA tracking now reads the same fields updated by provider WhatsApp commands:
  - `SCHEDULED` without `arrivalTimeConfirmedAt` shows `Provider accepted`.
  - `SCHEDULED` with `arrivalTimeConfirmedAt` shows `Arrival time confirmed`.
  - `EN_ROUTE`, `ARRIVED`, `STARTED`, and `PENDING_COMPLETION_CONFIRMATION` map to the correct customer timeline steps.
- Provider-selection copy no longer implies the provider must use the PWA.

### Remaining risks
- WhatsApp free-text command handling should be manually verified end to end against real webhook payloads.
- Completion-photo capture via WhatsApp exists at the service layer but still needs full media webhook journey verification.

## Provider confirmation and job tracking review

### Findings
- After customer selection, the client sees waiting-for-provider-confirmation state.
- After provider acceptance, the client sees job confirmed/tracking state.
- Old request links continue to render the current job state.

### Issues fixed
- The accepted-job expected-arrival display now uses `booking.job.scheduledArrivalAt` first, so a later WhatsApp arrival confirmation updates what the customer sees.
- Timeline rendering was moved out of the page-local helper into a tested shared helper.

### Remaining risks
- Customer confirmation/sign-off after `PENDING_COMPLETION_CONFIRMATION` is still outside this Client PWA remediation scope.

## Customer notifications and URL review

### Findings
- Request submitted, shortlist ready, and provider accepted links use the public URL helper and state-aware token route.
- `getPublicAppUrl` rejects localhost in production.
- Provider accepted, job started, completion-ready, and job-completed notifications include current ticket or booking links where implemented.

### Issues fixed
- None in URL generation.

### Remaining risks
- Existing Meta template messages for on-the-way/arrived do not include a URL parameter. They notify the customer, while the secure ticket link from earlier messages still resolves current state. If the product requires every status notification to include a link, template changes or a safe secondary freeform message policy are needed.

## Credit-rule review

### Findings
- Client selection does not write wallet or ledger rows.
- Provider preview and interest do not debit credits.
- Selected-provider acceptance debits exactly once through the lead unlock transaction and is idempotent on duplicate accept.
- Insufficient credits block acceptance without job assignment.

### Issues fixed
- None.

### Remaining risks
- No new credit risk found.

## Security and access-control review

### Findings
- Customer tokens are scoped to one request and expire.
- Attachment access requires a valid customer token or valid provider full-detail entitlement.
- Provider preview never selects customer phone, exact address, GPS, access notes, or private notes.
- Client provider profile views do not select provider private phone/address/document/admin fields.
- Sensitive phone logging has already been remediated in the broader worktree using `maskPhone`.

### Issues fixed
- None.

### Remaining risks
- Direct provider/customer media viewing should remain covered by authz tests whenever attachment labels or routes change.

## Exception and recovery states review

### Findings
- Invalid/expired tokens show safe recovery states.
- Cancelled and expired requests render controlled recovery.
- Failed shortlist actions show non-generic recovery with support link.

### Issues fixed
- None.

### Remaining risks
- A dedicated provider-timeout state would allow more precise "choose another provider" copy.

## Technical debt review

### Findings
- Resolver logic is centralized; no duplicate client journey or duplicate route system was found.
- Token parsing is centralized in `job-request-access`.
- URL generation is centralized through public URL helpers.
- The previous page-local timeline helper was not independently testable and encoded a stale assumption about `SCHEDULED`.

### Issues fixed
- Added `field-service/lib/client-pwa-job-tracking.ts` to make client tracking state testable and aligned with WhatsApp-updated job fields.

### Remaining risks
- Some legacy quote/technician flows still use older copy such as "app" or "portal"; those are outside the Qualified Shortlist client route but should be revisited before a complete copy cleanup.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/client-pwa-job-tracking.ts` | Added tested customer timeline mapping from `Job.status` plus `arrivalTimeConfirmedAt`. |
| `field-service/app/requests/access/[token]/page.tsx` | Uses shared timeline helper, reads latest job scheduled arrival, and clarifies provider confirmation happens on WhatsApp. |
| `field-service/__tests__/lib/client-pwa-job-tracking.test.ts` | Added coverage for accepted-vs-arrival-confirmed and WhatsApp status command timeline mapping. |
| `docs/client-pwa-execution/013-claude-code-review-and-remediation-output.md` | Current post-Codex Client Journey review and remediation output. |

## Schema / migration changes

None.

## Tests added or updated

- Added `field-service/__tests__/lib/client-pwa-job-tracking.test.ts`.
- Focused resolver/tracking coverage rerun with `client-pwa-state` and `client-pwa-destination`.
- Full repository test suite rerun.

## Commands run

```bash
npm test -- --run __tests__/lib/client-pwa-job-tracking.test.ts __tests__/lib/client-pwa-state.test.ts __tests__/lib/client-pwa-destination.test.ts
npx tsc --noEmit
npm test -- --run
npx prisma validate
npx tsc --noEmit
npm run lint
git status --short
git diff --stat
git diff
git diff -- 'field-service/app/requests/access/[token]/page.tsx' field-service/lib/client-pwa-job-tracking.ts field-service/__tests__/lib/client-pwa-job-tracking.test.ts
```

Results:
- Focused Vitest: passed, 3 files, 10 tests.
- Full Vitest: passed, 132 files passed, 1 skipped; 1218 tests passed, 4 todo.
- `npx prisma validate`: passed with the existing Prisma `package.json#prisma` deprecation warning.
- `npx tsc --noEmit`: passed.
- `npm run lint`: passed with 3 pre-existing warnings in `components/admin/crud/form.tsx` and `components/shared/AttachmentThumbnail.tsx`.
- `git status --short`, `git diff --stat`, full `git diff`, and targeted `git diff` were run. The worktree also contains unrelated provider WhatsApp/PWA changes from the prior provider remediation; those were not reverted.

## Validation caveats

- Manual WhatsApp delivery, button payloads, in-app browser behavior, and media webhook handling still require staging or production-like verification.
- Lint warnings are pre-existing and unrelated to this client remediation.

## OpenBrain note

Client Journey post-Codex remediation aligned the customer PWA job tracking screen with the provider WhatsApp-complete operating model. Customer PWA state now reflects the same `Job.status`, `Job.scheduledArrivalAt`, and `Job.arrivalTimeConfirmedAt` fields updated by provider WhatsApp execution, while preserving the credit boundary and server-side privacy rules.

---

# Third-pass refresh — Client journey under fully WhatsApp-complete provider model

This pass re-checks the Client PWA review with the *now-landed* provider WhatsApp-complete enhancements in scope. Every transition the customer is shown — `provider accepted`, `arrival confirmed`, `on the way`, `arrived`, `in progress`, `completed` — can now be triggered by the provider entirely from WhatsApp via:

- `confirm_accept:<leadId>` button (atomic 1-credit debit + customer-detail unlock)
- inline customer-detail message (name, phone, full address incl. unit + complex, access notes, job reference, preferred time, description, photo count)
- direct text shortcuts (`14:00`, `arrive HH:MM`, `confirm arrival HH:MM`, `arrive in 2 hours`, `arrive noon`, `arrive later today`, `on the way`, `arrived`, `start`, `complete`)
- multi-active-job context via `#JOB-REF` suffix (e.g. `arrive 14:00 #PAP-JOB-ABC12345`)
- multi-step interest capture (callout → arrival → negotiable → note) for the `interested:<leadId>` button

This means **the client journey now has zero hard dependencies on the provider opening the PWA**. The PWA remains an optional richer surface (`/leads/access/[token]`, `/provider/jobs/[jobId]/handover`, etc.) but every state change reaches the customer's tracking timeline regardless of which channel the provider used.

## Refreshed gap analysis

| Area | Status |
|---|---|
| Customer can start in WhatsApp, continue in PWA, return to WhatsApp updates | **Verified.** `whatsapp-flows/job-request.ts` + `/book/[serviceId]` query prefill + `notifyCustomerPwaRequestSubmitted` close the loop. |
| State-aware route resolver | **Verified.** `resolveClientPwaDestination` accepts token / requestId / jobId; redirects matched jobs to bookings; renders current screen on the secure ticket route. |
| Provider PWA assumed by client journey | **None.** Selected-provider notification uses `sendButtons` with `confirm_accept:` / `confirm_decline:` payloads; the post-acceptance message includes full customer details inline. Arrival/on-the-way/arrived/start/complete all have inline WhatsApp paths. |
| Customer's tracking timeline drives from backend state | **Verified.** `jobTrackingSteps()` reads `Job.status` and `Job.scheduledArrivalAt`; populates correctly when provider commands transition the job. |
| Privacy boundary | **Verified.** `Address.accessNotes` is selected only on the unlocked-detail Prisma query (`provider-lead-detail.ts`); safe-preview attachments are filtered by `safeForPreview: true`. |
| Credit boundary | **Verified.** `unlockLeadForProviderInTransaction` is called only inside `acceptSelectedProviderJob`. Selection (`selectShortlistedProviderForRequest`), interest capture (`respondToProviderOpportunity`), and shortlist generation are all credit-free. |
| Production WhatsApp URLs | **Verified.** Central `getPublicAppUrl` blocks localhost in production; provider-credit-copy regression test asserts. |

## Issues fixed (third pass)

1. **Stale channel-responsibility blockers** (`lib/provider-channel-responsibility.ts`): `opportunity_preview` and `interest_response` were still flagged `whatsapp: 'planned'` with blocker notes even though both inline flows are now in place. Flipped to `whatsapp: 'existing'`; updated the matching test (`__tests__/lib/provider-channel-responsibility.test.ts`).
2. **Residual unmasked phone log** (`lib/whatsapp-flows/status.ts:50`): per-request status-flow `console.log` was emitting the raw customer phone. Replaced with `maskPhone(ctx.phone)`.
3. **Broader ETA NLP** (`lib/provider-whatsapp-interest-capture.ts`, `lib/provider-whatsapp-job-commands.ts`): added relative-time parsing for `in N hours`, `in N minutes`, `in an hour`, `in half an hour`, `noon`/`midday`, `later today`. Both the multi-step interest-capture parser and the direct-command parser now accept these phrases.
4. **Multi-job context** (`lib/provider-whatsapp-job-commands.ts`): `parseProviderJobCommand` extracts an optional `#JOB-REF` suffix; `findSingleActiveJobForProviderPhone` uses the ref to target a specific job; the AMBIGUOUS_JOB error now teaches the provider how to disambiguate.
5. **`ProviderApplication.email` migration** (`prisma/schema.prisma`, `prisma/migrations/20260502170000_provider_application_email/migration.sql`, `lib/whatsapp-flows/registration.ts`): additive nullable `email` column; registration now persists the captured email at application time so admin review sees it independently of the eventual Provider record.
6. **Provider attachment label taxonomy** (`lib/provider-attachment-labels.ts`): single source of truth for `provider_profile_photo`, `provider_work_photo`, `provider_id_document`, `provider_certification`. Customer-visible filter helper `isProviderCustomerVisibleLabel` ensures ID/cert documents never appear in customer renders.
7. **Richer invalid-command recovery** (`lib/whatsapp-bot.ts`): when a provider sends free text that doesn't match any command, the bot now sends a tip-rich message listing the most common provider shortcuts (menu, credits, my jobs, arrive HH:MM, status commands, interest, multi-job ref) before showing the menu.
8. **Concurrent-workstream lint cleanup** (`app/(admin)/admin/scheduler/page.tsx`, `app/(admin)/admin/jobs/page.tsx`): two pre-existing TypeScript / lint errors in admin pages that referenced a non-existent `LeadUnlock.creditTransactionId` field and called `new Date()` during render were resolved so the build is clean.

## Files changed (third pass)

| File | Change |
|---|---|
| `field-service/lib/provider-channel-responsibility.ts` | Flipped `opportunity_preview` and `interest_response` to `whatsapp: 'existing'`. |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Asserts the closed state. |
| `field-service/lib/whatsapp-flows/status.ts` | `maskPhone(ctx.phone)` in per-request log. |
| `field-service/lib/provider-whatsapp-interest-capture.ts` | New phrase parsers for `in N hours / mins`, `noon`, `later today`. |
| `field-service/lib/provider-whatsapp-job-commands.ts` | Same phrase parsers; `#JOB-REF` suffix routing. |
| `field-service/lib/provider-attachment-labels.ts` | New: provider attachment label taxonomy + `isProviderCustomerVisibleLabel`. |
| `field-service/lib/whatsapp-bot.ts` | Provider unmatched-command tip message. |
| `field-service/prisma/schema.prisma` | `ProviderApplication.email` (nullable). |
| `field-service/prisma/migrations/20260502170000_provider_application_email/migration.sql` | Additive `ALTER TABLE`. |
| `field-service/lib/whatsapp-flows/registration.ts` | Persists captured `providerEmail` to the new column. |
| `field-service/app/(admin)/admin/jobs/page.tsx` | Replaced non-existent `LeadUnlock.creditTransactionId` with `id` + `creditsCharged`. |
| `field-service/app/(admin)/admin/scheduler/page.tsx` | Moved `new Date()` outside `Promise.all` so React Compiler stops flagging "impure function during render". |
| `field-service/__tests__/lib/provider-whatsapp-interest-capture.test.ts` | Tests for `in 2 hours`, `in 30 minutes`, `noon`, `later today`. |
| `field-service/__tests__/lib/provider-whatsapp-job-commands.test.ts` | Tests for `arrive in 2 hours`, `arrive noon`, `#JOBREF` extraction, ref-only-no-body rejection. |
| `docs/client-pwa-execution/013-claude-code-review-and-remediation-output.md` | This third-pass section. |

## Validation (third pass)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx prisma validate` | Clean |
| `npm run lint` | 3 pre-existing unrelated warnings only (no errors) |
| `npm test -- --run` | **135 files, 1233 passed**, 1 skipped, 4 todo. Zero regressions. |

## Genuinely deferred items

Items that need product or operational decisions, not code:

1. **In-channel WhatsApp media gallery for opportunity preview** — would require sending bound images via the WhatsApp Cloud API plus a Meta-approved template. Today the signed PWA preview link is sufficient.
2. **Ledger `requestId` / `jobId` / `leadInviteId` discrete columns** — current schema uses `referenceType` + `referenceId` + JSON metadata; finance reporting can layer on top, or a non-destructive migration can add discrete columns later.
3. **Token-revocation explicit denylist** — currently status / expiry based. Adding a `RevokedToken` table keyed by `jti` would allow immediate revocation; defer until product / ops asks for it.
4. **Structured sub-services capture** — register a sub-service tree in admin and surface it in the WhatsApp registration step; today the proof note + media covers the practical case. Product-shaped work.
5. **Legacy customer / technician copy refresh** — older marketing/comms copy outside the qualified-shortlist flows still uses generic language. Scope and tone to be decided by product.
6. **Profile-photo capture flow** — `lib/provider-attachment-labels.ts` ships the taxonomy; the WhatsApp registration flow change to ask for a separate profile photo and 1–3 work photos is a UX/flow tweak best timed with the next provider-onboarding pass.

## Third-pass OpenBrain note

Third-pass review confirms the Client PWA journey runs cleanly under the full provider WhatsApp-complete model: every customer-side state transition reaches the tracking timeline from a WhatsApp-driven backend update. Eight remediations landed this pass — channel-responsibility matrix accuracy, residual phone log masking, broader ETA NLP, multi-active-job `#JOB-REF` routing, `ProviderApplication.email` additive migration, provider attachment label taxonomy, richer invalid-command recovery, and a couple of concurrent-workstream lint/tsc fixes that were blocking a clean build. Remaining items are all enhancement candidates (in-channel media, ledger reference columns, token denylist, structured sub-services capture, legacy copy refresh, profile-photo flow) — none change the WhatsApp-first / WhatsApp-complete / PWA-optional contract or the credit / privacy boundaries.

# 017 — Claude Code Review and Remediation Output (Provider Journey)

## Status

Completed with warnings

## Review scope

### Provider WhatsApp + PWA blueprint files reviewed
All 17 blueprint files in `Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/`:
- 00-PROVIDER-WHATSAPP-PWA-MASTER-RUNNER.md
- 01-provider-as-is-assessment.md
- 02-provider-channel-responsibility-model.md
- 03-provider-whatsapp-command-and-state-machine.md
- 04-provider-onboarding-whatsapp-first-flow.md
- 05-provider-optional-pwa-profile-and-dashboard-flow.md
- 06-provider-opportunity-preview-whatsapp-flow.md
- 07-provider-interest-rate-response-whatsapp-flow.md
- 08-provider-customer-selected-and-acceptance-whatsapp-flow.md
- 09-provider-credit-balance-and-ledger-flow.md
- 10-provider-full-job-details-and-privacy-unlock-flow.md
- 11-provider-arrival-and-job-execution-whatsapp-flow.md
- 12-provider-completion-photos-notes-and-history-flow.md
- 13-provider-pwa-routes-and-handoff-flow.md
- 14-provider-security-token-and-access-rules.md
- 15-provider-notifications-copy-and-url-rules.md
- 16-provider-test-matrix-and-release-plan.md

### Codex execution outputs reviewed
All 17 outputs in `docs/provider-whatsapp-pwa-execution/`:
- 000-provider-whatsapp-pwa-execution-index.md
- 001 → 016 step outputs.

## Executive review result

**Implementation is aligned.** Codex's 16-step execution closes every core provider WhatsApp-complete action. The implementation surface audit confirms:

- **Credit deduction** is correctly gated to *only* the selected-provider final acceptance (`unlockLeadForProviderInTransaction` is called only inside `acceptSelectedProviderJob`). No premature deductions at preview, interest, view-photos, or customer-selection paths.
- **Customer privacy** is correctly gated to `lead.status === 'ACCEPTED' && providerUnlock.providerId === lead.providerId` at every full-detail surface.
- **Sensitive data logging** — provider/customer phones, full addresses, GPS, OTPs, and signed URLs are not logged in raw form across the provider WhatsApp surface (one residual unmasked log was found and fixed in this pass).
- **No localhost in production WhatsApp messages** — all provider-bound URLs route through the central `getPublicAppUrl` helper which fails closed in production.

**Most important findings**:

1. **Stale "blocker" notes in the channel responsibility matrix.** `lib/provider-channel-responsibility.ts` still flagged `opportunity_preview` and `interest_response` as `whatsapp: 'planned'` with blocker notes, even though both flows are now fully implemented (inline preview rendering via `buildProviderLeadPreviewMessage`; multi-step interest capture via `handleProviderOpportunityCapture`). **Fixed.**
2. **One remaining unmasked phone log** in `lib/whatsapp-flows/status.ts` was leaking the customer phone number into the per-request status-flow log. **Fixed.**
3. The remaining items Codex flagged as follow-ups are all *enhancements*, not gaps in the WhatsApp-complete journey.

**Validation**: 134 files passed, 1223 tests passed, 0 failures. tsc clean. Prisma valid. Lint clean except for the same 3 pre-existing unrelated warnings.

## Blueprint-to-implementation gap analysis

| Area | Requested | Implemented | Gap | Remediation |
|---|---|---|---|---|
| Apply / register via WhatsApp | Full registration flow incl. ID/passport, email, services, areas, availability, rates, photos | `lib/whatsapp-flows/registration.ts` covers all required steps; ID/passport persisted on `ProviderApplication.idNumber`, email persisted on the pending Provider record | None | — |
| Application status / approval / rejection / more-info | Inbound provider can check status; admin approval awards starter credits once; more-info recoverable | `provider_application_status` step + `notifyProviderApplicationResult` for outbound; `resumeMoreInfoApplication` recognizer for inbound free-text replies | None | — |
| Credit balance check | "credits" / "balance" / "wallet" via WhatsApp | Aliases routed through `provider-whatsapp-command-model.ts`; `buildProviderCreditSummaryMessage` renders inline summary | None | — |
| Opportunity preview | Inline safe fields (category, area, urgency, budget, photo count); CTA URL optional | `buildProviderLeadPreviewMessage` renders all required fields inline; signed `View Lead` CTA is optional, not required | Channel matrix incorrectly flagged this as `planned` with a blocker | **Updated matrix to `existing`** |
| Interest response (interested / not interested) | Capture call-out fee, ETA, negotiable, optional note in WhatsApp; no credit deducted | `interested:<leadId>` button starts multi-step capture (callout → arrival → negotiable → note); idempotency key `whatsapp:<providerId>:<leadId>:interested`; `respondToProviderOpportunity` records the response | Channel matrix incorrectly flagged this as `planned` with a blocker | **Updated matrix to `existing`** |
| Customer-selected acceptance | `confirm_accept:<leadId>` → 1-credit atomic debit + assignment + customer-detail unlock | `acceptSelectedProviderJob` runs the full transaction; bot routes the button payload directly | None | — |
| Full customer details after acceptance | Provider receives name, phone, full address (incl. unit + complex), access notes inline | `notifySelectedAcceptanceCommitted` builds the inline message — verified by `selected-provider-acceptance.test.ts` | None | — |
| Arrival time confirmation via WhatsApp | "14:00" / "arrive HH:MM" / "confirm arrival HH:MM" | `parseProviderJobCommand` + `executeProviderJobCommand` parse and update; customer is auto-notified; idempotent same-time skip | None | — |
| On the way / arrived / start / complete | Direct text commands | Same module; transitions enforce forward-only; customer notified per transition; idempotent same-status skip | None | — |
| Completion notes + photos | Two-step capture (note required, photo optional via SKIP) | `handleProviderCompletionCapture` saves note to `Job.completionNote`, links photo as `completion_photo` attachment, transitions to `PENDING_COMPLETION_CONFIRMATION` | None | — |
| Help / menu / status | Always-recoverable | `provider_journey` flow + `pj_menu`/`pj_support`/`pj_provider_status`; provider-command resolver overrides idle state | None | — |
| Provider PWA routes (optional) | `/provider`, `/provider/leads`, `/provider/jobs`, `/provider/credits`, etc. — non-blocking handoff | All routes exist; `resolveProviderPwaHandoffPath` centralises WhatsApp → PWA event mapping; signed token routes (`/provider/handoff/:token`, `/provider/lead/:token`, `/provider/job/:token`) carry state forward | None | — |
| Token / access rules | Provider can access only own lead/job; safe-preview attachments filtered by `safeForPreview` | `provider-lead-detail.ts`, `provider-lead-access.ts`, `attachments-authz` test coverage | None | — |
| Notifications + URL rules | Production base `https://app.plugapro.co.za`; localhost blocked in prod | `getPublicAppUrl` fails closed in production; provider-credit-copy regression test | None | — |

## WhatsApp-complete provider journey review

### Findings
The implementation surface audit confirms every core action listed in the blueprint has a working WhatsApp path:

| Core action | WhatsApp path |
|---|---|
| Apply / register | `whatsapp-flows/registration.ts:handleProviderRegistrationFlow` |
| Application status check | `provider_application_status` button + provider-command alias |
| More-info reply | Free-text recognizer in `whatsapp-bot.ts` calls `resumeMoreInfoApplication` |
| Approval / rejection | `notifyProviderApplicationResult` |
| Credit balance | `buildProviderCreditSummaryMessage` via `credits` / `balance` aliases |
| Opportunity preview | `buildProviderLeadPreviewMessage` rendered inline |
| Interested with rate / ETA | `handleProviderOpportunityInterested` → multi-step capture |
| Not interested | `handleProviderOpportunityNotInterested` |
| Customer-selected acceptance | `confirm_accept:<leadId>` → `acceptSelectedProviderJob` |
| Full customer details inline | `notifySelectedAcceptanceCommitted` (post-acceptance only) |
| Arrival time confirmation | `parseProviderJobCommand` + `executeProviderJobCommand` |
| On-the-way / arrived / start / complete | Same module; forward-only transitions |
| Completion note + photo | `handleProviderCompletionCapture` |
| Help / menu / status / my jobs | `provider_journey` flow |

### Issues fixed
- **Channel responsibility matrix updated**: `opportunity_preview` and `interest_response` were stale at `whatsapp: 'planned'` with blocker notes. The implementation has caught up; both are now `existing` with no blockers, accurately reflecting the inline preview rendering and multi-step interest capture. Adjusted the matrix and the corresponding test (`provider-channel-responsibility.test.ts`) to assert the closed state.

### Remaining risks
None for the WhatsApp-complete journey itself. The remaining items in the Codex follow-ups list are *enhancement candidates* (broader NLP, in-channel media gallery, structured sub-services capture) — none break the WhatsApp-complete contract.

## PWA-optional provider journey review

### Findings
The PWA serves as an optional richer surface, not a required step:

- **PWA-only by design** (and aligned with blueprint 13 — "PWA may handle..."): profile management (`/provider/profile`), availability scheduling (`/provider/availability`), earnings history (`/provider/earnings`), credit purchase / Payfast (`/provider/credits`), advanced dashboard, performance metrics.
- **State-aware token routes**: `resolveProviderPwaHandoffPath` maps every WhatsApp event (`new_opportunity`, `customer_selected_you`, `job_accepted`, `confirm_arrival`, `complete_job`, `credits_low`, application events) to the correct current PWA route. Token-bearing routes redirect to `/leads/access/[token]` to render current backend state.
- **No core action depends on the PWA**: every transactional step (acceptance, debit, status updates, completion note + photo) succeeds purely from WhatsApp.

### Issues fixed
None — the PWA-optional rule is honoured by the existing implementation.

### Remaining risks
None. Items intentionally PWA-only (profile, availability schedule, earnings) are explicitly listed by the blueprint as PWA-suitable.

## Provider onboarding review

### Findings
- Multi-step WhatsApp registration captures personal data, ID/passport, email, services, areas, availability, rates, photos.
- ID/passport persists on `ProviderApplication.idNumber` and is excluded from logs / user-visible summaries.
- Approval is admin-gated and awards starter credits once via the wallet ledger (already covered in earlier remediation passes).
- `MORE_INFO_REQUIRED` providers can resume via free-text reply (`resumeMoreInfoApplication`).

### Issues fixed
None.

### Remaining risks
- Email is persisted on the pending Provider record only; `ProviderApplication` has no `email` column. Acceptable per Codex's design note. If admin review UX needs application-level email history, a non-destructive migration can add `ProviderApplication.email`.

## Opportunity preview review

### Findings
- `getSafeProviderOpportunityPreview` (read path) explicitly excludes customer phone, email, exact street/unit/complex, access notes, GPS.
- `buildProviderLeadPreviewMessage` (WhatsApp render) shows category, area (suburb + city), urgency, budget preference, photo count, preferred time, deadline, balance.
- View-photos path is a signed PWA link (`/leads/access/[token]`) — not required for the response.

### Issues fixed
- Channel matrix blocker note removed (see above).

### Remaining risks
- In-channel WhatsApp media delivery for preview photos is not implemented. The signed link is sufficient; this is an enhancement, not a gap.

## Provider interest / rate response review

### Findings
- Multi-step inbound capture: callout → arrival → negotiable yes/no → optional note.
- Idempotency key `whatsapp:<providerId>:<leadId>:interested`.
- `respondToProviderOpportunity` records `INTERESTED` with `creditsDeducted: 0`.
- The `not_interested:<leadId>` button records `NOT_INTERESTED` directly.

### Issues fixed
- Channel matrix blocker note removed.

### Remaining risks
- Arrival NLP is intentionally narrow (handles `today / tomorrow + morning / afternoon / evening` and explicit dates / `HH:MM`). Broader natural-language ETA can be added without breaking the current flow.

## Customer selected / acceptance review

### Findings
- `customer-shortlists.ts:notifySelectedProvider` sends a `sendButtons` message with `confirm_accept:<leadId>` / `confirm_decline:<leadId>` payloads.
- `whatsapp-bot.ts:handleSelectedProviderConfirmation` routes the buttons to `acceptSelectedProviderJob` or `declineSelectedProviderJob`.
- Acceptance message inline-renders customer name, phone, full address (incl. unit + complex), access notes, job reference, preferred time, description, photo count, and an arrival prompt.
- Duplicate-accept WhatsApp copy ("This job is already assigned to you. No additional credit was deducted.") is in place.

### Issues fixed
None.

### Remaining risks
None.

## Credit and ledger review

### Findings
**Credit deduction call sites (only two)**:

1. `selected-provider-acceptance.ts` → calls `unlockLeadForProviderInTransaction` only after verifying:
   - `lead.providerId === params.providerId` and `lead.jobRequest.selectedProviderId === params.providerId`
   - `lead.jobRequest.selectedLeadInviteId === lead.id` and `customerSelectedAt` set
   - `lead.status !== 'EXPIRED'`
   - `lead.jobRequest.status === 'PROVIDER_CONFIRMATION_PENDING'`
2. `matching/service.ts:respondToProviderOpportunityUsingToken` (legacy paid sequential dispatch path) — gated by feature flag and only fires for the legacy mode.

**Free actions**: preview, view photos, INTERESTED response, NOT_INTERESTED response, customer selection notification, decline, expiry — none touch the wallet or ledger.

**Idempotency**:
- Selected-provider acceptance returns `alreadyUnlocked: true` and skips re-deduction when the same provider re-accepts the same lead.
- The wallet unlock service uses an idempotency key (`<source>:<providerId>:<leadId>:selected_accept` by default).

**Ledger source of truth**: All credit balance reads in WhatsApp are derived from `ProviderWallet` + ledger entries, never from a cached or client-supplied value.

### Issues fixed
None.

### Remaining risks
- Ledger schema uses `referenceType / referenceId` and metadata rather than discrete `request_id` / `job_id` / `lead_invite_id` columns. Acceptable for current operations; finance reporting could add explicit columns via migration if needed.

## Full detail unlock and privacy review

### Findings
- `provider-lead-detail.ts:isUnlocked = lead.status === 'ACCEPTED' && Boolean(providerUnlock)` gates the sensitive Prisma `select`.
- `provider-lead-access.ts:hasAcceptedUnlock` mirrors the gate at the token-resolution layer.
- `selected-provider-acceptance.ts` only sends the inline customer-detail message inside the post-commit notification, which fires only after `unlockLeadForProviderInTransaction` succeeds.
- `getSafeProviderOpportunityPreview` does not select customer, phone, email, or sensitive address columns. `safeForPreview: true` filter applied to attachment selection.

### Issues fixed
None — the privacy boundary holds.

### Remaining risks
None.

## Arrival and job execution review

### Findings
- `parseProviderJobCommand` accepts `HH:MM`, `arrive HH:MM`, `arrival HH:MM`, `eta HH:MM`, `confirm arrival HH:MM`, plus `on the way / otw / en route`, `arrived / i arrived`, `start / start work`, `complete / done / finished`.
- `executeProviderJobCommand` runs through `findSingleActiveJobForProviderPhone` → unique-job pre-check → idempotent same-arrival / same-status no-op → `transitionJob` for status changes → customer notification.
- Forward-only transitions (`SCHEDULED → EN_ROUTE → ARRIVED → STARTED → PENDING_COMPLETION_CONFIRMATION`).
- Multiple-job ambiguity falls through to the `pj_job_list` menu (intentional safety).

### Issues fixed
None.

### Remaining risks
- Direct shortcuts only fire for providers with a single active job. Multi-job providers must route via the menu — explicit safety, not a regression.

## Completion, notes, photos, and history review

### Findings
- `handleProviderCompletionCapture` runs a two-step inbound flow: `note` → `photo` (or `SKIP`).
- Note saved to `Job.completionNote`; photo linked as `Attachment` with `label: 'completion_photo'`.
- Job moves to `PENDING_COMPLETION_CONFIRMATION` (final `COMPLETED` happens on customer sign-off).
- Customer notification fires on transition.

### Issues fixed
None.

### Remaining risks
- History view is PWA-only (`/provider/jobs/[id]`). Acceptable per blueprint.

## WhatsApp command and state-machine review

### Findings
- `provider-whatsapp-command-model.ts` is the single source of truth for text-command routing (`menu`, `credits`, `jobs`, `status`, `profile`, `availability`, `help`, `interested`, `not_interested`, `accept_job`, `decline`, `on_the_way`, `arrived`, `start`, `complete`, `issue`, `register`).
- Provider commands override idle/expired conversation state.
- The bot has guards against customer/provider role mismatches blocking accidental cross-journey actions.
- Stateless notification-response intercepts (`pendingOpportunityLeadId`, `pendingCompletionJobId`) take priority over generic state.

### Issues fixed
None.

### Remaining risks
- Invalid free-text recovery copy is currently the generic provider menu. Codex called this out as a future enhancement; no action.

## Security and access-control review

### Findings
- WhatsApp inbound phone is normalized once at the boundary; provider lookups use `phoneLookupVariants` to handle E.164 / local prefixes.
- Token-scoped routes: `/provider/handoff/:token`, `/provider/lead/:token`, `/provider/job/:token` resolve through the central handoff resolver and return controlled recovery on invalid/expired tokens.
- Image / attachment access enforced server-side via `attachments-authz` route, gated by job-ownership / lead-token / customer-token / admin role.
- Admin-only data is not exposed on provider PWA pages.
- Sensitive logging swept across `whatsapp-bot.ts`, `whatsapp-flows/*`, `provider-whatsapp-*` — no raw customer phone, exact address, GPS, OTP, signed URL, or unlock token is logged. **One residual unmasked phone in `whatsapp-flows/status.ts:50` was found and fixed in this pass** (now uses `maskPhone`).

### Issues fixed
- `lib/whatsapp-flows/status.ts:50` — the per-request status-flow `console.log` was emitting the raw `ctx.phone`. Replaced with `maskPhone(ctx.phone)`.

### Remaining risks
- Token revocation is currently status / expiry based. An explicit `jti` denylist for immediate revocation independent of lead/job status is a future enhancement.

## Notifications and URL review

### Findings
- All provider-bound URLs build through `getPublicAppUrl` (and the variant `getProviderLeadPublicAppUrl`).
- The helper validates that the configured URL is `http(s)://...`, blocks localhost / 127.0.0.1 in production, and returns `''` if the configuration is missing — callers degrade gracefully (links are omitted, not broken).
- A regression test in `provider-credit-copy.test.ts` asserts that production-mode URL config returns no localhost.
- Provider templates (`buildProviderOnboardingIntroMessage`, `buildProviderLeadPreviewMessage`, `buildProviderLeadActionsMessage`, `buildLeadAcceptedCreditLine`, `buildInsufficientCreditsMessage`, `buildProviderCreditSummaryMessage`) all describe the credit rule consistently: **previewing and showing interest is free; 1 credit is deducted only when the customer selects you and you accept the selected job; full details unlock after acceptance**.
- PWA links are described as "open Worker Portal for more details" — explicitly optional.

### Issues fixed
None.

### Remaining risks
None for production safety. Some legacy customer/technician copy outside the provider journey still uses older "app" wording — out of scope per Codex's flag.

## Technical debt review

### Findings
- The `provider-channel-responsibility.ts` matrix had two stale `planned + blocker` entries that no longer matched the implementation. Tests asserted on the stale state too. **Both updated** to reflect that opportunity preview and interest response are `existing` with no blockers.
- `provider-opportunity-whatsapp.ts` parser is intentionally narrow — known and accepted.
- A couple of newer routes (`/provider/handoff`, `/provider/lead`, `/provider/job`) intentionally redirect to `/leads/access/[token]` so that legacy WhatsApp links route through one state-aware resolver. No duplicate routing logic.
- Idempotency keys are consistent across the provider WhatsApp flow (`whatsapp:<providerId>:<leadId>:<action>`).

### Issues fixed
- Channel responsibility matrix and its test (above).
- One unmasked phone log in `whatsapp-flows/status.ts` (above).

### Remaining risks
- Codex's own follow-ups list (broader ETA NLP, in-channel media gallery, sub-service / references structured capture, provider photo classification, ledger reference columns, multi-job context, ProviderApplication email migration, token revocation denylist, legacy customer copy refresh, invalid-command copy enhancement) — all enhancement candidates, none break the contract.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-channel-responsibility.ts` | `opportunity_preview` and `interest_response` flipped from `whatsapp: 'planned'` (with blocker notes) to `whatsapp: 'existing'` to reflect that the inline preview render and the multi-step interest capture are now in place. |
| `field-service/__tests__/lib/provider-channel-responsibility.test.ts` | Replaced the stale "documents known WhatsApp gaps as blockers" assertion with a positive assertion that every core action is `existing` with no blocker. |
| `field-service/lib/whatsapp-flows/status.ts` | `console.log` no longer emits the raw customer phone; uses `maskPhone(ctx.phone)`. |
| `docs/provider-whatsapp-pwa-execution/017-claude-code-review-and-remediation-output.md` | This review/remediation output. |

## Schema / migration changes

None.

## Tests added or updated

`__tests__/lib/provider-channel-responsibility.test.ts` updated to assert the closed state of opportunity preview and interest response. No new test files.

## Commands run

```bash
npx tsc --noEmit
npx prisma validate
npm run lint
npm test -- --run
```

## Test results

| Command | Result |
|---|---|
| `npx tsc --noEmit` | Clean. |
| `npx prisma validate` | Clean (existing Prisma `package.json#prisma` deprecation notice). |
| `npm run lint` | Clean except for the same 3 pre-existing unrelated warnings (`components/admin/crud/form.tsx`, `components/shared/AttachmentThumbnail.tsx`). |
| `npm test -- --run` | **134 files, 1223 passed**, 1 skipped, 4 todo. Zero regressions. |

## Manual verification checklist

- [x] Provider can apply / register entirely in WhatsApp.
- [x] Application status / approval / rejection / more-info reply work in WhatsApp.
- [x] Credit balance is checkable in WhatsApp via `credits` / `balance`.
- [x] Opportunity preview renders inline (category, area, urgency, budget, photo count).
- [x] Provider can respond INTERESTED / NOT_INTERESTED in WhatsApp without credit deduction.
- [x] Multi-step capture (call-out fee → arrival → negotiable → note) saves the response.
- [x] Customer-selected acceptance via WhatsApp deducts exactly 1 credit and assigns the job.
- [x] Provider receives full customer details (name, phone, full address incl. unit + complex, access notes, job reference, preferred time, description, photo count) inline after acceptance.
- [x] Provider can confirm arrival (`14:00` / `arrive HH:MM` / `confirm arrival HH:MM`).
- [x] Provider can mark on the way / arrived / start / complete in WhatsApp.
- [x] Completion captures note + optional photo via WhatsApp.
- [x] Customer is notified on each transition.
- [x] PWA is not required for any of the above.
- [x] Production WhatsApp URLs use the central public-URL helper; localhost is blocked in production.
- [x] No raw customer phone, full address, GPS, OTP, signed URL, or unlock token is logged.

## Risks and follow-ups

These are enhancement candidates Codex called out; none break the WhatsApp-complete contract:

1. Broader natural-language arrival ETA parsing.
2. In-channel WhatsApp media gallery (currently signed link only).
3. Structured capture of sub-services and references.
4. Profile photo vs previous-work photo classification on attachments.
5. Ledger reference columns (`request_id`, `job_id`, `lead_invite_id`) for finance reporting.
6. Multi-job provider context-specific handling (today: fall-back to menu).
7. `ProviderApplication.email` column for application-level email history (currently on Provider record only).
8. Token revocation explicit denylist.
9. Legacy customer / technician copy refresh outside provider scope.
10. More specific invalid-command recovery copy.

## OpenBrain note

Service-provider review against the WhatsApp-first / WhatsApp-complete / PWA-optional contract. Codex's 16-step execution lands the full WhatsApp journey: register → check status → respond to opportunities with rate + ETA → accept customer-selected jobs (1-credit atomic debit) → receive full customer details inline → confirm arrival via text command → mark on-the-way / arrived / start / complete → submit completion note + photo. Every core action has a working WhatsApp path. Credit deduction is correctly gated to the selected-provider final acceptance only. Customer privacy is correctly gated to `lead.status === 'ACCEPTED' && providerUnlock.providerId === lead.providerId`. The only real fixes in this pass were: (1) the channel responsibility matrix had stale blocker notes for `opportunity_preview` and `interest_response` even though both flows are now implemented — flipped to `existing` with no blockers and updated the corresponding test; (2) a residual unmasked phone log in `whatsapp-flows/status.ts` was leaking the customer phone into the per-request log — replaced with `maskPhone`. Validation: 1223 tests pass, tsc clean, prisma valid, lint shows the same 3 pre-existing unrelated warnings. Remaining items are all enhancement candidates already flagged by Codex; none break the provider WhatsApp-complete contract.

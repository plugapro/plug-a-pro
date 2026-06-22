# Provider Flow-to-Codebase Alignment Audit

Date: 2026-04-30  
Scope: Plug A Pro / ServiceMen service-provider WhatsApp, signed-PWA, Worker Portal, matching, and credit journey  
Mode: Source-code audit and gap analysis only. No implementation changes were made.

## 1. Executive Summary

The provider flow is substantially implemented but not fully aligned to the approved service-provider process flow. The strongest areas are role-aware WhatsApp identity resolution, customer/provider phone separation, transactional provider application submission, approval notification idempotency, default availability after approval, matching eligibility gates, signed one-lead and one-job PWA links, ledger-backed lead unlocks, and provider job progress actions.

The main alignment gaps are in the lead notification and response surface, the PWA unlock/accept model, re-offer protection after declines, draft persistence semantics, and consistent provider-facing diagnostics. The production customer request path uses `matching/orchestrator.ts` and `matching/dispatch.ts`, which sends a signed View Lead CTA plus quick `Unlock & Accept` / `Decline` buttons with 1-credit copy. A second assignment path in `matching/service.ts:createOfferForAttempt` sends only a View Lead CTA through `notifyProviderNewJob`, without the quick accept/decline buttons or explicit credit copy. That creates a risk that different matching entry points behave differently.

Top provider-flow risks:

- P1: PWA signed lead page unlocks first and accepts in a second action; the approved flow expects a single unlock-and-accept path from PWA and WhatsApp through the same backend service.
- P1: Some lead notification paths do not include quick `Unlock & Accept` / `Decline` buttons or explicit "uses 1 credit" copy.
- P1: Declined providers are protected within the current dispatch decision, but a later fresh dispatch decision can reselect the same provider because declined lead history is not a hard filter in the orchestrator candidate pass.
- P1: Authenticated Provider Portal lead actions still use the older two-step unlock/accept model and have weaker structured error handling than signed links.
- P1: Provider onboarding progress is preserved in WhatsApp conversation state, but draft application data is not database-backed before final submit.

No P0 provider-flow issue was found in the audited core path. The provider flow is suitable for controlled pilot testing if operations knows the P1 gaps, but broader pilot readiness should wait until the lead response path, decline suppression, and diagnostics are tightened.

## 2. Audit Scope

Approved flow documents reviewed:

- `docs/provider-whatsapp-pwa-journey.mmd`
- `docs/provider-whatsapp-pwa-journey.svg`
- `docs/provider-whatsapp-pwa-journey.png`
- `docs/spec-trace-marketplace-model-2026-04-08.md`
- `docs/audits/2026-04-13-customer-journey-hardening.md`
- `docs/audits/2026-04-20-periodic-platform-assurance-sweep.md`
- `README.md`
- `AGENTS.md`

Primary implementation areas reviewed:

- WhatsApp webhook and inbound idempotency: `field-service/app/api/webhooks/whatsapp/route.ts`
- WhatsApp bot router, stateless lead replies, and media batching: `field-service/lib/whatsapp-bot.ts`
- Identity and role resolution: `field-service/lib/whatsapp-identity.ts`
- Provider onboarding flow: `field-service/lib/whatsapp-flows/registration.ts`
- Provider operations WhatsApp flow: `field-service/lib/whatsapp-flows/provider-journey.ts`
- Provider application helpers: `field-service/lib/provider-applications.ts`
- Approval notification lock: `field-service/lib/provider-application-notifications.ts`
- Provider record sync and default availability: `field-service/lib/provider-record.ts`
- Admin application approval/rejection: `field-service/app/(admin)/admin/applications/page.tsx`
- Matching orchestration and dispatch: `field-service/lib/matching/orchestrator.ts`, `field-service/lib/matching/dispatch.ts`
- Matching service compatibility and assignment accept/decline: `field-service/lib/matching/service.ts`, `field-service/lib/matching-engine.ts`
- Candidate pool and hard filters: `field-service/lib/matching/candidate-pool.ts`, `field-service/lib/matching/filter.ts`
- Credit wallet and ledger: `field-service/lib/provider-wallet.ts`, `field-service/lib/lead-unlocks.ts`
- Provider lead signed tokens and detail scoping: `field-service/lib/provider-lead-access.ts`, `field-service/lib/provider-lead-detail.ts`
- Signed lead page and signed job actions: `field-service/app/leads/access/[token]/page.tsx`
- Signed job handover entry: `field-service/app/provider/jobs/[jobId]/handover/page.tsx`
- Authenticated provider lead page: `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`
- Worker Portal auth: `field-service/app/(auth)/provider-sign-in/page.tsx`, `field-service/app/(auth)/provider-verify/page.tsx`, `field-service/app/api/auth/provider/send-code/route.ts`
- Worker Portal availability and credits: `field-service/app/(provider)/provider/availability/page.tsx`, `field-service/app/(provider)/provider/credits/page.tsx`
- Attachment/media lifecycle: `field-service/lib/whatsapp-media.ts`, `field-service/app/api/attachments/[id]/route.ts`, `field-service/components/shared/AttachmentThumbnail.tsx`
- Route auth boundaries: `field-service/proxy.ts`
- Schema and migrations: `field-service/prisma/schema.prisma`, `field-service/prisma/migrations/20260412090000_provider_application_phone_dedup/migration.sql`, `field-service/prisma/migrations/20260428162000_provider_application_approval_notification_idempotency/migration.sql`

Test areas reviewed:

- `field-service/__tests__/lib/whatsapp-identity.test.ts`
- `field-service/__tests__/lib/whatsapp-menu-routing.test.ts`
- `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts`
- `field-service/__tests__/lib/whatsapp-flows/registration.test.ts`
- `field-service/__tests__/lib/whatsapp-flows/provider-journey.test.ts`
- `field-service/__tests__/lib/provider-applications.test.ts`
- `field-service/__tests__/lib/provider-record.test.ts`
- `field-service/__tests__/lib/provider-application-notifications.test.ts`
- `field-service/__tests__/lib/matching-dispatch.test.ts`
- `field-service/__tests__/lib/matching-orchestrator.test.ts`
- `field-service/__tests__/lib/matching-service.test.ts`
- `field-service/__tests__/lib/matching-filter.test.ts`
- `field-service/__tests__/lib/lead-unlocks.test.ts`
- `field-service/__tests__/lib/provider-wallet.test.ts`
- `field-service/__tests__/lib/provider-lead-access.test.ts`
- `field-service/__tests__/lib/provider-lead-detail.test.ts`
- `field-service/__tests__/lib/accepted-job-actions.test.ts`
- `field-service/__tests__/api/attachments-authz.test.ts`
- `field-service/__tests__/api/auth.test.ts`
- `field-service/__tests__/proxy.test.ts`
- `field-service/__tests__/integration/provider-credit-wallet-lead-monetisation.test.ts`

## 3. Provider Alignment Matrix

| Flow area | Expected behaviour | Implementation status | Files/modules found | Gap/risk | Required action | Priority |
|---|---|---:|---|---|---|---|
| WhatsApp phone normalization | Normalize sender and use lookup variants. | ✅ Aligned | `whatsapp-bot.ts`, `whatsapp-identity.ts`, `provider-journey.ts:providerPhoneVariants` | None material. | Keep variant tests. | P3 |
| Provider identity lookup | Find approved, pending, inactive, and application states. | ✅ Aligned | `whatsapp-identity.ts:resolveWhatsAppIdentity`, `provider-applications.ts` | Role precedence favors provider/application over customer if both exist, and logs conflict. | Keep conflict monitoring. | P2 |
| One role per phone | Phone can only be customer, provider, or unknown in MVP. | ✅ Aligned | `registration.ts:startRegistration`, `job-request.ts`, `Provider.phone @unique`, partial provider application index migration | Customer-to-provider onboarding is blocked. Provider-to-customer request is blocked. | Keep DB constraints and stale-button tests. | P2 |
| Duplicate provider prevention | Prevent duplicate provider records/applications. | ✅ Aligned | `Provider.phone @unique`, `provider_applications_phone_active_unique`, `provider-applications.ts`, `registration.ts:handlePending` | Provider journey logs duplicate provider phone records defensively, but schema should prevent them. | Add health check for duplicate legacy data. | P2 |
| Provider-only menu | Existing providers do not see Find Work and see provider menu. | ✅ Aligned | `job-request.ts:showMainMenu`, `provider-journey.ts:handleProviderMenu`, `whatsapp-menu-routing.test.ts` | None material. | None. | P3 |
| Pending provider menu | Pending providers see Application Status, Update Application, Support. | ✅ Aligned | `job-request.ts:showMainMenu`, `provider-journey.ts:handleApplicationStatus` | Update Application currently routes to edit existing conversation data only when a session exists; true persisted update flow is limited. | Clarify/update pending application edit flow. | P2 |
| Inactive/suspended menu | Inactive providers see Provider Status / Contact Support. | ✅ Aligned | `job-request.ts:showMainMenu`, `registration.ts:startRegistration`, `provider-journey.ts:handleProviderStatus` | Button label sometimes says `Support` rather than `Contact Support`. | Optional copy cleanup. | P3 |
| Stale Find Work | Registered provider/customer cannot restart onboarding from stale button. | ✅ Aligned | `whatsapp-bot.ts`, `registration.ts:startRegistration`, `whatsapp-menu-routing.test.ts` | None material. | None. | P3 |
| Onboarding full name | Capture full name. | ✅ Aligned | `registration.ts:handleCollectName/handleCollectSkills` | None material. | None. | P3 |
| Skills capture | Capture services/skills as numbered multi-select. | ✅ Aligned | `registration.ts:handleCollectSkillsMore`, `SERVICE_CATEGORY_OPTIONS` | None material. | Keep tests for invalid labels/numbers. | P3 |
| City/region/suburb capture | Capture province, city, active region, and suburbs. | ✅ Aligned | `registration.ts:handleCollectExperience/handleCollectCity/handleCollectRegion/handleCollectSuburbSelect` | Non-pilot areas are saved with coming-soon status. | Keep structured-area tests. | P3 |
| Non-pilot areas | Mark as coming soon but allow registration. | ✅ Aligned | `registration.ts`, `service-area-guard.ts` | None material. | None. | P3 |
| Experience capture | Capture experience. | ✅ Aligned | `registration.ts:sendExperiencePrompt/handleCollectAvailability` | None material. | None. | P3 |
| Availability capture | Capture provider availability at onboarding. | ✅ Aligned | `registration.ts:handleCollectEvidence`, `handlePending` | Onboarding availability is a label stored on ProviderApplication, then approval defaults Worker Portal availability to available now. | Confirm product wants default override rather than preserving onboarding schedule. | P2 |
| Evidence upload | Upload proof/example work files. | ✅ Aligned | `registration.ts:handleCollectEvidence`, `whatsapp-media.ts` | Images and PDFs are accepted. | None. | P3 |
| Evidence batch upload | Batch provider evidence with one final confirmation. | ✅ Aligned | `whatsapp-bot.ts` provider evidence batching, `registration.ts:sendEvidenceFileProgress`, `whatsapp-bot-stateless.test.ts` | Partial batch failures lack one consolidated partial-failure summary. | Add batch-level partial result. | P2 |
| Evidence max 5 | Max 5 files and max-reached copy. | ✅ Aligned | `registration.ts:MAX_EVIDENCE_FILES`, tests | Expected 5-file max message is implemented. | None. | P3 |
| Application summary/edit | Show summary and edit selected fields. | ✅ Aligned | `registration.ts:showRegistrationSummary/showEditMenu/handleEditField` | Edit is conversation-state based. | Persist draft if longer-lived edit is required. | P2 |
| Progress preserved after failure | Failed submit keeps progress. | ✅ Aligned | `registration.ts:handlePending` catch returns `reg_pending` with existing data | Conversation expiry can still lose progress. | Consider DB draft persistence. | P2 |
| Draft data persisted | Draft data should be persisted. | ⚠️ Partial | `Conversation.data`, `registration.ts` | Draft is persisted only in WhatsApp conversation state, not as a durable ProviderApplication draft row. | Add draft application table/state or document session-only behavior. | P1 |
| Final submit transaction | Submit application transactionally. | ✅ Aligned | `registration.ts:handlePending` transaction | Notification failures do not roll back DB submit. | None. | P3 |
| Files linked on submit | Evidence attachments linked to application. | ✅ Aligned | `registration.ts:handlePending`, tests | File validation and link count enforced in transaction. | None. | P3 |
| Duplicate submit prevention | Duplicate submit should not create duplicates. | ✅ Aligned | `registration.ts:handlePending`, partial unique index migration | P2002 recovery returns existing pending/approved application. | Keep race test. | P2 |
| Application success message | Send ref and 24h review message. | ⚠️ Partial | `registration.ts:handlePending` | Sends interactive confirmation and also sends template confirmation asynchronously, which can create duplicate acknowledgements. | Decide one primary acknowledgement path or de-dupe templates. | P2 |
| Provider shell after submit | Create pending provider shell. | ✅ Aligned | `registration.ts:handlePending`, `provider-record.ts:syncProviderRecord` | Actual shell is `active=false`, `availableNow=false`, `verified=false`, `APPLICATION_PENDING`; approved diagram said active/available true before approval. Code is safer and aligns with no pending leads. | Update approved diagram wording or keep as intentional implementation difference. | P2 |
| Admin approval | Admin can approve/reject application. | ✅ Aligned | `app/(admin)/admin/applications/page.tsx` | Mutations depend on feature flag via `crudAction`. | Document flag requirements for ops. | P2 |
| Approved provider status | Provider becomes active, verified, status ACTIVE. | ✅ Aligned | `provider-record.ts:syncProviderRecord`, admin approval action | None material. | None. | P3 |
| Approval notification idempotency | Send one approval WhatsApp. | ✅ Aligned | `provider-application-notifications.ts`, migration, tests | Send lock prevents duplicates. | None. | P3 |
| Default availability after approval | Set available now by default. | ✅ Aligned | `provider-record.ts:ensureDefaultProviderAvailability` | `emergencyAvailable` defaults false, `sameDayAvailable` true. | Confirm product default. | P3 |
| Pending providers do not receive leads | Pending/inactive excluded. | ✅ Aligned | `candidate-pool.ts`, `matching/filter.ts`, `matching/service.ts`, `lead-unlocks.ts` | Strong. | None. | P3 |
| WhatsApp pause/go available | Quick availability controls. | ✅ Aligned | `provider-journey.ts` | Availability changes audited. | None. | P3 |
| Detailed Worker Portal availability | Schedule managed in PWA. | ✅ Aligned | `app/(provider)/provider/availability/page.tsx` | Requires provider OTP session. | None. | P3 |
| Paused provider matching | Paused/unavailable providers do not receive new leads. | ✅ Aligned | `matching/filter.ts`, `provider-journey.ts`, availability page | Accepted jobs still visible while paused. | None. | P3 |
| Matching service/category/area | Match active provider, skill, area, schedule, cohort. | ✅ Aligned | `candidate-pool.ts`, `matching/filter.ts`, `matching/orchestrator.ts` | Decline history re-offer gap noted separately. | None. | P3 |
| Declined provider not re-offered | Declined provider should not get same lead again. | ⚠️ Partial | `matching/service.ts:offerNextRankedCandidate`, `matching/orchestrator.ts`, `matching/dispatch.ts` | Within same dispatch decision, rejected attempt is skipped. A later fresh dispatch decision can select the same provider and `lead.upsert` can reset a declined lead to SENT. | Add declined-lead exclusion to candidate/reservation/dispatch. | P1 |
| WhatsApp lead notification | Includes service, area, expiry, credit copy, CTA, buttons. | ⚠️ Partial | `matching/dispatch.ts`, `whatsapp-bot.ts:notifyProviderNewJob`, `matching/service.ts:createOfferForAttempt` | `dispatchMatchLead` is aligned. `createOfferForAttempt` path sends only View Lead CTA and lacks explicit credit/buttons. | Consolidate all offer sends through one dispatch module. | P1 |
| WhatsApp quick accept | Quick accept uses same backend accept/unlock service. | ✅ Aligned | `whatsapp-bot.ts:handleAssignmentHoldAcceptance`, `matching-engine.ts:acceptLead`, `matching/service.ts:acceptAssignmentOffer` | Good for `accept:{holdId}` and legacy `match_accept_`. | None. | P3 |
| Credit unlock cost | Unlock costs exactly 1 credit. | ✅ Aligned | `lead-unlocks.ts:LEAD_UNLOCK_COST_CREDITS`, `provider-wallet.ts` | Promo consumed first, then paid. | None. | P3 |
| Ledger-backed wallet | Ledger entry created for debit. | ✅ Aligned | `provider-wallet.ts:debitCreditsForLeadUnlockInTransaction` | Ledger-first and immutable entries used. | None. | P3 |
| Duplicate accept/unlock | No double-deduct on duplicate accept. | ✅ Aligned | `lead-unlocks.ts`, `LeadUnlock.leadId @unique`, tests | Existing unlock returns `alreadyUnlocked`. | None. | P3 |
| KYC not unlock gate | KYC is not a lead unlock gate in MVP. | ✅ Aligned | `lead-unlocks.ts:assertProviderCanUnlock`, `lead-unlocks.test.ts` | Provider approval gates; `kycStatus` is not checked. | Keep regression. | P3 |
| PWA View Lead no OTP | Signed one-lead page works without OTP. | ✅ Aligned | `provider-lead-access.ts`, `app/leads/access/[token]/page.tsx`, `proxy.ts` | Strong diagnostics for invalid/expired links. | None. | P3 |
| PWA signed lead unlock/accept | Approved flow expects unified unlock-and-accept. | ⚠️ Partial | `app/leads/access/[token]/page.tsx` | Signed page first unlocks with `unlockLeadForProvider`, then accept button calls `acceptLead`. WhatsApp quick accept uses combined service. | Add single PWA "Use 1 Credit & Accept" action or document two-step UX. | P1 |
| PWA loading states | Unlock/accept/decline buttons have pending state. | ✅ Aligned | `LeadActionSubmitButton.tsx` | None. | None. | P3 |
| PWA structured errors | Known signed-link failures avoid generic crash page. | ✅ Aligned | `app/leads/access/[token]/page.tsx`, `provider/jobs/[jobId]/handover/page.tsx` | Authenticated portal page is weaker. | Bring authenticated page up to signed-link standard. | P2 |
| Decline flow | Decline from WhatsApp/PWA without credits and provider-specific. | ✅ Aligned | `matching-engine.ts:declineLead`, `matching/service.ts:rejectAssignmentOffer`, signed and authenticated pages | Re-offer protection gap after new dispatch decision. | Add hard exclusion. | P1 |
| Accepted job handover | Provider receives full customer details and signed View Job link after accept. | ✅ Aligned | `post-match-communications.ts`, `provider-lead-access.ts`, signed page | Customer notification waits until assignment commit. | None. | P3 |
| Customer photos after unlock | Provider can view customer photos after unlock. | ✅ Aligned | `provider-lead-access.ts`, `provider-lead-detail.ts`, `attachments/[id]/route.ts` | Depends on customer photo backfill working; see client audit. | Keep integration test. | P2 |
| Signed job management | No OTP for one-job actions. | ✅ Aligned | `proxy.ts`, `provider/jobs/[jobId]/handover/page.tsx`, `app/leads/access/[token]/page.tsx` | None material. | None. | P3 |
| Job progress updates | Arrival/contacted/on-way/arrived/start/complete actions. | ⚠️ Partial | `accepted-job-actions.ts`, signed page | Actions are implemented and logged, but `customer_contacted` does not send customer WhatsApp notification; approved provider flow says customer-contacted event logged where enabled. | Confirm product expectation. | P2 |
| Worker Portal OTP | Account-wide provider routes require OTP session. | ✅ Aligned | `proxy.ts`, provider auth pages/routes | Signed links remain public token-scoped. | None. | P3 |
| OTP diagnostics | Country defaults ZA, normalization, mapped errors, trace IDs. | ✅ Aligned | `provider-sign-in/page.tsx`, `provider-verify/page.tsx`, `api/auth/provider/send-code/route.ts`, tests | Verify page maps errors to messages and trace ID, but not structured error code. | Optional: add code display on verify errors. | P2 |
| Media lifecycle | WhatsApp media downloaded, stored, attachment records created and linked. | ✅ Aligned | `whatsapp-media.ts`, `registration.ts`, `attachments/[id]/route.ts`, `AttachmentThumbnail.tsx` | Blob upload uses public access while access proxy is intended primary path. | Consider private blobs for new uploads consistently. | P2 |
| Provider logging | Logs for key provider flow events. | ⚠️ Partial | `whatsapp-identity.ts`, `registration.ts`, `provider-journey.ts`, `matching/*`, `lead-unlocks.ts`, auth send-code | Strong in some modules, inconsistent trace propagation in WhatsApp accept/decline and notification paths. | Add cross-flow trace context and message metadata. | P1 |

## 4. Provider Identity and Role Routing Findings

Provider identity routing is well implemented.

`field-service/lib/whatsapp-identity.ts:resolveWhatsAppIdentity` normalizes phone numbers, builds lookup variants, loads customer/provider/provider-application state, derives roles `customer`, `provider`, `provider_pending`, `provider_inactive`, or `unknown`, and logs trace ID plus role metadata.

`field-service/lib/whatsapp-flows/registration.ts:startRegistration` blocks customer numbers from provider onboarding. It also prevents known providers and active applications from restarting onboarding. `field-service/lib/whatsapp-flows/job-request.ts:handleCollectNameStep` and `field-service/lib/job-requests/create-job-request.ts:createJobRequest` block provider numbers from entering the customer request flow.

Duplicate prevention exists at several layers:

- `Provider.phone` is unique in `field-service/prisma/schema.prisma`.
- `provider_applications_phone_active_unique` prevents duplicate non-rejected applications for the same phone.
- `registration.ts:handlePending` checks existing active applications inside the transaction.
- P2002 duplicate races are recovered by looking up the latest active application and returning its ref.

Stale action handling is covered in `field-service/lib/whatsapp-bot.ts`. Stateless provider lead buttons can be handled after session expiry, while stale `Find Work` for known customers/providers is blocked by identity resolution and registration entry checks.

Gap: `provider-journey.ts:findProviderForWhatsApp` logs duplicate provider phone records if they exist. The schema should prevent new duplicates, but a data-health check would catch imported legacy duplicates before they create inconsistent status routing.

## 5. Provider Onboarding Findings

The WhatsApp onboarding journey is largely aligned.

Implemented capture steps:

- Unknown user chooses `Find Work` or sends registration trigger: `whatsapp-bot.ts`, `registration.ts`
- Full name: `handleCollectName`, `handleCollectSkills`
- Services/skills: `handleCollectSkillsMore`
- Province/city/region: `promptArea`, `handleCollectExperience`, `handleCollectCity`, `handleCollectRegion`
- Active pilot region/suburb selection: `handleCollectSuburbSelect`
- Coming-soon areas: non-Gauteng and inactive regions show soft pilot notices
- Experience: `sendExperiencePrompt`
- Availability: `handleCollectAvailability`, `handleCollectEvidence`
- Evidence note/files: `handleCollectEvidence`
- Summary/edit: `showRegistrationSummary`, `showEditMenu`, `handleEditField`
- Submit: `handlePending`

Provider evidence upload is aligned:

- Images and PDFs are supported via `whatsapp-media.ts`.
- Maximum is 5 files via `MAX_EVIDENCE_FILES`.
- Provider evidence media is batched in `whatsapp-bot.ts`.
- Progress confirmations are suppressed until the final message in a batch.
- The expected max message is implemented: `✅ *5 files received.* Maximum reached. Continue to the next step?`
- Tests cover batching, suppression, max count, duplicate media, and attachment backfill.

Gaps:

- Draft persistence is session-based. Data is stored in `Conversation.data`, not in a durable provider application draft. If the conversation expires or is overwritten before submit, progress can be lost.
- Partial batch upload failures are not summarized as one batch result. Individual failures send a generic "couldn't upload that file" message.
- The application success path sends an interactive confirmation and then also triggers the `technician_application_received` template asynchronously. That can produce duplicate submission acknowledgements.

## 6. Provider Application Review and Approval Findings

Application submit is strong. `registration.ts:handlePending` validates name, skills, areas, availability, and evidence attachments; creates/syncs a provider shell; creates a `PENDING` ProviderApplication; links evidence attachments; writes an audit log; then sends confirmation/admin notifications after commit.

Important implementation difference: the approved diagram said the provider shell is `active true`, `availableNow true`, `verified false`. Actual `provider-record.ts:syncProviderRecord` calculates `leadEligible = input.active && input.verified`; for a pending application, it stores `active=false`, `availableNow=false`, `verified=false`, and `status=APPLICATION_PENDING`. This is safer and aligns with the rule that pending providers must not receive leads, but the diagram should be updated to match implementation.

Admin approval is implemented in `field-service/app/(admin)/admin/applications/page.tsx:approveApplication`:

- Requires admin through `requireAdmin`/`crudAction`.
- Blocks duplicate active applications for the same phone.
- Creates or updates Supabase provider user metadata.
- Calls `syncProviderRecord` with `active=true`, `availableNow=true`, `verified=true`.
- Sets ProviderApplication to `APPROVED`.
- Awards mobile-verified promo credits through immutable wallet ledger logic.
- Releases onboarding ops queue item.
- Sends approval WhatsApp through `notifyTechnicianApplicationResult`.

Approval notification idempotency is implemented in `provider-application-notifications.ts:notifyProviderApplicationApprovedOnce` using `approvalWhatsappSendStartedAt` and `approvalWhatsappSentAt`. Tests cover sent, already sent, in-progress, and failure lock release.

Rejection is implemented and deactivates the provider shell when linked. Rejection notification uses the template path and failures are swallowed.

## 7. Provider Operations Menu Findings

Approved provider menu is aligned in both `job-request.ts:showMainMenu` and `provider-journey.ts:handleProviderMenu`:

- My Jobs
- Available Jobs
- Check Status
- Pause Leads / Go Available
- Worker Portal
- Support

Pending provider menu is aligned:

- Application Status
- Update Application
- Support

Inactive/suspended provider menu is aligned:

- Provider Status
- Support / Contact Support

My Jobs is implemented in `provider-journey.ts:handleJobList`. It includes traditional `Job` rows and accepted-lead work that has not become a booking yet. This is important because the credit unlock flow can produce accepted leads before full booking artifacts exist.

Available Jobs is partially aligned. `provider-journey.ts:handleAvailableLeads` lists `SENT`/`VIEWED` leads and uses row IDs shaped like `match_accept_{leadId}`. Selecting a row can immediately attempt acceptance/unlock through the stateless handler. The list copy says "Tap a lead to accept it" but does not show explicit 1-credit copy or a View Lead option in that list. This is weaker than the approved flow.

## 8. Provider Availability Findings

Availability is well represented:

- Approval defaults provider to available now through `provider-record.ts:ensureDefaultProviderAvailability`.
- WhatsApp quick pause/go-available is implemented in `provider-journey.ts`.
- PWA detailed schedule and pause settings are implemented in `app/(provider)/provider/availability/page.tsx`.
- Availability changes are audit-logged with before/after data.
- Matching filters exclude `availableNow=false`, `PAUSED`, `OFFLINE`, temporary pauses, same-day unavailable, emergency unavailable, and stale live heartbeat.
- Accepted active jobs remain visible in My Jobs while the provider is paused.

Open question: onboarding captures coarse availability (`Weekdays only`, `Mon-Sat`, `Any day`) on the ProviderApplication, but approval defaults the Worker Portal schedule to always available. If onboarding availability should seed the actual schedule, that is not currently implemented.

## 9. Lead Matching Findings

The current customer request path uses `create-job-request.ts` -> `matching/orchestrator.ts` -> `matching/dispatch.ts`.

Aligned eligibility rules:

- Provider must be active, verified, status `ACTIVE`.
- Provider must match the request test/live cohort.
- Provider must have matching skills/category.
- Provider must cover the service area via structured suburb/region, radius, or legacy fallback.
- Availability, schedule, live heartbeat, same-day, emergency, daily max, equipment, certification, and vehicle constraints are checked.
- Active holds prevent duplicate concurrent dispatch.
- Expired job requests are skipped before dispatch.
- Lead expiry is enforced during accept.
- Lead accepted by another provider returns taken/closed.

Pending and inactive providers are excluded by `candidate-pool.ts`, `matching/filter.ts`, `matching/service.ts`, and `lead-unlocks.ts`.

Gap: decline suppression is not complete across fresh dispatch decisions. `matching/service.ts:offerNextRankedCandidate` skips a rejected attempt inside the same dispatch decision, but `matching/orchestrator.ts` does not hard-filter providers with a prior `Lead.status = DECLINED` for the same job request. `matching/dispatch.ts` uses `lead.upsert` on `(jobRequestId, providerId)` and can update a declined lead back to `SENT` if the same provider is selected in a later dispatch decision. This conflicts with "declined provider does not get re-offered same lead."

## 10. Credit Unlock and Acceptance Findings

Credit unlock and acceptance are strong in the backend:

- `LEAD_UNLOCK_COST_CREDITS = 1`.
- `lead-unlocks.ts:assertProviderCanUnlock` gates on provider active/verified/status, not KYC status.
- `lead-unlocks.test.ts` explicitly verifies approved providers can unlock without KYC approval.
- `provider-wallet.ts:debitCreditsForLeadUnlockInTransaction` checks wallet balance server-side and consumes promo credits before paid credits.
- Every credit movement creates immutable `WalletLedgerEntry` records.
- `LeadUnlock.leadId @unique` plus create-before-debit prevents double-deduct on duplicate unlock.
- `acceptAssignmentOffer` uses `unlockLeadForProviderInTransaction` inside the same transaction that accepts the lead and creates the match.
- Customer notification is sent after the accept transaction commits via `matching-engine.ts:acceptLead`.

WhatsApp quick accept is aligned. `whatsapp-bot.ts:handleAssignmentHoldAcceptance` calls `matching-engine.ts:acceptLead`, which delegates to `matching/service.ts:acceptAssignmentOffer`.

PWA signed link is partially aligned. `app/leads/access/[token]/page.tsx` has two separate actions:

- `unlockLeadWithToken` calls `unlockLeadForProvider`.
- After unlock, `acceptLeadWithToken` calls `matching-engine.acceptLead`.

This is safe and ledger-backed, but it is not the approved single "Unlock & Accept" PWA action. It also means PWA users can spend 1 credit to inspect full details and then not accept. That may be intentional product behaviour, but it differs from the approved flow language.

## 11. PWA View Lead and Decline Findings

Signed PWA View Lead is aligned:

- Token is HMAC-signed and scoped to lead/provider/job request.
- `/leads/access/[token]` is public in `proxy.ts`.
- Invalid/expired links show structured diagnostics with error code and trace ID.
- Before unlock, full address, customer contact, and photos are hidden.
- After unlock, customer name, phone, full address, description, and photos are shown.
- The unlock button has a loading state via `LeadActionSubmitButton`.
- Unlock success shows 1 credit used and balance remaining.
- Known unlock failures show structured banners.
- Decline from signed PWA does not require credits and redirects to a clear success state.

Authenticated Provider Portal lead page is weaker:

- `app/(provider)/provider/leads/[leadId]/page.tsx` also uses a two-step unlock/accept model.
- Some failures redirect with terse query flags such as `unlockError=unavailable` instead of the richer signed-link error envelope.
- Decline errors have trace ID/code, but unlock and accept errors are less detailed than the signed link page.

KYC warning is not visible in the signed lead page. The current code does not gate unlock on `kycStatus`.

## 12. Accepted Job and PWA Job Management Findings

Accepted job handover is aligned:

- `post-match-communications.ts` sends provider acceptance confirmation with credit usage, customer name, phone, address, preferred availability, ref, and View Job CTA.
- Customer is notified with provider name/phone and signed provider handover link after assignment commit.
- `provider-lead-access.ts:getProviderSignedJobHandoverUrl` creates accepted-job scoped links.
- `app/provider/jobs/[jobId]/handover/page.tsx` validates token/scope/job and redirects to signed lead/job page.
- `app/leads/access/[token]/page.tsx` renders accepted job management actions without OTP.

Signed job management actions:

- Update planned arrival time: `saveAcceptedLeadArrival`
- Mark customer contacted: `markAcceptedLeadAction`
- Mark on the way
- Mark arrived
- Start job
- Complete job

Actions are logged and duplicate timestamps prevent repeated customer spam. Arrival duplicate saves do not resend. Job update notifications are sent for arrival planned, on the way, arrived, started, and completed.

Gap: `customer_contacted` updates `customerContactedAt` and audit log, but does not send a customer WhatsApp notification. The approved provider diagram says "Customer contacted event logged where enabled", while the user validation list says customer receives relevant WhatsApp updates. This should be clarified.

Gap: the provider WhatsApp acceptance message confirms the credit used, but does not show balance remaining. The signed PWA unlock success state does show balance remaining.

## 13. Worker Portal OTP Boundary Findings

Auth boundary is aligned:

- Signed one-lead path `/leads/access` is public.
- Signed one-job routes `/provider/jobs/:id/handover`, `/arrival`, and `/quick-update` are public token-scoped routes.
- Account-wide `/provider` and `/api/provider` routes require provider session via `proxy.ts`.
- Worker Portal pages for dashboard/jobs/profile/availability/credits/history/settings sit behind provider auth.

OTP sign-in is strong:

- `provider-sign-in/page.tsx` defaults country to South Africa and disables country switching.
- Helper copy uses fake/example numbers.
- Client and server use phone normalization through `phone-normalization`.
- `api/auth/provider/send-code/route.ts` blocks not found, pending, inactive, and unsupported phones before calling OTP.
- Send-code errors include friendly reason, code, step, trace ID, time, masked phone, country, and provider ID where relevant.
- Server logs include the same trace ID and OTP provider state.
- `UNKNOWN_AUTH_ERROR` is used only when the OTP provider was not called or the failure could not be classified.

Gap: `provider-verify/page.tsx` maps known OTP verification errors to friendly messages and shows a trace ID, but it does not show a structured error code alongside the trace ID.

## 14. Provider Media Attachment Findings

Provider onboarding media lifecycle is aligned:

- WhatsApp media metadata is fetched.
- Media binary is downloaded from Meta.
- File type and size are validated.
- Blob is uploaded.
- Attachment record is created.
- Attachment ID is stored in conversation state.
- Submit validates attachment records and links them to ProviderApplication transactionally.
- Duplicate media IDs are deduped by `uploadedBy = system:whatsapp:{mediaId}` plus conversation `evidenceMediaIds`.

Customer photos visible to provider after unlock:

- `provider-lead-access.ts` only includes attachments after a lead unlock exists.
- `provider-lead-detail.ts` only fetches full customer details and attachments after unlock.
- `attachments/[id]/route.ts` allows lead-token attachment access only if the lead token resolves to an unlocked lead for the same job request.
- `AttachmentThumbnail.tsx` shows useful client diagnostics for broken thumbnails.

Risk: `whatsapp-media.ts` uploads to Vercel Blob with `access: 'public'`, while comments say access should go through the attachment proxy. The app uses the proxy for display, but public blob URLs remain in the database. Consider private blobs for new uploads where supported.

## 15. Provider Error Handling Review

Strong provider error handling:

- Provider application submit errors have explicit codes and trace IDs.
- Application submit failure preserves progress and offers Try Again/Edit/Support.
- PWA signed lead unlock/accept/decline known failures render structured errors with trace IDs.
- Signed job handover invalid/expired links render structured errors with trace IDs.
- Worker Portal send-code errors are well classified and logged.
- Attachment API returns structured JSON errors for storage failures.
- Arrival scheduling errors return reason and trace ID.

Weak provider error handling:

- WhatsApp quick accept/decline failures are friendly but mostly lack trace IDs/error codes in the user-facing message.
- `provider-journey.ts:handleAvailableLeads` row accept path can trigger credit deduction without first showing explicit credit copy in that menu.
- `notifyProviderNewJob` failures are logged by `matching/service.ts`, but the provider may receive only fallback template or no quick-action buttons depending on path.
- Authenticated Provider Portal lead page has weaker error query states than the signed lead page.
- Approval rejection notification failures are swallowed without structured retry metadata.
- Provider application template acknowledgement can duplicate the interactive acknowledgement and has no de-dupe lock.

Failure point status:

| Failure point | Current behaviour | Gap |
|---|---|---|
| Application submit failure | Structured WhatsApp message with error code and trace ID; progress saved. | Good. |
| Media upload failure | Generic retry/skip message; server logs details. | No batch partial summary or trace ID to provider. |
| Approval failure | Admin action logs; Supabase user creation failure is logged but approval can continue with null userId. | Needs ops decision on whether Supabase failure should block approval. |
| Lead unlock failure | Signed PWA structured; WhatsApp insufficient credits specific. | WhatsApp non-credit failures lack trace ID/code. |
| Insufficient credits | WhatsApp and PWA show top-up guidance. | Good. |
| Lead expired/taken | WhatsApp and signed PWA show clear messages. | WhatsApp lacks trace ID/code. |
| PWA decline failure | Signed PWA and authenticated portal log and show trace/code. | Good for signed path. |
| Signed link expired | Structured diagnostics and fresh link option. | Good. |
| OTP send-code failure | Structured diagnostics and logs. | Good. |
| OTP verify failure | Friendly copy and trace ID. | No error code displayed. |
| Arrival update failure | Returns `CUSTOMER_NOTIFICATION_FAILED` with trace ID for arrival. | No durable retry/outbox. |

## 16. Provider Logging and Troubleshooting Review

Strong logging/audit areas:

- WhatsApp inbound WAMID dedupe and failure reason logging.
- Identity resolution logs trace ID, phone, role, IDs, and conflict.
- Provider application submit logs trace ID, phone, counts, error code, application/provider ID.
- Provider application submit writes an audit log.
- Approval notification lock logs skipped reasons.
- Availability changes write audit logs.
- Matching emits dispatch events and records dispatch decisions.
- Lead unlock logs attempts and commits with credit transaction IDs.
- Accept writes audit logs and logs accept attempts.
- Signed job link access writes audit logs and console logs.
- Worker Portal send-code logs trace ID, phone, provider lookup result, OTP provider state, and errors.

Logging gaps:

- No single trace ID is carried from WhatsApp lead dispatch through provider accept, credit debit, match assignment, provider/customer notifications, and signed link access.
- Some WhatsApp sends omit `OutboundInteractiveContext`, reducing `MessageEvent` audit richness.
- WhatsApp quick accept/decline user-facing failures do not include trace IDs.
- Approval rejection notification failures are swallowed.
- Provider media upload logs include media ID and attachment ID but not application ID before submit; this is expected but makes abandoned sessions harder to trace.
- Notification failures are not consistently durable/retryable.

Screenshot-based troubleshooting is workable for signed PWA and OTP flows because trace IDs are visible. It is weaker for WhatsApp quick lead actions and provider evidence upload failures.

## 17. Provider Test Coverage Review

Existing coverage:

- Identity roles and provider pending/inactive states: `whatsapp-identity.test.ts`
- Provider/customer menu routing and stale Find Work blocking: `whatsapp-menu-routing.test.ts`
- Provider onboarding submit, evidence upload, attachment linking, duplicate submit handling: `whatsapp-flows/registration.test.ts`
- Provider evidence batching: `whatsapp-bot-stateless.test.ts`
- Provider operations menu, My Jobs, accepted lead rows, stale provider states: `whatsapp-flows/provider-journey.test.ts`
- Provider application lookup/dedup helpers: `provider-applications.test.ts`
- Provider record sync and default availability: `provider-record.test.ts`
- Approval notification idempotency: `provider-application-notifications.test.ts`
- Dispatch copy/buttons and duplicate sends: `matching-dispatch.test.ts`
- Matching filters/schedule/area/service: `matching-filter.test.ts`, `matching-service-area.test.ts`, `matching-scheduling.test.ts`
- Assignment accept/credits/no-KYC/insufficient credits: `matching-service.test.ts`, `lead-unlocks.test.ts`
- Wallet ledger, top-ups, promo awards, refund/disputes: wallet and credit tests
- Signed lead token scoping: `provider-lead-access.test.ts`
- Provider lead detail hides/reveals sensitive details after unlock: `provider-lead-detail.test.ts`
- Accepted job actions and arrival validation: `accepted-job-actions.test.ts`
- Attachment auth by lead token/ticket token/session: `attachments-authz.test.ts`
- Worker Portal OTP send-code: `api/auth.test.ts`
- Route public/private boundaries: `proxy.test.ts`
- Integration monetisation flow: `integration/provider-credit-wallet-lead-monetisation.test.ts`

Missing or insufficient tests:

Unit tests:

- `matching/orchestrator.ts` excludes providers who previously declined the same job request.
- `matching/service.ts:createOfferForAttempt` and `matching/dispatch.ts` have identical provider notification semantics.
- `provider-journey.ts:handleAvailableLeads` does not accept/unlock without explicit credit copy or confirmation.
- Provider application acknowledgement de-dupes interactive and template confirmations.
- OTP verify page displays structured code in addition to trace ID.

Integration tests:

- Unknown provider full WhatsApp onboarding with 5-file batch, submit, admin approve, default availability, lead receipt.
- Approved provider receives actual orchestrator lead with View Lead CTA and quick action buttons.
- Provider accept through WhatsApp and signed PWA both produce identical ledger/assignment/customer notification effects.
- Declined provider is not re-offered after cron/rematch/fresh dispatch decision.

WhatsApp webhook tests:

- `accept:{holdId}` duplicate webhook does not double charge.
- `decline:{holdId}` and `hd_*` decline reason duplicate webhook remains idempotent.
- Provider evidence partial batch failure shows one clear partial message.
- Stale `provider_available_jobs` / `match_accept_` replies enforce active provider and credit gates.

PWA signed-link tests:

- Signed lead page can perform a single unlock-and-accept action if product adopts it.
- Signed lead known failures never render generic error page.
- Signed accepted job actions return trace IDs for all failures, not only arrival.

Ledger/transaction tests:

- PWA two-step unlock then later accept intentionally charges at unlock time and does not refund if not accepted, if that product model remains.
- Concurrent PWA accept after prior PWA unlock does not create duplicate ledger entries.
- WhatsApp quick accept and PWA accept share an idempotency key strategy.

Idempotency tests:

- Approval template + interactive submit acknowledgement does not duplicate customer-visible application submitted confirmation.
- Provider approval duplicate action does not notify twice.
- Decline duplicate does not re-open/re-offer the same provider.

End-to-end tests:

- WhatsApp Find Work -> onboarding -> admin approval -> lead notification -> WhatsApp Unlock & Accept -> customer handover -> signed job updates.
- WhatsApp View Lead -> signed PWA -> unlock/accept -> provider handover -> job completion.
- Worker Portal OTP -> availability pause -> matching excludes -> My Jobs still shows accepted active work.

## 18. Provider Remediation Backlog

### P1: Unify PWA Unlock and Accept

Problem: Signed PWA View Lead uses a two-step unlock then accept flow, while approved flow expects PWA and WhatsApp to use the same backend unlock-and-accept service.

Files/modules likely involved:

- `field-service/app/leads/access/[token]/page.tsx`
- `field-service/app/(provider)/provider/leads/[leadId]/page.tsx`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/matching/service.ts`
- `field-service/lib/lead-unlocks.ts`

Expected fix: Add a signed PWA action `Use 1 Credit & Accept` that calls `matching-engine.acceptLead` directly. Keep inspect-only unlock only if product explicitly wants paid inspection without acceptance.

Acceptance criteria:

- WhatsApp quick accept and signed PWA accept both call `acceptLead`.
- One credit is deducted exactly once.
- Match assignment and customer notification happen only after commit.
- Duplicate clicks do not double-deduct.

Suggested tests: PWA accept success, insufficient credits, already unlocked, concurrent double click, customer notification after commit.

### P1: Consolidate Lead Notification Paths

Problem: `matching/dispatch.ts` sends approved CTA plus quick buttons and credit copy, but `matching/service.ts:createOfferForAttempt` sends only View Lead CTA via `notifyProviderNewJob`.

Files/modules likely involved:

- `field-service/lib/matching/dispatch.ts`
- `field-service/lib/matching/service.ts`
- `field-service/lib/whatsapp-bot.ts`
- `field-service/__tests__/lib/matching-dispatch.test.ts`
- `field-service/__tests__/lib/matching-service.test.ts`

Expected fix: Route every provider offer through one notification module that always sends signed View Lead and quick `Unlock & Accept` / `Decline` actions with 1-credit copy.

Acceptance criteria:

- Every new lead notification includes service, area, expiry, signed View Lead, 1-credit copy, and decline.
- Duplicate sends are suppressed by message event metadata.
- Fallback template behaviour is documented and does not silently omit required quick actions when WhatsApp supports them.

Suggested tests: create offer through orchestrator and service compatibility path; assert identical notification semantics.

### P1: Prevent Re-Offering Declined Providers

Problem: A provider who declines can be skipped in the same dispatch decision, but a fresh dispatch decision may reselect the same provider and `lead.upsert` can reset `DECLINED` to `SENT`.

Files/modules likely involved:

- `field-service/lib/matching/orchestrator.ts`
- `field-service/lib/matching/filter.ts`
- `field-service/lib/matching/dispatch.ts`
- `field-service/lib/matching/service.ts`

Expected fix: Add prior-decline exclusion for the same `jobRequestId/providerId` before reservation/dispatch. Do not update declined leads back to SENT.

Acceptance criteria:

- Declined provider never receives the same customer request again.
- Decline remains provider-specific and does not cancel the whole request.
- Next eligible provider is offered where available.

Suggested tests: decline then cron/rematch; dispatch upsert preserves declined state; no WhatsApp resend to declined provider.

### P1: Persist Provider Application Drafts or Document Session-Only Drafts

Problem: Onboarding progress is stored in WhatsApp conversation state, not as a durable provider application draft.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/registration.ts`
- `field-service/prisma/schema.prisma`
- `field-service/lib/provider-applications.ts`

Expected fix: Either create a draft application record during onboarding, or update approved architecture to state that drafts are conversation-session only.

Acceptance criteria:

- If durable drafts are required, progress survives conversation expiry/restart.
- Submit uses the draft and remains idempotent.
- Abandoned drafts have cleanup policy.

Suggested tests: interrupted onboarding resumes; expired session recovery; duplicate draft submit.

### P1: Add Provider Trace Context to WhatsApp Lead Actions

Problem: WhatsApp quick accept/decline failure messages are friendly but not consistently traceable.

Files/modules likely involved:

- `field-service/lib/whatsapp-bot.ts`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/matching/service.ts`
- `field-service/lib/message-events.ts`

Expected fix: Generate or propagate a trace ID for stateless lead accept/decline, include safe error codes/trace IDs in provider-facing failures, and attach metadata to outbound messages.

Acceptance criteria:

- Provider screenshot for accept/decline failure includes error code and trace ID.
- Backend logs include the same trace ID.
- MessageEvent metadata includes lead ID, provider ID, hold ID, action, result.

Suggested tests: insufficient credits, expired lead, taken lead, provider not approved, unknown error.

### P2: De-Dupe Application Submitted Acknowledgements

Problem: Submit path can send both interactive acknowledgement and template acknowledgement.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/registration.ts`
- `field-service/lib/message-events.ts`
- WhatsApp template send path

Expected fix: Use one primary acknowledgement per application, or record/send the template only when interactive confirmation fails or the conversation window requires it.

Acceptance criteria:

- Provider receives one clear application submitted confirmation per application.
- Confirmation includes application ref.
- Failures are logged and retryable without duplicate sends.

Suggested tests: interactive success, interactive fail/template fallback, duplicate submit.

### P2: Align Available Jobs WhatsApp List With Credit Gate

Problem: Available Jobs list rows can immediately attempt accept/unlock without first displaying credit copy in that interaction.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/provider-journey.ts`
- `field-service/lib/whatsapp-bot.ts`

Expected fix: Make Available Jobs row open a lead preview or confirmation prompt that explicitly says 1 credit will be used before accept.

Acceptance criteria:

- Available Jobs does not silently trigger paid accept.
- Provider sees "uses 1 credit" before the paid action.
- Decline and View Lead are available.

Suggested tests: provider available jobs row path, insufficient credits, decline from list.

### P2: Add Structured OTP Verify Error Codes

Problem: OTP verify page shows friendly error and trace ID but not a stable error code.

Files/modules likely involved:

- `field-service/app/(auth)/provider-verify/page.tsx`
- `field-service/lib/auth-client-errors.ts`

Expected fix: Return/display a code such as `OTP_EXPIRED`, `OTP_INVALID`, `RATE_LIMITED`, or `OTP_VERIFY_FAILED`.

Acceptance criteria:

- Verify errors show message, code, trace ID.
- Known Supabase messages map to stable codes.

Suggested tests: expired, invalid, rate-limited, unknown verify errors.

### P2: Make Provider Media Batch Partial Failures Clear

Problem: Multi-file evidence batch can produce generic per-file failures instead of one clear partial result.

Files/modules likely involved:

- `field-service/lib/whatsapp-bot.ts`
- `field-service/lib/whatsapp-flows/registration.ts`

Expected fix: Track batch successes/failures and send one final message: files received, failed count, remaining slots, and next action.

Acceptance criteria:

- A 5-file batch sends one max-reached message.
- A partial batch sends one partial-upload summary.
- Counts reflect stored attachments.

Suggested tests: 5 success batch, 3 success/2 fail batch, duplicate media in batch.

### P2: Standardize Provider Notification Retry

Problem: Critical provider and customer notifications are logged but not uniformly retryable.

Files/modules likely involved:

- `field-service/lib/whatsapp-interactive.ts`
- `field-service/lib/message-events.ts`
- `field-service/lib/provider-application-notifications.ts`
- `field-service/lib/post-match-communications.ts`
- `field-service/lib/accepted-job-actions.ts`

Expected fix: Use a durable outbox or retryable message-event state for critical provider lifecycle messages.

Acceptance criteria:

- Approval, lead offer, accepted job handover, and critical job updates can be retried safely.
- Duplicate retry does not duplicate delivered messages.

Suggested tests: send failure -> retry -> success, duplicate retry suppressed.

## 19. Open Questions

- Should PWA signed lead page allow paid "unlock only" inspection without accepting, or must every credit spend also accept/assign the job?
- Should onboarding availability seed actual Worker Portal schedule after approval, or should all approved providers default to available now?
- Should pending provider shells be `active=false` as implemented, or should the approved diagram be updated from `active true` to `lead-ineligible pending shell`?
- Should Available Jobs list rows open a preview instead of immediate accept?
- Is `customer_contacted` provider-only/internal, or should it send customer WhatsApp?
- Should application acknowledgement use interactive message, template message, or exactly one best-effort de-duped pair?
- Should Supabase user creation failure block admin approval, or is an approved provider without `userId` acceptable until OTP sign-in/backfill?
- Should all new attachment blobs be private instead of public with proxy-only display?
- Should fresh dispatch decisions exclude providers who declined the same job forever, or only for the current customer request lifetime?

## 20. Final Recommendation

The provider flow is not fully ready for broad production pilot, but no P0 blocker was found. The core monetised flow is technically present: approved providers can receive signed leads, unlock with exactly 1 ledger-backed credit, accept without KYC gating, release customer details after successful unlock/assignment, and manage accepted jobs through signed links.

Before broader pilot, fix these first:

1. Unify signed PWA accept with the same backend unlock-and-accept path used by WhatsApp.
2. Consolidate provider lead notification paths so every offer includes credit copy, signed View Lead, quick accept, and decline.
3. Prevent declined providers from being re-offered the same customer request across fresh dispatch decisions.
4. Add provider-facing trace IDs/error codes to WhatsApp quick accept/decline failures.
5. Decide whether onboarding drafts must be durable or officially session-only.

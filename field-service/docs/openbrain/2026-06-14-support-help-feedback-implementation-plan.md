# Plug A Pro support/help/feedback implementation plan

Date: 2026-06-14
Status: implementation-ready plan
Related assessment: `field-service/docs/openbrain/2026-06-14-support-help-feedback-solution-assessment.md`

## 1. Delivery goal

Build a practical MVP support capability that lets customers and providers get help from the PWA or WhatsApp, lets admins triage and respond from one inbox, and preserves existing job dispute, case, wallet, payment, verification, and privacy boundaries.

The MVP must not replace existing working disputes/cases on day one. It should introduce a user-facing support ticket layer that can link to existing operational records and escalate into existing dispute/case workflows when needed.

## 2. Implementation principles

- Keep the implementation explicit and service-based, matching existing `lib/*` patterns.
- Do not replatform or redesign `admin.plugapro.co.za`. Add support as a module inside the existing admin app, plus targeted cross-links to existing admin workflows.
- Treat WhatsApp as a first-class entry point, but keep detailed context behind secure PWA links.
- Do not leak cross-role data. Customers only see their tickets; providers only see tickets tied to their provider account; admins see all through admin-gated routes.
- Preserve ledger-first wallet behavior. Support tickets can request a credit/payment review, but wallet changes still go through wallet/ledger services.
- Keep admin-only notes separate from user-visible responses.
- Reuse existing admin `crudAction`, auth guards, audit logging, attachment proxy, WhatsApp send helpers, and route patterns.
- Ship FAQ/rule-based self-help before AI. AI user-facing answers are allowed only after approved Plug A Pro knowledge, tool access boundaries, escalation rules, and ticket handoff are in place.

## 3. Current integration points to use

### Auth and role gates

- Use `getSession`, `requireAdmin`, `requireProvider`, `requireRole`, and `requireProviderApi` from `field-service/lib/auth.ts`.
- Use `resolveCustomerForSession` from `field-service/lib/customer-session.ts` when resolving customer-owned tickets.
- Mirror the ownership approach used by `getCustomerBookingDetailForViewer` and `getProviderJobDetailForViewer` in `field-service/lib/booking-detail-loaders.ts`.

### Existing support-adjacent workflows

- Customer job issues currently create `Dispute` records from `field-service/app/(customer)/bookings/[id]/page.tsx`.
- Provider job issues currently create `Dispute` records from `field-service/app/(provider)/provider/jobs/[jobId]/page.tsx`.
- Admin disputes are triaged in `field-service/app/(admin)/admin/disputes/page.tsx` and mutated through `field-service/app/(admin)/admin/disputes/actions.ts`.
- Internal operational cases are managed by `field-service/lib/cases.ts` and displayed through admin case components.

### WhatsApp integration

- Inbound WhatsApp events enter through `field-service/app/api/webhooks/whatsapp/route.ts`.
- Bot routing lives in `field-service/lib/whatsapp-bot.ts`.
- The existing help/FAQ flow is `field-service/lib/whatsapp-flows/help.ts`.
- Message delivery/audit records use `MessageEvent` and `InboundWhatsAppMessage` in `field-service/prisma/schema.prisma`.

### Admin navigation and UI conventions

- Add the support inbox to `field-service/lib/admin-nav-routes.ts`.
- Use the same server-first admin page approach as disputes/bookings/payments.
- Use existing shared components such as `Badge`, `EmptyState`, admin form buttons, and admin case/timeline patterns where useful.
- Existing admin pages remain authoritative for their domains. `/admin/support` should intake, communicate, triage, and link/escalate; disputes, payments, wallets, verification, dispatch, bookings, and cases keep their current source-of-truth workflows.

## 4. Scope by release phase

## Phase 0 — Foundation and migration design

### Deliverables

1. Add support enums and models to `field-service/prisma/schema.prisma`.
2. Generate a Prisma migration.
3. Add seed/static category and FAQ registries.
4. Add typed support service modules under `field-service/lib`.
5. Add unit tests for ownership, priority, and status transitions.

### Schema additions

Add enums:

- `SupportRequesterRole`: `CUSTOMER`, `PROVIDER`, `ADMIN`, `UNKNOWN`.
- `SupportTicketStatus`: `NEW`, `IN_REVIEW`, `WAITING_FOR_USER`, `WAITING_FOR_PROVIDER`, `ESCALATED`, `RESOLVED`, `CLOSED`, `REOPENED`.
- `SupportPriority`: `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- `SupportChannel`: `PWA`, `WHATSAPP`, `ADMIN`.
- `SupportMessageVisibility`: `USER_VISIBLE`, `INTERNAL_ONLY`.

Add models:

- `SupportTicket`
- `SupportMessage`
- `SupportInternalNote`
- `SupportStatusHistory`
- `SupportAttachment`

Key fields for `SupportTicket`:

- requester identity: `requesterId`, `requesterRole`, `requesterPhone`.
- linked context: `linkedJobRequestId`, `linkedLeadId`, `linkedJobId`, `linkedBookingId`, `linkedPaymentId`, `linkedPaymentIntentId`, `linkedProviderId`, `linkedDisputeId`.
- support triage: `category`, `subcategory`, `title`, `description`, `status`, `priority`, `channelCreatedFrom`, `assignedAdminId`.
- WhatsApp/audit: `whatsappMessageId`, `lastResponseAt`, `closedAt`, timestamps.

Indexes:

- `[requesterId, requesterRole, createdAt]`
- `[status, priority, createdAt]`
- `[linkedJobId]`
- `[linkedBookingId]`
- `[linkedJobRequestId]`
- `[linkedProviderId]`
- `[linkedPaymentId]`
- `[linkedPaymentIntentId]`
- `[linkedDisputeId]`

### New service files

Create:

- `field-service/lib/support-categories.ts`
  - Static category registry for customer/provider/admin display.
  - Defines category keys, role availability, allowed linked entity types, default priority, and FAQ references.

- `field-service/lib/support-faq.ts`
  - Static FAQ registry shared by PWA and WhatsApp.
  - Includes category, title, short WhatsApp-safe answer, longer PWA answer, escalation category.

- `field-service/lib/support-priority.ts`
  - Determines priority from requester role, category, linked entity, active job state, payment/credit flags, and safety flags.

- `field-service/lib/support-ticket-access.ts`
  - Ownership checks for customer/provider/admin views.
  - Helpers: `assertCanCreateTicket`, `assertCanViewTicket`, `assertCanMessageTicket`, `resolveSupportLinkedContext`.

- `field-service/lib/support-tickets.ts`
  - Core mutations and reads.
  - Helpers: `createSupportTicket`, `addSupportMessage`, `addInternalSupportNote`, `assignSupportTicket`, `transitionSupportTicket`, `listSupportTicketsForAdmin`, `listSupportTicketsForRequester`, `getSupportTicketDetail`.

- `field-service/lib/support-notifications.ts`
  - WhatsApp confirmation and admin response/status update messages.
  - Must avoid sensitive context in WhatsApp body.

### Tests

Add tests under `field-service/__tests__/support/`:

- `support-priority.test.ts`
- `support-categories.test.ts`
- `support-ticket-access.test.ts`
- `support-ticket-status.test.ts`

### Acceptance criteria

- Prisma generates cleanly.
- Support models can represent job, booking, payment, credit, provider profile, verification, and general account issues.
- Internal notes cannot be represented as user-visible messages by accident.
- Priority logic marks safety, active job, payment, and credit blockers correctly.

## Phase 1 — Customer and provider PWA ticket creation

### Deliverables

1. Add customer support centre and new ticket routes.
2. Add provider support centre and new ticket routes.
3. Add linked “Get help” entry points from high-value screens.
4. Add user ticket list/detail with user-visible message thread.
5. Send WhatsApp confirmation on ticket creation when a phone is available and service opt-in permits.

### Customer routes

Create:

- `field-service/app/(customer)/support/page.tsx`
  - Shows FAQ cards, “Create support request”, and the customer’s recent tickets.

- `field-service/app/(customer)/support/new/page.tsx`
  - Accepts query params such as `jobId`, `bookingId`, `requestId`, `paymentId`, `category`.
  - Prefills category/context where authorized.

- `field-service/app/(customer)/support/[ticketId]/page.tsx`
  - Shows user-visible messages, status, linked safe context, and reply box if open.

- `field-service/app/(customer)/support/actions.ts`
  - Server actions for create/reply.

### Provider routes

Create:

- `field-service/app/(provider)/provider/support/page.tsx`
  - Shows FAQ cards and provider ticket list.

- `field-service/app/(provider)/provider/support/new/page.tsx`
  - Accepts `jobId`, `leadId`, `paymentIntentId`, `category`.

- `field-service/app/(provider)/provider/support/[ticketId]/page.tsx`
  - Shows provider-visible messages/status/reply.

- `field-service/app/(provider)/provider/support/actions.ts`
  - Server actions for create/reply.

### Entry point changes

Customer:

- Add support link to `field-service/app/(customer)/bookings/[id]/page.tsx` near the provider card, job progress, completion sign-off, and existing dispute section.
- Add support link to `field-service/app/(customer)/requests/[id]/page.tsx` near request/quote/shortlist status.
- Add a general help link to customer account/profile navigation if present.

Provider:

- Add support link to `field-service/app/(provider)/provider/jobs/[jobId]/page.tsx` above or alongside the existing dispute form.
- Add support link to `field-service/app/(provider)/provider/credits/page.tsx` for credit/top-up issues.
- Add support link to `field-service/app/(provider)/provider/profile/page.tsx` for profile/service-area issues.
- Add support link to `field-service/app/(provider)/provider/application/page.tsx` and verification surfaces for onboarding/verification issues.

### Ticket creation behavior

- User selects category.
- Form displays any matching FAQ first.
- User can continue to submit a ticket.
- Server validates ownership of every linked ID.
- Server calculates priority.
- Server creates `SupportTicket`, first `SupportMessage`, and first `SupportStatusHistory` in one transaction.
- Server records `AuditLog` for `support.ticket.create`.
- Server sends WhatsApp confirmation through `support-notifications` if available.

### Acceptance criteria

- Customer can create a ticket from a booking/request and from general support.
- Provider can create a ticket from job/credits/profile/application and from general support.
- Users see only their own tickets.
- User-visible ticket thread excludes internal notes.
- Ticket creation writes audit/status history.
- Ticket creation does not create wallet ledger mutations.

## Phase 2 — Admin support inbox and response workflow

### Deliverables

1. Add admin support inbox to the sidebar.
2. Add admin list with filters.
3. Add admin detail route with context, conversation, internal notes, assignment, status transitions, and response form.
4. Add audit logging for all admin actions.
5. Send WhatsApp update when an admin posts a user-visible response or status changes.

### Admin routes

Create:

- `field-service/app/(admin)/admin/support/page.tsx`
  - Filterable server-rendered inbox.
  - Filters: status, role, category, priority, channel, assigned admin, age/SLA, linked entity.

- `field-service/app/(admin)/admin/support/[ticketId]/page.tsx`
  - Full ticket detail.
  - Shows requester, safe linked context, message thread, attachments, internal notes, status history, audit events.

- `field-service/app/(admin)/admin/support/actions.ts`
  - `claimSupportTicketAction`
  - `releaseSupportTicketAction`
  - `assignSupportTicketAction`
  - `respondToSupportTicketAction`
  - `addInternalSupportNoteAction`
  - `transitionSupportTicketAction`
  - `linkDisputeToSupportTicketAction`

Update:

- `field-service/lib/admin-nav-routes.ts`
  - Add `{ href: '/admin/support', label: 'Support', icon: 'messages' }` near Messages/Disputes.

### Admin workflow

Statuses:

- New: newly submitted, not triaged.
- In review: admin claimed or triaging.
- Waiting for user: admin needs requester response.
- Waiting for provider: issue depends on provider response/action.
- Escalated: safety/payment/trust/ops escalation.
- Resolved: outcome sent; can be reopened.
- Closed: final closed state.
- Reopened: reopened after requester reply or admin action.

Actions:

- Claim/assign/release ticket.
- Respond to user.
- Add internal note.
- Set priority.
- Link existing dispute or create a formal dispute for eligible job issues.
- Resolve/close/reopen.

### Existing dispute integration

Do not remove existing dispute pages. Instead:

- On support tickets with job issue categories, show “Create/link formal dispute”.
- If linked, show `/admin/disputes` link and dispute status on support detail.
- Existing dispute form on customer/provider job pages can remain, but future UX should nudge general problems into support tickets and reserve formal disputes for bad service/no-show/safety/payment outcome issues.

### Acceptance criteria

- Admin can see all tickets in one inbox.
- Admin can filter and open a ticket detail page.
- Admin can respond; user can see response.
- Admin can add internal notes; user cannot see them.
- Admin can assign, escalate, resolve, close, and reopen tickets.
- Every admin action is audited.
- WhatsApp update is sent for user-visible responses/status changes where possible.

## Phase 3 — WhatsApp HELP/ISSUE ticket routing

### Deliverables

1. Extend WhatsApp help flow to offer issue categories and support ticket creation/linking.
2. Add `ISSUE` keyword handling in `field-service/lib/whatsapp-bot.ts`.
3. Add safe context detection for active customer bookings and provider jobs/leads.
4. Add support form signed-link fallback for ambiguous or richer detail cases.
5. Link inbound WhatsApp WAMID to tickets/messages.

### Bot changes

Update `field-service/lib/whatsapp-flows/help.ts`:

- Keep current FAQ list.
- Add `issue_menu` step.
- Add role-aware category menus.
- Add `still_need_help` escalation option after FAQ answers.
- Add short confirmation when ticket is created.

Update `field-service/lib/whatsapp-bot.ts`:

- Add `ISSUE`, `problem`, `complaint`, `support` handling before generic fallback.
- Use existing identity/context resolution helpers before mentioning any linked context.
- If one active context exists, store safe context in conversation data.
- If multiple or ambiguous, send a signed support form link rather than listing sensitive context.

Create or extend:

- `field-service/lib/support-whatsapp-context.ts`
  - Resolve phone to customer/provider context.
  - Find one active customer booking/request or one active provider job/lead when safe.

- `field-service/lib/support-link-tokens.ts`
  - Mint signed short-lived support form links if existing token helpers are not suitable.

### WhatsApp copy rules

- Use references only: `PAP-SUP-8F3A`, `your active job`, `your booking`.
- Do not include full addresses, customer phone, provider private data, payment amounts, wallet balances, or KYC detail in WhatsApp support copy unless already safely shown in that flow.
- Include a warning not to send banking PINs/card details.

### Acceptance criteria

- WhatsApp user can send HELP and see FAQ categories.
- WhatsApp user can send ISSUE and either create a ticket or receive a secure PWA support form link.
- Unknown/ambiguous phone numbers do not receive private context.
- Admin sees WhatsApp-originated tickets in `/admin/support`.
- Ticket record stores `channelCreatedFrom = WHATSAPP` and source WAMID where available.

## Phase 4 — Attachments and support media

### Deliverables

1. Allow PWA support ticket attachments using existing attachment/storage conventions.
2. Allow admins to view support attachments through authorized proxy URLs.
3. Optionally link inbound WhatsApp image/document messages to a ticket when conversation is in support flow.

### Implementation notes

- Reuse existing `Attachment` model and `/api/attachments/[id]` where possible.
- Validate MIME type, size, and ownership.
- Add `SupportAttachment` join rows after upload.
- For WhatsApp media, first log metadata and only download/store after confirming a ticket/context to avoid unnecessary PII retention.

### Acceptance criteria

- Customer/provider can attach a photo to a support ticket from PWA.
- Admin can see attachments on ticket detail.
- Other users cannot access support attachments.
- Unsupported file types and oversized uploads fail safely.

## Phase 5 — FAQ/self-help improvement and analytics

### Deliverables

1. Add PWA FAQ search/filter.
2. Add admin “FAQ candidate” tags from resolved tickets.
3. Add support metrics to admin reports or support inbox summary.
4. Add duplicate detection.
5. Prepare AI-assisted admin suggestions behind a feature flag, grounded only in approved FAQ content.

### Metrics

- Tickets by category, channel, requester role, priority, status.
- First response time.
- Resolution time.
- Reopened tickets.
- WhatsApp-origin tickets.
- FAQ deflection click-through.
- Duplicate tickets by linked entity/category.

### Acceptance criteria

- Admin can see support volume and aging.
- Common unanswered questions can be identified.
- AI remains disabled for user-facing answers in MVP.

## Phase 6 — Guardrailed AI self-help assistant

### Direction

Add a Plug A Pro self-help assistant after the support ticket foundation, FAQ registry, and admin support inbox are live. The assistant is not a generic chatbot and must not replace operations workflows. It is a constrained support interface that answers from approved Plug A Pro knowledge, uses the logged-in user's authorized platform context when available, and escalates sensitive or unresolved issues into support tickets.

### User modes

Logged-in customer/provider:

- Can ask questions from inside the platform.
- May receive answers based on approved Plug A Pro knowledge plus their own authorized profile, requests, bookings, jobs, leads, credits, verification, and ticket history.
- Must receive role-appropriate information only. Customer context never exposes provider-private data, and provider context never exposes customer-private data beyond what the provider is already authorized to see.
- Sensitive, policy-bound, or action-requiring issues create or link a support ticket instead of being resolved by AI.

Anonymous/unknown user:

- Can ask general public support questions only.
- Receives answers from public Plug A Pro knowledge such as how booking works, provider onboarding basics, service availability, pricing model basics, cancellation/reschedule guidance, and how to contact support.
- Does not receive internal operations details, customer/provider records, payment status, wallet balance, verification status, dispute details, or private policy logic.
- Is routed to sign in, create an account, start provider onboarding, or open a generic support ticket when account-specific help is needed.

### Knowledge and model boundaries

- The model provider can be OpenAI, Anthropic, or another approved LLM provider behind a local adapter.
- Retrieval must be restricted to an approved Plug A Pro knowledge base. The assistant must refuse or redirect anything outside Plug A Pro support scope.
- Responses should cite or reference the approved internal answer source where practical.
- Do not train on raw private user data. Use retrieval and authorized tool calls instead.
- Keep system prompts, guardrails, redaction rules, and escalation policy in code-owned configuration, not editable by normal admins without review.

### Tool access boundaries

Allowed for logged-in users after authorization checks:

- Read safe user profile summary.
- Read own customer requests/bookings/jobs/tickets.
- Read own provider application, verification summary, jobs/leads, wallet summary, and credit/top-up status.
- Recommend next steps.
- Create or append to a support ticket.

Not allowed:

- Wallet balance mutations, refunds, lead unlock reversals, payment adjustments, KYC approval/rejection, provider discipline, cancellation penalties, dispute resolution, or dispatch decisions.
- Revealing hidden scoring, risk flags, internal notes, admin-only case notes, raw audit logs, or another user's data.
- Giving binding promises on refunds, payments, verification outcomes, provider sanctions, arrival guarantees, or legal conclusions.

### Escalation rules

Create or link a support ticket when:

- The user reports safety, fraud, harassment, no-show, damage, payment, credit, verification, account access, or urgent active-job issues.
- The answer requires an admin decision or operational action.
- The assistant cannot answer from approved knowledge with enough confidence.
- The user asks for a human or says the answer did not help.

### Implementation sequence

1. Build the support ticket foundation and `/admin/support` inbox first.
2. Build the approved `support-faq`/knowledge registry and analytics.
3. Add AI adapter interfaces and retrieval over approved Plug A Pro content only.
4. Add an anonymous assistant with public-only answers and sign-in/ticket handoff.
5. Add logged-in assistant context tools with strict ownership checks.
6. Add ticket creation/append handoff from assistant conversations.
7. Enable for an internal cohort behind `support.ai_assistant.enabled`.
8. Add evals for refusal, privacy, hallucination, scope control, and ticket escalation.

### Acceptance criteria

- Anonymous assistant answers only public Plug A Pro support questions.
- Logged-in assistant uses only the current user's authorized context.
- Out-of-scope questions are refused or redirected.
- Sensitive issues create or link support tickets.
- AI cannot mutate payments, wallet ledger entries, verification, disputes, dispatch, bookings, or provider status.
- Admin can see AI-origin ticket context in `/admin/support`.
- Tests cover public/private context separation, prompt-injection attempts, unsafe action refusal, and escalation ticket creation.

## 5. Concrete task breakdown

### Task group A — Database and generated client

1. Edit `field-service/prisma/schema.prisma` with support enums/models.
2. Run `pnpm db:generate`.
3. Create migration with `pnpm prisma migrate dev --name support_tickets` or project-approved migration workflow.
4. Review SQL for indexes and foreign key/delete behavior.
5. Add schema notes to OpenBrain doc.

### Task group B — Core support services

1. Add category registry.
2. Add FAQ registry.
3. Add priority helper.
4. Add ticket access helper.
5. Add ticket mutation/query service.
6. Add notification helper.
7. Unit-test all pure helpers and mock/service mutation paths where project conventions allow.

### Task group C — Customer PWA

1. Add support centre route.
2. Add new-ticket route/action.
3. Add ticket detail route/action.
4. Add links from booking/request/account.
5. Test customer ownership and unauthorized access.

### Task group D — Provider PWA

1. Add provider support centre route.
2. Add new-ticket route/action.
3. Add ticket detail route/action.
4. Add links from job/credits/profile/application/verification.
5. Test provider ownership and unauthorized access.

### Task group E — Admin inbox

1. Add admin nav item.
2. Add inbox list/filter page.
3. Add ticket detail page.
4. Add admin actions.
5. Add audit logging.
6. Add user-visible response notifications.
7. Test role gating and note visibility.

### Task group F — WhatsApp support

1. Extend help flow with issue categories.
2. Add ISSUE keyword handling.
3. Add context resolver.
4. Add signed PWA support link fallback.
5. Link WAMID/source messages.
6. Test inbound keyword handling and safe fallback.

### Task group G — Attachments and hardening

1. Add support attachment upload/reuse path.
2. Add attachment joins and authorization checks.
3. Add rate limits/duplicate controls.
4. Add tests for unsupported files and unauthorized access.

## 6. Suggested implementation order by PR

### PR 1 — Support schema and services

Files likely touched:

- `field-service/prisma/schema.prisma`
- `field-service/prisma/migrations/*/migration.sql`
- `field-service/lib/support-categories.ts`
- `field-service/lib/support-faq.ts`
- `field-service/lib/support-priority.ts`
- `field-service/lib/support-ticket-access.ts`
- `field-service/lib/support-tickets.ts`
- `field-service/lib/support-notifications.ts`
- `field-service/__tests__/support/*`

Why first:

- Gives all later UI and WhatsApp work one stable domain/service layer.

### PR 2 — PWA customer/provider ticket creation

Files likely touched:

- `field-service/app/(customer)/support/**`
- `field-service/app/(provider)/provider/support/**`
- `field-service/app/(customer)/bookings/[id]/page.tsx`
- `field-service/app/(customer)/requests/[id]/page.tsx`
- `field-service/app/(provider)/provider/jobs/[jobId]/page.tsx`
- `field-service/app/(provider)/provider/credits/page.tsx`
- `field-service/app/(provider)/provider/profile/page.tsx`
- `field-service/app/(provider)/provider/application/page.tsx`

Why second:

- Creates immediate user value without needing WhatsApp command complexity.

### PR 3 — Admin support inbox

Files likely touched:

- `field-service/lib/admin-nav-routes.ts`
- `field-service/app/(admin)/admin/support/**`
- `field-service/components/admin/support/**` if component extraction is useful.
- `field-service/lib/admin-action-messages.ts` if banner messages are needed.

Why third:

- Gives ops one place to act on tickets before WhatsApp-origin tickets increase volume.

### PR 4 — WhatsApp HELP/ISSUE integration

Files likely touched:

- `field-service/lib/whatsapp-bot.ts`
- `field-service/lib/whatsapp-flows/help.ts`
- `field-service/lib/support-whatsapp-context.ts`
- `field-service/lib/support-link-tokens.ts`
- `field-service/lib/support-notifications.ts`
- WhatsApp tests/harnesses.

Why fourth:

- Uses the completed ticket/admin infrastructure and reduces risk of orphan WhatsApp issues.

### PR 5 — Attachments, analytics, and FAQ improvement

Files likely touched:

- `field-service/app/(customer)/support/**`
- `field-service/app/(provider)/provider/support/**`
- `field-service/app/(admin)/admin/support/**`
- `field-service/lib/support-tickets.ts`
- `field-service/lib/storage.ts`
- `field-service/app/api/attachments/[id]/route.ts` only if authorization extension is required.

Why fifth:

- Hardens the MVP after core ticket flow is stable.

## 7. Test plan

Run before each PR completion:

- `pnpm typecheck`
- `pnpm lint`
- Relevant unit tests, for example `pnpm test -- __tests__/support`
- Relevant integration tests for customer/provider/admin route access if existing harness supports them.

Add tests for:

- Support priority calculation.
- Category availability by requester role.
- Customer cannot view provider ticket.
- Provider cannot view customer ticket.
- User cannot link ticket to a job/booking/payment they do not own.
- Admin internal notes are excluded from user ticket detail.
- Admin response creates user-visible message and status history.
- WhatsApp HELP returns FAQ/menu.
- WhatsApp ISSUE creates ticket or safe support link without leaking context.
- Duplicate ticket suppression for same requester/entity/category.

Manual QA checklist:

- Customer creates ticket from booking.
- Customer creates general ticket.
- Provider creates ticket from job.
- Provider creates ticket from credits.
- Admin replies and closes.
- User sees reply and status.
- WhatsApp HELP shows FAQ.
- WhatsApp ISSUE from known active-job phone is routed safely.
- WhatsApp ISSUE from unknown phone gives generic secure link.

## 8. Rollout and feature flags

Recommended flags:

- `support.pwa.enabled`
- `support.admin.enabled`
- `support.whatsapp.enabled`
- `support.attachments.enabled`
- `support.ai_suggestions.enabled`

Rollout sequence:

1. Enable admin support inbox for internal users only.
2. Enable PWA support centre for test cohort.
3. Enable customer/provider entry links.
4. Enable WhatsApp HELP/ISSUE routing for test numbers.
5. Enable public WhatsApp support routing after template/copy review.
6. Keep AI suggestions disabled until approved FAQ content and admin review workflow exist.

## 9. Operational runbook for MVP

Admin daily workflow:

1. Open `/admin/support`.
2. Filter `NEW`, `URGENT`, and `HIGH` first.
3. Claim ticket.
4. Review linked context.
5. Add internal note if investigation is needed.
6. Respond to user with a short clear next step.
7. Move to `WAITING_FOR_USER`, `WAITING_FOR_PROVIDER`, `ESCALATED`, or `RESOLVED`.
8. Close only after resolution is confirmed or no response after policy window.

Escalation rules:

- Safety complaint: set `URGENT`, `ESCALATED`, assign trust/admin role.
- Payment/credit issue: set `HIGH`, link payment/payment intent/wallet context, assign finance/admin role.
- Active job no-show/unreachable: set `URGENT`, link job/booking, assign ops.
- Verification issue: set `HIGH` if provider is blocked from accepting work; otherwise `NORMAL`.
- General FAQ: answer with approved FAQ and resolve if no further action needed.

## 10. Privacy and abuse controls to implement with MVP

- Require server-side ownership checks for every linked entity ID.
- Never trust requester role or linked IDs from hidden form fields without lookup.
- Store admin notes in `SupportInternalNote`, not `SupportMessage`.
- Add rate limits per user/phone/category.
- Suppress duplicates for same requester, linked entity, and category while an active ticket exists.
- Validate support attachment MIME type, extension, and size.
- Keep WhatsApp copy minimal and reference-based.
- Avoid exposing internal errors to users; log trace IDs for support/admin diagnostics.
- Do not allow support ticket actions to mutate wallet balances directly.

## 11. Definition of done for MVP

The MVP is done when:

- Customer can create and view a support ticket from booking/request/general support.
- Provider can create and view a support ticket from job/credits/profile/application/general support.
- Admin can view, filter, claim, respond, internally note, resolve, close, and reopen tickets.
- WhatsApp HELP gives FAQ/self-help.
- WhatsApp ISSUE creates a ticket or safe support form link.
- User receives WhatsApp confirmation and admin response/status notifications where available.
- Tickets can link to job request, booking, job, provider, payment/payment intent, lead, dispute, or general account.
- Access is role-protected and ownership-checked.
- Admin-only notes are never visible to users.
- Audit/status history exists for create/respond/status/assignment actions.
- Basic FAQ content exists and is shared between PWA and WhatsApp.
- Typecheck, lint, and relevant tests pass.

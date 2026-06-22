# Plug A Pro support, help, and feedback capability assessment

Date: 2026-06-14

## A. Executive summary

Plug A Pro already has the foundations for an MVP support capability: mobile-first Next.js routes, Supabase/Prisma-backed auth, WhatsApp inbound message capture, message-event auditing, job/customer/provider ownership loaders, admin dispute queues, case lifecycle records, audit logs, and a WhatsApp FAQ/help flow. The current gap is that these pieces are fragmented: job disputes exist only on job detail pages, WhatsApp help answers are not converted into trackable support tickets, general account/profile/credits/verification support is not structured, and admin users do not have one customer/provider support inbox.

Recommended MVP: build a hybrid support desk that reuses the current `Dispute`, `Case`, `MessageEvent`, `InboundWhatsAppMessage`, `AuditLog`, attachment proxy, and role guards where possible, but introduces a dedicated `SupportTicket` model for non-dispute issues and user-visible ticket messages. This avoids overloading operational cases, keeps admin notes private, supports WhatsApp-first users, and leaves room for AI-assisted answers later only after approved FAQ content exists.

## B. Source code findings

### Application structure

- Framework: Next.js App Router with route groups for admin, auth, client/customer, and provider journeys under `field-service/app`.
- Customer PWA routes live mainly in `app/(customer)` with bookings, requests, messages, notifications, profile, providers, and service booking routes. A newer/client ticket flow also exists in `app/(client)/client` and public token routes such as `app/ticket/[token]`, `app/requests/access/[token]`, and `app/r/[token]`.
- Provider PWA routes live in `app/(provider)/provider` plus token/handoff routes under `app/provider/*`, including credits, jobs, leads, profile, availability, application, verification, voucher redemption, and signup.
- Admin routes live in `app/(admin)/admin`; navigation is centralized in `lib/admin-nav-routes.ts` and includes operations, validation, dispatch, bookings, disputes, messages, payments, credit top-ups, provider wallets, lead refunds, team, settings, OTP, audit log, and launch/nudge routes.

### Authentication and role access

- `lib/auth.ts` resolves Supabase sessions from the `sb-access-token` cookie, normalizes phone numbers, downgrades client-writable metadata so it cannot grant admin access, detects provider eligibility through provider records, and exposes `requireAdmin`, `requireProvider`, `requireRole`, `requireProviderApi`, and customer session helpers.
- Admin access is resolved only through the database-backed `AdminUser` table and `Role` enum, not user metadata.
- Provider access is gated by `checkWorkerPortalAccess` and active/verified provider state.
- Customer ownership is commonly resolved through `resolveCustomerForSession` and route-specific loader functions that return `unauthorized` or redirect rather than leaking records.

### Data model and current operations model

- Core marketplace models include `Customer`, `Provider`, `JobRequest`, `Lead`, `LeadUnlock`, `LeadUnlockDispute`, `Match`, `Quote`, `Booking`, `Job`, `Payment`, `PaymentIntent`, `ProviderWallet`, `WalletLedgerEntry`, vouchers, reviews, disputes, messages, inbound WhatsApp messages, conversations, audit logs, ops queue assignments, cases, case events, and case notes.
- `Dispute` supports job-linked issues with `jobId`, `raisedById`, `raisedByRole`, `reason`, `status`, `resolution`, `resolvedAt`, and `resolvedById`.
- `Case` is a polymorphic ops wrapper around operational entities and has private `CaseNote` records with `CaseNoteVisibility.INTERNAL_ONLY` only.
- `MessageEvent` records outbound/inbound messaging metadata and delivery status; `InboundWhatsAppMessage` stores inbound WAMID, phone, body, payload, duplicate counts, processed/failure state.
- `Conversation` stores WhatsApp bot flow, step, session data, and expiry.

### Job lifecycle

- `lib/jobs.ts` is the central job state machine. It validates transitions, updates `Job`, writes `JobStatusEvent`, records `AuditLog`, opens a `FIELD_EXCEPTION` case for `FAILED`/`CALLBACK_REQUIRED`, and sends WhatsApp side effects to customers for en route, arrived, started, completion sign-off, and completed.
- Provider job detail pages use `getProviderJobDetailForViewer` before showing full customer/job context.
- Customer booking pages use `getCustomerBookingDetailForViewer` before showing booking, provider, quote, status, evidence, cancellation, completion confirmation, and dispute controls.

### WhatsApp and notification handling

- `app/api/webhooks/whatsapp/route.ts` verifies Meta signatures, deduplicates inbound WAMIDs into `InboundWhatsAppMessage`, calls `processInboundMessage`, marks processed/failure state, and updates delivery status on `MessageEvent` and `OtpDeliveryAttempt`.
- `lib/whatsapp-bot.ts` is the inbound router. It supports customer job request, registration, status, reschedule, cancel, help, provider journey, provider job commands, RFP lead interest, opt-in/out, recovery, and identity verification triggers.
- `lib/whatsapp-flows/help.ts` already has a Help/FAQ list with pricing, areas, duration, cancellations, rescheduling, payment, providers, problem with job, and speak-to-human options. It currently gives answers or asks the user to reply, but it does not create a tracked ticket.
- Provider WhatsApp job commands in `lib/provider-whatsapp-job-commands.ts` parse arrival/status/completion commands and verify inbound phone ownership before changing a job.

### Payments, credits, vouchers, bookings, onboarding

- Provider credits: `app/(provider)/provider/credits/page.tsx`, `app/(provider)/provider/credits/actions.ts`, `lib/provider-wallet.ts`, `lib/provider-credit-*`, `PaymentIntent`, `ProviderWallet`, `WalletLedgerEntry`, `ProviderPromoAward`, `PromoVoucher`, and `VoucherRedemptionAttempt`.
- Payment/admin surfaces: `app/(admin)/admin/payments`, `provider-credit-payments`, `provider-wallets`, `lead-unlock-disputes`, and webhook routes for Payat/Payfast/payment webhooks.
- Booking/customer flow: `components/customer/BookingFlow.tsx`, `app/api/customer/bookings/route.ts`, `lib/bookings.ts`, `app/(customer)/book/[serviceId]`, `app/(customer)/bookings`, and request detail routes.
- Provider onboarding: WhatsApp registration flow, provider signup/register routes, `ProviderApplication`, `ProviderIdentityVerification`, `ProviderVerificationEvent`, admin applications/verifications routes, and provider application/verification pages.

### Existing support-adjacent functionality

- Existing: job disputes from customer booking detail and provider job detail; admin dispute queue; internal case lifecycle; admin case timeline/notes; reviews; quote feedback; WhatsApp FAQ/help flow; status dashboard; contact-support links on auth error screens; application error event support docs.
- Missing: general support ticket entity, unified support inbox, user-visible ticket messaging, ticket status updates over WhatsApp, FAQ content management, support ticket creation from WhatsApp HELP/ISSUE, linked support from credits/profile/verification/payment screens, support attachment policy, and user ticket history.

## C. Current user journey map

### Customer creates a request or booking

1. Customer lands on the public/customer home and starts booking via `BookingFlow` or service booking routes.
2. The booking/request APIs create or update `Customer`, address/site data, `JobRequest`, attachments, matching mode, dispatch/matching records, and WhatsApp notifications.
3. Customer tracks the request in `/requests/[id]` or tokenized request routes, reviews providers/quotes, selects a provider, and is redirected to booking detail once a booking exists.

Best support entry points:
- Booking wizard step footer: “Need help booking?”
- After submit/matching screen: “Problem with this request?”
- Request detail: “Get help with this request.”
- Quote review/shortlist: “Question about quote/provider.”
- Booking detail: replace/augment dispute block with categorized “Report an issue.”
- WhatsApp confirmation messages: include a safe support link or “Reply ISSUE”.

### Provider receives or accepts work

1. Provider sees leads/opportunities in provider PWA or receives WhatsApp lead/selection messages.
2. Provider can respond through WhatsApp command flows, tokenized lead access routes, or provider PWA lead/job pages.
3. Accepted customer-selected jobs spend credits/unlock details via wallet/lead-unlock logic.

Best support entry points:
- Lead/opportunity cards: “I cannot accept this job.”
- Credits page: “Credit issue.”
- Verification/application/profile pages: “Need help with verification/profile.”
- WhatsApp job offer: “Reply HELP or ISSUE.”
- Insufficient credits WhatsApp/PWA screens: “Need help with credits?”

### Provider updates job progress

1. Provider uses job detail controls or WhatsApp commands to mark en route, arrived, started, complete, or raise issues.
2. `transitionJob` writes status events/audits and notifies customers.
3. Provider can currently raise a free-text job dispute from job detail.

Best support entry points:
- Job status controls area: “Job details unclear / customer unreachable / report customer issue.”
- Evidence upload failures: “Having trouble uploading photos?”
- Existing dispute block should become linked support categories, while preserving Dispute for formal job disputes.

### Customer receives updates

1. Customer receives WhatsApp updates when provider is en route, arrived, started, marked ready for sign-off, and completed.
2. Customer can review booking detail and confirm completion.
3. Customer can currently raise a job dispute from booking detail.

Best support entry points:
- Each active job WhatsApp update: “Reply ISSUE if something is wrong.”
- Booking detail near provider/contact row: “Provider did not arrive” / “I need to change booking.”
- Completion sign-off: “Work not complete? Report an issue.”

### Admin manages jobs or users

1. Admin uses operations, validation, dispatch, bookings, disputes, messages, payments, provider wallets, applications, verifications, lead refunds, and audit logs.
2. Existing disputes are visible in `/admin/disputes`, claimable through `OpsQueueAssignment`, updatable via `crudAction`, optionally linked to cases/timeline/notes when cases flag is enabled.

Best support entry points:
- New `/admin/support` inbox should unify general tickets, WhatsApp-origin tickets, job disputes, payment/credit issues, verification issues, and escalations.
- Existing `/admin/disputes` should remain for formal job disputes or be linked as a filtered support category.

### WhatsApp communication touchpoints

- Inbound webhook, `Conversation`, help flow, job request flow, status/cancel/reschedule flows, provider job commands, provider journey, OTP, and notification delivery receipts.
- Best support integration: add HELP/ISSUE routing in `lib/whatsapp-bot.ts` and `lib/whatsapp-flows/help.ts` so common questions get quick answers and unresolved issues create `SupportTicket` records.

## D. Support/help gaps found

- Help exists in WhatsApp but is not tied to a ticket queue or admin response workflow.
- Job disputes exist but are too narrow for credits, verification, profile, payment, booking, quote, WhatsApp flow problems, or general help.
- `Case` is internal-only and not suitable as the user-facing ticket thread because `CaseNoteVisibility` only supports `INTERNAL_ONLY`.
- Existing admin disputes page can triage job disputes but not general support and does not send user-visible responses/status updates.
- No central support route is present in customer/provider bottom navigation.
- No ticket history for users.
- No structured FAQ in PWA; only WhatsApp FAQ copy.
- No WhatsApp ticket confirmation/status response path.

## E. Solution options

### Option A: Simple MVP support form

What it solves:
- Adds PWA “Get Help” from booking/job/profile/credits/account screens.
- Lets users select category and link ticket to job, booking, payment, provider, request, or account.
- Gives admins a basic queue and sends WhatsApp confirmation.

What it does not solve:
- Does not fully support WhatsApp-native issue creation beyond links.
- Minimal self-help unless FAQ cards are added.
- Limited threaded conversation unless messages are included.

Complexity: low to medium.

Codebase touched:
- Prisma schema/migration for `SupportTicket` and minimal `SupportMessage`.
- New routes under `app/(customer)/support`, `app/(provider)/provider/support`, `app/(admin)/admin/support`.
- Existing booking/job/profile/credits/request pages for entry links.
- `lib/auth.ts` helpers/ownership checks, `lib/audit.ts`, `lib/whatsapp.ts` or `lib/whatsapp-interactive.ts` for confirmation.

Risks:
- If too basic, users continue replying free-form to WhatsApp.
- Duplicates with `Dispute` unless mapped carefully.

MVP suitability: strong first increment.

Sequence:
1. Add data model and server actions.
2. Add linked PWA form.
3. Add admin list/detail/respond/close.
4. Send WhatsApp confirmation/status update.

### Option B: WhatsApp-first support flow

What it solves:
- Meets users where they already communicate.
- Supports HELP/ISSUE keywords and guided menus.
- Can infer context from phone, active jobs, pending bookings, leads, or conversation state.
- Opens PWA support form for richer details/photo upload.

What it does not solve:
- Admin still needs a support queue.
- WhatsApp-only detail capture can be ambiguous.
- Attachment handling and user identity mapping require care.

Complexity: medium.

Codebase touched:
- `app/api/webhooks/whatsapp/route.ts`, `lib/whatsapp-bot.ts`, `lib/whatsapp-flows/help.ts`, `lib/whatsapp-identity.ts`, `Conversation` handling.
- Support data model/admin queue from Option A.
- MessageEvent/InboundWhatsAppMessage linking.

Risks:
- Ambiguous phone numbers, provider/customer overlap, expired conversations.
- Could leak context if the bot mentions jobs not owned by the sender.
- WhatsApp template/freeform constraints.

MVP suitability: good as Phase 2 after simple queue exists, or included narrowly for “reply ISSUE -> support link/ticket.”

Sequence:
1. Add HELP/ISSUE intent handling.
2. Identify user role/context safely.
3. Offer concise menu and PWA link.
4. Create ticket if user gives enough detail.
5. Confirm ticket and mirror admin responses.

### Option C: Hybrid support desk with self-help

What it solves:
- Best long-term fit: PWA support centre + WhatsApp entry + FAQ + admin support inbox + messages + internal notes + status/SLA/escalation.
- Supports customers, providers, and admins in one model.
- Gives prompt answers for common questions and human handoff for unresolved issues.
- Auditable and AI-ready later.

What it does not solve:
- Requires more schema/routes/UI than Option A.
- AI answers should not be shipped until approved content and guardrails exist.

Complexity: medium to high, but can be phased.

Codebase touched:
- Option A + Option B touchpoints.
- Admin nav, case/SLA integration, FAQ content module/table, audit events, attachment handling, notification events.

Risks:
- Scope creep into full Zendesk clone.
- Need clear boundaries between support tickets, operational cases, disputes, and lead refund disputes.

MVP suitability: recommended if delivered in phases: build the hybrid foundation but keep Phase 1 simple.

Sequence:
1. Build tickets/messages/admin queue.
2. Add PWA self-help and categorized issue creation.
3. Add WhatsApp HELP/ISSUE ticket routing.
4. Add status history/internal notes/SLA.
5. Improve with analytics/AI suggestions.

## F. Recommended MVP solution

Build Option C as a phased hybrid MVP, starting with Option A scope plus a narrow WhatsApp entry point.

Why:
- Low operational overhead: one admin inbox, category filters, status, priority, assignment.
- Fast implementation: reuses Next.js app routes, Prisma, admin route patterns, `crudAction`, audit logs, WhatsApp send helpers, and existing ownership loaders.
- Good customer/provider experience: visible from the natural job/request/credits/profile/verification flows and accessible by replying HELP/ISSUE on WhatsApp.
- Admin visibility: all tickets in `/admin/support`, with formal job disputes still linked to `/admin/disputes`.
- Auditability: ticket status history, messages, internal notes, and `AuditLog`/`AdminAuditEvent` records.
- POPIA/privacy: strict requester ownership, role-aware linked context, redacted WhatsApp copy, private admin notes.
- AI-ready: FAQ can become the approved source corpus before any AI answer generation.

Do not replace existing `Dispute` immediately. Treat `Dispute` as a formal job dispute entity and add support tickets for broader support. A ticket may link to a dispute or create one only for formal job-quality/no-show/safety disputes.

## G. Proposed UX flows

### Customer

Entry points:
- `/requests/[id]`: “Get help with this request.”
- `/bookings/[id]`: prominent “Report an issue” and “Need help?” actions near job status/provider card and completion sign-off.
- Booking confirmation/matching/quote screens: “Need help with booking/quote?”
- Payment screens and payment links: “Payment issue.”
- Account/profile area: “Help & support.”
- WhatsApp confirmations and updates: “Reply ISSUE for help with this job.”

Customer categories:
- My provider did not arrive.
- I need to change booking.
- I have a payment issue.
- I am unhappy with service.
- I need help with quote.
- I cannot contact my provider.
- Something else.

Customer flow:
1. Tap Get Help.
2. See matching FAQ cards first if category is common.
3. Select category and linked entity prefilled from current screen.
4. Add description/photo.
5. Submit.
6. See ticket reference and status.
7. Receive WhatsApp confirmation and updates.

### Provider

Entry points:
- `/provider/jobs/[jobId]`: “Customer unreachable,” “Job details unclear,” “Report customer issue,” “Cannot update job.”
- `/provider/credits`: “Credit issue / top-up not showing / refund request.”
- `/provider/profile`: “Profile or service area issue.”
- `/provider/application` and verification pages: “Verification/profile issue.”
- WhatsApp lead/job messages: “Reply HELP or ISSUE.”

Provider categories:
- I cannot accept a job.
- Credit issue.
- Customer unreachable.
- Job details are unclear.
- Verification/profile issue.
- Payment or payout issue.
- Report customer issue.
- Something else.

Provider flow:
1. Tap Help from relevant context.
2. Category and linked job/lead/payment/provider are prefilled.
3. FAQ answer appears for credits/verification where possible.
4. If unresolved, submit ticket.
5. WhatsApp confirmation uses ticket reference only, not customer private details.

### Admin/Ops

Entry points:
- New sidebar item: `/admin/support`.
- Filters: status, requester role, category, priority, linked entity, age, assigned admin, channel, SLA breach.
- Ticket detail: requester, role, safe linked context, messages, attachments, internal notes, audit trail, related dispute/case/payment/job/request links.
- Actions: claim, assign, respond, add internal note, escalate, link/create dispute, change status, resolve, close, reopen.

## H. Proposed data model

Minimum Prisma models:

```prisma
enum SupportRequesterRole {
  CUSTOMER
  PROVIDER
  ADMIN
  UNKNOWN
}

enum SupportTicketStatus {
  NEW
  IN_REVIEW
  WAITING_FOR_USER
  WAITING_FOR_PROVIDER
  ESCALATED
  RESOLVED
  CLOSED
  REOPENED
}

enum SupportPriority {
  LOW
  NORMAL
  HIGH
  URGENT
}

enum SupportChannel {
  PWA
  WHATSAPP
  ADMIN
}

enum SupportMessageVisibility {
  USER_VISIBLE
  INTERNAL_ONLY
}

model SupportTicket {
  id                    String @id @default(cuid())
  requesterId           String?
  requesterRole         SupportRequesterRole
  requesterPhone         String?
  linkedJobRequestId    String?
  linkedLeadId          String?
  linkedJobId           String?
  linkedBookingId       String?
  linkedPaymentId       String?
  linkedPaymentIntentId String?
  linkedProviderId      String?
  linkedDisputeId       String?
  category              String
  subcategory           String?
  title                 String
  description           String @db.Text
  status                SupportTicketStatus @default(NEW)
  priority              SupportPriority @default(NORMAL)
  channelCreatedFrom    SupportChannel
  whatsappMessageId     String?
  assignedAdminId       String?
  lastResponseAt        DateTime?
  closedAt              DateTime?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt

  messages SupportMessage[]
  notes SupportInternalNote[]
  statusHistory SupportStatusHistory[]
  attachments SupportAttachment[]

  @@index([requesterId, requesterRole, createdAt])
  @@index([status, priority, createdAt])
  @@index([linkedJobId])
  @@index([linkedBookingId])
  @@index([linkedProviderId])
}

model SupportMessage {
  id              String @id @default(cuid())
  ticketId        String
  authorUserId    String?
  authorRole      String
  body            String @db.Text
  channel         SupportChannel
  visibility      SupportMessageVisibility @default(USER_VISIBLE)
  whatsappEventId String?
  createdAt       DateTime @default(now())
  ticket          SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@index([ticketId, createdAt])
}

model SupportInternalNote {
  id            String @id @default(cuid())
  ticketId      String
  authorAdminId String
  body          String @db.Text
  createdAt     DateTime @default(now())
  ticket        SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@index([ticketId, createdAt])
}

model SupportStatusHistory {
  id            String @id @default(cuid())
  ticketId      String
  fromStatus    String?
  toStatus      String
  actorUserId   String?
  actorRole     String
  reason        String?
  createdAt     DateTime @default(now())
  ticket        SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@index([ticketId, createdAt])
}

model SupportAttachment {
  id           String @id @default(cuid())
  ticketId     String
  attachmentId String
  uploadedById String?
  createdAt    DateTime @default(now())
  ticket       SupportTicket @relation(fields: [ticketId], references: [id], onDelete: Cascade)
  @@index([ticketId])
}
```

Implementation notes:
- Use explicit linked IDs instead of polymorphic JSON for common entities so admin filters are fast.
- Keep admin-only notes separate from user-visible messages.
- Link `SupportAttachment.attachmentId` to existing `Attachment` by convention or add a relation if ownership patterns support it.
- If Supabase/PostgREST access is enabled for new tables, add RLS policies: users can select only their own tickets/messages; admins can select all; internal notes are admin-only. If only Prisma service role is used, enforce equivalent checks in loaders/actions.
- Add `SUPPORT` to `OpsQueueType` only if support tickets need case/SLA queue assignment through the current `Case` system. Otherwise keep assignment on `SupportTicket.assignedAdminId` for MVP.

## I. Proposed API/routes/actions

PWA routes:
- `app/(customer)/support/page.tsx`: customer support centre + FAQ + user ticket list.
- `app/(customer)/support/new/page.tsx`: general/new linked ticket form.
- `app/(customer)/support/[ticketId]/page.tsx`: user-visible ticket thread.
- `app/(provider)/provider/support/page.tsx`: provider support centre + FAQ + ticket list.
- `app/(provider)/provider/support/new/page.tsx`: provider form with category/context.
- `app/(provider)/provider/support/[ticketId]/page.tsx`: provider ticket thread.
- `app/(admin)/admin/support/page.tsx`: admin inbox.
- `app/(admin)/admin/support/[ticketId]/page.tsx`: admin detail/respond/notes/status.

Server actions/services:
- `lib/support-tickets.ts`: create ticket, add user message, add admin response, add internal note, assign, transition status, priority calculation, linked-entity authorization.
- `app/(customer)/support/actions.ts` and `app/(provider)/provider/support/actions.ts`: thin wrappers around service, with role and ownership checks.
- `app/(admin)/admin/support/actions.ts`: claim/respond/status/internal note with `requireAdmin`/`crudAction` and audit.
- `lib/support-faq.ts`: static FAQ registry for MVP.
- `lib/support-priority.ts`: payment/safety/active job priority rules.
- `lib/support-notifications.ts`: WhatsApp confirmation and admin response/status update messages.

API routes if needed:
- Prefer server actions for PWA forms, matching existing admin patterns.
- Add `app/api/support/whatsapp-link/route.ts` only if WhatsApp needs to mint short signed links.

Entry point changes:
- Add support links to booking detail, request detail, provider job detail, provider credits, profile, application/verification, customer account, and WhatsApp message copy.
- Add admin nav item `/admin/support`.

## J. WhatsApp support flow

Current foundation:
- Webhook already verifies signatures and records inbound messages before routing.
- Bot already supports `HELP_TRIGGERS` and a help menu.
- Conversations can hold `flow: help` and `step`.

Proposed flow:
1. User sends `HELP`, `ISSUE`, `problem`, `complaint`, or taps a menu item.
2. Bot resolves context with phone lookup and role detection.
3. If there is one active job/booking/lead, offer context-aware options without exposing sensitive detail.
4. If multiple contexts exist, ask for broad category or send a PWA support link.
5. For FAQ categories, answer immediately and offer “Still need help?”
6. If user chooses issue/report, create a support ticket or send signed support form link.
7. Send ticket confirmation over WhatsApp.
8. When admin responds/status changes, send short WhatsApp update with ticket reference and link.

Safe fallback:
- If phone is unknown or role/context is ambiguous, do not list jobs/customers/providers. Send a generic support link and ask for a brief description.

Example WhatsApp copy:

- Help menu:
  - `Hi 👋 What do you need help with? Reply with a number: 1 Booking, 2 Active job, 3 Payment, 4 Provider/credits, 5 Verification/profile, 6 Something else.`
- Ticket confirmation:
  - `✅ We logged your support request. Ref: PAP-SUP-8F3A. Our team will reply here or in the app. Please do not send card or banking PIN details.`
- Active job issue:
  - `Sorry there is an issue with your job. Tell us briefly what happened. If safe, you can add a photo. Ref will be sent after we log it.`
- Admin response update:
  - `Update on PAP-SUP-8F3A: our team replied in Plug A Pro. Open your support ticket: {link}`
- Unknown context:
  - `I can help, but I could not safely match this number to one active Plug A Pro job. Please open this secure support form: {link}`

Privacy rules:
- Do not include full addresses, payment details, provider private details, or customer private details in WhatsApp support copy.
- Use references and secure links for details.
- Store inbound WhatsApp WAMID on ticket/message for audit.

## K. Admin support inbox design

Statuses:
- NEW
- IN_REVIEW
- WAITING_FOR_USER
- WAITING_FOR_PROVIDER
- ESCALATED
- RESOLVED
- CLOSED
- REOPENED

Priority logic:
- URGENT: safety complaint, active job in progress with provider no-show/unreachable, fraud/security concern.
- HIGH: payment issue, paid credit/top-up not credited, active booking/quote blocker, verification blocker for approved provider.
- NORMAL: profile/setup/help/general booking changes.
- LOW: general FAQ, feature feedback, non-urgent suggestions.

SLA thinking:
- Active job/safety/payment issues: visible immediately; target first response within 15-30 minutes during operating hours.
- Provider credit acceptance blockers: target within 30 minutes because monetisation and job conversion are affected.
- Verification/profile issues: same business day unless blocking current job acceptance.
- General questions: show FAQ first; human response within one business day.

Admin detail view:
- Header: ticket ref, status, priority, requester role, category, channel, age/SLA.
- Context cards: linked job/request/booking/payment/provider/lead/dispute with role-appropriate admin links.
- Conversation: user-visible messages and admin responses.
- Internal notes: never visible to users.
- Timeline: status changes, assignment, priority changes, linked entity changes, WhatsApp confirmations.
- Actions: respond, add note, assign, escalate, close, reopen, create/link dispute, send WhatsApp update.

## L. FAQ/self-help design

Current finding:
- WhatsApp has a hard-coded FAQ/help flow. No equivalent PWA support centre/knowledge-base was found.
- AI-related libraries and `lib/ai-loop/*` exist for internal improvement candidates, but there is no user-facing AI support bot or approved knowledge base.

MVP approach:
- Start with structured FAQ cards in `lib/support-faq.ts` and render the same content in PWA and WhatsApp.
- Use rule-based answers by category before ticket creation.
- Always offer “Still need help?” and do not block ticket creation.
- Admin should tag resolved tickets as FAQ candidates; later, convert common answers into approved content.
- Do not use AI to answer refunds, payments, safety, verification decisions, or provider discipline. AI may later draft suggestions for admins or answer only from approved FAQ content with citations/guardrails.

First FAQ categories:
- How booking works.
- How provider matching works.
- How credits work.
- How verification works.
- How payment works.
- What to do if provider does not arrive.
- What to do if customer is unreachable.
- How to cancel or reschedule.
- How to report a problem.
- How to contact support.

## M. Security and privacy controls

- Customers can access only their own tickets and tickets linked to their owned requests/bookings/jobs.
- Providers can access only their own tickets and tickets linked to their provider profile, leads, jobs, credits, payments, or verification records.
- Admins must use `requireAdmin`/role checks; sensitive support actions should use `crudAction`/audit.
- Admin notes remain separate from user-visible messages.
- Ticket detail loaders must not infer or expose whether another user’s ticket/job/payment exists; redirect/not-found safely.
- WhatsApp inbound messages are already signature-verified; support routing must keep using this webhook path.
- Attachments must use existing upload validation, size/type limits, malware-safe storage assumptions, and `/api/attachments/[id]` authorization checks.
- Avoid stack traces or internal codes in user-visible support errors.
- Add duplicate/spam controls: one open ticket per category/entity within a short window; rate limit WhatsApp ticket creation by phone; collapse repeated HELP messages into the same conversation.
- Do not let AI make binding statements about refunds, payments, disciplinary action, KYC approval, or credit reversals.
- POPIA: minimize WhatsApp content; store only required ticket context; avoid unnecessary cross-role personal data in ticket list cards; record access/audit for admin actions.

## N. Implementation plan

### Phase 1: Discovery and source map

Files/directories inspected:
- `app/(customer)/bookings/[id]/page.tsx`
- `app/(customer)/requests/[id]/page.tsx`
- `app/(provider)/provider/jobs/[jobId]/page.tsx`
- `app/(provider)/provider/credits/page.tsx`
- `app/(provider)/provider/profile/page.tsx`
- `app/(provider)/provider/application/page.tsx`
- `app/(admin)/admin/disputes/page.tsx`
- `app/(admin)/admin/disputes/actions.ts`
- `app/api/webhooks/whatsapp/route.ts`
- `lib/auth.ts`
- `lib/jobs.ts`
- `lib/cases.ts`
- `lib/admin-nav-routes.ts`
- `lib/whatsapp-bot.ts`
- `lib/whatsapp-flows/help.ts`
- `lib/provider-whatsapp-job-commands.ts`
- `prisma/schema.prisma`

Current support-related functionality found:
- Job disputes from both customer and provider job detail.
- Admin disputes queue with claim/release/update and optional case timeline/notes.
- Internal case lifecycle and case notes.
- WhatsApp FAQ/help flow.
- Message event and inbound WhatsApp audit records.
- Reviews and quote feedback.

Current WhatsApp and job touchpoints:
- Inbound signature verification/dedupe/process in webhook.
- Bot HELP/status/cancel/reschedule/job/provider commands.
- Job state machine sends customer updates.
- Provider commands can update job status after ownership checks.

### Phase 2: MVP design

- Add support data model and migration.
- Create `lib/support-tickets.ts`, `lib/support-faq.ts`, `lib/support-priority.ts`, `lib/support-notifications.ts`.
- Add customer/provider support routes and linked form actions.
- Add admin support inbox/detail actions.
- Add WhatsApp HELP/ISSUE route enhancements and confirmation messages.
- Add audit events and basic status history.

### Phase 3: Build MVP

- Ticket creation from customer request/booking and provider job/credits/profile/verification.
- Linked job/booking/payment/provider ticket context.
- Admin queue with filters and detail page.
- Admin response and close/reopen.
- WhatsApp confirmation and admin response notifications.
- Basic FAQ cards shared between PWA and WhatsApp.
- Audit logging for create/respond/status/internal note/assignment.

### Phase 4: Improve

- SLA dashboard and breached support ticket indicators.
- Better category/subcategory management.
- AI-assisted FAQ suggestions for admins only.
- Auto-tagging/priority suggestions.
- Duplicate detection and ticket merge.
- Support analytics by category/channel/role/SLA.
- Attachment previews and media from WhatsApp.

## O. Acceptance criteria

- Customer can raise a support issue from a request, booking, quote, payment, or account context.
- Provider can raise a support issue from job, credits, verification, application, or profile flow.
- General help is available from customer and provider PWA.
- WhatsApp users can reply HELP/ISSUE and receive FAQ, support link, or ticket confirmation.
- Admin can see all support tickets in one inbox.
- Admin can respond and close/reopen tickets.
- User receives confirmation when an issue is logged.
- User receives updates when admin responds or status changes.
- Tickets can link to job requests, bookings, jobs, leads, payments/payment intents, providers, disputes, or general account issues.
- Access is role-protected and ownership-checked.
- User cannot access another user’s ticket.
- Admin notes are not visible to users.
- Support actions are auditable.
- Basic FAQ/self-help content exists for common questions.
- Existing disputes, job lifecycle, payments, wallet ledger logic, WhatsApp notifications, and admin routes continue to work.

## P. Risks and edge cases

- Duplicate `Dispute` and `SupportTicket` records for the same job issue. Mitigation: link ticket to existing dispute or create dispute only for formal cases.
- Provider/customer dual-role or pending-provider accounts. Mitigation: use existing auth/session/provider eligibility resolution and explicit requester role.
- WhatsApp phone maps to no user or multiple contexts. Mitigation: generic support form link and no context disclosure.
- Active job issue after hours. Mitigation: priority/SLA flag and clear expectation copy.
- Payment/credit issue might require ledger reversal. Mitigation: support ticket can request review, but any wallet change must still go through ledger-first wallet services.
- Attachment abuse. Mitigation: file validation, size/type limits, rate limits, auth-protected reads.
- Admin accidentally sends internal notes to users. Mitigation: separate tables/components and default internal-only path for notes.
- AI hallucination/refund promises. Mitigation: no user-facing AI in MVP; use approved FAQ/rule-based responses only.
- WhatsApp template/freeform restrictions. Mitigation: use user-initiated service window where available; otherwise send approved template with ticket reference/link.

## Q. Open questions

1. Should formal job disputes remain separate from general support, or should all dispute creation happen through a support ticket that can escalate into `Dispute`?
2. What are Plug A Pro’s support operating hours and target first-response SLAs for South African launch operations?
3. Which admin roles may view payment/credit support, verification support, and safety complaints?
4. Should customers/providers see a full ticket history in MVP or only confirmation/status messages?
5. What attachment limits and media retention policy should apply to support photos/documents?
6. Should support ticket references be sequential/human-friendly (`PAP-SUP-1234`) or keep cuid suffixes?
7. Which WhatsApp templates are already approved for support updates, and which new templates are required?
8. Should FAQ content be hard-coded for MVP or editable by admins from `/admin/settings` later?

# Support AI self-help direction

Date: 2026-06-14
Status: logged direction
Related plan: `field-service/docs/openbrain/2026-06-14-support-help-feedback-implementation-plan.md`

## Root decision

Build support in layers:

1. Add a support ticket foundation and `/admin/support` module inside the existing admin platform.
2. Keep `admin.plugapro.co.za` as the operating system for admins. Do not replatform or redesign existing admin pages.
3. Add a guardrailed AI self-help assistant only after the support ticket, FAQ/knowledge, and ticket escalation foundations exist.

## Admin platform boundary

The support desk is an additive module, not a replacement for existing admin workflows.

- Existing dispatch, bookings, disputes, payments, provider wallets, verification, applications, messages, cases, and audit pages stay in place.
- `/admin/support` handles intake, triage, assignment, user-visible responses, internal notes, and escalation.
- Domain-specific actions remain in their existing services and admin pages.
- Support tickets can link to existing disputes, cases, payments, wallets, jobs, bookings, requests, leads, providers, and verification records.
- Support tickets must not mutate wallet balances, payment outcomes, verification outcomes, provider status, dispatch decisions, or dispute resolutions directly.

## AI self-help product direction

Add a Plug A Pro-specific assistant for self-help. It is a support interface, not a general chatbot.

The assistant may use OpenAI, Anthropic, or another approved model provider through a local adapter, but its behavior must be constrained by Plug A Pro-owned prompts, retrieval, authorization checks, redaction rules, and escalation policy.

## User modes

### Logged-in customer or provider

The assistant can:

- Answer questions from approved Plug A Pro knowledge.
- Read the user's own authorized context through server-side tools.
- Summarize safe next steps for the user's profile, request, booking, job, provider application, verification summary, wallet summary, credit/top-up status, and support ticket history.
- Create or append to a support ticket when the issue needs human review.

The assistant cannot:

- Reveal cross-role private data.
- Reveal internal notes, case notes, audit logs, hidden scoring, or risk flags.
- Make binding decisions about refunds, wallet credits, KYC, provider discipline, dispute resolution, cancellation penalties, or dispatch.
- Mutate payments, wallet ledger entries, verification state, provider status, bookings, disputes, or jobs.

### Anonymous or unknown user

The assistant can:

- Answer public Plug A Pro support questions.
- Explain how booking works, how provider onboarding works, service availability basics, broad pricing model guidance, cancellation/reschedule basics, and how to contact support.
- Route the user to sign in, start onboarding, create a request, or open a generic support ticket.

The assistant cannot:

- Discuss account-specific records.
- Confirm payment, booking, wallet, credit, verification, dispute, or support ticket status.
- Reveal internal operations logic or private policy details.

## Knowledge boundary

The assistant must answer from an approved Plug A Pro knowledge base only.

Initial source candidates:

- `field-service/lib/support-faq.ts`
- Public help/FAQ copy used by WhatsApp and PWA support.
- Approved policy snippets for booking, matching, cancellations, rescheduling, credits, verification, payments, disputes, safety, and support hours.
- Admin-approved FAQ candidates from resolved support tickets.

Do not use raw private tickets, internal notes, case notes, audit logs, payment payloads, KYC documents, or WhatsApp transcripts as unrestricted model context.

## Escalation to support tickets

The assistant must create or link a support ticket when:

- The user reports safety, fraud, harassment, no-show, damage, active-job trouble, payment, credit, verification, account access, or dispute issues.
- The issue needs a human/admin decision.
- The answer would require a domain mutation.
- The user asks for a human.
- The assistant cannot answer from approved knowledge with confidence.

AI-origin tickets should store:

- requester identity and role when known.
- channel/source as AI assistant.
- sanitized conversation summary.
- linked entity IDs only after server-side ownership checks.
- escalation reason.
- no hidden prompt, chain-of-thought, or private model metadata.

## Recommended build order

1. Support schema and services.
2. Customer/provider PWA support ticket creation.
3. Admin support inbox.
4. WhatsApp HELP/ISSUE ticket routing.
5. Shared FAQ/knowledge registry and support analytics.
6. Anonymous public-only self-help assistant.
7. Logged-in assistant with authorized context tools.
8. Assistant-to-ticket escalation.
9. Admin-facing AI suggestions, if useful, after ticket workflows prove stable.

## Guardrails and tests

Required tests before user-facing AI:

- Anonymous user cannot get account-specific data.
- Customer cannot infer provider-private data.
- Provider cannot infer customer-private data outside authorized job context.
- Prompt-injection attempts cannot reveal system prompts, internal notes, or hidden data.
- Refund, credit, verification, dispute, and dispatch decisions are escalated, not answered as binding outcomes.
- Assistant creates a support ticket for sensitive issues.
- Assistant refuses non-Plug A Pro questions or redirects them to general support.

## Current recommendation

Do not start with the AI assistant. Start with the support ticket foundation and admin support inbox. The assistant depends on that foundation because its safest and most useful action is not "answer everything"; it is "answer approved low-risk questions and escalate everything else into the support workflow."

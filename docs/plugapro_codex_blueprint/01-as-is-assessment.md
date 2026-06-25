# 01 — As-Is Assessment

## Task to execute

Perform a full as-is assessment of the current Plug A Pro implementation before changing the product journeys.

## Why this is needed

The app already has working pieces: WhatsApp onboarding, provider approval, lead messages, secure lead links, provider credits, image handling, Worker Portal login, and customer ticket views.

Before implementing the Qualified Shortlist Model, we need to understand what exists, what can be reused, and what must change.

Do not make code changes in this task unless they are harmless documentation or report generation changes.

## Scope

Assess these areas:

1. Service provider onboarding
2. Provider approval and profile model
3. Client service request flow
4. Customer request image handling
5. Lead matching and lead invite model
6. Provider lead acceptance
7. Credit ledger and credit balance model
8. Secure lead / job links
9. WhatsApp templates and notification services
10. Worker Portal and customer PWA routes
11. Admin console capabilities
12. Database schema and migrations
13. Existing tests

## Investigation commands / searches

Search the codebase for:

```text
provider
provider_application
application approved
Find Work
Join Plug A Pro
lead
lead_invite
match
matching
shortlist
credit
credits
ledger
balance
customer request
service request
request_attachments
attachments
View Lead
Accept Lead
Unlock
WhatsApp
webhook
button_reply
interactive
worker portal
admin provider
terms
APP_PUBLIC_URL
localhost
```

## Specific questions to answer

### Provider onboarding

- How does a provider currently apply?
- Is onboarding WhatsApp-only, PWA-only, or both?
- Which fields are captured?
- Where are they stored?
- What does “approved” currently mean?
- Does approval create or link a Worker Portal login identity?
- Are starter credits awarded on approval?

### Client service request

- How does a client currently submit a request?
- Which fields are captured?
- Are photos stored in app-controlled storage?
- How is address data stored?
- Is exact address hidden from providers before acceptance?
- Does the request have clear lifecycle states?

### Matching and lead flow

- How are providers matched today?
- Is matching sequential, random, score-based, manual, or first available?
- Does the current flow push directly to one provider?
- Are multiple providers supported?
- Are lead invites separate from jobs?
- Is there a response deadline?
- What happens on expiry?

### Credits

- Is there a proper ledger or only a balance field?
- When are credits deducted today?
- Is credit deduction atomic with job assignment?
- Are promo/starter and purchased credits separate?
- Are balances shown in WhatsApp and Worker Portal?

### WhatsApp

- Which templates exist?
- Which messages include app links?
- Are any links using localhost?
- Are interactive button payloads stable?
- Are webhook replies idempotent?

### Admin

- Can admin approve/reject/suspend providers?
- Can admin approve categories separately?
- Can admin view matching results?
- Can admin manually override matching?
- Can admin adjust credits with audit reason?

## Output required

Create an implementation assessment report:

```text
docs/implementation-assessment/as-is-assessment.md
```

The report must include:

1. Current architecture summary
2. Current data model summary
3. Current provider onboarding flow
4. Current client request flow
5. Current matching and lead flow
6. Current credit flow
7. Current WhatsApp template inventory
8. Current admin capability inventory
9. Current test coverage
10. Gaps against the Qualified Shortlist Model
11. Reuse recommendations
12. Change recommendations
13. Risks and unknowns

## What good output looks like

A clear report that lets the team decide the next implementation steps without guessing.

It should include exact file paths, table/model names, API route names, and template names found in the codebase.

## Acceptance criteria

- No production behaviour changed.
- All three journeys are assessed.
- Current schema/tables/models are documented.
- Existing WhatsApp templates are listed.
- Existing API routes/server actions are listed.
- Existing status values are listed.
- Major gaps are identified.
- Reuse candidates are identified.
- Risks are documented.
- OpenBrain implementation note is logged.

## Risks / edge cases

- The existing implementation may have overlapping concepts: request, ticket, lead, job, invite.
- Do not rename or migrate anything yet.
- Do not create new tables yet.
- Do not delete existing flows.

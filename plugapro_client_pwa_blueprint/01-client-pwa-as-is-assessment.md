# 01 — Client PWA As-Is Assessment

## Task

Perform a focused as-is assessment of the current Client PWA experience and its WhatsApp handoff behaviour.

Do not implement product changes in this step unless needed to generate assessment documentation.

## Why

The existing journey is WhatsApp-first. The PWA likely already has customer request, ticket, secure link, photo, or status pages. We must understand what exists before designing new PWA screens.

## Inspect

Search for:

```text
client
customer
request
service request
ticket
view ticket
secure token
shortlist
provider profile
matching
photo upload
address
WhatsApp link
handoff
public URL
ticket token
request status
job status
```

Inspect:

```text
routes
pages/app router
components
API routes/server actions
WhatsApp message link generation
secure token resolver
customer ticket view
request form
photo upload
address capture
tests
```

## Questions to answer

1. What client-facing PWA routes exist today?
2. What WhatsApp links currently open the PWA?
3. What secure token/link model exists?
4. Does the PWA resolve current backend state or show static pages?
5. Does a client request form exist?
6. Does photo upload exist?
7. Does address capture exist?
8. Does a customer ticket/request page exist?
9. Does a shortlist page exist?
10. Does a provider profile page exist?
11. Does job tracking exist?
12. What request/job statuses are rendered today?
13. What customer fields are currently captured?
14. What privacy rules are currently enforced?
15. What is missing for the Qualified Shortlist Model?

## Required output

Create:

```text
docs/client-pwa-execution/001-client-pwa-as-is-assessment-output.md
```

The output must list:

```text
existing client routes
existing components
existing APIs/server actions
existing WhatsApp handoff links
existing token/access model
existing request states
existing gaps
reuse recommendations
implementation risks
```

## Acceptance criteria

- No major product changes made.
- Current Client PWA surfaces are documented.
- Current WhatsApp → PWA handoff is documented.
- Gaps against the new client journey are identified.
- OpenBrain note is included.

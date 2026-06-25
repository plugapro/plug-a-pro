# 14 — Provider Security, Token, and Access Rules

## Task

Audit and harden provider WhatsApp and PWA access control.

## Required rules

1. WhatsApp sender number must map to the correct provider.
2. Secure tokens must be scoped to the provider, lead, job, or application.
3. Provider can view only own opportunities and jobs.
4. Provider safe preview excludes protected customer fields.
5. Full customer details unlock only after selected provider acceptance.
6. Non-selected providers cannot access accepted job details.
7. Expired/superseded invites cannot unlock full details.
8. Image access requires authorization.
9. Admin-only data must not appear in provider PWA or WhatsApp.

## Protected customer fields before acceptance

```text
customer phone
customer email
street address
house number
unit number
complex details
access notes
GPS coordinates
private notes
```

## Implementation requirements

1. Enforce access server-side.
2. Do not rely on frontend hiding or WhatsApp copy alone.
3. Add tests for unauthorized access.
4. Add tests for wrong WhatsApp sender.
5. Add tests for secure token scope.
6. Avoid logging sensitive fields.
7. Add trace IDs for denied access.

## Acceptance criteria

- Wrong provider cannot access another provider's lead/job.
- Safe preview hides protected fields.
- Accepted provider can access full details.
- Unauthorized image access blocked.
- Tests pass.

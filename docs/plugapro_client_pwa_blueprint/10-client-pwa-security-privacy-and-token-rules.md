# 10 — Client PWA Security, Privacy, and Token Rules

## Task

Audit and harden Client PWA access control, secure token handling, and privacy behaviour.

## Required rules

1. Client can view only their own request/job.
2. Secure WhatsApp token can access only the linked request/job.
3. Secure token must be scoped and expirable.
4. Provider preview must not expose customer protected fields.
5. Client shortlist must not expose provider private fields.
6. Full customer details unlock to provider only after selected provider acceptance.
7. Images must require authorization.
8. Production links must not use localhost.

## Protected customer fields

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

## Protected provider fields

```text
provider phone
provider private address
ID/passport
private documents
reference contact details
admin notes
```

## Implementation requirements

1. Enforce rules server-side.
2. Do not rely on frontend hiding.
3. Add tests for unauthorized access.
4. Add tests for secure token scope.
5. Add tests for image access.
6. Avoid logging sensitive fields.
7. Add support trace IDs for denied access.

## Acceptance criteria

- Client token cannot access another request.
- Provider safe preview cannot access protected customer fields.
- Client cannot see provider private fields.
- Unauthorized image access blocked.
- Tests pass.

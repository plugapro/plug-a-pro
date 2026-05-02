# 10 — Ops Security, Audit, and Data Privacy

## Task

Harden Ops dashboard security, data visibility, and audit logging.

## Sensitive data

```text
customer phone
customer email
full address
access notes
GPS coordinates
provider ID/passport
provider documents
provider private phone/address
credit adjustment history
admin notes
```

## Requirements

1. Role-protect sensitive screens/actions.
2. Audit access to sensitive records.
3. Do not expose service role keys to frontend.
4. Do not expose signed URLs unnecessarily.
5. Mask phone numbers where full number is not needed.
6. Protect admin APIs server-side.
7. Log admin actions with user, timestamp, reason, target entity, and trace ID.
8. Add tests for unauthorized access.

## Acceptance criteria

- Sensitive Ops actions are role-protected.
- Sensitive views are audited.
- Unauthorized users are blocked.
- Tests pass.

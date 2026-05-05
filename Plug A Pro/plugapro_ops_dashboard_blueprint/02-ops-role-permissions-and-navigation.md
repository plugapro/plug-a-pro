# 02 — Ops Role, Permissions, and Navigation

## Task

Implement or align Ops Dashboard roles, permissions, and navigation for supporting the new journeys.

## Required roles

At minimum support role separation such as:

```text
ops_viewer
ops_agent
ops_manager
admin
finance_admin
support_agent
```

Use existing roles if already available.

## Permission examples

| Capability | Required role |
|---|---|
| View requests/jobs | ops_viewer |
| Review provider applications | ops_agent |
| Approve providers | ops_manager/admin |
| Suspend providers | ops_manager/admin |
| Adjust credits | finance_admin/admin |
| Retry notifications | ops_agent |
| View sensitive customer details | ops_agent with audit |
| View credit ledger | finance_admin/ops_manager |
| Override matching | ops_manager/admin |
| Run scheduler manually | admin |

## Navigation sections

Ops Dashboard should support:

```text
Overview
Provider Applications
Providers
Client Requests
Matching Queue
Shortlists
Jobs
Credits
Notifications
Escalations
Scheduler / Cron
Audit Log
Settings
```

## Implementation requirements

1. Reuse existing auth/role system.
2. Add missing permissions.
3. Protect server actions and API routes.
4. Do not rely on hidden UI only.
5. Add audit logging for sensitive views/actions.
6. Add navigation entries where missing.
7. Add tests.

## Acceptance criteria

- Ops navigation supports new journeys.
- Role protections exist server-side.
- Sensitive actions are protected.
- Credit adjustments require proper role.
- Provider approval requires proper role.
- Tests pass.

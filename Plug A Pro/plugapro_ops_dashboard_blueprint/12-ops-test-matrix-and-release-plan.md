# 12 — Ops Test Matrix and Release Plan

## Task

Create and implement the Ops Dashboard + Scheduler test matrix and release validation plan.

## Required tests

### Provider review

```text
ops can view pending applications
ops can approve provider
ops can reject provider
ops can request more info
approval awards starter credits once
auto-approval does not blindly approve
```

### Client request monitoring

```text
ops can view request queue
ops can view request timeline
sensitive fields require role
ops can trigger rematch where allowed
```

### Matching oversight

```text
ops can view eligible providers
ops can view excluded providers and reasons
ops can rerun matching
ops can manually include/exclude with audit
ops can view shortlist status
```

### Scheduler

```text
matching scheduler creates invites not assignments
provider review scheduler does not auto-approve blindly
expiry scheduler expires stale invites
retry scheduler retries failed notifications safely
scheduler jobs are idempotent
```

### Credits

```text
ops can view ledger
authorized user can adjust credits with reason
unauthorized user cannot adjust credits
adjustment writes ledger entry
balance reconciles
```

### Notifications

```text
ops can view failed WhatsApp messages
ops can retry failed message
retry is idempotent
production URLs do not contain localhost
```

### Security

```text
unauthorized user cannot access admin routes
sensitive view is audited
service role key not exposed
```

## Validation commands

Run:

```bash
npm test -- --run
npx tsc --noEmit
npm run lint
npx prisma validate
```

If project has e2e/admin commands, run those too.

## Manual verification

1. Review and approve provider.
2. Confirm starter credits awarded.
3. Submit client request.
4. Matching scheduler creates provider opportunities.
5. Provider responses generate shortlist.
6. Customer selects provider.
7. Provider accepts in WhatsApp.
8. Ops sees job assigned.
9. Ops sees credit ledger.
10. Ops monitors notifications.
11. Ops handles stuck/failed case.

## Acceptance criteria

- Ops Dashboard supports the three user journeys.
- Scheduler supports the new matching and approval rules.
- No blind provider auto-approval remains unless explicitly approved.
- No blind auto-assignment remains.
- Security/privacy rules are enforced.
- Tests pass.
- Execution index completed.

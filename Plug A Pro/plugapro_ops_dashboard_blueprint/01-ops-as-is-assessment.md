# 01 — Ops Dashboard As-Is Assessment

## Task

Perform a focused as-is assessment of the current internal Ops/Admin web app, scheduler/cron jobs, matching automation, provider approval automation, credit adjustment tooling, notification monitoring, and support workflows.

Do not implement product changes in this step unless needed to generate assessment documentation.

## Why

The customer, provider, and matching journeys have changed. Ops needs a dashboard and automation model that supports the new flows. Existing cron jobs may still assume old behaviours such as blind auto-match or auto-approval.

## Inspect

Search for:

```text
admin
ops
dashboard
provider review
provider approval
auto approve
auto-approval
cron
scheduler
queue
job
matching
auto match
dispatch
lead invite
shortlist
assignment
credit adjustment
ledger
notification log
whatsapp log
retry
escalation
support
manual override
```

Inspect admin routes, ops dashboard routes, server actions, APIs, scheduler/cron config, queue workers, matching services, provider approval services, credit services, notification services, WhatsApp sender logs, audit logs, and tests.

## Questions to answer

1. What Ops/Admin routes exist today?
2. What internal roles/permissions exist?
3. Can Ops review provider applications?
4. Can Ops approve/reject/suspend providers?
5. Can Ops approve categories separately?
6. Is there a 30-minute provider auto-approval cron?
7. What exactly does provider auto-approval do?
8. Is provider auto-approval safe under the new model?
9. Is there a 5-minute auto-match cron?
10. What exactly does auto-match do?
11. Does auto-match directly assign providers or create opportunities?
12. Can Ops see matching results and explain why providers were selected/excluded?
13. Can Ops manually override matching or shortlist?
14. Can Ops view credit balances and ledger?
15. Can Ops adjust credits with reason and audit?
16. Can Ops monitor WhatsApp notification failures?
17. Can Ops retry failed notifications?
18. Can Ops view job lifecycle and escalations?
19. What audit logs exist?
20. What gaps exist against the new journeys?

## Required output

Create:

```text
docs/ops-dashboard-execution/001-ops-as-is-assessment-output.md
```

Include existing ops routes, roles/permissions, provider review tools, matching tools, cron/scheduler jobs, credit tools, notification monitoring, job support tools, gaps, reuse recommendations, and risks.

## Acceptance criteria

- No major product changes made.
- Current Ops/Admin app is documented.
- Current cron/scheduler behaviour is documented.
- Current auto-approval behaviour is documented.
- Current auto-matching behaviour is documented.
- Gaps against new model are identified.
- OpenBrain note is included.

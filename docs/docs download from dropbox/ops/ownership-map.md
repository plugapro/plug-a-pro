# Plug-A-Pro Operational Ownership Map

## Journey Ownership

| Journey | Owner type | Primary monitor | Alert target | Runbook |
| --- | --- | --- | --- | --- |
| Customer registration and OTP | engineering + security | `/api/health`, auth error events, rate-limit events | auth/security on-call | `docs/ops/runbooks/auth-otp.md` |
| Customer booking request | engineering + operations | booking API errors, application error events | operations on-call | `docs/ops/runbooks/matching-dispatch.md` |
| Customer uploads | engineering + security | attachment proxy errors, upload validation failures | platform/security on-call | `docs/ops/runbooks/uploads.md` |
| WhatsApp inbound/outbound messaging | engineering + operations | message events, webhook errors, WhatsApp health | operations on-call | `docs/ops/runbooks/whatsapp.md` |
| Provider lead review/unlock | engineering + operations | lead events, wallet ledger failures, auth errors | operations on-call | `docs/ops/runbooks/matching-dispatch.md` |
| Provider credit top-up/payment | engineering + finance operations | payment intent status, webhook errors, ledger mismatch | operations + finance owner | `docs/ops/runbooks/payments.md` |
| Technician job execution | operations | job status events, upload errors | operations on-call | `docs/ops/runbooks/matching-dispatch.md` |
| Admin queues and recovery | operations + engineering | admin dashboard, case queues, audit logs | operations lead | `docs/ops/runbooks/database.md` |
| Public status page | platform/SRE | `/api/health`, status model | platform/SRE | `docs/ops/runbooks/rollback-recovery.md` |

## Not-Monitored Inventory

These user-visible journeys must not be represented internally as fully monitored until explicit probes exist.

| Area | Current state | Required probe | Owner type |
| --- | --- | --- | --- |
| Browse/search service cards | inferred from platform health | browser smoke or API probe for service listing | engineering |
| Provider search | inferred from DB/API health | provider search API probe with seeded provider | engineering |
| Payment initiation | config-level visibility only | payment provider sandbox token/probe and webhook loopback | engineering + operations |
| Job completion flow | dashboard/audit visibility | seeded technician completion E2E | operations |
| Email/SMS notifications | no dedicated health probe | provider-specific delivery probe | platform/SRE |
| Dispute/support queue | dashboard visibility | queue freshness and assignment-age probe | operations |
| Audit log delivery | DB model exists | write/read synthetic audit probe | engineering |

## Closure Rule

A journey may move from `not_monitored` to `monitored` only when the probe, alert threshold, owner type, and runbook are all documented and tested.

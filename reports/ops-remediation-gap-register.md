# Ops Remediation Gap Register

| Severity | Title | Domain | Evidence | Business impact | Recommendation | Priority / order |
| --- | --- | --- | --- | --- | --- | --- |
| P0 Critical | Audit payloads are too thin for reliable reconstruction | Audit / governance | `field-service/lib/crud-action.ts:73-79`, `field-service/lib/crud-action.ts:151-172` | privileged changes cannot be defended in disputes or compliance review | capture full before/after diffs, mandatory reason for high-risk actions, linked side-effect events | 1 |
| P0 Critical | No first-class case lifecycle for ops exceptions | Ops serviceability | queue pages in quotes, payments, field exceptions, bookings | ops cannot close, reopen, or narrate exception handling safely | introduce `Case`, `CaseEvent`, `CaseNote` model and shared UI | 2 |
| P0 Critical | Booking / quote / payment / dispute / message CRUD is not operationally complete | Transaction operations | `bookings/[id]`, `quotes`, `payments`, `disputes`, `messages` admin pages | platform cannot be run end-to-end by operations when flows fail | build safe correction, reschedule, reconciliation, and retry workflows | 3 |
| P1 High | Customer correction tooling does not match the canonical schema | Customer support | structured `Address[]` exists, admin edits free-text `address` only | support changes can create silent data inconsistency | add first-class address and identity correction tooling | 4 |
| P1 High | Provider enforcement actions do not persist structured reasons | Trust / provider ops | `setProviderStatusAction()` ignores persisted reason targets | suspensions/bans are weakly defensible | store status reasons in canonical fields and provider notes | 5 |
| P1 High | Queue activity panels can miss actual admin actions | Ops supervision | entity-type casing mismatches across audit queries and writes | operators get false negative activity views | normalize audit entity constants and backfill/repair where needed | 6 |
| P1 High | Role model is cumulative and overbroad | Permissions | `ROLE_HIERARCHY`, widespread `requireAdmin()` use | overshared access to PII and sensitive tools | replace hierarchy-only logic with explicit action permissions | 7 |
| P1 High | Sensitive CSV export is too broadly available | Privacy / governance | customer/provider export routes gated only by `requireAdmin()` + flag | unnecessary data-exfiltration risk | add explicit export permission and export audit events | 8 |
| P1 High | Static/reference data management is incomplete | Configuration safety | settings page read-only; reason/template/fee config absent | ops cannot correct rules safely without engineering | move operational rules into governed reference-data tables | 9 |
| P1 High | Payment and messaging recovery controls are underpowered | Finance / support recovery | refund-only payment workflow, read-only message log, webhook 200 on handler error | silent failure and manual workarounds | add reconciliation, resend, retry, and recovery-safe webhook handling | 10 |
| P2 Medium | Feature flags default disabled and readiness is easy to overestimate | Launch operations | `seed-flags.ts`, `flags.ts`, rollout doc | screens may exist while real operations remain read-only | add launch readiness checklist and admin flag visibility | 11 |
| P2 Medium | Marketing app lint remains red | Delivery assurance | `marketing npm run lint` failed locally | CI hygiene and release confidence gap | fix lint baseline so assurance sweeps can rely on the declared quality gate | 12 |

## Recommended remediation sequence

### Wave 1: Pre-launch blockers

1. Audit diff capture
2. Case lifecycle foundation
3. Transactional ops workflows for bookings, quotes, payments, disputes, and messages

### Wave 2: Data stewardship and role hardening

1. Customer address/conversation/admin-workspace improvements
2. Provider enforcement and trust-history hardening
3. Explicit permission matrix and sensitive export control

### Wave 3: Configuration and resilience

1. governed operational reference data
2. payment/message reconciliation
3. launch checklist and visibility tooling

## Current ops readiness statement

**Plug-A-Pro is not yet operationally credible for production support at normal failure rates.**  
It is a strong foundation with visible queues and partial interventions, but it still lacks the controlled CRUD, audit depth, exception-handling model, and permission discipline required for ops to run the platform safely on their own.

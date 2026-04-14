# Plug-A-Pro Platform Hardening Implementation Plan

Date: 2026-04-13  
Source audits:
- [platform hardening audit](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-platform-hardening-audit.md:1)
- [customer journey hardening](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-customer-journey-hardening.md:1)
- [provider journey hardening](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-provider-journey-hardening.md:1)
- [ops journey hardening](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-ops-journey-hardening.md:1)
- [security and architecture closure](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:1)

## Goal

Turn the audit findings into a practical hardening backlog that:
- preserves current product intent
- prioritizes risk reduction over new capability
- drives to zero untriaged material issues in accessible scope
- separates code fixes from manual validation and governance decisions

## Implementation Principles

1. No net-new product features.
2. Prefer server-side enforcement over client-side assumptions.
3. Prefer safe error contracts over raw exception leakage.
4. Keep mutations auditable where they materially affect money, jobs, users, or access.
5. Do not make storage, token, or RBAC model changes blindly; stage them behind explicit rollout steps.

## Delivery Structure

The work is split into three tracks:
- `Track A`: code hardening work that can be implemented safely now
- `Track B`: manual validation and penetration testing required before claiming closure
- `Track C`: product-owner or governance decisions required before further code changes

## Current Status

Already completed in code:
- auth recovery and safe redirect hardening
- customer identity continuity and customer-owned access enforcement
- provider duplicate identity hardening and safer provider error handling
- ops queue routing and claim semantics
- admin mutation re-checks and safer privileged error handling
- final route-contract hardening for dispatch, quote-token, and provider extra-work flows

Open work in this plan focuses on the remaining residual risks and the closure activities needed to move from “audited and partially hardened” to “operationally hardened with explicit residual sign-off”.

## Priority Workstreams

### Workstream 1: Attachment Privacy Hardening
- Priority: `P0`
- Risk reduced:
  - direct exposure of customer/provider/job artifacts if raw blob URLs leak
- Source findings:
  - [platform audit H-009](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-platform-hardening-audit.md:1)
  - [security closure finding 3](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:35)
- Scope:
  - review [storage.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/storage.ts:1)
  - review [attachments route](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/attachments/[id]/route.ts:1)
  - replace public-addressable artifact access with private or signed access semantics
  - remove any unnecessary raw blob URL exposure from persisted records and client payloads
- Acceptance criteria:
  - raw storage URLs are no longer sufficient to access protected attachments
  - customer/provider/admin attachment access still works through the authorized app path
  - attachment regressions are covered by tests where practical
- Current execution state:
  - partially implemented in Codex
  - randomized blob pathnames added for new uploads
  - raw blob URLs no longer echoed back to upload clients
  - attachment proxy now resolves a server-side blob download URL before fetching blobs
  - full private-blob write/read migration remains blocked by the current `@vercel/blob` SDK/runtime support in this repo, which is still public-upload oriented
- Notes:
  - requires careful rollout because existing stored URLs and caches may need migration handling

### Workstream 2: Tokenized Approval Flow Abuse Resistance
- Priority: `P0`
- Risk reduced:
  - replay, stale-link reuse, and token abuse on public quote and extra-work flows
- Source findings:
  - [customer journey payment/approval findings](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-customer-journey-hardening.md:1)
  - [security closure finding 5](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:53)
- Scope:
  - review [api/quotes/[token]/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/quotes/[token]/route.ts:1)
  - review [app/(customer)/approve/[token]/page.tsx](/Users/shimane/Projects/Plug-A-Pro/field-service/app/(customer)/approve/[token]/page.tsx:1)
  - review [jobs.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/jobs.ts:227)
  - manually test token replay, token guessing resistance, stale-tab conflicts, shared-device behavior, and expired-state handling
  - only then implement any token lifecycle changes that are justified by the test results
- Acceptance criteria:
  - manual test results are documented
  - if weaknesses are confirmed, remediation is specified with rollout steps
- Notes:
  - this is intentionally split into test-first because the product currently depends on low-friction public approval flows

### Workstream 3: Admin vs Owner RBAC Separation
- Priority: `P1`
- Risk reduced:
  - over-broad privilege sharing across sensitive admin actions
- Source findings:
  - [security closure finding 4](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:44)
- Scope:
  - review all `requireAdmin()` protected surfaces
  - classify actions into:
    - standard ops/admin
    - privileged owner-only
  - encode the distinction in route guards and sensitive server actions if product confirms the split
- Acceptance criteria:
  - privileged actions are explicitly enumerated
  - guard behavior matches agreed governance
  - regression coverage exists for at least one owner-only and one admin-allowed path
- Notes:
  - blocked until governance decides whether `owner` is a real stronger role or just an alias

### Workstream 4: Audit Completeness For Privileged Operations
- Priority: `P1`
- Risk reduced:
  - weak operator accountability and incident traceability
- Source findings:
  - [ops journey hardening](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-ops-journey-hardening.md:1)
  - [security closure architecture finding 3](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:96)
- Scope:
  - extend audit coverage to:
    - queue claim/release
    - failed refund attempts where operationally relevant
    - other materially privileged state changes still outside audit
- Acceptance criteria:
  - material privileged ops actions have durable audit records with actor, entity, before/after where appropriate
  - audit additions do not break existing flows or introduce false positives
- Current execution state:
  - partially implemented in Codex
  - queue claim/release now records audit events through the shared ops queue helper
  - remaining auditability follow-up is focused on failed privileged attempts where operationally useful

### Workstream 5: Shared Validation For High-Risk Write Paths
- Priority: `P2`
- Risk reduced:
  - inconsistent validation and hard-to-maintain route-local rules
- Source findings:
  - [security closure architecture finding 5](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-security-architecture-closure.md:110)
- Scope:
  - identify highest-risk write endpoints:
    - booking/request creation
    - quote decision actions
    - provider job status/photo/extra-work actions
    - dispatch override actions
  - introduce shared schema validation where practical
- Acceptance criteria:
  - high-risk mutation routes use shared validation helpers or schema objects
  - tests prove invalid payload handling is consistent

### Workstream 6: Browser Regression Coverage For Hardened Flows
- Priority: `P2`
- Risk reduced:
  - route/UI regressions that pass unit tests
- Source findings:
  - [platform audit H-010](/Users/shimane/Projects/Plug-A-Pro/docs/audits/2026-04-13-platform-hardening-audit.md:1)
- Scope:
  - add a minimal smoke suite for:
    - customer request/booking tracking
    - quote approval conflict/expiry handling
    - provider job update and extra-work failure messaging
    - admin dashboard, dispatch, and field-exceptions queues
- Acceptance criteria:
  - one browser-level happy-path and one failure-path check per persona group

## Sequenced Execution Plan

### Phase 1: Immediate Risk Reduction
- Workstream 1: Attachment privacy hardening
- Workstream 4: Audit completeness for privileged operations
- Workstream 6: Browser regression coverage for the most sensitive existing flows

Rationale:
- attachment privacy is the highest remaining code-and-architecture risk
- audit completeness improves incident traceability immediately
- browser verification closes the current gap between unit coverage and actual user flows

### Phase 2: Governance-Constrained Security Hardening
- Workstream 2: Tokenized approval flow abuse resistance
- Workstream 3: Admin vs owner RBAC separation

Rationale:
- both need explicit decisions or verified abuse evidence before changing the model safely

### Phase 3: Maintainability Hardening
- Workstream 5: Shared validation for high-risk write paths

Rationale:
- important, but lower risk reduction than storage/privacy and privilege work
- best done after the more urgent security boundaries are settled

## Backlog Table

| ID | Work item | Priority | Type | Dependencies | Output |
|---|---|---|---|---|---|
| PH-001 | Replace public attachment access model with private/signed semantics | P0 | Code + rollout | storage review, attachment proxy review | secure attachment path + migration notes |
| PH-002 | Add audit logs for queue claim/release and remaining material privileged ops actions | P1 | Code | audit model review | stronger operator traceability |
| PH-003 | Add browser smoke checks for hardened customer/provider/ops flows | P2 | Test | stable seeded data or staging accounts | minimal E2E regression pack |
| PH-004 | Manually pen-test quote and extra-work token flows | P0 | Manual test | staged/public test links | abuse findings report |
| PH-005 | Split `admin` vs `owner` privileges if governance confirms stronger boundary | P1 | Product + code | governance decision | explicit RBAC model |
| PH-006 | Consolidate validation for highest-risk write endpoints | P2 | Code | route inventory | shared validation layer |

## Blocked Residuals

These are not untriaged. They are explicitly blocked pending decisions or non-code verification:

1. `Blocked on rollout design`
   - attachment storage privacy changes
   - reason: affects current asset URLs and serving behavior

2. `Blocked on manual testing`
   - public quote and extra-work token abuse resistance
   - reason: should be informed by real replay/guessing/shared-device test outcomes

3. `Blocked on governance`
   - `admin` vs `owner` privilege separation
   - reason: product/ops must define the intended authority split

4. `Blocked on operational validation`
   - browser-level verification of hardened flows
   - reason: code and unit/integration verification already exist, but leadership-ready closure needs real route checks

## Definition Of Done

This hardening plan is complete when:
- attachment access no longer depends on public blob URL secrecy
- tokenized approval flows have documented abuse-test results and any justified fixes
- privileged role boundaries are explicitly encoded or explicitly accepted as shared
- queue ownership and other material privileged actions are auditable
- browser-level smoke coverage exists for the hardened customer, provider, and ops flows
- the residual risk register is updated with only accepted or intentionally deferred items

## Leadership Readout

Current state:
- no untriaged material issues remain in accessible code scope
- the remaining material items are known, prioritized, and split between code work, manual testing, and product/governance decisions

Recommended execution order for maximum risk reduction:
1. secure attachment storage/access model
2. pen-test tokenized approval flows
3. add audit coverage for queue ownership and remaining privileged mutations
4. decide and implement `admin` vs `owner` separation if required
5. add browser-level regression coverage
6. converge route-local validation into shared schemas

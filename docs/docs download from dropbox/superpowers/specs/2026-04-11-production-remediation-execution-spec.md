# Plug A Pro Production Remediation Execution Spec

**Date:** 2026-04-11
**Status:** Ready for execution
**Primary executor:** Claude Code
**Scope:** Drive the current production implementation to a state that is aligned with marketplace business value, operational intent, and production safety requirements.

## 1. Purpose

This spec converts the production review into an execution plan.

The immediate goal is not broad refactoring. The immediate goal is to remove the highest-risk gaps that prevent the system from reliably delivering the intended marketplace outcome:

- customer creates a request
- matching starts immediately
- only real exceptions require operator intervention
- provider and customer workflows remain coherent
- production behavior no longer depends on schema incompatibility fallbacks
- sensitive artifacts remain protected

## 2. Source Of Truth

Use these documents as the requirements and product-intent baseline:

- `docs/strategy/servicemen-app/persona-clarification-document.md`
- `docs/strategy/servicemen-app/role-by-role-feature-requirements-matrix.md`
- `field-service/docs/superpowers/plans/2026-03-31-whatsapp-marketplace-journeys.md`
- `docs/superpowers/specs/2026-03-27-pap-business-case-alignment-design.md`
- `docs/release-runbook.md`
- `docs/release-readiness-tracker.md`

## 3. Product Intent To Preserve

The implementation must preserve these business outcomes:

- Plug A Pro is a marketplace, not a workforce-dispatch SaaS.
- Matching is a platform-side flow triggered by job creation.
- Admin/ops should spend time on exceptions, not on normal intake.
- Customer booking behavior must be channel-consistent across WhatsApp and web/PWA.
- Provider onboarding and approval must result in a usable provider identity.
- Sensitive customer/job artifacts must not leak through storage implementation shortcuts.

## 4. Confirmed Gaps From Review

These are confirmed findings from the code review and must be treated as facts unless disproven during implementation:

1. The web/PWA booking flow creates a `JobRequest` but does not trigger matching.
2. The WhatsApp booking flow does trigger matching.
3. Core booking creation paths are not transactional and are not idempotent.
4. Matching behavior currently depends on Prisma schema-compatibility exceptions to decide whether to use the new or legacy dispatch path.
5. Provider record creation includes schema-compatibility raw SQL, which is a short-term bridge and not an acceptable steady-state architecture.
6. Attachment authorization is incorrect for provider-owned job context.
7. Attachments are backed by public blob URLs, which is a privacy risk.
8. Provider approval creates auth users without fully aligned provider identity metadata.
9. The admin operating model is inconsistent across docs: some docs support queue-based intervention, other docs say `/admin/dispatch` should no longer exist as a live manual dispatch surface.
10. Test protection is meaningful at unit level but weak for end-to-end customer and admin journeys.

## 5. Execution Goal

Claude Code must reduce the system to a state where:

- the web/PWA booking path and WhatsApp path both start matching through the same domain service
- normal intake no longer depends on ops intervention
- matching behavior does not branch based on runtime schema errors
- core create flows are transactional and safe to retry
- attachment access rules match business expectations
- the codebase has regression protection around the main business journeys
- residual blocked decisions are documented explicitly, not buried

## 6. Hard Requirements

Claude Code must:

- preserve functional parity for working WhatsApp journeys
- avoid reverting unrelated local changes
- prefer incremental, production-safe changes over broad rewrites
- update or add tests alongside behavior changes
- run build and relevant tests after each material change set
- explicitly document anything blocked by product ambiguity or environment limitations
- log progress and outcome back into OpenBrain at the end

Claude Code must not:

- rely on schema error codes as long-term control flow
- ship new behavior that creates another channel mismatch
- weaken auth or privacy controls to make tests easier
- silently ignore unresolved residual risk

## 7. Workstreams

### Workstream A: Unify Job Request Creation And Matching Trigger

**Objective**
Create one canonical server-side domain service for job request intake that is used by both:

- web/PWA booking submission
- WhatsApp job request submission

**Required outcome**
Both paths must:

- create or resolve customer
- create address
- create job request
- start matching
- return a consistent success/failure contract

**Implementation direction**

- Extract a domain service, for example:
  - `field-service/lib/job-requests/create-job-request.ts`
- Move shared creation logic out of:
  - `field-service/app/api/customer/bookings/route.ts`
  - `field-service/lib/whatsapp-flows/job-request.ts`
- The service must support channel-specific caller needs without duplicating the core creation logic.

**Acceptance criteria**

- Web/PWA booking starts matching immediately after successful request creation.
- WhatsApp booking still starts matching immediately.
- Both paths use the same core server-side service.
- Tests cover both callers and the shared service.

### Workstream B: Add Transactionality And Idempotency To Core Intake

**Objective**
Make core create flows safe under retry and partial failure.

**Required outcome**

- customer/address/job request creation happens transactionally
- duplicate request creation risk is reduced
- failure cannot leave obviously orphaned partial state without a recovery strategy

**Implementation direction**

- Use Prisma transactions for the shared intake service.
- Introduce an idempotency key or deterministic dedupe strategy for booking submission.
- Ensure caller retry behavior is safe.

**Acceptance criteria**

- Shared intake service uses a transaction.
- Repeated submission with the same idempotency contract does not create duplicate active requests.
- Tests cover at least one retry/duplicate path and one failure path.

### Workstream C: Replace Schema-Error Fallback With Explicit Compatibility Gate

**Objective**
Remove the current production behavior where normal control flow falls back to the legacy matcher because Prisma hits missing-table or missing-column errors.

**Required outcome**

- matching mode is explicit
- deploy/migration state is visible and intentional
- runtime does not treat schema breakage as a normal branch

**Implementation direction**

- Introduce an explicit compatibility or rollout gate.
- Preferred order:
  1. ensure migrations are applied
  2. use the new matching flow as the primary path
  3. remove or sharply isolate the legacy fallback path
- If temporary fallback must remain, it must be behind an explicit feature flag or version gate, not exception-driven behavior.

**Acceptance criteria**

- No mainline dispatch path branches on `P2021` or `P2022`.
- Release notes or runbook include migration/deploy ordering.
- Build or deployment instructions clearly require migration application before rollout.

### Workstream D: Fix Attachment Security And Workflow Correctness

**Objective**
Align attachment access with real job ownership while protecting sensitive files from public exposure.

**Required outcome**

- providers can access attachments they should legitimately see for jobs they own
- unauthorized users cannot access those attachments
- storage model no longer assumes public URLs are acceptable for sensitive artifacts

**Implementation direction**

- Fix authorization logic in:
  - `field-service/app/api/attachments/[id]/route.ts`
- Review blob access model and move to a safer retrieval pattern if required.
- Keep customer and admin access semantics correct.

**Acceptance criteria**

- Provider access is based on legitimate job ownership, not only upload origin.
- Unauthorized access tests fail correctly.
- Sensitive file retrieval is not dependent on public blob secrecy.

### Workstream E: Repair Provider Identity Continuity

**Objective**
Ensure approved providers have a coherent identity across auth, provider records, and protected routes.

**Required outcome**

- provider auth creation and provider record linkage are aligned
- downstream code does not depend on metadata that is never set

**Implementation direction**

- Review:
  - `field-service/app/(admin)/admin/applications/page.tsx`
  - `field-service/lib/auth.ts`
- Either populate provider metadata consistently or remove the assumption where it is not needed.

**Acceptance criteria**

- Newly approved provider accounts can sign in and resolve to the correct provider identity.
- Tests cover approval-to-login continuity.

### Workstream F: Add End-To-End Regression Protection For Core Journeys

**Objective**
Protect the business-critical paths that are currently under-tested.

**Required journeys**

1. Web/PWA customer booking:
   - submit request
   - request is created
   - matching starts

2. WhatsApp customer booking:
   - submit request
   - request is created
   - matching starts

3. Provider approval:
   - approve application
   - provider identity is usable

4. Attachment access:
   - provider can access authorized job attachments
   - unauthorized provider cannot

**Acceptance criteria**

- Add integration or E2E coverage for the journeys above.
- If full browser E2E is not yet practical, add the highest-value route/service integration tests now and document the remaining E2E gap explicitly.

## 8. Product Decision Residual To Document Explicitly

Claude Code must not silently choose a product model here.

There is an unresolved conflict around admin operations:

- Requirements/persona docs support queue-based console, SLA timers, ownership, and manual intervention tools.
- Marketplace-alignment docs say `/admin/dispatch` should be removed or replaced with a lead-management surface and that the admin console should focus on moderation and platform health.

**Required action**

At the end of implementation, Claude Code must document one of the following:

- `resolved by product decision`
- `left intentionally unchanged pending product decision`

If unresolved, it must be logged as a blocked residual and not disguised as finished work.

## 9. Files Most Likely To Be Touched

- `field-service/app/api/customer/bookings/route.ts`
- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/matching-engine.ts`
- `field-service/lib/provider-record.ts`
- `field-service/app/api/attachments/[id]/route.ts`
- `field-service/app/(admin)/admin/applications/page.tsx`
- `field-service/lib/auth.ts`
- `field-service/package.json`
- `docs/release-runbook.md`
- relevant test files under `field-service/__tests__/`

## 10. Definition Of Done

The work is done only if all of the following are true:

- the primary booking journey is channel-consistent
- matching starts from both web and WhatsApp intake
- core create flow is transactional
- duplicate/retry behavior is meaningfully safer
- matching control flow no longer relies on schema failure
- attachment authorization is corrected
- sensitive attachment delivery is materially safer
- provider identity continuity is coherent
- regression tests were added or strengthened for the core journeys
- build and relevant tests pass
- blocked residuals are explicitly documented
- OpenBrain contains a session log with:
  - what changed
  - what remains blocked
  - what still needs product input

## 11. Claude Code Task Instruction

Use the following as the execution brief for Claude Code:

```text
Implement the production remediation spec in `docs/superpowers/specs/2026-04-11-production-remediation-execution-spec.md`.

Execution rules:
- Treat the listed review findings as the starting facts.
- Preserve working WhatsApp behavior while removing channel mismatches.
- Do not revert unrelated worktree changes.
- Make production-safe incremental changes.
- Prefer shared domain services over duplicated route logic.
- Add or update tests for every material behavior change.
- Run build and relevant tests before finishing.
- Explicitly document all blocked residuals instead of hand-waving them away.

Priority order:
1. Unify job request creation and matching trigger across web and WhatsApp.
2. Make intake transactional and safer under retry.
3. Replace schema-error-driven matcher fallback with an explicit compatibility strategy.
4. Fix attachment authorization and privacy posture.
5. Repair provider identity continuity after approval.
6. Add regression protection for the critical journeys.

Required deliverables:
- code changes
- test changes
- any required runbook or deployment-doc updates
- a concise implementation summary
- a clear blocked residuals section
- an OpenBrain knowledge log entry summarizing:
  - what was implemented
  - what was verified
  - what remains blocked
  - what product decision is still required, if any

Do not claim completion unless the booking journey is channel-consistent and the mainline matcher path no longer depends on Prisma schema-compatibility exceptions.
```

## 12. Logging Requirement

When Claude Code finishes, it must write an OpenBrain knowledge log for project `Plug A Pro` with tags similar to:

- `domain:engineering`
- `production-hardening`
- `marketplace`
- `matching`
- `security`
- `release-readiness`

The log must include:

- implementation scope completed
- tests/build/browser verification performed
- any blocked residuals
- next recommended follow-up

## 13. OpenBrain Connector Repair Instruction

There is a confirmed operational failure outside the codebase:

- OpenBrain requests are currently failing with `401 token_expired`
- This is a connector authentication problem, not an application code problem

Claude Code must handle this explicitly.

### Required behavior

1. Attempt the OpenBrain write at the end of execution.
2. If OpenBrain returns `401 token_expired`, do not silently skip logging.
3. Record in the final handoff that:
   - the implementation work is complete or partially complete
   - the OpenBrain write was attempted
   - the OpenBrain connector is blocked by expired authentication
   - user action is required to reconnect the OpenBrain connector
4. Preserve the exact log payload in the final handoff so it can be replayed after reconnection.
5. After the connector is re-authenticated, Claude Code must retry the exact OpenBrain knowledge log write.

### Claude Code repair instruction

Use the following instruction if the OpenBrain failure is still present:

```text
Repair the OpenBrain logging failure as an operational follow-up.

Rules:
- First retry the intended OpenBrain log write.
- If the connector still fails with `401 token_expired`, treat this as an external auth failure, not a code bug.
- Do not claim the logging requirement is satisfied.
- In the final handoff, include:
  - `OpenBrain log status: BLOCKED`
  - the exact connector failure (`401 token_expired`)
  - the exact knowledge-log payload that should be written after reconnect
  - a clear operator instruction: reconnect OpenBrain, then retry the same log
- If the connector has been reconnected successfully, write the log and report `OpenBrain log status: COMPLETE`.
```

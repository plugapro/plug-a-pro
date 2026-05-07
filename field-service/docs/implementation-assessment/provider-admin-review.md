# Provider Admin Review and Approval

## Current capabilities

All provider application review actions (approve, reject, request-more-info, category-approval, claim, release) are implemented as Next.js inline server actions in `app/(admin)/admin/applications/page.tsx`.

The page shows three sections:
- **Pending** — applications with `status === 'PENDING'` only. Includes approve, reject, more-info, claim/release buttons.
- **Approved** — applications with `status === 'APPROVED'`. Shows category-level approval controls.
- **Reviewed** — all remaining statuses shown as a read-only table. This includes `MORE_INFO_REQUIRED`, `REJECTED`, and `CANCELLED`.

**Identified gap**: `MORE_INFO_REQUIRED` applications land in the read-only "Reviewed" table. The `approveApplication` action does accept `MORE_INFO_REQUIRED` as a valid input status, but the page does not render action buttons for applications in that state. An admin cannot approve or re-request info from a `MORE_INFO_REQUIRED` application without going through another path. This is a UI surface gap only — the underlying action logic is correct.

## Role guards

All six server actions wrap their mutations in `crudAction()` with:

```ts
requiredRole: ['OPS', 'ADMIN', 'OWNER']
```

`crudAction()` (`lib/crud-action.ts:108`) enforces this by:
1. Requiring an authenticated session.
2. Looking up the `AdminUser` row and checking `meetsRoleRequirement(adminUser.role, requiredRole)`.
3. Checking the `admin.crud.applications` feature flag before allowing mutations.

OPS is deliberately included — the ops team processes the application queue. FINANCE and TRUST cannot approve or reject.

The `requireAdmin()` call at the top of each action (before `crudAction`) is an additional guard that redirects unauthenticated requests before the role check runs.

**Role guard verdict: present and correct.**

## Decision audit trail

`crudAction()` writes two audit rows atomically per decision:
- `AuditLog` — general log with `actorId`, `actorRole`, `action`, `entityType`, `entityId`, `before`, `after`.
- `AdminAuditEvent` — admin-specific log with `adminId`, `action`, `entityType`, `entityId`, `before`, `after`, `metadata`.

Both rows are committed in the same Prisma transaction as the mutation, so partial writes are structurally impossible.

The `ProviderApplication.notes` field stores the admin-supplied reason for every rejection and more-info request. The `reviewedAt` and `reviewedById` fields stamp the decision.

**Audit trail verdict: present and correct.**

## High-risk category guards

High-risk categories (electrical, pest_control, air_conditioning, roofing) are defined in `lib/service-category-policy.ts` under `SERVICE_COMPLIANCE_REQUIREMENTS` with `blocksAutoApproval: true`.

The auto-approval worker (`lib/provider-auto-approve.ts`) calls `assessProviderApplicationForOpsReview()` from `lib/provider-application-review-support.ts`, which in turn calls `hasAutoApprovalBlockingServiceSelection()`. Applications with high-risk categories are skipped by the auto-approver and routed to the manual queue with reason code `HIGH_RISK_CATEGORY`.

The admin UI does not currently surface a high-risk checklist inline for pending applications. There is no warning banner or per-category evidence checklist shown to the reviewing admin. This is a UI gap — the policy data exists and is enforced in the auto-approval path, but it is not surfaced in the manual review UI.

**High-risk guard verdict: enforced in auto-approval; not surfaced in admin UI (known gap).**

## Undo approval guard

There is no "undo approval" action on the applications page. Once a `ProviderApplication` is `APPROVED`, the only way to deactivate the linked provider is through:
- `Provider.active = false` (provider suspension)
- `Provider.verified = false` (manual reset)
- The suspension/archival paths on the provider profile page

The `isApprovalUndoBlocked()` guard in `lib/provider-application-review-guards.ts` documents this invariant and can be called from any future "reverse approval" action to enforce it explicitly.

**Undo approval verdict: no accidental re-approval path exists; intentional revocation requires the provider-level suspension flow.**

## Fixes applied

No breaking changes were made. The implementation was already substantially correct. The following was added:

1. **`lib/provider-application-review-guards.ts`** — new file providing:
   - `isHighRiskCategory(category)` — single-category boolean check.
   - `requiresManualReview(application)` — structured assessment with per-category requirements, reason codes, and evidence prompts.
   - `applicationBlocksAutoApproval(application)` — thin boolean wrapper.
   - `isApprovalUndoBlocked(application)` — documents the terminal-state invariant.
   - `buildManualReviewSummary(application)` — returns a human-readable review reason for UI tooltips and WhatsApp messages.

These functions are pure (no I/O), draw from the existing `SERVICE_COMPLIANCE_REQUIREMENTS` in `service-category-policy.ts`, and are safe to call from server actions, API routes, or tests.

## Files changed

| File | Change |
|------|--------|
| `lib/provider-application-review-guards.ts` | New — centralised review guard helpers |
| `__tests__/lib/provider-application-review-guards.test.ts` | New — 29 unit tests |
| `docs/implementation-assessment/provider-admin-review.md` | New — this document |
| `docs/implementation-assessment/000-codex-execution-index.md` | Updated — Step 6 marked Completed |

## Tests added

File: `__tests__/lib/provider-application-review-guards.test.ts`

| Suite | Tests |
|-------|-------|
| `isHighRiskCategory` | 12 cases — all four high-risk categories, six standard categories, unknown category, case-insensitivity |
| `requiresManualReview` | 7 cases — empty skills, all-standard, mixed, deduplication, multi-high-risk, evidencePrompt presence, certificationRequiredForApproval flag |
| `applicationBlocksAutoApproval` | 3 cases — standard, high-risk, empty |
| `isApprovalUndoBlocked` | 4 cases — APPROVED (blocked), PENDING, MORE_INFO_REQUIRED, REJECTED |
| `buildManualReviewSummary` | 3 cases — null for standard, non-null for high-risk, multi-category listing |

## Test results

```
Test Files  164 passed | 1 skipped (165)
     Tests  1760 passed | 4 todo (1764)
```

New test file standalone: 29 passed / 0 failed.

## Remaining gaps

| Gap | Severity | Location |
|-----|----------|----------|
| `MORE_INFO_REQUIRED` applications shown in read-only "Reviewed" table with no action buttons, even though `approveApplication` accepts that status | Medium | `app/(admin)/admin/applications/page.tsx` — `pending` filter should include `MORE_INFO_REQUIRED` |
| Admin UI does not surface high-risk category checklist or evidence prompt to the reviewing admin | Low | `app/(admin)/admin/applications/page.tsx` — pending card could render `requiresManualReview()` output |
| Rejection reason field in the UI has `placeholder="Reason (optional)"` — reason is genuinely optional in the schema and stored as-is | Low | `RejectApplicationSchema` has `reason: z.string().optional()`; consider making it required for auditability |
| No "last-OWNER" guard in team actions | Medium | `app/(admin)/admin/team/actions.ts` (separate from applications) |
| No per-category evidence checklist tied to `ProviderApplication.attachments` in the admin review UI | Low | Would require surface-level UI work only; data model supports it |

## OpenBrain Note

Step 06 complete. `lib/provider-application-review-guards.ts` created with four guard helpers and one summary builder. 29 tests pass. Full suite 1760/1760. No schema changes. No breaking changes.

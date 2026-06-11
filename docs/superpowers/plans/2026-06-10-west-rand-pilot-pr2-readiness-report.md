# West Rand Pilot — PR2: Launch Readiness Report Implementation Plan (RETROSPECTIVE)

> **Status:** RETROSPECTIVE. Code was committed before this plan was written. Tasks below are checked `[x]` where the audit verified the shipped commit matches the spec; drift annotations describe the few deltas.
>
> **As-built commit:** `0754192f1` on `feat/west-rand-pilot-readiness` (squash-merged into `main` as `ab6910681 feat(launch): West Rand pilot readiness report (PR2 of 3) (#62)`).
>
> **Spec:** `docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md` (v2) — §3.0 PR2 row, §3.2, §3.4, §4.4, §5.2, §8.1 PR2 rows, §8.2.
>
> **Audit summary:** 6 of 7 spec requirements MATCH exactly; one DRIFT documented at the bottom (smoke-extension/nav deferral, with reason in commit message).

**Goal:** Land the admin-facing launch-readiness report — a derived provider-tier classifier (R1–R5, PENDING_R1, excluded) and a SSR page at `/admin/launch-readiness` showing per-(suburb × category) approved-provider counts, tier breakdown, electrical readiness, and thin-coverage warnings. Gated by `launch.west_rand_pilot.readiness_report` (default OFF).

**Architecture:** Pure `lib/provider-tier.ts` classifier (no DB calls; inputs passed in). Async aggregator `lib/launch/readiness-counts.ts` rolls up `db.provider.findMany` + `getElectricalReadiness()` into a `LaunchReadiness` shape. Server component `app/(admin)/admin/launch-readiness/page.tsx` calls the aggregator and renders cards + count table.

**Tech Stack:** Next.js 16 App Router, React Server Components, Prisma, Vitest, TypeScript.

---

## File Structure (as built)

| File | Status | Responsibility |
|---|---|---|
| `field-service/lib/provider-tier.ts` | Created | `classifyProviderTier(input): ProviderTier \| null`, `listMissingProfileItems(input): string[]`, `PROFILE_FIELDS_TRACKED`, friendly-label map. |
| `field-service/lib/launch/readiness-counts.ts` | Created | `getLaunchReadiness(pilotKey): Promise<LaunchReadiness>` aggregator + types. |
| `field-service/app/(admin)/admin/launch-readiness/page.tsx` | Created | SSR readiness report, flag-gated. |
| `field-service/lib/feature-flags-registry.ts` | Modified | `launch.west_rand_pilot.readiness_report` added (5 lines). |
| `field-service/__tests__/lib/provider-tier.test.ts` | Created | Table-driven tier rules. |
| `field-service/__tests__/lib/provider-tier-missing-items.test.ts` | Created | Missing-fields + friendly-label tests. |
| `field-service/__tests__/lib/launch/readiness-counts.test.ts` | Created | Aggregator: counts, electrical pass-through, thin-coverage threshold, excluded providers. |

---

## Task 1: Implement `classifyProviderTier` + `listMissingProfileItems` (TDD)

**Files:**
- Create: `field-service/lib/provider-tier.ts`
- Create: `field-service/__tests__/lib/provider-tier.test.ts`
- Create: `field-service/__tests__/lib/provider-tier-missing-items.test.ts`

- [x] **Step 1: Write failing tests for the tier table.**
  - `provider-tier.test.ts` lines 28–143 cover every spec rule:
    - PENDING_R1 when `hasApplication && applicationStatus ∈ {SUBMITTED, UNDER_REVIEW}` (lines 28–50).
    - Excluded → `null` for `status ∈ {SUSPENDED, BANNED, ARCHIVED}` (lines 52–61).
    - R5 when `kycStatus !== 'VERIFIED'` OR `payoutVerifiedAt == null` OR `missingCount >= 3` (lines 63–89).
    - R4 when 1–2 missing fields (lines 91–103).
    - R3/R2/R1 by `identityAssurance` + strikes (lines 105–143).

- [x] **Step 2: Implement the classifier (top-down first-match rules).**
  - `lib/provider-tier.ts:102–146` implements rules per spec §3.2.
  - `PROFILE_FIELDS_TRACKED` at lines 49–57: `name, phone, email, payoutVerifiedAt, skills, equipmentTags, serviceAreas`.
  - Friendly-label map at lines 54–61 (per spec §4.5).

- [x] **Step 3: Write + pass missing-items tests.**
  - `provider-tier-missing-items.test.ts` lines 20–60 cover null/empty for every tracked field and assert friendly-label mapping.

- [x] **Step 4: Commit.**
  - Shipped as part of `0754192f1` (and squash-merged as `ab6910681`).

**Audit:** MATCH spec §3.2 exactly. One clarifying note: `classifyProviderTier` returns `ProviderTier | null` (null for excluded statuses) — spec implied "all providers have a tier" but null is the right representation and the page treats null as "excluded from counts".

---

## Task 2: Implement `getLaunchReadiness()` aggregator (TDD)

**Files:**
- Create: `field-service/lib/launch/readiness-counts.ts`
- Create: `field-service/__tests__/lib/launch/readiness-counts.test.ts`

- [x] **Step 1: Write failing tests.**
  - `readiness-counts.test.ts` lines 40–148 cover:
    - Electrical pass-through (line 51–62) — delegates to `getElectricalReadiness()`.
    - Thin-coverage categories at `< 3` approved providers (lines 64–82).
    - Tier-breakdown rollup excludes suspended/banned/archived (lines 84–108).
    - Per-suburb × category approved counts honor `serviceAreas.includes(suburb) && skills.includes(category)` (lines 110–147).

- [x] **Step 2: Implement aggregator.**
  - `lib/launch/readiness-counts.ts:73–102` runs `Promise.all([getElectricalReadiness(), db.provider.findMany(...)])` then computes:
    - `LaunchReadiness.electrical` from `getElectricalReadiness()`.
    - `thinCoverageCategories: string[]` for categories with approved count `<` `THIN_COVERAGE_THRESHOLD = 3` (line 23).
    - `suburbCategoryCounts: Record<suburbSlug, Record<categorySlug, number>>`.
    - `tierBreakdown: Record<ProviderTier, number>` excluding null-tier providers.

- [x] **Step 3: Commit.**
  - Shipped as part of `0754192f1`.

**Audit:** MATCH spec §5.2 exactly.

---

## Task 3: Register flag `launch.west_rand_pilot.readiness_report`

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [x] **Step 1: Add entry near `customer.home.serviceability_v2`.**
  - Registered at `feature-flags-registry.ts:277–280` with `defaultValue: false`, `owner: 'eng'`.

**Audit:** MATCH. Default OFF as required by spec §3.4.

---

## Task 4: Build `/admin/launch-readiness` page (SSR, flag-gated)

**Files:**
- Create: `field-service/app/(admin)/admin/launch-readiness/page.tsx`

- [x] **Step 1: `export const dynamic = 'force-dynamic'` and gate on flag.**
  - `page.tsx:6` sets dynamic.
  - `page.tsx:77–80` calls `isEnabled('launch.west_rand_pilot.readiness_report')` → `notFound()` if OFF.
  - `page.tsx:76` calls `requireAdmin()`.

- [x] **Step 2: Render electrical readiness card.**
  - Lines 28–57 render `ready` (green, count vs threshold) or `not ready` (red, shortfall).

- [x] **Step 3: Render thin-coverage warning banner.**
  - Lines 59–73 list categories below threshold (yellow).

- [x] **Step 4: Render tier breakdown badges.**
  - Lines 99–116 show per-tier counts.

- [x] **Step 5: Render per-(suburb × category) count table.**
  - Lines 118–161 render suburbs as rows × categories as columns from `suburbCategoryCounts`.

- [x] **Step 6: Commit.**
  - Shipped in `0754192f1`.

**Audit:** MATCH spec §4.4 / §5.2 exactly.

---

## Task 5 (DEFERRED — DRIFT vs spec): Smoke coverage for `/admin/launch-readiness`

**Files (would-be):**
- Modify: `field-service/lib/admin-nav-routes.ts` (add nav entry → flows into `ADMIN_SMOKE_ROUTES`)
- Modify: `field-service/e2e/smoke.spec.ts` (or rely on the derived smoke route list)

- [ ] **Step 1: Add to `ADMIN_NAV_ITEMS`.**

Would be inserted in `lib/admin-nav-routes.ts`:

```ts
{ href: '/admin/launch-readiness', label: 'Launch Readiness', icon: 'reports' as const },
```

- [ ] **Step 2: Either flag-gate the smoke route or accept a 404 while OFF.**

Spec §8.2 calls for this in PR2. The shipped PR2 commit message explicitly defers:

> "Intentionally NOT added to ADMIN_NAV_ITEMS in this PR — that array also powers the smoke route list, which would 404 while the flag is off. Admins reach /admin/launch-readiness by direct URL when the flag is on; a follow-up wires nav once the route is live for ops."

**Decision recorded:** deferred to a follow-up PR. Not blocking PR2 functionality. Track as **PR2-FOLLOWUP-NAV** in OpenBrain so it doesn't get lost. Two viable paths for the follow-up:

1. Add the nav entry only when the flag is ON (admin-nav-routes.ts iterates and filters).
2. Add the smoke route conditionally (smoke spec skips if flag is OFF in CI env).

Either approach is correct; pick whichever matches the convention used for the other ops-only routes (`/admin/otp-security`, `/admin/audit-log`) that are nav-listed unconditionally today.

---

## Acceptance-criteria coverage (PR2)

| AC # | Brief | Covered by | Status |
|---|---|---|---|
| 5 (matching tests confirm KYC filter unchanged) | provider-tier doesn't relax matching | `provider-tier.test.ts` lines 28–143 | MATCH |
| 6 | Admin sees R4/R5/PENDING_R1 + electrical readiness | `launch-readiness/page.tsx`, `readiness-counts.test.ts` | MATCH |
| 11 (partial) | OpenBrain note + per-action `AdminAuditEvent` | OpenBrain log at session end; PR2 doesn't write AuditEvents (read-only page) | MATCH |

---

## Drift / surprises (full audit detail)

| Finding | Severity | Notes |
|---|---|---|
| `/admin/launch-readiness` not in `ADMIN_SMOKE_ROUTES` (spec §8.2 implies it should be) | Medium — delivery-timeline miss, not a code bug | Documented in commit message as deferral; follow-up PR required to close the gap |
| `classifyProviderTier` returns `\| null` for excluded statuses | Low | Correct representation; spec wording was ambiguous |
| `THIN_COVERAGE_THRESHOLD = 3` hardcoded | Low | Matches spec literal; future parameterisation would be its own PR |
| No outbound side effects | — | Confirmed by audit |
| No schema change | — | Confirmed by audit |

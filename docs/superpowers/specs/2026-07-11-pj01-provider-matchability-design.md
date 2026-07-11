# Design — PJ-01 / P0-6: Fix silent provider unmatchability at approval

**Date:** 2026-07-11
**Status:** Approved design, pre-plan
**Finding:** PJ-01 (Critical) / backlog P0-6, platform audit 2026-07-06
**Scope decision:** Surgical + persist `locationNodeIds`; new behaviour flag-gated (`provider.matchability.autosync`, default OFF)

---

## 1. Problem & evidence

Matching requires an **active `technician_service_areas` (TSA)** row (`lib/matching/filter.ts:219-270` — `providerCoversAddress` filters `serviceAreas.filter(a=>a.active)`; zero rows ⇒ `OUTSIDE_SERVICE_AREA` at `:581`). Approval does not reliably create those rows.

**Live prod (2026-07-11):** 61 of 135 active+verified providers (45%) have zero active TSA rows and are silently unmatchable. All 61 have a populated `Provider.serviceAreas` String[]; 128 of their 130 distinct area labels resolve to a `LocationNode` by label (2 are malformed free-text). Matchable vs unmatchable providers appear in the *same* creation weeks — so this is a per-path defect, not a time cutoff.

**Root cause (code-confirmed):** `ProviderApplication` has **no `locationNodeIds` column** (`schema.prisma:372-431`; only `ProviderApplicationDraft.locationNodeIds` exists at `:445`). Resolved node IDs are captured transiently in onboarding state and consumed once, at first Provider creation, by three ad-hoc post-commit `.catch()`-swallowed `upsertStructuredServiceAreas` calls (WhatsApp finalize `registration.ts:3360-3361`; quality-gate create-on-PASS `quality-gate-submission.ts:735-742, 932-933`; PWA self-serve is the one in-tx call `pwa-flow.ts:881-883`). After application creation the IDs are gone. Therefore every approval-time path that only has `serviceAreas` labels skips TSA sync:

| Path | Entry | Syncs TSA today? |
|---|---|---|
| A admin Approve | `applications/page.tsx:355-366` (`crudAction`-wrapped) | No |
| B cron auto-approve | `provider-auto-approve.ts:857-868, 934-949` | No |
| C manual script | `scripts/manual-approve-provider.ts:40-51` | No |
| D triage sweep | `scripts/application-triage-sweep.ts:287-295` | No |
| E WhatsApp finalize | post-commit `registration.ts:3360-3361` | Conditional (fire-and-forget) |
| F PWA self-serve | in-tx `pwa-flow.ts:881-883` | Conditional |
| G quality-gate create-on-PASS | `quality-gate-submission.ts:735-742` | Conditional (fire-and-forget) |
| H admin profile edit | `providers/actions.ts:240-291` raw update | No — bypasses `syncProviderRecord` |
| I `setProviderStatusAction`→ACTIVE | `providers/actions.ts:295-366` raw update | No — bypasses |
| J `verifyProviderAction` | `providers/actions.ts:370-412` raw update | No — bypasses |
| K reconcile sweep | `provider-record.ts:407-418` | No |

`syncProviderRecord` (`provider-record.ts:200-358`) is the choke point A/B/C/D/E/F/G/K already call, but it only enriches TSA when `locationNodeIds` is non-empty (`:301,:344`); labels in `serviceAreas` are written verbatim and never resolved. The real TSA writer `upsertStructuredServiceAreas` (`:101-164`) takes node IDs, and correctly gates row `active` on `getRegionServiceStatus({regionKey,slug},'matching')` (`:131-132`).

## 2. Goal & invariant

**Invariant:** *Any active+verified provider with non-empty `serviceAreas` (or `locationNodeIds`) has TSA rows synced, with each row's `active` flag gated by the region's matching-pilot status.* Held on every approval/activation path, enforced in shared code, not per-caller.

**Non-goals:** no Lead/JobRequest state-machine refactor (P1-3); no change to matching filter logic; no new UI beyond a thin readiness indicator; no change to the pilot-region gate semantics.

## 3. Design

### 3.1 Shared label→node resolver (new)
Extract the proven matcher from `scripts/backfill-tsa-from-legacy-service-areas.ts:48,82-100,139-183` into a shared, unit-tested module (e.g. `lib/provider-record/resolve-service-area-labels.ts`): normalize label → exact `LocationNode.label` (case-insensitive) match; disambiguate duplicate suburb names across regions by majority-region vote among the same provider's other resolvable areas; return `{ resolved: nodeId[], unresolved: label[] }`. Refactor the backfill script to import this helper so there is one source of truth.

### 3.2 `syncProviderRecord` label fallback (flag-gated)
When `provider.matchability.autosync` is ON and `locationNodeIds` is empty/absent but `serviceAreas` is non-empty, resolve labels via 3.1 and pass the resulting node IDs into the existing `upsertStructuredServiceAreas` (inheriting its correct `active` pilot-gate). Unresolved labels: `console.warn` + surfaced count (non-fatal). This closes A/B/C/D/K in one change because they all call `syncProviderRecord`. Flag default OFF; flip to ON after the backfill lands and is verified.

### 3.3 Persist `locationNodeIds` on `ProviderApplication` (additive migration)
Add nullable `locationNodeIds String[]` to `ProviderApplication` (mirror `ProviderApplicationDraft.locationNodeIds`, `schema.prisma:445`). Populate at the three creation sites that already hold the array (E `registration.ts`, F `pwa-flow.ts`, G `quality-gate-submission.ts`). Approval-time callers (A/B/C/D/K) pass `app.locationNodeIds` into `syncProviderRecord` when present — exact IDs, no lossy label round-trip; the 3.2 label fallback covers pre-migration applications and free-text onboarding. **Additive only** (house rule 2).

### 3.4 Route admin paths through the invariant
`setProviderStatusAction`→ACTIVE (I), `verifyProviderAction` (J), and `updateProviderProfileAction` serviceAreas save (H) call a shared `ensureProviderMatchable(tx, providerId)` (resolve current `serviceAreas`/`locationNodeIds` → `upsertStructuredServiceAreas`) instead of raw `tx.provider.update`. Keeps `crudAction` audit wrapping.

### 3.5 Backfill the existing 61 (prod write — gated)
Fix the backfill's `active:true` (`:196,201`) to use `getRegionServiceStatus(...,'matching')` so backfilled rows match real-time gating (won't over-activate out-of-fence areas). Run `--dry-run` → review counts → **`--commit` only after explicit founder approval**. The 2 malformed free-text providers (a comma-blob and "Westrand") are reported for manual handling, not auto-repaired.

### 3.6 Thin readiness surfacing
On admin provider detail (`technicians/[id]/page.tsx`, existing `admin.providers.legacy_tsa_warning` banner at `:316-333`): show active-TSA count and a "Matchable: yes/no" derived from whether ≥1 active TSA row exists. Lightweight; no full filter-reason engine this cycle.

## 4. Testing (TDD)
- Resolver: exact match, case-insensitivity, ambiguous suburb → majority-region tiebreak, unresolvable → reported not thrown.
- `syncProviderRecord`: labels-only input with flag ON creates correctly-gated TSA rows; flag OFF = no change; already-has-`locationNodeIds` path unaffected.
- Admin: `setProviderStatusAction`/`verifyProviderAction` provision TSA on activation.
- Regression: matchable providers (74) unaffected; pilot-inactive regions produce `active:false` rows.
- Backfill: dry-run detection count == 61; idempotent re-run; region-gate applied.

## 5. Guardrails / house rules
- Additive migration only; no drops/renames (rule 2).
- New behaviour flag-gated, flipped separately (rule 5).
- Admin mutations stay in `crudAction` (rule 1).
- No `as any` without TODO (rule 7).
- Backfill `--commit` is a prod write → explicit approval before running (approval-boundary).

## 6. Success criteria
- After flag ON + backfill: `active+verified with zero active TSA AND resolvable serviceAreas` → 0 (excluding the 2 flagged free-text).
- New approvals via any path A–K produce active TSA rows (subject to pilot gate) without manual steps.
- Matchable-provider count rises from 74 toward ~133; unlocked supply visible in matching.
- All tests green; matching filter logic unchanged.

## 7. Out of scope / follow-ups
- Fixing the fire-and-forget post-commit swallow on E/G into durable retry (fold into P1-3 state-machine work).
- Full filter-reason readiness engine (audit acceptance (2) richer form).
- The 2 free-text providers' manual area correction.

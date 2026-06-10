# West Rand Pilot Launch — Region Config, Electrical Holdback, Provider Nudge

**Status:** revised draft for review (2026-06-09) — constant module, no live send, 3 PRs
**Date:** 2026-06-09
**Owner:** Engineering (Plug A Pro / field-service)

> **Revision note (2026-06-09):** This is v2 of the spec. v1 was committed at `321fa696d` and added a `PilotRegion` Prisma model + live Meta WhatsApp send. Brainstorming on 2026-06-09 walked the four decisions back to a lighter posture: (a) a TypeScript constant module instead of new tables, (b) preview + CSV export + mark-sent (no live Meta call), (c) a pure-function tier classifier, and (d) three sequenced PRs. v1 is recoverable via `git show 321fa696d:docs/superpowers/specs/2026-06-09-west-rand-pilot-launch-design.md`.

---

## 1. Problem & Objective

The West Rand pilot must launch with:

1. A bounded geographic footprint (8 suburbs, 4 of them prioritised).
2. A bounded service-category footprint (6 categories), with **Electrical suppressed end-to-end** until provider supply is in place.
3. Provider eligibility that does **not** require strict KYC (current strict-KYC lead-eligible count is 0).
4. An admin readiness view so ops can see who is launch-ready vs gap-filling.
5. A WhatsApp-first **nudge workflow** for under-complete approved providers, surfaced as an admin queue with preview + CSV export + mark-sent (no live Meta API call in this scope).
6. Decision auditability via existing `AuditLog` / `AdminAuditEvent` and a session-end OpenBrain entry.

Constraints: additive only, behind flags, reusing existing serviceability / matching / audit / messaging surfaces. **No schema change** (no new Prisma models, no migrations). **No live outbound WhatsApp** from the nudge console — ops sends externally and marks the batch sent. House rules apply.

## 2. Non-goals

- No new payment surfaces, KYC pipeline changes, or matching-engine refactor.
- No auto-send WhatsApp without explicit admin confirm-flow + flag.
- No "R1–R5" persisted columns; tiers are derived.
- No "launch region" abstraction beyond what's needed for this pilot.

## 3. Architecture

### 3.0 Delivery shape — three PRs

Work ships in three sequenced PRs. Each merges independently behind its own flag; nothing changes for customers until the master flag flips on.

```
┌─────────────────────────────────────────────────────────────┐
│ PR1 — feat/launch-config-and-gates                          │
│   lib/launch/west-rand-pilot.ts      (constant module)     │
│   lib/launch/electrical-readiness.ts                        │
│   Hard gates in: customer serviceability, bookings,         │
│     quote approval, payment init, matching filter           │
│   Flags: launch.west_rand_pilot.enabled,                    │
│          launch.west_rand_pilot.electrical_gate             │
├─────────────────────────────────────────────────────────────┤
│ PR2 — feat/launch-readiness-report                          │
│   lib/provider-tier.ts                                      │
│   /admin/launch-readiness page                              │
│   Flag: launch.west_rand_pilot.readiness_report             │
├─────────────────────────────────────────────────────────────┤
│ PR3 — feat/provider-nudge-console                           │
│   lib/nudges/{queue,missing-items,template}.ts              │
│   /admin/nudges + actions.ts                                │
│   Preview / CSV export / Mark-sent (no Meta API)            │
│   Flag: launch.west_rand_pilot.nudge_console                │
└─────────────────────────────────────────────────────────────┘
```

Rollout sequence: PR1 ships off → ops validates `/admin/launch-readiness` once PR2 is on → master flag flips on for customers → `/admin/nudges` flag flips on for ops.

### 3.1 Data model — none

**No new Prisma models. No migration.** The pilot is expressed as a single TypeScript constant module that imports zero DB state. This is sufficient because there is exactly one pilot today, the allowed suburbs and categories are known at build time, and admins do not need to edit them through a UI in v1.

```ts
// field-service/lib/launch/west-rand-pilot.ts
export const WEST_RAND_PILOT = {
  key: 'west-rand-pilot',
  label: 'West Rand Pilot',
  regionKey: 'jhb_west',                    // existing LocationNode regionKey

  activeSuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
    'gauteng__johannesburg__jhb_west__bromhof',
    'gauteng__johannesburg__jhb_west__discovery',
    'gauteng__johannesburg__jhb_west__helderkruin',
    'gauteng__johannesburg__jhb_west__little_falls',
  ],

  prioritySuburbSlugs: [
    'gauteng__johannesburg__jhb_west__honeydew',
    'gauteng__johannesburg__jhb_west__randpark_ridge',
    'gauteng__johannesburg__jhb_west__constantia_kloof',
    'gauteng__johannesburg__jhb_west__florida',
  ],

  allowedCategorySlugs: [
    'handyman', 'painting', 'plumbing', 'tiling', 'carpentry', 'appliances',
  ],

  electricalThreshold: 3,                   // configurable 3–5; raise by editing this constant + redeploying
} as const

export function isPilotSuburbSlug(slug: string | null | undefined): boolean
export function isPilotCategorySlug(slug: string | null | undefined): boolean
export function isPriorityPilotSuburb(slug: string | null | undefined): boolean
```

Companion module — runtime-computed electrical readiness:

```ts
// field-service/lib/launch/electrical-readiness.ts
export type ElectricalReadiness = {
  ready: boolean
  approvedCount: number
  threshold: number
  shortfall: number
}
export async function getElectricalReadiness(): Promise<ElectricalReadiness>
```

Invariants enforced in code (no FK to lean on):
- `isPilotSuburbSlug(slug)` is the single source of truth — any caller checking suburb eligibility goes through this helper. Slug canonicalization happens at the boundary (one place: where the caller resolves a `LocationNode` to its slug).
- `isPilotCategorySlug(slug)` similarly. The label-variant canonicalization layer (`canonicalSlug(category)` already used by `lib/category-config.ts`) normalises "Electrical Repairs" → "electrical" before lookup.
- **Electrical commercial-open invariant:** `electrical serviceable = isPilotCategorySlug('electrical') === true AND getElectricalReadiness().ready === true`. The first condition is permanently `false` in this revision because `'electrical'` is intentionally absent from `allowedCategorySlugs`. The second is a tripwire for the (out-of-scope) future flip.

This means electrical commercial-open is governed by **two independent checks** (allowlist + readiness). Both must be edited deliberately to enable Electrical, which is the intended friction.

### 3.2 Derived Provider risk tiers

`field-service/lib/provider-tier.ts` — pure function `classifyProviderTier(provider): ProviderTier`. No DB calls. Inputs are passed in by the caller (which is responsible for joining `ProviderIdentityVerification.assuranceLevel` and `ProviderApplication.status`).

```ts
export type ProviderTier = 'R1' | 'R2' | 'R3' | 'R4' | 'R5' | 'PENDING_R1'

type Input = Pick<Provider,
  'verified' | 'kycStatus' | 'status' | 'strikes' |
  'name' | 'phone' | 'email' | 'payoutVerifiedAt' |
  'skills' | 'equipmentTags' | 'serviceAreas'
> & {
  identityAssurance?: 'LOW' | 'MEDIUM' | 'HIGH' | null
  hasApplication?: boolean
  applicationStatus?: ProviderApplicationStatus | null
}

export function classifyProviderTier(p: Input): ProviderTier
export function listMissingProfileItems(p: Input): string[]
```

Rules (evaluated top-down; first match wins):

| Tier | Predicate |
|---|---|
| `PENDING_R1` | `hasApplication && applicationStatus in ('SUBMITTED','UNDER_REVIEW')` |
| _excluded_ | `status in ('SUSPENDED','BANNED','ARCHIVED')` — not tier-reported |
| `R5` | `status='ACTIVE' && (kycStatus !== 'VERIFIED' OR payoutVerifiedAt is null OR ≥3 missing profile fields)` |
| `R4` | `status='ACTIVE' && verified && kycStatus='VERIFIED' && payoutVerifiedAt && 1–2 missing profile fields` |
| `R3` | same as R4 + profile-complete + `identityAssurance='LOW'` |
| `R2` | same as R3 but `identityAssurance='MEDIUM'` |
| `R1` | same as R2 but `identityAssurance='HIGH'` AND `strikes === 0` |

"Missing profile field" = empty/null for any of: `name`, `phone`, `email`, `skills` (empty array), `equipmentTags` (empty array), `serviceAreas` (empty array), `payoutVerifiedAt` (null). `listMissingProfileItems(p)` returns the human-readable labels of the missing fields (used by the nudge template).

`isPilotLaunchCandidate(provider)` remains a **narrower** predicate than tier classification, intentionally not a KYC-cleared lead-detail unlock:

```ts
// Pilot dispatch candidate ONLY. Does NOT imply customer-detail unlock.
// For lead-detail unlock continue using existing isKycLeadEligible predicate.
isPilotLaunchCandidate(p) =
     p.status === 'ACTIVE'
  && p.verified === true
  && !isBannedOrFraudFlagged(p)
  && !isActivelySuspended(p)
  && hasValidContact(p)
  && providerCoversAnyPilotSuburb(p)            // checks p.serviceAreas vs WEST_RAND_PILOT.activeSuburbSlugs
  && providerHasAnyAllowedSkill(p)              // checks p.skills vs WEST_RAND_PILOT.allowedCategorySlugs
```

### 3.3 Gating chokepoint

Single source of truth: `lib/customer-serviceability.ts`. Behaviour is **flag-conditional**, so the table-driven logic never accidentally fails the legacy path:

```ts
import { isPilotSuburbSlug, isPilotCategorySlug } from './launch/west-rand-pilot'
import { getElectricalReadiness } from './launch/electrical-readiness'

async function isAreaCategoryServiceable(area, category) {
  if (!await flag('launch.west_rand_pilot.enabled')) {
    return legacyIsAreaCategoryServiceable(area, category) // existing behaviour
  }
  const suburbSlug = area.slug
  const categorySlug = canonicalSlug(category)
  if (!isPilotSuburbSlug(suburbSlug))   return { ok: false, code: 'pilot.suburb_not_supported' }
  if (!isPilotCategorySlug(categorySlug)) return { ok: false, code: 'pilot.category_not_supported' }
  // Electrical is permanently absent from allowedCategorySlugs in v1, so the next
  // branch is dead today. It will activate if/when 'electrical' is re-added AND the
  // electrical_gate flag flips on AND the readiness threshold is met.
  if (categorySlug === 'electrical' && await flag('launch.west_rand_pilot.electrical_gate')) {
    const readiness = await getElectricalReadiness()
    if (!readiness.ready) return { ok: false, code: 'pilot.electrical_disabled' }
  }
  return legacyIsAreaCategoryServiceable(area, category) // provider-count gate still applies
}
```

The same gate is enforced by four call sites for defence-in-depth:
- `app/api/customer/serviceability/route.ts` — filters the response to allowed slugs.
- `app/api/customer/bookings/route.ts` — pre-create check; 422 on fail.
- `lib/job-requests/create-job-request.ts` — deeper persistence seam; identical check.
- `app/api/quotes/[token]/route.ts` (PATCH approve) — re-check at approval (quote may pre-date the gate flip).

Two further gates live in their own modules:
- `lib/payments.ts` `initializeBookingPayment()` — throws `CategoryGatedByPilotError` if the booking's category is not pilot-allowed.
- `lib/matching/filter.ts` — drops jobs with disallowed categories from the auto-routing pool with `FilteredCandidate.reason = 'CATEGORY_GATED_BY_PILOT'`.

### 3.4 Feature flags (registered in `lib/feature-flags-registry.ts`)

| Flag | Default prod | Purpose |
|---|---|---|
| `launch.west_rand_pilot.enabled` | OFF | Master toggle. When ON, customer serviceability + bookings gate to pilot suburbs/categories. |
| `launch.west_rand_pilot.electrical_gate` | OFF | Independent gate for the electrical-readiness check. Dead in v1 (electrical not in allowlist); reserved for the future flip. |
| `launch.west_rand_pilot.readiness_report` | OFF | Shows `/admin/launch-readiness`. Can flip on independently of the master flag so ops can validate counts before customer activation. |
| `launch.west_rand_pilot.nudge_console` | OFF | Shows `/admin/nudges`, preview + CSV export + mark-sent. No outbound Meta API. |

**Per-batch cap on nudge mark-sent:** server-side constant `NUDGE_MARK_SENT_BATCH_CAP = 200` in `lib/nudges/queue.ts`, overridable via env `NUDGE_MARK_SENT_BATCH_CAP`. Not a feature flag. Protects audit log from runaway batches.

## 4. Components

### 4.1 Schema, migration, seed — almost nothing

- **`field-service/prisma/schema.prisma`** — no change.
- **`field-service/prisma/migrations/`** — no new migration.
- **`field-service/scripts/seed-flags.ts`** — extend to upsert the four new `FeatureFlag` rows from §3.4. Each starts disabled. Idempotent; safe to re-run.
- **No seed for suburbs/categories** — they live in `lib/launch/west-rand-pilot.ts` as a `const`. Editing the pilot footprint = code change + redeploy. Intentional: the friction is the safety.

Sanity-check script (optional, not committed): `scripts/check-pilot-suburb-presence.ts` reads `WEST_RAND_PILOT.activeSuburbSlugs` and asserts every slug resolves to a `LocationNode` with `nodeType='SUBURB'`. Run on demand during PR1 review.

### 4.2 Library / domain
- `field-service/lib/launch/west-rand-pilot.ts` — `WEST_RAND_PILOT` constant + `isPilotSuburbSlug`, `isPilotCategorySlug`, `isPriorityPilotSuburb`.
- `field-service/lib/launch/electrical-readiness.ts` — `getElectricalReadiness()` async helper backed by a `db.provider.count(...)` call (no memoization in v1; cheap).
- `field-service/lib/provider-tier.ts` — `classifyProviderTier`, `listMissingProfileItems`, `isPilotLaunchCandidate`. Pure functions; all inputs passed in.
- `field-service/lib/customer-serviceability.ts` — gate extension as in §3.3.
- `field-service/lib/feature-flags-registry.ts` — four new flag entries from §3.4.

### 4.3 Customer surfaces
- `field-service/app/api/customer/serviceability/route.ts` — when master flag ON, filter response `serviceableCategories` to `WEST_RAND_PILOT.allowedCategorySlugs` and reject suburbs outside `activeSuburbSlugs` (returns the existing empty-state shape, no new fields).
- `field-service/app/api/customer/bookings/route.ts` — calls shared gate.
- `field-service/lib/job-requests/create-job-request.ts` — calls shared gate.
- `field-service/app/api/quotes/[token]/route.ts` (PATCH approve) — re-checks gate at approval.
- `field-service/components/customer/HomeServiceSearch.tsx` — **no change.** Electrical is absent from the serviceability response when master flag is ON, so it doesn't render. The existing "hide absent categories" behavior covers the "not actively advertised" acceptance criterion.

### 4.4 Admin surfaces
- `field-service/app/(admin)/admin/launch-readiness/page.tsx` — readiness report (counts per suburb × category × tier; electrical readiness card; warning banners). Read-only.
- `field-service/app/(admin)/admin/launch-readiness/actions.ts` — none in v1. Pilot footprint is constant-driven; flag flips happen via the existing flag-management surface, not from this page.
- `field-service/app/(admin)/admin/nudges/page.tsx` — ordered nudge queue, per-row preview, CSV export, bulk-select + "Mark sent" with typed confirmation.
- `field-service/app/(admin)/admin/nudges/actions.ts` — `previewNudgeAction` (single provider), `exportNudgeQueueCsvAction`, `markNudgeBatchSentAction`. All via `crudAction()`. **No `sendNudgeBatchAction` in v1** — outbound is performed externally by ops.
- `field-service/lib/admin-nav-routes.ts` — add Launch Readiness + Nudges entries (flag-gated).

### 4.5 Messaging
- `field-service/lib/nudges/template.ts` — `renderNudgeMessage({ firstName, missingItemsLabel })` returns the rendered string for in-app preview and CSV export. **Not registered with Meta in v1** — no live API call, so Meta template approval is deferred. Wording (locked):

  > Hi {{first_name}}, thanks again for registering with Plug A Pro. We are preparing the first West Rand pilot jobs and noticed your profile is missing: {{missing_items}}.
  > We have noticed that providers with a more complete profile are easier for customers to trust and nominate for jobs. Please add these when you have a moment so you can be considered for more suitable leads.

- `{{missing_items}}` rendering: human-readable comma-separated list with serial comma, lowercase, mapped from missing-field slugs to friendly labels (`payoutVerifiedAt` → "bank details", `skills` → "skills list", `serviceAreas` → "service areas", `equipmentTags` → "equipment list", `name` → "name", `phone` → "phone number", `email` → "email address"). Example: "bank details, equipment list, and service areas".
- No outbound transport in v1. When ops sends the batch externally (e.g. WhatsApp Business app, manual paste, future Meta-template send), they return to `/admin/nudges` and click "Mark sent" with an optional batch note.

## 5. Data flow

### 5.1 Customer (flag ON)
1. `GET /api/customer/serviceability?area=<slug>&category=<tag>` → resolves area to a `LocationNode` → applies the §3.3 gate.
2. If suburb not in `WEST_RAND_PILOT.activeSuburbSlugs` → 422 `pilot.suburb_not_supported`.
3. If category not in `WEST_RAND_PILOT.allowedCategorySlugs` → 422 `pilot.category_not_supported`.
4. Electrical is permanently absent from the allowlist in v1, so it never appears in the response — the customer home renders without it.
5. On allowed (area, category) → existing serviceability response with provider counts.
6. `POST /api/customer/bookings` and `create-job-request` call the same gate; 422 on fail; otherwise existing creation path.
7. `PATCH /api/quotes/[token]` action=approve re-checks the gate (quote may pre-date a flag flip): 409 `pilot.category_no_longer_supported` if it fails.

### 5.2 Admin readiness (`/admin/launch-readiness`)
- SSR loads pilot constants + per-(suburb, category) provider counts rolled up by tier (via `classifyProviderTier`).
- **Electrical readiness card** (read-only banner): `approvedCount` from `getElectricalReadiness()` vs `WEST_RAND_PILOT.electricalThreshold`. Banner reads "Electrical is not launch-ready — need N more approved providers" (N = `shortfall`) when `ready=false`.
- **Warnings:** "Electrical is not launch-ready" while electrical is not allowlisted OR `getElectricalReadiness().ready === false`; "Thin coverage: <category>" when approved-provider count for an allowed category < 3 (spec calls out Appliances; rule generalises).
- **No "Unlock electrical" button.** Enabling Electrical requires a code change (add 'electrical' to `allowedCategorySlugs`) plus flag flips. The friction is intentional.

### 5.3 Nudge lifecycle (`/admin/nudges`)
- **List:** candidates = providers where `isPilotLaunchCandidate(p)` AND `listMissingProfileItems(p).length > 0`. Excludes suspended/banned/archived (already excluded by tier classifier).
- **Ordering:** tier rank `R5-plumbing > R5 > R4 > PENDING_R1` → within tier `lastNudgedAt` ASC nulls first (this is **derived from `AdminAuditEvent`** queries, not a new Provider column — see §11 for the deferred persistent column) → fall back to `updatedAt` DESC.
- **Preview** (single row): `renderNudgeMessage({firstName, missingItemsLabel})` → admin sees the rendered text. Writes `AdminAuditEvent action='nudge.preview.viewed'` with provider id.
- **CSV export:** same query as list, writes one `AdminAuditEvent action='nudge.csv.exported'` with `{rowCount, filter}` metadata. CSV columns: `provider_id, name, phone, tier, primary_skills, missing_items, suburb_label, application_status, rendered_message`.
- **Mark batch as sent:**
  1. Validate `confirmPhrase === "mark-sent-<count>"`.
  2. Cap ids at `NUDGE_MARK_SENT_BATCH_CAP` (default 200).
  3. For each id: re-resolve provider (still exists, still active).
  4. Write **one** `AdminAuditEvent action='nudge.batch.marked_sent'` with metadata `{providerIds, batchNote, count, filter}`. No per-row event — keeps the audit log compact.
  5. No outbound API call. No `WhatsappPolicy` invocation. No `Provider.lastPilotNudgeAt` write (no such column; the audit-event query is the system of record).

### 5.4 OpenBrain (session-end, CLI)
Runtime "logging" = `AuditLog` + `AdminAuditEvent`. There is no in-app OpenBrain integration — OpenBrain is CLI-only (`pnpm brain`). Session-end, the assistant logs a knowledge entry per PR:

```
cd /Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle\ Holdings/Solutions/Projects/MobileApps/OpenBrain/backend && \
  pnpm brain -- knowledge add \
    --project "PlugAPro" \
    --domain "engineering" \
    --title "feat — west rand pilot PR{N} merged (2026-06-09)" \
    --tags "launch,west-rand-pilot,electrical-gate,nudges" \
    --content "<flags state + decisions + acceptance results>"
```

In-app side covers acceptance criterion #11 via per-action `AdminAuditEvent` writes (`nudge.preview.viewed`, `nudge.csv.exported`, `nudge.batch.marked_sent`, `pilot.payment.blocked`, `pilot.quote.blocked`).

## 6. Error handling

All customer-facing API rejections use the project's standard error envelope (`code`, `category`, `message`, `reference_id`, `retryable`, `suggested_actions`, `context`, `timestamp`) from the global error-handling standard. Reference-ID prefix `PAP`.

### 6.1 Customer
| Condition | Response |
|---|---|
| Non-pilot suburb, master flag ON | 422 `{ code: 'pilot.suburb_not_supported', suggested_actions: ['join_waitlist', 'contact_support'] }` |
| Disabled category, master flag ON | 422 `{ code: 'pilot.category_not_supported', suggested_actions: ['choose_supported_category', 'join_waitlist'] }` |
| Electrical (future re-add) with `electrical_gate` ON and `readiness.ready=false` | 422 `{ code: 'pilot.electrical_disabled', suggested_actions: ['join_waitlist'] }` — dead path in v1 |
| Quote approve, category no longer pilot-allowed | 409 `{ code: 'pilot.category_no_longer_supported', suggested_actions: ['contact_support'] }` |
| `initializeBookingPayment` called with gated category | server throws `CategoryGatedByPilotError`; booking remains `PENDING_PAYMENT`; `AdminAuditEvent action='pilot.payment.blocked'` |
| Master flag OFF | Legacy behaviour, no new errors |

### 6.2 Admin
| Condition | Response |
|---|---|
| Non-admin | existing `requireAdmin` 403/redirect |
| `launch.west_rand_pilot.readiness_report` OFF | 404 on `/admin/launch-readiness` |
| `launch.west_rand_pilot.nudge_console` OFF | 404 on `/admin/nudges` |
| `markNudgeBatchSentAction` confirm-phrase mismatch | `{ error: 'confirm-phrase-mismatch' }`, no audit write |
| Mark-sent batch exceeds `NUDGE_MARK_SENT_BATCH_CAP` | `{ error: 'batch-oversized', cap }`, no audit write |
| Mark-sent batch contains zero ids | `{ error: 'empty-batch' }`, no audit write |

Existing `/(admin)/error.tsx` boundary covers unhandled throws. PII (phone) masked to last-4 in audit per existing convention.

## 7. Rollback plan

There is no schema to roll back. All changes are additive and behind flags. Rollback is a flag flip.

1. `launch.west_rand_pilot.enabled = false` — restores legacy serviceability immediately. Customer flows return to pre-pilot behaviour. No DB state changes.
2. `launch.west_rand_pilot.electrical_gate = false` — disables the readiness-driven electrical rejection (dead path in v1 anyway).
3. `launch.west_rand_pilot.nudge_console = false` — hides `/admin/nudges` (no outbound in flight, so nothing to halt).
4. `launch.west_rand_pilot.readiness_report = false` — hides `/admin/launch-readiness`.
5. `AuditLog`, `AdminAuditEvent`, and OpenBrain knowledge entries are retained intact.
6. If a code revert is necessary (e.g. a gate bug surfaces under load), reverting the PR merge commit restores prior behaviour fully — all new code is additive.

Operator runbook (appendix) maps symptoms → which flag to flip first.

## 8. Tests

### 8.1 Vitest
| File | PR | Asserts |
|---|---|---|
| `__tests__/lib/launch/west-rand-pilot.test.ts` | 1 | suburb/category allowlist matches spec; priority list correct; `isPilotSuburbSlug` / `isPilotCategorySlug` boolean behaviour for in/out cases. |
| `__tests__/lib/launch/electrical-readiness.test.ts` | 1 | `ready=true` at threshold; `ready=false` and correct `shortfall` below; filters by `status='ACTIVE'`, `verified`, `kycStatus='VERIFIED'`, skills includes 'electrical'. |
| `__tests__/lib/customer-serviceability.pilot.test.ts` | 1 | 8 launch suburbs allowed; non-pilot suburb 422 `pilot.suburb_not_supported`; allowed categories pass; electrical never appears (absent from allowlist); flag-off preserves legacy. |
| `__tests__/lib/electrical-canonicalization.test.ts` | 1 | "Electrical", "Electrical Repairs", "electric", "electrician" all canonicalize to `'electrical'` and hit the gate. |
| `__tests__/api/customer-bookings-pilot-gate.test.ts` | 1 | Non-pilot suburb 422; non-allowed category 422; allowed combination 200/201; flag-off behavior unchanged. |
| `__tests__/lib/job-requests/create-job-request.pilot.test.ts` | 1 | Deeper persistence seam enforces same gate. |
| `__tests__/lib/payments-category-gate.test.ts` | 1 | `initializeBookingPayment` throws `CategoryGatedByPilotError` when called with a gated category and master flag ON; passes through when flag OFF. |
| `__tests__/lib/matching-filter-pilot.test.ts` | 1 | Gated-category jobs filtered with reason `CATEGORY_GATED_BY_PILOT`; allowed-category jobs unaffected; non-pilot regions unaffected. |
| `__tests__/lib/provider-tier.test.ts` | 2 | Table-driven shapes → expected tier; suspended/banned/archived excluded; PENDING_R1 from `applicationStatus`. |
| `__tests__/lib/provider-tier-missing-items.test.ts` | 2 | Each null/empty field surfaces in `listMissingProfileItems`; friendly-label mapping correct. |
| `__tests__/app/admin/launch-readiness.test.ts` | 2 | Roll-up counts per suburb × category × tier; electrical-not-ready banner; thin-coverage warning for any allowed category < 3 providers. |
| `__tests__/lib/nudges/queue.test.ts` | 3 | Ordering: R5-plumbing first, then R5, then R4, then PENDING_R1; within tier oldest-nudge first; filters by suburb/category/tier. |
| `__tests__/lib/nudges/template.test.ts` | 3 | `renderNudgeMessage(...)` returns the exact wording from §4.5 including the corrected closing line "so you can be considered for more suitable leads". |
| `__tests__/app/admin/nudges-actions.test.ts` | 3 | `previewNudgeAction` writes `nudge.preview.viewed`; `exportNudgeQueueCsvAction` writes `nudge.csv.exported` with `{rowCount, filter}`; `markNudgeBatchSentAction` writes one `nudge.batch.marked_sent` per call with `{providerIds, batchNote, count, filter}`. |
| `__tests__/app/admin/nudges-mark-sent-guards.test.ts` | 3 | Confirm-phrase mismatch → no audit; empty batch → no audit; oversized batch → no audit. |

### 8.2 Playwright smoke
| Test | PR | Asserts |
|---|---|---|
| `e2e/smoke.spec.ts` (extend) | 2 + 3 | `/admin/launch-readiness` and `/admin/nudges` render under admin auth + their respective flags. |
| `e2e/pilot.spec.ts` (new) | 1 | Honeydew customer sees only allowed categories (no electrical); Sandton (non-pilot) sees existing waitlist empty-state; master flag OFF restores baseline. |

### 8.3 Manual QA (one-pager in repo)
- Flip `launch.west_rand_pilot.enabled` in staging; verify narrowed customer flow on Honeydew + electrical absent; flip back; verify identical-to-baseline.
- Flip `launch.west_rand_pilot.readiness_report` on; verify counts table populates and electrical-not-ready banner shows.
- Flip `launch.west_rand_pilot.nudge_console` on; preview a single row; export CSV; mark a 3-row batch as sent with a note; verify the three `AdminAuditEvent` rows (`preview`, `export`, `mark_sent`).
- Mismatched confirm phrase blocks mark-sent (no audit row written).
- Oversized batch (> `NUDGE_MARK_SENT_BATCH_CAP`) rejected with `batch-oversized`.
- Empty batch rejected with `empty-batch`.

## 9. Acceptance-criteria coverage

| AC # | Brief | Covered by |
|---|---|---|
| 1 | 7+ launch suburbs accessible for allowed categories | `customer-serviceability.pilot.test.ts`, `customer-bookings-pilot-gate.test.ts`, `e2e/pilot.spec.ts` |
| 2 | Customers cannot book Electrical | `customer-serviceability.pilot.test.ts`, `customer-bookings-pilot-gate.test.ts`, `create-job-request.pilot.test.ts`, `payments-category-gate.test.ts` |
| 3 | Electrical not advertised/lead-routed | `electrical-canonicalization.test.ts`, `e2e/pilot.spec.ts` (electrical never appears on customer home) |
| 4 | Lead routing excludes Electrical | `matching-filter-pilot.test.ts` |
| 5 | Basic approved providers eligible without strict KYC | `provider-tier.test.ts` (R3/R4 are tier-labeled, not excluded); existing matching tests confirm `verified && kycStatus='VERIFIED'` filter unchanged |
| 6 | Admin sees R4/R5/PENDING_R1 + electrical readiness | `launch-readiness.test.ts`, `provider-tier.test.ts` |
| 7 | Nudge ordering correct | `nudges/queue.test.ts` |
| 8 | Corrected nudge copy ("so you can be considered for more suitable leads") | `nudges/template.test.ts` (asserts exact string) |
| 9 | No mass live messages without admin review/confirm | No Meta API integration in scope; `nudges-actions.test.ts` confirms mark-sent is the only "sent" pathway; `nudges-mark-sent-guards.test.ts` covers confirm/oversized/empty guards |
| 10 | Required tests pass | All above |
| 11 | OpenBrain note exists | Session-end CLI log per §5.4; in-app side covered by per-action `AdminAuditEvent` |

## 10. Risks & open questions

- **R5 providers still carry safety risk.** Matching filter still enforces `verified && kycStatus='VERIFIED'`. R5 is a tier label for reporting + nudging, not a relaxed eligibility bar.
- **Strict-KYC hard gate would block launch.** Mitigated by deliberate decoupling: `isPilotLaunchCandidate` ≠ `isKycLeadEligible`. The pilot dispatch candidate predicate uses the existing matching filter; tier classification is reporting-only.
- **Electrical monetisation before supply.** Prevented by §3.1 invariant + multi-layer gate (booking 422 + payment-init throw + matching-filter drop).
- **Thin Appliances coverage.** Surfaced as admin warning on `/admin/launch-readiness`, not a hard block.
- **Suburb/category data normalization.** Canonicalization layer (`canonicalSlug`) + targeted tests (`electrical-canonicalization.test.ts`) cover label variants.
- **WhatsApp consent.** Out of scope for v1 (no live send). When live send is added in a future PR, that PR must add an opt-in check at send time and respect `whatsappServiceOptIn`.
- **Unsupported attempts must not create payable sessions.** Gate is enforced at booking-creation seam, at quote-approve seam, and at `initializeBookingPayment()` — three independent layers.
- **Admin override must be explicit + auditable.** Every mutation through `crudAction()`. Mark-sent additionally requires typed confirm phrase.
- **Quote pre-dating gate flip.** `PATCH /api/quotes/[token]` re-checks the gate at approval time and rejects with 409.
- **Master-flag race during deploy.** Flags default off. Activation order: PR1 deployed (gates inert) → readiness flag on (ops validates) → master flag on (customer activation) → nudge-console flag on (ops only).

## 11. Out of scope (deferred)

- **Live Meta WhatsApp nudge send.** Requires registering `pilot_nudge_v1` with Meta (~48h approval), opt-in checks per provider, send-rate limiter, status-webhook reconciliation, retry semantics. Tracked as the next PR after PR3 lands.
- **`PilotRegion` / `PilotRegionSuburb` / `PilotRegionCategory` DB tables** + admin CRUD. Deferred until there is a second pilot to manage. The constant module is sufficient for one.
- **Persisting risk tier on Provider** as a denormalised column. Compute at query time; revisit if hot-path latency becomes an issue.
- **`Provider.lastPilotNudgeAt` column.** Last-nudged-at is derived from `AdminAuditEvent` queries in v1; add the column if/when nudge ordering needs sub-second lookups.
- **Coming-soon UX chip for Electrical** in `HomeServiceSearch`. Existing "hide absent categories" behavior already satisfies the "not actively advertised" criterion.
- **Multi-pilot region orchestration UI.**
- **Automated nudge cadence / cron.** Ops triggers manually from the console; cron is a later add.
- **Per-suburb readiness scoring beyond counts.** Counts + thin-coverage warnings are enough for v1.

## 12. Production-data impact

**No schema change. No destructive writes to existing Plug A Pro business tables.** Behavior changes only when `launch.west_rand_pilot.enabled` is ON. There is no outbound WhatsApp from the nudge console in this scope — the only external-visible artifact is `AdminAuditEvent` rows.

| Category | Reality |
|---|---|
| Schema | No new tables, no migration |
| Config writes | Four new `FeatureFlag` rows (all `enabled=false` at insert) |
| Behavioral side effects (flag-gated) | Customer serviceability narrowing when master flag ON; matching-filter drop for gated categories |
| External side effects | **None.** No WhatsApp sends, no third-party API calls. `AdminAuditEvent` rows always. |
| Preview / CSV export | Business-data read-only; audit-write only |
| Mark-sent | Business-data read-only; audit-write only |

## 13. House-rule compliance

| Rule | Status |
|---|---|
| Every admin mutation goes through `crudAction()` | ✓ §4.4 (`previewNudgeAction`, `exportNudgeQueueCsvAction`, `markNudgeBatchSentAction` all wrapped) |
| No schema drops/renames | ✓ no schema change at all |
| No hard deletes | ✓ no deletes introduced |
| Destructive actions use destructive-confirmation pattern | ✓ `markNudgeBatchSentAction` requires typed `"mark-sent-<count>"` phrase |
| Every admin-facing feature behind a flag | ✓ §3.4 (`readiness_report`, `nudge_console`) |
| Playwright smoke maintained | ✓ §8.2 |
| No `as any` without TODO | enforced at PR review |
| Detail pages guard nullable relations | enforced at PR review (readiness page guards nullable provider counts) |

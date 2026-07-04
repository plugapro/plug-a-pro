# Provider Onboarding Quality Gate v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce passed Didit KYC + ≥3 work photos + high-risk-trade certification on every new provider application (WhatsApp and both PWA surfaces), behind one flag, without letting an unverified application reach the ops queue.

**Architecture:** A shared, channel-agnostic policy module (`lib/provider-onboarding/quality-gate.ts`) decides whether the gate is on and evaluates the evidence/certification bars. Each of the three submit paths calls it. The paid Didit gate runs **last and create-on-PASS**: while the gate flag is ON, an applicant's captured data is held in a `ProviderApplicationDraft` and a **draft-anchored** `ProviderIdentityVerification` is issued; the applicant's `ProviderApplication` row (status `PENDING`) is created **only** by the Didit `PASSED` webhook. This preserves today's behaviour where an abandoned registration creates no application/provider row — the founder's "keep junk out" requirement.

**Tech Stack:** Next.js 16 (App Router), Prisma 6 / PostgreSQL (Supabase), Vitest, pnpm, Vercel Blob, Meta WhatsApp Cloud API, Didit KYC vendor.

## Reconciliations vs the approved spec

The spec's "reuse, do not rebuild" list was optimistic. These are the load-bearing corrections this plan is built on (verified against current code):

1. **Didit is not wired into the registration/submit path.** It powers the provider-facing `/provider/verify/[token]` page, admin-issued links, and the separate `provider_journey` WhatsApp flow. The *registration* flow (`lib/whatsapp-flows/registration.ts`) uses a manual ID-number/doc/selfie upload path (`reg_verify_*` → generic `Attachment` rows), unrelated to `ProviderIdentityVerification`. Wiring Didit into submit is **new work**.
2. **The identity-verification link issuer is provider-centric.** `issueProviderIdentityVerificationLink` (`lib/identity-verification/link.ts:45`) requires a non-null `providerId`. An application-stage applicant has no `Provider` row. This plan adds a **sibling draft-anchored issuer** and a nullable `ProviderApplicationDraft` FK on `ProviderIdentityVerification`.
3. **No pre-PENDING application status and no draft usage in WhatsApp.** `ApplicationStatus` is `PENDING/MORE_INFO_REQUIRED/APPROVED/REJECTED/CANCELLED`. The WhatsApp flow holds state in `Conversation.data` (JSON), not in `ProviderApplicationDraft`, and only creates a `ProviderApplication` at submit. Create-on-PASS requires the WhatsApp + Flow-B paths to **persist a `ProviderApplicationDraft`** at the gate point so the webhook can reconstruct the application.
4. **Two web submit functions; one PWA surface captures zero photos.** `/provider/register` (Flow A, self-serve wizard) → `submitProviderRegistrationApplication`, `evidenceFileUrls` hard-coded `[]`, no uploader. `/provider/signup` (Flow B, resume-finish) → `submitProviderApplication`, carries `evidenceFileUrls` but via a single URL text box. Both must gate; Flow A needs a real multi-photo uploader built.
5. **Ops notes live in one overloaded string.** There is no per-application notes table. The `[quality-gate]` note is appended to `ProviderApplication.notes` using the marker-append/strip convention in `lib/provider-application-review-support.ts`. Anything written there can surface in the provider-facing rejection message (`safeProviderStatusReason`), so the marker line must be filtered there.

## Global Constraints

- **Next.js** `next@^16.2.1`, App Router. Prisma schema at `field-service/prisma/schema.prisma`; singleton `field-service/lib/db.ts`.
- **Additive migrations only** (house rule #2). No enum renames/drops. New nullable columns/relations only.
- **Every admin mutation via `crudAction()`** (house rule #1). The webhook completion runs server-side, not an admin mutation — it uses the existing orchestrator/transaction pattern, not `crudAction`.
- **Feature-flagged, flipped separately** (house rule #5). New flag `provider.onboarding.quality_gate_v2`, default OFF. All new enforcement is a no-op when the flag is OFF; the full pre-existing behaviour must be preserved (regression suite unchanged when OFF).
- **Flag read:** `isEnabled(key, { userId? })` from `lib/flags.ts`. Flag keys are typed by `FeatureFlagKey` in `lib/feature-flags-registry.ts`; a new key must be added to the registry or the type-check fails.
- **High-risk trade set** (spec §2): `plumbing, gas, geyser, locksmith, appliance_repair, air_conditioning, roofing, electrical`. Use `hasHighRiskServiceSelection(categories: string[])` from `lib/service-category-policy.ts` — do not hardcode a new list.
- **Minimum evidence photos:** `3`.
- **No `as any` without an adjacent TODO** (house rule #7).
- **WhatsApp interactive limits:** quick-reply button title ≤ 20 code points; list row/section title ≤ 24. Count with `[...text].length` (guards in `lib/whatsapp-interactive.ts`).
- **All commands run from** `field-service/` unless stated. Test runner: `pnpm test <path>`. Single test: `pnpm test <path> -t "<name>"`.
- **Vitest mocking:** mock factories that reference outer variables must use `vi.hoisted(...)`; mock `@/lib/db` and pass through real pure helpers with `vi.importActual` when a SUT imports a builder from a mocked module (both pitfalls hit in this codebase before).

---

## File Structure

**New files:**
- `lib/provider-onboarding/quality-gate.ts` — policy: flag read, evidence/cert evaluation, applicant-facing copy. Pure + one flag read; no DB writes.
- `lib/provider-onboarding/quality-gate-submission.ts` — completion: draft → `ProviderApplication` (PENDING) on PASS; draft → MORE_INFO_REQUIRED application + ops note on FAILED×2. Server-side, transactional.
- `lib/identity-verification/application-link.ts` — `issueProviderApplicationVerificationLink({ providerApplicationDraftId, channel })`: draft-anchored sibling of the provider-centric issuer.
- `app/api/provider/identity/application-status/route.ts` — read-only, token-scoped verification status for the PWA client to poll (PASSED/FAILED/pending) without the mutating `resolveProviderVerificationToken`.
- `components/provider/registration/EvidenceUploader.tsx` — multi-photo Vercel Blob uploader for Flow A (and reused by Flow B's evidence section).
- Test files mirror each under `__tests__/…`.

**Modified files (anchors are current line numbers):**
- `lib/feature-flags-registry.ts` — add `provider.onboarding.quality_gate_v2` entry (~line 300).
- `scripts/feature-flag-groups.ts` — add the key to `WHATSAPP_REGISTRATION_FRICTION_FLAGS` (line 38) so seed tooling can target it.
- `prisma/schema.prisma` — add `providerApplicationDraftId String?` + relation on `ProviderIdentityVerification` (~1081); back-relation on `ProviderApplicationDraft` (~466).
- `lib/whatsapp-flows/registration.ts` — no-skip evidence (≥3), new certification step, Didit-at-submit branch, draft persistence at summary.
- `lib/whatsapp-flows/types.ts` — new `FlowStep` values, new `ConversationData` fields.
- `lib/web-signup-sections.ts` — evidence section `min(3)` when gate ON; new certification section.
- `lib/provider-registration/pwa-flow.ts` — carry `evidenceFileUrls`; evidence/cert gate in `submitProviderRegistrationApplication`; Didit-at-submit branch.
- `lib/provider-applications-submit.ts` — evidence/cert gate in `submitProviderApplication` (defense-in-depth).
- `app/provider/signup/actions.ts` — gate + Didit branch in `submitProviderApplicationFromWebAction`.
- `components/provider/registration/ProviderRegistrationClient.tsx` — evidence uploader wiring; non-skippable verify step + status poll when gate ON.
- `lib/identity-verification/orchestrator.ts` — allowlist bypass for application-stage subjects when gate ON (`resolveActiveVendorConfig`, ~627).
- `app/api/webhooks/verification/[vendor]/route.ts` — select `providerApplicationDraftId`; on PASSED/FAILED call the completion module.
- `lib/whatsapp-flows/provider-journey.ts` — filter the `[quality-gate]` marker out of `safeProviderStatusReason` (line 912).
- `scripts/seed-flags.ts` — no code change; used to seed the new flag at rollout.

---

## Phase 0 — Foundation (flag + policy + schema)

### Task 0.1: Register the `provider.onboarding.quality_gate_v2` flag

**Files:**
- Modify: `lib/feature-flags-registry.ts` (registry object, near the other `provider.*` entries ~line 300)
- Modify: `scripts/feature-flag-groups.ts:38` (`WHATSAPP_REGISTRATION_FRICTION_FLAGS`)
- Test: `__tests__/lib/feature-flags-registry.test.ts` (create if absent)

**Interfaces:**
- Produces: flag key string `'provider.onboarding.quality_gate_v2'` now valid in the `FeatureFlagKey` union.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/feature-flags-registry.test.ts
import { describe, it, expect } from 'vitest'
import { FEATURE_FLAGS_REGISTRY } from '@/lib/feature-flags-registry'

describe('quality gate v2 flag', () => {
  it('is registered, owned by eng, default OFF', () => {
    const entry = FEATURE_FLAGS_REGISTRY['provider.onboarding.quality_gate_v2']
    expect(entry).toBeDefined()
    expect(entry.defaultValue).toBe(false)
    expect(entry.owner).toBe('eng')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/feature-flags-registry.test.ts -t "quality gate v2"`
Expected: FAIL — `entry` is undefined (key not in registry, and TS error on the index type).

- [ ] **Step 3: Add the registry entry**

```ts
// lib/feature-flags-registry.ts — inside FEATURE_FLAGS_REGISTRY, next to other provider.* keys
'provider.onboarding.quality_gate_v2': {
  description:
    'Master switch for submit-time onboarding quality gate v2 (Didit KYC + ≥3 work photos + high-risk certification). ' +
    'When ON, all three application submit paths (WhatsApp registration, /provider/register, /provider/signup) enforce the bar. Default OFF.',
  owner: 'eng',
  defaultValue: false,
},
```

```ts
// scripts/feature-flag-groups.ts:38 — add to WHATSAPP_REGISTRATION_FRICTION_FLAGS array
'provider.onboarding.quality_gate_v2',
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/feature-flags-registry.test.ts -t "quality gate v2"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/feature-flags-registry.ts scripts/feature-flag-groups.ts __tests__/lib/feature-flags-registry.test.ts
git commit -m "feat(onboarding): register provider.onboarding.quality_gate_v2 flag (default OFF)"
```

### Task 0.2: Quality-gate policy module

**Files:**
- Create: `lib/provider-onboarding/quality-gate.ts`
- Test: `__tests__/lib/provider-onboarding/quality-gate.test.ts`

**Interfaces:**
- Consumes: `isEnabled` (`lib/flags.ts`), `hasHighRiskServiceSelection` (`lib/service-category-policy.ts`).
- Produces:
  - `MIN_EVIDENCE_PHOTOS = 3`
  - `isQualityGateV2Enabled(ctx?: { userId?: string }): Promise<boolean>`
  - `evaluateEvidenceGate(evidenceFileUrls: readonly string[]): { ok: boolean; have: number; need: number }`
  - `evaluateCertificationGate(skills: readonly string[], hasCertification: boolean): { required: boolean; ok: boolean }`
  - `evidenceShortfallMessage(have: number, need: number): string`
  - `certificationRequiredMessage(): string`

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/provider-onboarding/quality-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { isEnabledMock } = vi.hoisted(() => ({ isEnabledMock: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: isEnabledMock }))

import {
  MIN_EVIDENCE_PHOTOS,
  isQualityGateV2Enabled,
  evaluateEvidenceGate,
  evaluateCertificationGate,
  evidenceShortfallMessage,
} from '@/lib/provider-onboarding/quality-gate'

describe('quality-gate policy', () => {
  beforeEach(() => isEnabledMock.mockReset())

  it('MIN_EVIDENCE_PHOTOS is 3', () => {
    expect(MIN_EVIDENCE_PHOTOS).toBe(3)
  })

  it('isQualityGateV2Enabled reads the flag with userId', async () => {
    isEnabledMock.mockResolvedValue(true)
    await expect(isQualityGateV2Enabled({ userId: 'u1' })).resolves.toBe(true)
    expect(isEnabledMock).toHaveBeenCalledWith('provider.onboarding.quality_gate_v2', { userId: 'u1' })
  })

  it('evidence gate: <3 blocked, 3 ok, duplicates/blank ignored', () => {
    expect(evaluateEvidenceGate([])).toEqual({ ok: false, have: 0, need: 3 })
    expect(evaluateEvidenceGate(['a', 'b'])).toEqual({ ok: false, have: 2, need: 3 })
    expect(evaluateEvidenceGate(['a', 'a', ' ', 'b', 'c'])).toEqual({ ok: true, have: 3, need: 3 })
  })

  it('cert gate: required only when high-risk skills present', () => {
    expect(evaluateCertificationGate(['painting'], false)).toEqual({ required: false, ok: true })
    expect(evaluateCertificationGate(['plumbing'], false)).toEqual({ required: true, ok: false })
    expect(evaluateCertificationGate(['plumbing'], true)).toEqual({ required: true, ok: true })
  })

  it('shortfall message states remaining count', () => {
    expect(evidenceShortfallMessage(1, 3)).toContain('2 more')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/provider-onboarding/quality-gate.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the module**

```ts
// lib/provider-onboarding/quality-gate.ts
import { isEnabled } from '@/lib/flags'
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'

export const QUALITY_GATE_V2_FLAG = 'provider.onboarding.quality_gate_v2' as const
export const MIN_EVIDENCE_PHOTOS = 3

export function isQualityGateV2Enabled(ctx: { userId?: string } = {}): Promise<boolean> {
  return isEnabled(QUALITY_GATE_V2_FLAG, ctx)
}

function countDistinctNonEmpty(urls: readonly string[]): number {
  const seen = new Set<string>()
  for (const raw of urls) {
    const v = raw?.trim()
    if (v) seen.add(v)
  }
  return seen.size
}

export function evaluateEvidenceGate(evidenceFileUrls: readonly string[]): { ok: boolean; have: number; need: number } {
  const have = countDistinctNonEmpty(evidenceFileUrls ?? [])
  return { ok: have >= MIN_EVIDENCE_PHOTOS, have, need: MIN_EVIDENCE_PHOTOS }
}

export function evaluateCertificationGate(skills: readonly string[], hasCertification: boolean): { required: boolean; ok: boolean } {
  const required = hasHighRiskServiceSelection([...(skills ?? [])])
  return { required, ok: required ? Boolean(hasCertification) : true }
}

export function evidenceShortfallMessage(have: number, need: number): string {
  const remaining = Math.max(0, need - have)
  return `You've added ${have} of ${need} required work photos — please add ${remaining} more.`
}

export function certificationRequiredMessage(): string {
  return 'One of your selected trades is high-risk, so we need a certification document or registration number before you can finish.'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/provider-onboarding/quality-gate.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/provider-onboarding/quality-gate.ts __tests__/lib/provider-onboarding/quality-gate.test.ts
git commit -m "feat(onboarding): quality-gate policy module (evidence + cert evaluation)"
```

### Task 0.3: Additive schema — draft-anchored verification link

**Files:**
- Modify: `prisma/schema.prisma` (`ProviderIdentityVerification` ~1081; `ProviderApplicationDraft` ~466)
- Migration: `prisma/migrations/<timestamp>_qgv2_draft_verification_link/migration.sql`

**Interfaces:**
- Produces: `ProviderIdentityVerification.providerApplicationDraftId String?` + relation `providerApplicationDraft`; `ProviderApplicationDraft.identityVerifications ProviderIdentityVerification[]`.

- [ ] **Step 1: Add the field + relation to the schema**

```prisma
// prisma/schema.prisma — ProviderIdentityVerification, alongside providerApplicationId (~line 1081)
providerApplicationDraftId String?
// ... within the relations block (~1132):
providerApplicationDraft   ProviderApplicationDraft? @relation(fields: [providerApplicationDraftId], references: [id], onDelete: SetNull)
// ... add index near the other @@index lines:
@@index([providerApplicationDraftId])
```

```prisma
// prisma/schema.prisma — ProviderApplicationDraft relations block (~line 466)
identityVerifications ProviderIdentityVerification[]
```

- [ ] **Step 2: Generate the migration (no data change)**

Run: `pnpm prisma migrate dev --name qgv2_draft_verification_link --create-only`
Then inspect the generated SQL: it must be **only** `ALTER TABLE "provider_identity_verifications" ADD COLUMN "providerApplicationDraftId" TEXT;`, a `CREATE INDEX`, and an `ADD CONSTRAINT ... FOREIGN KEY`. No drops/renames. If anything else appears, stop and investigate.

- [ ] **Step 3: Apply + regenerate client**

Run: `pnpm prisma migrate dev --name qgv2_draft_verification_link` then `pnpm prisma generate`
Expected: migration applies clean; client types now expose `providerApplicationDraftId`.

- [ ] **Step 4: Verify the client compiles**

Run: `pnpm tsc --noEmit`
Expected: no errors referencing `providerApplicationDraftId`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): draft-anchored FK on ProviderIdentityVerification (additive)"
```

---

## Phase 1 — Free gates: evidence ≥3 and high-risk certification

These land value before any Didit work and are all no-ops when the flag is OFF.

### Task 1.1: Submit-path guard in `submitProviderApplication` (WhatsApp + Flow B creator)

**Files:**
- Modify: `lib/provider-applications-submit.ts` (`submitProviderApplication`, gate before create ~line 103)
- Test: `__tests__/lib/provider-applications-submit-quality-gate.test.ts`

**Interfaces:**
- Consumes: `isQualityGateV2Enabled`, `evaluateEvidenceGate`, `evaluateCertificationGate` (Task 0.2); `SubmitInput` (`lib/provider-applications-submit.ts:32`, has `skills: string[]`, `evidenceFileUrls?: string[]`).
- Produces: throws a typed rejection when the gate is ON and the bar is unmet. Reuse the file's existing error style; if it throws plain `Error`, throw `new Error('QUALITY_GATE_EVIDENCE')` / `'QUALITY_GATE_CERTIFICATION'`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/provider-applications-submit-quality-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateEnabled } = vi.hoisted(() => ({ gateEnabled: vi.fn() }))
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))

import { submitProviderApplication } from '@/lib/provider-applications-submit'
// Build a minimal fake tx client that returns no existing application, so the
// only reason to reject is the quality gate.
function fakeClient() {
  return {
    providerApplication: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    provider: { findFirst: vi.fn().mockResolvedValue(null) },
    // add just enough of the methods submitProviderApplication touches
  } as any
}

describe('submitProviderApplication quality gate', () => {
  beforeEach(() => gateEnabled.mockReset())

  it('rejects when gate ON and <3 evidence photos', async () => {
    gateEnabled.mockResolvedValue(true)
    await expect(
      submitProviderApplication(fakeClient(), { name: 'X', phone: '+2782', skills: ['painting'], evidenceFileUrls: ['a', 'b'] } as any, { source: 'web' } as any),
    ).rejects.toThrow('QUALITY_GATE_EVIDENCE')
  })

  it('rejects when gate ON, high-risk skill, no certification', async () => {
    gateEnabled.mockResolvedValue(true)
    await expect(
      submitProviderApplication(fakeClient(), { name: 'X', phone: '+2782', skills: ['plumbing'], evidenceFileUrls: ['a', 'b', 'c'] } as any, { source: 'web' } as any),
    ).rejects.toThrow('QUALITY_GATE_CERTIFICATION')
  })

  it('passes the gate when OFF regardless of evidence', async () => {
    gateEnabled.mockResolvedValue(false)
    const client = fakeClient()
    // create() resolves to a minimal application; assert it is reached
    client.providerApplication.create.mockResolvedValue({ id: 'app-1' })
    await submitProviderApplication(client, { name: 'X', phone: '+2782', skills: ['plumbing'], evidenceFileUrls: [] } as any, { source: 'web' } as any).catch(() => {})
    expect(gateEnabled).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/provider-applications-submit-quality-gate.test.ts`
Expected: FAIL — no gate rejection thrown (create called instead).

- [ ] **Step 3: Add the guard**

```ts
// lib/provider-applications-submit.ts — top imports
import { isQualityGateV2Enabled, evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'

// inside submitProviderApplication, immediately BEFORE the existing active-application
// conflict check (~line 103), after input is normalized:
if (await isQualityGateV2Enabled()) {
  const evidence = evaluateEvidenceGate(input.evidenceFileUrls ?? [])
  if (!evidence.ok) throw new Error('QUALITY_GATE_EVIDENCE')
  // A high-risk applicant must carry a certification. At submit the certification
  // is represented by a non-empty certification input on SubmitInput (see Task 1.6);
  // treat any provided cert doc URL or registration number as satisfying.
  const cert = evaluateCertificationGate(input.skills ?? [], Boolean(input.certificationRef))
  if (!cert.ok) throw new Error('QUALITY_GATE_CERTIFICATION')
}
```

Note: `certificationRef` is added to `SubmitInput` in Task 1.6; until then the high-risk test uses a skill with no cert and expects rejection, which holds.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/provider-applications-submit-quality-gate.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/provider-applications-submit.ts __tests__/lib/provider-applications-submit-quality-gate.test.ts
git commit -m "feat(onboarding): enforce evidence+cert gate in submitProviderApplication"
```

### Task 1.2: Submit-path guard in `submitProviderRegistrationApplication` (Flow A creator)

**Files:**
- Modify: `lib/provider-registration/pwa-flow.ts` (after the completeness check ~line 581, inside the `$transaction`)
- Test: `__tests__/lib/provider-registration/pwa-flow-quality-gate.test.ts`

**Interfaces:**
- Consumes: same policy helpers; `ProviderRegistrationValidationError(message, code, status=422)` (`pwa-flow.ts:20`) — the flow's rejection mechanism.
- Produces: throws `ProviderRegistrationValidationError('…', 'QUALITY_GATE_EVIDENCE', 422)` / `'QUALITY_GATE_CERTIFICATION'`.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/provider-registration/pwa-flow-quality-gate.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateEnabled } = vi.hoisted(() => ({ gateEnabled: vi.fn() }))
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))

import { submitProviderRegistrationApplication, ProviderRegistrationValidationError } from '@/lib/provider-registration/pwa-flow'
// Reuse the existing pwa-flow test harness/fixtures for a valid submit; only the
// evidence/cert fields vary. See __tests__/lib/provider-registration/pwa-flow.test.ts
// for the fake SubmitClient + valid input builder to import or copy.
import { buildValidSubmitClient, validSubmitInput } from './pwa-flow.fixtures'

describe('pwa-flow quality gate', () => {
  beforeEach(() => gateEnabled.mockReset())

  it('rejects <3 photos with code QUALITY_GATE_EVIDENCE when gate ON', async () => {
    gateEnabled.mockResolvedValue(true)
    const err = await submitProviderRegistrationApplication(
      buildValidSubmitClient(),
      { ...validSubmitInput(), skills: ['painting'], evidenceFileUrls: ['x'] },
    ).catch((e) => e)
    expect(err).toBeInstanceOf(ProviderRegistrationValidationError)
    expect(err.code).toBe('QUALITY_GATE_EVIDENCE')
  })

  it('allows 3 photos, non-high-risk, when gate ON', async () => {
    gateEnabled.mockResolvedValue(true)
    const res = await submitProviderRegistrationApplication(
      buildValidSubmitClient(),
      { ...validSubmitInput(), skills: ['painting'], evidenceFileUrls: ['x', 'y', 'z'] },
    )
    expect(res.outcome).toBe('created')
  })
})
```

If `pwa-flow.fixtures` does not exist, extract the valid-client + valid-input builders from the existing `pwa-flow.test.ts` into a shared `pwa-flow.fixtures.ts` as Step 1a (a pure refactor; run the existing suite green after).

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/provider-registration/pwa-flow-quality-gate.test.ts`
Expected: FAIL — no `QUALITY_GATE_EVIDENCE` thrown (Flow A currently ignores evidence entirely).

- [ ] **Step 3: Add `evidenceFileUrls` to the input + the guard**

```ts
// lib/provider-registration/pwa-flow.ts — extend ProviderRegistrationSubmitInput (~line 64)
evidenceFileUrls?: string[] | null
certificationRef?: string | null   // cert doc URL or registration number

// top imports
import { isQualityGateV2Enabled, evaluateEvidenceGate, evaluateCertificationGate } from '@/lib/provider-onboarding/quality-gate'

// inside the $transaction, AFTER the completeness check (after line 581), BEFORE the
// customer-phone conflict block:
if (await isQualityGateV2Enabled()) {
  const evidence = evaluateEvidenceGate(input.evidenceFileUrls ?? [])
  if (!evidence.ok) {
    throw new ProviderRegistrationValidationError(
      `At least ${evidence.need} work photos are required.`, 'QUALITY_GATE_EVIDENCE', 422,
    )
  }
  const cert = evaluateCertificationGate(data.skills ?? [], Boolean(input.certificationRef))
  if (!cert.ok) {
    throw new ProviderRegistrationValidationError(
      'A certification is required for high-risk trades.', 'QUALITY_GATE_CERTIFICATION', 422,
    )
  }
}

// at application create (~line 623/639) replace the hard-coded evidenceFileUrls:
evidenceFileUrls: input.evidenceFileUrls ?? [],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/provider-registration/pwa-flow-quality-gate.test.ts`
Expected: PASS. Also run `pnpm test __tests__/lib/provider-registration/pwa-flow.test.ts` — existing suite still green.

- [ ] **Step 5: Commit**

```bash
git add lib/provider-registration/pwa-flow.ts __tests__/lib/provider-registration/
git commit -m "feat(onboarding): carry evidence + enforce quality gate in pwa-flow submit"
```

### Task 1.3: WhatsApp evidence step — no-skip ≥3 when gate ON

**Files:**
- Modify: `lib/whatsapp-flows/registration.ts` (`handleCollectEvidence` ~1706; `sendEvidencePrompt` ~2387; `promptEvidenceAfterBio` ~2350)
- Test: `__tests__/lib/whatsapp-flows/registration-quality-gate-evidence.test.ts`

**Interfaces:**
- Consumes: `isQualityGateV2Enabled` (0.2); existing `evidenceFileUrls` accumulation in `ctx.data`; `MAX_EVIDENCE_FILES=5` (registration.ts:81).
- Produces: `evidence_done` / `evidence_skip` are refused with `evidenceShortfallMessage(...)` until `evidenceFileUrls` has ≥3 distinct entries; `evidence_skip` button + `evidence_skip_primary` path suppressed when gate ON.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/whatsapp-flows/registration-quality-gate-evidence.test.ts
// Mirror the mock scaffold from registration-kyc-mandatory.test.ts (db, whatsapp-interactive,
// whatsapp, whatsapp-media). Force the gate ON.
import { describe, it, expect, vi, beforeEach } from 'vitest'
const { gateEnabled, sendText } = vi.hoisted(() => ({ gateEnabled: vi.fn(), sendText: vi.fn() }))
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: gateEnabled,
}))
// ... (copy the remaining vi.mock scaffolding from registration-kyc-mandatory.test.ts,
//      wiring sendText into the whatsapp-interactive mock)
import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'

function buildCtx(overrides: any) {
  return { phone: '+2782', flow: 'registration', reply: { type: 'text', text: '' }, data: {}, ...overrides }
}

describe('WhatsApp evidence gate', () => {
  beforeEach(() => { gateEnabled.mockReset().mockResolvedValue(true); sendText.mockReset() })

  it('evidence_done with 2 photos stays on evidence + sends shortfall copy', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_collect_evidence')
    expect(sendText.mock.calls.flat().join(' ')).toContain('1 more')
  })

  it('evidence_skip is refused when gate ON', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_skip' },
      data: { evidenceFileUrls: ['a'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_collect_evidence')
  })

  it('evidence_done with 3 photos advances (to certification/summary)', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['painting'] },
    }))
    expect(result.nextStep).not.toBe('reg_collect_evidence')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/whatsapp-flows/registration-quality-gate-evidence.test.ts`
Expected: FAIL — `evidence_done`/`evidence_skip` currently advance to summary regardless of count.

- [ ] **Step 3: Gate the finish branches**

```ts
// lib/whatsapp-flows/registration.ts — top imports
import { isQualityGateV2Enabled, evaluateEvidenceGate, evidenceShortfallMessage } from '@/lib/provider-onboarding/quality-gate'

// handleCollectEvidence: at the top, resolve the gate ONCE
const qualityGate = await isQualityGateV2Enabled()

// In the evidence_skip branch (~1746) and the evidence_done branch (~1847), before
// calling showRegistrationSummary, add:
if (qualityGate) {
  const gate = evaluateEvidenceGate(ctx.data.evidenceFileUrls ?? [])
  if (!gate.ok) {
    await sendText(ctx.phone, evidenceShortfallMessage(gate.have, gate.need))
    // re-prompt for another upload; do not advance
    return { nextStep: 'reg_collect_evidence' }
  }
}
// (evidence_skip specifically: when qualityGate, treat it identically to a shortfall —
//  never clear evidence to empty. The block above already returns before the skip clears.)

// sendEvidencePrompt (~2392): suppress the skip-primary path when gate ON
const skipPrimary = !qualityGateForPrompt && await isEnabled('whatsapp.registration.evidence_skip_primary')
// where qualityGateForPrompt is isQualityGateV2Enabled() resolved at the call site;
// and when qualityGateForPrompt, render only the "add work photo" button (drop evidence_skip).
```

Pass the resolved `qualityGate` boolean into `sendEvidencePrompt`/`promptEvidenceAfterBio` (add a parameter) rather than re-reading the flag, to keep a single source of truth per turn.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/whatsapp-flows/registration-quality-gate-evidence.test.ts`
Expected: PASS (3 tests). Run the existing `registration-kyc-mandatory.test.ts` — still green.

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-flows/registration.ts __tests__/lib/whatsapp-flows/registration-quality-gate-evidence.test.ts
git commit -m "feat(onboarding): WhatsApp evidence step requires ≥3 photos, no skip, when gate ON"
```

### Task 1.4: WhatsApp certification step (high-risk only)

**Files:**
- Modify: `lib/whatsapp-flows/types.ts` (new `FlowStep` `reg_collect_certification`; `ConversationData.certificationRef?: string`, `certificationDocAttachmentId?: string`)
- Modify: `lib/whatsapp-flows/registration.ts` (new `handleCollectCertification`; route into it after evidence when high-risk + gate ON; wire the dispatcher case ~459)
- Test: `__tests__/lib/whatsapp-flows/registration-quality-gate-cert.test.ts`

**Interfaces:**
- Consumes: `hasHighRiskServiceSelection` (`lib/service-category-policy.ts`), `downloadAndStoreWhatsAppMedia` (already used in registration for doc uploads), `evaluateCertificationGate`.
- Produces: after a successful evidence gate, if `hasHighRiskServiceSelection(ctx.data.skills)` and gate ON → `reg_collect_certification`; a cert doc upload or a typed registration number sets `certificationRef`/`certificationDocAttachmentId` and advances to summary; non-high-risk skips straight to summary.

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/whatsapp-flows/registration-quality-gate-cert.test.ts
// Same mock scaffold; gate ON.
describe('WhatsApp certification gate', () => {
  beforeEach(() => gateEnabled.mockResolvedValue(true))

  it('high-risk skill routes evidence-done → certification step', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_collect_certification')
  })

  it('non-high-risk skips certification (evidence-done → summary/pending)', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_evidence',
      reply: { type: 'interactive', id: 'evidence_done' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['painting'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
  })

  it('certification step: typed registration number advances to summary', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_certification',
      reply: { type: 'text', text: 'PIRB-12345' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_pending')
    expect(result.nextData?.certificationRef).toBe('PIRB-12345')
  })

  it('certification step: empty input re-prompts, does not advance', async () => {
    const result = await handleRegistrationFlow(buildCtx({
      step: 'reg_collect_certification',
      reply: { type: 'text', text: '   ' },
      data: { evidenceFileUrls: ['a', 'b', 'c'], skills: ['plumbing'] },
    }))
    expect(result.nextStep).toBe('reg_collect_certification')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/whatsapp-flows/registration-quality-gate-cert.test.ts`
Expected: FAIL — `reg_collect_certification` step does not exist; evidence-done routes straight to summary.

- [ ] **Step 3: Add the step type, handler, and routing**

```ts
// lib/whatsapp-flows/types.ts — add to FlowStep union
| 'reg_collect_certification'
// add to ConversationData
certificationRef?: string
certificationDocAttachmentId?: string
```

```ts
// lib/whatsapp-flows/registration.ts — new handler
import { hasHighRiskServiceSelection } from '@/lib/service-category-policy'

async function handleCollectCertification(ctx: FlowContext): Promise<FlowResult> {
  // Media upload (cert document)
  if (ctx.reply.type === 'image' || ctx.reply.type === 'document') {
    const attachmentId = await downloadAndStoreWhatsAppMedia(ctx /* per existing call shape ~930 */)
    return showRegistrationSummary(ctx, { certificationDocAttachmentId: attachmentId, certificationRef: `attachment:${attachmentId}` })
  }
  const text = ctx.reply.text?.trim()
  if (!text) {
    await sendText(ctx.phone, 'Please upload your certification document or type your registration/licence number.')
    return { nextStep: 'reg_collect_certification' }
  }
  return showRegistrationSummary(ctx, { certificationRef: text })
}

// dispatcher: add a case near line 459
case 'reg_collect_certification':
  return handleCollectCertification(ctx)

// In handleCollectEvidence, replace the "advance to summary" after a passed evidence gate with:
if (qualityGate && hasHighRiskServiceSelection(ctx.data.skills ?? [])) {
  await sendCertificationPrompt(ctx.phone)      // new small helper: asks for doc upload or reg number
  return { nextStep: 'reg_collect_certification' }
}
return showRegistrationSummary(ctx, {})
```

`showRegistrationSummary` already routes to `reg_pending` (registration.ts:1963). Add `sendCertificationPrompt(phone)` mirroring `sendEvidencePrompt` copy.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/whatsapp-flows/registration-quality-gate-cert.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-flows/types.ts lib/whatsapp-flows/registration.ts __tests__/lib/whatsapp-flows/registration-quality-gate-cert.test.ts
git commit -m "feat(onboarding): WhatsApp high-risk certification step when gate ON"
```

### Task 1.5: Multi-photo evidence uploader component (both PWA surfaces)

**Files:**
- Create: `components/provider/registration/EvidenceUploader.tsx`
- Test: `__tests__/components/provider/registration/EvidenceUploader.test.tsx`

**Interfaces:**
- Consumes: existing Vercel Blob upload route/util (`lib/storage.ts`; the registration draft/photo upload endpoint the wizard already uses for `profilePhotoUrl` — reuse the same client upload path).
- Produces: `<EvidenceUploader value={string[]} onChange={(urls: string[]) => void} min={3} />` — renders thumbnails, "Add photo" button, per-item remove, and a live "N of 3" counter; disables its own "done" affordance until `value.length >= min`. Emits the array of stored blob URLs.

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/components/provider/registration/EvidenceUploader.test.tsx
import { render, screen } from '@testing-library/react'
import { EvidenceUploader } from '@/components/provider/registration/EvidenceUploader'

describe('EvidenceUploader', () => {
  it('shows N of min counter and blocks below min', () => {
    render(<EvidenceUploader value={['u1', 'u2']} onChange={() => {}} min={3} />)
    expect(screen.getByText(/2 of 3/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add photo/i })).toBeEnabled()
  })

  it('renders one thumbnail per url', () => {
    render(<EvidenceUploader value={['u1', 'u2', 'u3']} onChange={() => {}} min={3} />)
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText(/3 of 3/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/components/provider/registration/EvidenceUploader.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the component** (client component; upload handler posts to the existing blob upload route used for profile photos, then appends the returned URL via `onChange`). Keep it presentational + a thin upload call; validate each file is an image and `*.vercel-storage.com` URL on return (mirror `cleanUrlString` in `pwa-flow.ts:159`).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/components/provider/registration/EvidenceUploader.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add components/provider/registration/EvidenceUploader.tsx __tests__/components/provider/registration/EvidenceUploader.test.tsx
git commit -m "feat(onboarding): multi-photo evidence uploader component"
```

### Task 1.6: Flow B (`/provider/signup`) — evidence ≥3 + certification sections

**Files:**
- Modify: `lib/web-signup-sections.ts` (`evidence` schema line 33; new `certification` section; `SubmitInput` carries `certificationRef`)
- Modify: `app/provider/signup/sections/evidence.tsx` (swap the single-URL box for `EvidenceUploader`)
- Create: `app/provider/signup/sections/certification.tsx`
- Modify: `app/provider/signup/actions.ts` (`submitProviderApplicationFromWebAction` forwards `evidenceFileUrls` (already at ~74) + new `certificationRef`)
- Modify: `lib/provider-applications-submit.ts` (`SubmitInput` gains `certificationRef?: string | null` — completing the Task 1.1 reference)
- Test: `__tests__/lib/web-signup-sections-quality-gate.test.ts`

**Interfaces:**
- Consumes: `isQualityGateV2Enabled`, `MIN_EVIDENCE_PHOTOS`, `hasHighRiskServiceSelection`.
- Produces: when the gate is ON, `buildDynamicSchema` requires `evidenceFileUrls: z.array(z.string().url()).min(MIN_EVIDENCE_PHOTOS)`, and includes a `certification` section (required only when selected skills are high-risk).

- [ ] **Step 1: Write the failing test**

```ts
// __tests__/lib/web-signup-sections-quality-gate.test.ts
import { describe, it, expect, vi } from 'vitest'
vi.mock('@/lib/provider-onboarding/quality-gate', async (orig) => ({
  ...(await orig<typeof import('@/lib/provider-onboarding/quality-gate')>()),
  isQualityGateV2Enabled: vi.fn().mockResolvedValue(true),
}))
import { buildDynamicSchema, selectMissingSections } from '@/lib/web-signup-sections'

describe('web signup sections quality gate', () => {
  it('evidence requires 3 urls when gate ON', async () => {
    const schema = await buildDynamicSchema(['evidence'], { gateEnabled: true })
    const bad = schema.safeParse({ evidenceFileUrls: ['https://x.vercel-storage.com/a'] })
    expect(bad.success).toBe(false)
    const good = schema.safeParse({ evidenceFileUrls: ['https://x/a', 'https://x/b', 'https://x/c'] })
    expect(good.success).toBe(true)
  })

  it('certification section is selected for high-risk skills', () => {
    const missing = selectMissingSections({ skills: ['plumbing'] } as any, { gateEnabled: true })
    expect(missing).toContain('certification')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test __tests__/lib/web-signup-sections-quality-gate.test.ts`
Expected: FAIL — evidence optional; no certification section.

- [ ] **Step 3: Implement** the gate-aware schema (thread a `{ gateEnabled: boolean }` option through `buildDynamicSchema`/`selectMissingSections`; the action resolves `isQualityGateV2Enabled()` once and passes it in), add the `certification` section + component, wire `certificationRef` through the action and into `SubmitInput`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test __tests__/lib/web-signup-sections-quality-gate.test.ts`
Expected: PASS (2 tests). Existing signup section tests still green.

- [ ] **Step 5: Commit**

```bash
git add lib/web-signup-sections.ts app/provider/signup/ lib/provider-applications-submit.ts __tests__/lib/web-signup-sections-quality-gate.test.ts
git commit -m "feat(onboarding): /provider/signup evidence≥3 + certification sections behind gate"
```

### Task 1.7: Flow A (`/provider/register`) — wizard evidence uploader + cert field

**Files:**
- Modify: `components/provider/registration/ProviderRegistrationClient.tsx` (`evidence` step ~renders `evidenceNote` only; add `EvidenceUploader`; `registrationPayload` ~578 forwards `evidenceFileUrls` + `certificationRef`; `validateCurrentStep` ~614 blocks below 3 when gate ON)
- Modify: `app/provider/register/[[...step]]/page.tsx` (pass a server-resolved `qualityGateEnabled` prop into the client)
- Test: `__tests__/components/provider/registration/ProviderRegistrationClient-quality-gate.test.tsx`

**Interfaces:**
- Consumes: `EvidenceUploader` (1.5); a `qualityGateEnabled: boolean` prop resolved server-side via `isQualityGateV2Enabled()` in the page.
- Produces: `registrationPayload(step)` includes `evidenceFileUrls: string[]` and `certificationRef?: string`; client-side `validateCurrentStep('evidence')` fails below 3 photos when `qualityGateEnabled`.

- [ ] **Step 1: Write the failing test** — render the client with `qualityGateEnabled` and 2 photos on the evidence step; assert the "next/continue" affordance is disabled and a "3 of 3" style counter is shown. (Use the existing client test harness; if none, render `ProviderRegistrationClient` with minimal props.)
- [ ] **Step 2: Run** — Expected FAIL (no uploader, no gate).
- [ ] **Step 3: Implement** — render `EvidenceUploader` in the `evidence` step; store `evidenceFileUrls` in wizard form state; forward in `registrationPayload`; add the cert input when `hasHighRiskServiceSelection(serviceTags(form))`; gate `validateCurrentStep`. Server page resolves the flag and passes the prop.
- [ ] **Step 4: Run** — Expected PASS; existing client tests green.
- [ ] **Step 5: Commit**

```bash
git add components/provider/registration/ProviderRegistrationClient.tsx app/provider/register/ __tests__/components/provider/registration/ProviderRegistrationClient-quality-gate.test.tsx
git commit -m "feat(onboarding): /provider/register wizard evidence uploader + cert field behind gate"
```

### Task 1.8: Flag-OFF regression guard

**Files:**
- Test: `__tests__/lib/provider-onboarding/quality-gate-off-regression.test.ts`

- [ ] **Step 1: Write tests** asserting that with `isQualityGateV2Enabled → false`: `submitProviderApplication` and `submitProviderRegistrationApplication` create applications with `evidenceFileUrls: []` and high-risk skills and **do not throw**; the WhatsApp `evidence_skip`/`evidence_done` advance to summary as before; `buildDynamicSchema(['evidence'], { gateEnabled: false })` accepts zero photos.
- [ ] **Step 2: Run** — Expected FAIL only if a gate leaked into an unguarded path; otherwise PASS immediately (acceptable here — this is a guard test, not new behaviour).
- [ ] **Step 3:** If any assertion fails, fix the leak (the enforcement must be strictly inside `if (gate)` branches).
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add __tests__/lib/provider-onboarding/quality-gate-off-regression.test.ts
git commit -m "test(onboarding): flag-OFF preserves pre-gate behaviour across all paths"
```

---

## Phase 2 — Didit at submit (create-on-PASS)

**Design recap:** while the gate is ON, the applicant's captured data is written to a `ProviderApplicationDraft`; a **draft-anchored** `ProviderIdentityVerification` (providerId = null, `providerApplicationDraftId` set) is issued; the applicant receives the internal `/provider/verify/[token]` link (consent → Didit hosted session). The `PASSED` webhook creates the `ProviderApplication` (PENDING) from the draft and sends the confirmation. `FAILED×2` creates the application as `MORE_INFO_REQUIRED` with a `[quality-gate]` ops note. No application/provider row exists before PASS.

### Task 2.1: Allowlist bypass for application-stage subjects when gate ON

**Files:**
- Modify: `lib/identity-verification/orchestrator.ts` (`resolveActiveVendorConfig` ~627, the `pilotGateRequired` block)
- Test: `__tests__/lib/identity-verification/orchestrator-appstage-bypass.test.ts`

**Interfaces:**
- Consumes: `isQualityGateV2Enabled`; the subject shape `{ providerId?, providerApplicationId?, providerApplicationDraftId? }` already flowing through `resolveActiveVendorConfig`.
- Produces: when the gate is ON **and** the subject is application-stage (no `providerId`), the pilot allowlist check is skipped; automation flag + single active `VerificationVendorConfig` + vendor flag are still required. Post-approval subjects (with `providerId`) still require the allowlist.

- [ ] **Step 1: Write the failing test** — with automation ON, `pilot_allowlist_required` ON, one active didit config, didit vendor flag ON, and gate ON: a subject `{ providerApplicationDraftId: 'd1' }` resolves to `vendorKey: 'didit'` **without** an allowlist row; a subject `{ providerId: 'p1' }` still falls back to `manual` without an allowlist row.
- [ ] **Step 2: Run** — Expected FAIL (app-stage subject falls back to manual today).
- [ ] **Step 3: Implement**

```ts
// resolveActiveVendorConfig, inside the `if (pilotGateRequired)` block (~627):
const isApplicationStage = !snapshot.providerId &&
  Boolean(snapshot.providerApplicationId || (snapshot as any).providerApplicationDraftId)
const gateOn = isApplicationStage ? await isQualityGateV2Enabled() : false
if (!(isApplicationStage && gateOn)) {
  const allowlisted = await client.providerIdentityVerificationPilotAllowlist.findFirst({ /* existing query */ })
  if (!allowlisted) return manualConfig()
}
```

Thread `providerApplicationDraftId` into the snapshot type used by `resolveActiveVendorConfig` and `resolveIdentityVerificationConsentVendorForSubject`.

- [ ] **Step 4: Run** — Expected PASS. Existing orchestrator tests green.
- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/orchestrator.ts __tests__/lib/identity-verification/orchestrator-appstage-bypass.test.ts
git commit -m "feat(kyc): bypass pilot allowlist for application-stage subjects when gate ON"
```

### Task 2.2: Draft-anchored verification link issuer

**Files:**
- Create: `lib/identity-verification/application-link.ts`
- Test: `__tests__/lib/identity-verification/application-link.test.ts`

**Interfaces:**
- Consumes: `db`, `ProviderIdentityVerification` (now with `providerApplicationDraftId`); the token-mint + verify-URL logic from `issueProviderIdentityVerificationLink` (`link.ts:45`) — extract the shared token/URL builder rather than duplicating.
- Produces: `issueProviderApplicationVerificationLink(input: { providerApplicationDraftId: string; channel: VerificationChannel }): Promise<{ verificationId: string; verificationUrl: string; expiresAt: Date }>`. Creates a verification row with `providerId: null`, `providerApplicationDraftId` set, `channel`, `identityBasis` default, and a fresh access token; returns the `/provider/verify/[token]` URL.

- [ ] **Step 1: Write the failing test** — call with `{ providerApplicationDraftId: 'd1', channel: 'WHATSAPP' }` against a fake `db`; assert it creates one `providerIdentityVerification` with `providerId: null`, `providerApplicationDraftId: 'd1'`, and returns a `verificationUrl` containing the minted token and an `expiresAt` in the future.
- [ ] **Step 2: Run** — Expected FAIL (module absent).
- [ ] **Step 3: Implement** the issuer, reusing the token/URL helper factored out of `link.ts`. Do **not** call `checkCanStartNewVerification(providerId)` (there is no provider). Set `countsTowardAttemptCap: true`.
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/identity-verification/application-link.ts lib/identity-verification/link.ts __tests__/lib/identity-verification/application-link.test.ts
git commit -m "feat(kyc): draft-anchored verification link issuer for application-stage subjects"
```

### Task 2.3: Consent/session-start tolerates a null-provider verification

**Files:**
- Modify: `app/provider/verify/[token]/actions.ts` (`startHostedVerificationFromConsent`)
- Modify: `lib/provider-verification-token.ts` if the token resolver assumes a provider
- Test: `__tests__/app/provider/verify/consent-null-provider.test.ts`

**Interfaces:**
- Produces: `startHostedVerificationFromConsent` creates the Didit session and returns the hosted URL for a verification whose `providerId` is null (application-stage). No `Provider.kycStatus` write is attempted (already gated on `providerId` in the orchestrator).

- [ ] **Step 1: Write the failing test** — drive consent for a verification row with `providerId: null, providerApplicationDraftId: 'd1'`; assert a Didit session is created (mock `createDiditSession`) and the hosted URL is returned; assert no `provider.update` is attempted.
- [ ] **Step 2: Run** — Expected FAIL if any code path dereferences a null provider.
- [ ] **Step 3: Implement** the null-provider tolerance (guard any provider lookups with `if (verification.providerId)`).
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add app/provider/verify/ lib/provider-verification-token.ts __tests__/app/provider/verify/consent-null-provider.test.ts
git commit -m "feat(kyc): hosted verification consent works for application-stage (no provider) subjects"
```

### Task 2.4: Draft persistence + Didit launch at WhatsApp summary confirm

**Files:**
- Modify: `lib/whatsapp-flows/registration.ts` (`handleConfirm`/`handlePending` — when gate ON, instead of `submitProviderApplication`, upsert a `ProviderApplicationDraft` from `ctx.data`, issue the draft-anchored link, send the CTA-URL button, land on a new `reg_awaiting_kyc` step)
- Modify: `lib/whatsapp-flows/types.ts` (`FlowStep` `reg_awaiting_kyc`)
- Test: `__tests__/lib/whatsapp-flows/registration-didit-launch.test.ts`

**Interfaces:**
- Consumes: `issueProviderApplicationVerificationLink` (2.2); `sendCtaUrl` (already used in registration); a new `upsertDraftFromConversation(ctx.data)` helper mapping `ConversationData` → `ProviderApplicationDraft` fields (skills, serviceAreas, experience, evidenceFileUrls→URLs, certificationRef, phone, name, references, availability).
- Produces: gate ON → `{ nextStep: 'reg_awaiting_kyc' }`, a draft row persisted, a verification issued with `channel: 'WHATSAPP'` and `providerApplicationDraftId`, and the hosted link sent. Gate OFF → unchanged `submitProviderApplication` path.

- [ ] **Step 1: Write the failing test** — gate ON, drive `reg_confirm` with complete `ctx.data`; assert a draft is created, `issueProviderApplicationVerificationLink` is called with `channel: 'WHATSAPP'`, a CTA-URL button is sent with the returned URL, `nextStep === 'reg_awaiting_kyc'`, and **no** `ProviderApplication` is created. Gate OFF → `submitProviderApplication` is called as today.
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** the branch + `upsertDraftFromConversation` helper. WhatsApp evidence is stored as attachment IDs; convert to durable URLs (the same mapping `handlePending` already does at submit → `evidenceAttachmentIds`; resolve attachment URLs for the draft, or store attachment IDs and resolve them in the completion step — pick one and keep it consistent with Task 2.6's reader).
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-flows/ __tests__/lib/whatsapp-flows/registration-didit-launch.test.ts
git commit -m "feat(kyc): WhatsApp summary launches Didit + persists draft (create-on-PASS) when gate ON"
```

### Task 2.5: PWA — draft persistence + Didit launch + status polling

**Files:**
- Create: `app/api/provider/identity/application-status/route.ts` (read-only, token-scoped status)
- Modify: `app/provider/signup/actions.ts` and `lib/provider-registration/pwa-flow.ts` submit paths (gate ON → persist/reuse draft, issue link, return `{ awaitingVerification: true, verificationUrl }` instead of creating an application)
- Modify: `components/provider/registration/ProviderRegistrationClient.tsx` (verify step non-skippable when gate ON; poll `application-status` until PASSED, then submit completes)
- Modify: `app/provider/signup/remaining-fields-form.tsx` (same gate on the resume-finish path)
- Test: `__tests__/app/api/provider/identity/application-status.test.ts`, `__tests__/lib/provider-registration/pwa-flow-didit-launch.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/provider/identity/application-status?token=<accessToken>` → `{ status: VerificationStatus; decision: VerificationDecision | null }`, read-only, **non-mutating** (does not call `resolveProviderVerificationToken`, which throws on terminal statuses — read the row directly by hashed token). No PII.
  - Flow A/B submit, gate ON: returns `{ outcome: 'awaiting_verification', verificationUrl }`; the client shows the link, polls status, and finalizes on PASSED (the webhook is the source of truth for the application row; the client only advances its own UI).

- [ ] **Step 1: Write the failing tests** — status route returns the row's status/decision for a valid token and 404 for unknown; both submit paths, gate ON, return `awaiting_verification` + a `verificationUrl` and create **no** application.
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** the route (hash the token, `findUnique` on `accessTokenHash`, select only `status, decision`), and the gate-ON submit branches (persist a `ProviderApplicationDraft`, call `issueProviderApplicationVerificationLink({ channel: 'PWA' })`).
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add app/api/provider/identity/application-status/ app/provider/signup/ lib/provider-registration/pwa-flow.ts components/provider/registration/ __tests__/app/api/provider/identity/ __tests__/lib/provider-registration/pwa-flow-didit-launch.test.ts
git commit -m "feat(kyc): PWA draft+Didit launch and read-only status polling when gate ON"
```

### Task 2.6: Webhook completion — PASSED → PENDING application; FAILED×2 → MORE_INFO

**Files:**
- Create: `lib/provider-onboarding/quality-gate-submission.ts`
- Modify: `app/api/webhooks/verification/[vendor]/route.ts` (select `providerApplicationDraftId`; after `applyVendorVerdict`, call the completion module)
- Modify: `lib/whatsapp-flows/provider-journey.ts:912` (`safeProviderStatusReason` must strip the `[quality-gate]` marker line)
- Test: `__tests__/lib/provider-onboarding/quality-gate-submission.test.ts`, `__tests__/app/api/webhooks/verification-completion.test.ts`

**Interfaces:**
- Consumes: the draft (all captured fields), the existing draft→application creator (call `submitProviderApplication` with the draft's fields + `source: 'kyc_webhook'`), and the failure-count from `ProviderVerificationEvent`/verification `decision`.
- Produces:
  - `completeApplicationForPassedVerification(client, { verificationId }): Promise<{ applicationId: string } | { skipped: 'no_draft' | 'already_submitted' }>` — idempotent (guards on `draft.submittedApplicationId`), creates PENDING application, links `draft.submittedApplicationId`, fires the existing submitted-confirmation message, sets the verification's `providerApplicationId`.
  - `recordFailedVerificationForApplication(client, { verificationId, failureCount }): Promise<void>` — on the 2nd FAIL, create the application as `MORE_INFO_REQUIRED` with `appendReviewNote(notes, …)` using marker `[quality-gate]` and reason "KYC failed at application"; otherwise send a retry link (reuse the in-flight re-nudge machinery — no new cron).

- [ ] **Step 1: Write the failing tests**
  - `completeApplicationForPassedVerification`: given a verification with a linked draft, creates exactly one PENDING application, sets `submittedApplicationId`, and is a no-op on a second call (idempotent).
  - Webhook: a PASSED payload for a draft-anchored verification results in a PENDING application + confirmation sent once; a FAILED payload with prior-fail-count 1 results in a `MORE_INFO_REQUIRED` application whose `notes` contains `[quality-gate]`; a FAILED with count 0 creates no application.
  - `safeProviderStatusReason('[quality-gate] KYC failed at application\nreal reason')` does not leak the marker line.
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** the completion module + wire it into the webhook. In the route, extend the verification `findUniqueOrThrow` select (route ~103) to include `providerApplicationDraftId` and `providerId`; after `applied = applyVendorVerdict(...)`, branch: `applied.status === 'PASSED'` → `completeApplicationForPassedVerification`; `applied.status === 'FAILED'` → `recordFailedVerificationForApplication`. Only act when `providerApplicationDraftId` is set (leave provider-centric re-verifications untouched).
- [ ] **Step 4: Run** — Expected PASS. Run the full webhook suite — existing behaviour for provider-centric verifications unchanged.
- [ ] **Step 5: Commit**

```bash
git add lib/provider-onboarding/quality-gate-submission.ts app/api/webhooks/verification/ lib/whatsapp-flows/provider-journey.ts __tests__/lib/provider-onboarding/quality-gate-submission.test.ts __tests__/app/api/webhooks/verification-completion.test.ts
git commit -m "feat(kyc): PASSED webhook creates PENDING application from draft; FAILED×2 → MORE_INFO + ops note"
```

### Task 2.7: Retire the manual `reg_verify_*` skip when gate ON

**Files:**
- Modify: `lib/whatsapp-flows/registration.ts` (when gate ON, the early `reg_collect_id`/`reg_verify_*` manual-KYC steps are bypassed — identity is deferred to the Didit step at summary; the name step routes straight to skills)
- Test: `__tests__/lib/whatsapp-flows/registration-gate-skips-manual-kyc.test.ts`

**Interfaces:**
- Produces: gate ON → `handleCollectName` routes to `reg_collect_skills_more` (skipping `reg_collect_id`); the manual doc/selfie path is not entered. Gate OFF → unchanged (manual KYC as today, still governed by `isKycRequiredForActivation`).

- [ ] **Step 1: Write the failing test** — gate ON, drive `reg_collect_name` with a valid name; assert `nextStep` skips identity and lands on skills; the `sendVerificationChoicePrompt` is not sent.
- [ ] **Step 2: Run** — Expected FAIL (name currently routes to `reg_collect_id`).
- [ ] **Step 3: Implement** the gate-ON routing in `handleCollectName` (and the migrated-email path).
- [ ] **Step 4: Run** — Expected PASS. `registration-kyc-mandatory.test.ts` (gate OFF) still green.
- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-flows/registration.ts __tests__/lib/whatsapp-flows/registration-gate-skips-manual-kyc.test.ts
git commit -m "feat(kyc): defer identity to Didit (skip manual reg_verify_*) when gate ON"
```

### Task 2.8: Error handling — Didit unavailable at session create

**Files:**
- Modify: the Didit launch call sites (2.4, 2.5) to catch `DiditApiError`/`DiditDisabledError` (`vendors/didit/client.ts`)
- Test: `__tests__/lib/whatsapp-flows/registration-didit-unavailable.test.ts`

**Interfaces:**
- Produces: on session-create failure with gate ON, the applicant gets "verification is temporarily unavailable — we'll message you here shortly", the draft stays in the pre-Didit state (no application), and the in-flight re-nudge cron retries the link issue. **No** fallback to the manual vendor while the gate is ON.

- [ ] **Step 1: Write the failing test** — force `issueProviderApplicationVerificationLink` to throw `DiditDisabledError`; assert the applicant gets the temporary-unavailable copy, `nextStep` stays at the confirm/awaiting step, and no application is created.
- [ ] **Step 2: Run** — Expected FAIL.
- [ ] **Step 3: Implement** the try/catch + copy.
- [ ] **Step 4: Run** — Expected PASS.
- [ ] **Step 5: Commit**

```bash
git add lib/whatsapp-flows/ app/provider/ __tests__/lib/whatsapp-flows/registration-didit-unavailable.test.ts
git commit -m "feat(kyc): graceful Didit-unavailable handling at session create (no manual fallback when gate ON)"
```

---

## Phase 3 — Rollout & verification

### Task 3.1: Full suite + typecheck + lint gate

- [ ] **Step 1:** Run `pnpm tsc --noEmit` — Expected: clean.
- [ ] **Step 2:** Run `pnpm lint` — Expected: clean.
- [ ] **Step 3:** Run `pnpm test` — Expected: all green (note the 12 known machine-local parallelism flakes; confirm identical failures on clean `main` before dismissing any).
- [ ] **Step 4:** Extend `e2e/smoke.spec.ts` with a flag-OFF smoke of `/provider/register` and `/provider/signup` (house rule #6) — the pages render and submit works with the gate OFF.
- [ ] **Step 5: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test(onboarding): smoke coverage for provider signup surfaces (gate OFF)"
```

### Task 3.2: Rollout runbook (dark → verify → flip)

- [ ] **Step 1:** Write `docs/marketing/2026-07-04-quality-gate-v2-rollout.md` (or the ops runbook location) capturing the exact sequence:
  1. Merge with `provider.onboarding.quality_gate_v2` **OFF** (default).
  2. Verify Vercel prod env present: `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`, Didit workflow IDs.
  3. Turn `provider.identity.verification.automation` ON; insert a single active `VerificationVendorConfig` row for `didit`; turn the `provider.identity.vendor.didit` flag ON.
  4. Turn `provider.kyc.required_for_activation` ON (defense-in-depth).
  5. End-to-end test with the internal `isTestUser` provider cohort (application → Didit → PASSED → PENDING).
  6. Flip `provider.onboarding.quality_gate_v2` ON.
  7. Monitor first-day funnel via the existing funnel report.
- [ ] **Step 2:** No code. Commit the runbook.

```bash
git add docs/
git commit -m "docs(onboarding): quality-gate-v2 rollout runbook"
```

**Rollout note:** flags are flipped by the operator via `scripts/seed-flags.ts --flag=<key> --enable` or the DB `feature_flags` row — **not** by this plan's code. Steps 3–6 are gated on user confirmation (production config + KYC enforcement fall under the approval boundaries).

---

## Self-Review

**Spec coverage:**
- KYC at submit (Approach A, create-on-PASS) → Tasks 2.1–2.8. ✓
- ≥3 photos all applicants → 1.1, 1.2, 1.3, 1.6, 1.7. ✓
- High-risk certification → 1.1, 1.2, 1.4, 1.6, 1.7. ✓
- Platform-wide, both channels + both PWA surfaces → WhatsApp (1.3, 1.4, 2.4, 2.7), Flow B (1.6, 2.5), Flow A (1.7, 2.5). ✓
- Flag `provider.onboarding.quality_gate_v2` default OFF → 0.1. ✓
- Vendor selection allowlist bypass for application-stage → 2.1. ✓
- `provider.kyc.required_for_activation` defense-in-depth → 3.2 rollout step 4 (flag already exists). ✓
- FAILED×2 → MORE_INFO_REQUIRED + `[quality-gate]` ops note → 2.6. ✓
- Abandoned mid-Didit covered by existing re-nudge cron → 2.5/2.8 (no new machinery). ✓
- Didit unavailable / no manual fallback → 2.8. ✓
- Flag OFF preserves current behaviour → 1.8. ✓

**Deviations from spec (surfaced, deliberate):**
- Spec's "reuse draft-first application + Didit adapter" → reality required a new draft-anchored issuer (2.2), null-provider consent tolerance (2.3), a draft FK (0.3), and a webhook completion module (2.6). Documented in "Reconciliations".
- Create-on-PASS (no application until PASS) chosen over a holding-status application, to preserve today's "abandoned registration creates nothing" behaviour and the founder's keep-junk-out intent.

**Type consistency:** `certificationRef` is introduced on `SubmitInput` (1.6) and referenced in 1.1/1.2 — 1.1's guard tolerates its absence until 1.6 lands (high-risk test rejects on missing cert either way). `evidenceFileUrls` is the single field name across all paths. `providerApplicationDraftId` is the single FK name across 0.3, 2.1, 2.2, 2.4, 2.5, 2.6. `issueProviderApplicationVerificationLink` signature is identical in 2.2, 2.4, 2.5.

**Open confirmations for the executor (not blockers):**
- The exact `submitProviderApplication` `SubmitInput` fields the draft maps to (Task 2.4 `upsertDraftFromConversation`) — confirm against `lib/provider-applications-submit.ts:32` at implementation time.
- Whether the wizard's profile-photo upload route can be reused verbatim for evidence blobs (Task 1.5) — confirm the route accepts arbitrary image uploads, else add a sibling route.

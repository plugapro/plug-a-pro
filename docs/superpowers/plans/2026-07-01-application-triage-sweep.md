# Application Triage Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One repeatable CLI sweep that triages the provider-application queue with the 4 approved rules, plus one new Meta template.

**Architecture:** A single script exposing pure, testable classification functions (`classifyApplication`) + a CLI main with `--dry-run` default. Status mutations go through `db` with AuditLog rows; rule-2 approvals go through the existing `syncProviderRecord` so the KYC-activation gate stays authoritative. Sends go through existing `lib/whatsapp` adapters with message-event dedup.

**Tech Stack:** tsx script, Prisma 6, Vitest, existing `lib/whatsapp` + `lib/provider-record` + `lib/ops-agents/pilot-area` + `lib/service-category-policy` helpers.

**Spec:** `docs/superpowers/specs/2026-07-01-application-triage-sweep-design.md` (approved 2026-07-01).

## Global Constraints

- `--dry-run` is the DEFAULT; `--execute` required for any write or send. Dry-run performs ZERO db writes and ZERO sends.
- Idempotency marker appended to `ProviderApplication.notes`: `[triage-sweep YYYY-MM-DD rule-N]`. Rows whose notes contain `[triage-sweep` are skipped on re-run.
- Duplicate guard (rule 0) runs before all other rules: applicant phone matching an active `Provider.phone` → skip + report.
- Message dedup: same templateName to same phone within 7 days → skip send (query `message_events`).
- Rule 4 delegates to the existing `sendProviderKycNudge` + KYC-drive spacing/caps — the sweep never sends `provider_kyc_nudge` directly.
- Rule 2 approvals call `syncProviderRecord` (lib/provider-record.ts) — never raw `provider.update` for activation.
- High-risk skills = categories whose `CATEGORY_POLICIES[slug].riskLevel !== 'standard'` (use `getCategoryPolicy`).
- stdout shows phone tails only (`…1234`), never full numbers.
- AuditLog on every status change: `actorRole: 'SYSTEM'`, `action: 'application.triage_sweep'`, before/after JSON.
- Rule 3 send requires the `provider_area_waitlist` template APPROVED at Meta — the script checks via Graph API and skips-with-warning otherwise.
- Waitlist row: `ServiceAreaWaitlist` upsert on `(phone, city)` with `source: 'triage-sweep'`.
- New template copy is FIXED (spec §4) — do not edit wording.

---

### Task 1: Register `provider_area_waitlist` template

**Files:**
- Modify: `field-service/lib/messaging-templates.ts` (after `provider_verification_resume_selfie` block)
- Modify: `field-service/scripts/register-whatsapp-templates.mjs` (TEMPLATES array, after the resume templates)

**Interfaces:**
- Produces: `TEMPLATES.provider_area_waitlist` registry entry; TemplateName union gains `'provider_area_waitlist'` (auto-derived).

- [ ] **Step 1: Add registry entry**

In `field-service/lib/messaging-templates.ts`, after the `provider_verification_resume_selfie` entry, add:

```typescript
  // ─── Application triage sweep (2026-07-01) ───────────────────────────────
  provider_area_waitlist: {
    name: 'provider_area_waitlist',
    language: 'en_ZA',
    category: 'UTILITY',
    description:
      'Sent to out-of-pilot applicants during the application triage sweep. Parks them on the launch waitlist; prevents re-applications.',
    // {{1}} applicant first name, {{2}} area label (e.g. "Midrand", "the Western Cape")
    example:
      "Hi {{1}}, thanks for applying to Plug A Pro. We're not live in {{2}} yet — your application is saved and you're on the launch list. We'll message you the moment we start rolling out in your area. No need to re-apply.",
  },
```

- [ ] **Step 2: Add registration-batch entry**

In `field-service/scripts/register-whatsapp-templates.mjs`, after the `provider_verification_resume_selfie` block in `TEMPLATES`, add:

```javascript
  {
    name: 'provider_area_waitlist',
    category: 'UTILITY',
    // {{1}} applicant first name, {{2}} area label
    body: "Hi {{1}}, thanks for applying to Plug A Pro. We're not live in {{2}} yet - your application is saved and you're on the launch list. We'll message you the moment we start rolling out in your area. No need to re-apply.",
    examples: ['Sipho', 'Midrand'],
  },
```

- [ ] **Step 3: Verify audit coverage + typecheck**

```bash
cd field-service
node scripts/register-whatsapp-templates.mjs --audit-coverage | head -5
pnpm tsc --noEmit
```

Expected: `provider_area_waitlist` NOT in the missing list; typecheck clean.

- [ ] **Step 4: Commit**

```bash
git add field-service/lib/messaging-templates.ts field-service/scripts/register-whatsapp-templates.mjs
git commit -m "feat(applications): provider_area_waitlist template for triage sweep"
```

---

### Task 2: Classification logic (pure, TDD)

**Files:**
- Create: `field-service/scripts/application-triage-sweep.ts`
- Create: `field-service/__tests__/scripts/application-triage-sweep.test.ts`

**Interfaces:**
- Produces (exported from the script, consumed by Task 3's CLI + the tests):

```typescript
export type TriageRule = 'DUPLICATE' | 'RULE_1_NO_ID' | 'RULE_2_PARTIAL_APPROVE' | 'RULE_2B_HIGH_RISK_ONLY' | 'RULE_3_OUT_OF_PILOT' | 'SKIP_ALREADY_SWEPT'
export interface TriageInput {
  id: string
  name: string | null
  phone: string
  skills: string[]
  serviceAreas: string[]
  idNumber: string | null
  status: 'PENDING' | 'MORE_INFO_REQUIRED'
  notes: string | null
  hasVerificationRow: boolean
  isActiveProviderPhone: boolean
}
export interface TriageDecision {
  rule: TriageRule
  targetStatus: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | null // null = no change
  template: 'provider_registration_continue' | 'provider_high_risk_cert_nudge' | 'provider_area_waitlist' | null
  approvedSkills: string[] | null   // rule 2 only: selected minus high-risk (canonical slugs)
  heldSkills: string[] | null       // rule 2/2b: the high-risk slugs held pending cert
  waitlist: boolean                 // rule 3 only
  areaLabel: string | null          // rule 3 only: humanised {{2}} value
}
export function classifyApplication(input: TriageInput): TriageDecision
```

- [ ] **Step 1: Write the failing tests**

`field-service/__tests__/scripts/application-triage-sweep.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { classifyApplication, type TriageInput } from '../../scripts/application-triage-sweep'

const base: TriageInput = {
  id: 'app-1',
  name: 'Sipho Test',
  phone: '+27820000001',
  skills: ['plumbing', 'painting'],
  serviceAreas: ['Honeydew', 'Florida'],
  idNumber: '9001015800081',
  status: 'PENDING',
  notes: null,
  hasVerificationRow: false,
  isActiveProviderPhone: false,
}

describe('classifyApplication', () => {
  it('rule 0: active-provider phone → DUPLICATE, no change, no send', () => {
    const d = classifyApplication({ ...base, isActiveProviderPhone: true })
    expect(d.rule).toBe('DUPLICATE')
    expect(d.targetStatus).toBeNull()
    expect(d.template).toBeNull()
  })

  it('idempotency: notes containing [triage-sweep → SKIP_ALREADY_SWEPT', () => {
    const d = classifyApplication({ ...base, notes: 'prev [triage-sweep 2026-07-01 rule-2]' })
    expect(d.rule).toBe('SKIP_ALREADY_SWEPT')
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3: no pilot-suburb overlap → park + waitlist + area label', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand', 'Centurion'] })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.template).toBe('provider_area_waitlist')
    expect(d.waitlist).toBe(true)
    expect(d.areaLabel).toBe('Midrand')
    // has ID → stays PENDING
    expect(d.targetStatus).toBeNull()
  })

  it('rule 3 + no ID → MORE_INFO_REQUIRED while parked', () => {
    const d = classifyApplication({ ...base, serviceAreas: ['Midrand'], idNumber: null })
    expect(d.rule).toBe('RULE_3_OUT_OF_PILOT')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
  })

  it('rule 1: in-pilot, no idNumber, no verification row → MORE_INFO + resume nudge', () => {
    const d = classifyApplication({ ...base, idNumber: null })
    expect(d.rule).toBe('RULE_1_NO_ID')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.template).toBe('provider_registration_continue')
  })

  it('rule 1 exception: verification row counts as ID captured (Bernard edge)', () => {
    const d = classifyApplication({ ...base, idNumber: null, hasVerificationRow: true })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
  })

  it('rule 2: in-pilot multi-skill with ID → APPROVED minus high-risk + cert nudge', () => {
    const d = classifyApplication(base)
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.targetStatus).toBe('APPROVED')
    expect(d.approvedSkills).toEqual(['painting'])
    expect(d.heldSkills).toEqual(['plumbing'])
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('rule 2 holds geysers too (any non-standard risk level)', () => {
    const d = classifyApplication({ ...base, skills: ['geysers', 'painting', 'plumbing'] })
    expect(d.heldSkills).toEqual(expect.arrayContaining(['plumbing', 'geysers']))
    expect(d.approvedSkills).toEqual(['painting'])
  })

  it('rule 2b: plumbing-only with ID → MORE_INFO + cert nudge, nothing approved', () => {
    const d = classifyApplication({ ...base, skills: ['plumbing'] })
    expect(d.rule).toBe('RULE_2B_HIGH_RISK_ONLY')
    expect(d.targetStatus).toBe('MORE_INFO_REQUIRED')
    expect(d.approvedSkills).toBeNull()
    expect(d.template).toBe('provider_high_risk_cert_nudge')
  })

  it('normalises mixed-case skills and areas ("Plumbing", "Allen\'s Nek")', () => {
    const d = classifyApplication({ ...base, skills: ['Plumbing', 'Painting'], serviceAreas: ["Allen's Nek"] })
    expect(d.rule).toBe('RULE_2_PARTIAL_APPROVE')
    expect(d.heldSkills).toEqual(['plumbing'])
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
cd field-service && pnpm vitest run __tests__/scripts/application-triage-sweep.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the classification core**

`field-service/scripts/application-triage-sweep.ts` (classification half; CLI comes in Task 3):

```typescript
#!/usr/bin/env tsx
// Application triage sweep — classify + act on the provider-application queue.
// Spec: docs/superpowers/specs/2026-07-01-application-triage-sweep-design.md
//
// Default is --dry-run: prints the classification table, writes and sends NOTHING.
// Usage:
//   pnpm tsx scripts/application-triage-sweep.ts                 # dry-run, all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute       # apply all rules
//   pnpm tsx scripts/application-triage-sweep.ts --execute --rule=3

import { areaInPilot } from '@/lib/ops-agents/pilot-area'
import { getCategoryPolicy } from '@/lib/service-category-policy'

export type TriageRule =
  | 'DUPLICATE'
  | 'RULE_1_NO_ID'
  | 'RULE_2_PARTIAL_APPROVE'
  | 'RULE_2B_HIGH_RISK_ONLY'
  | 'RULE_3_OUT_OF_PILOT'
  | 'SKIP_ALREADY_SWEPT'

export interface TriageInput {
  id: string
  name: string | null
  phone: string
  skills: string[]
  serviceAreas: string[]
  idNumber: string | null
  status: 'PENDING' | 'MORE_INFO_REQUIRED'
  notes: string | null
  hasVerificationRow: boolean
  isActiveProviderPhone: boolean
}

export interface TriageDecision {
  rule: TriageRule
  targetStatus: 'PENDING' | 'MORE_INFO_REQUIRED' | 'APPROVED' | null
  template:
    | 'provider_registration_continue'
    | 'provider_high_risk_cert_nudge'
    | 'provider_area_waitlist'
    | null
  approvedSkills: string[] | null
  heldSkills: string[] | null
  waitlist: boolean
  areaLabel: string | null
}

const SWEEP_MARKER = '[triage-sweep'

function normaliseSkill(skill: string): string {
  return skill.trim().toLowerCase()
}

function isHighRisk(skillSlug: string): boolean {
  return getCategoryPolicy(skillSlug).riskLevel !== 'standard'
}

function hasIdCaptured(input: TriageInput): boolean {
  return Boolean(input.idNumber && input.idNumber.trim() !== '') || input.hasVerificationRow
}

function inPilot(input: TriageInput): boolean {
  return input.serviceAreas.some((area) => areaInPilot(area))
}

const NO_DECISION: Omit<TriageDecision, 'rule'> = {
  targetStatus: null,
  template: null,
  approvedSkills: null,
  heldSkills: null,
  waitlist: false,
  areaLabel: null,
}

export function classifyApplication(input: TriageInput): TriageDecision {
  if (input.notes?.includes(SWEEP_MARKER)) {
    return { rule: 'SKIP_ALREADY_SWEPT', ...NO_DECISION }
  }
  if (input.isActiveProviderPhone) {
    return { rule: 'DUPLICATE', ...NO_DECISION }
  }

  const idCaptured = hasIdCaptured(input)

  if (!inPilot(input)) {
    return {
      rule: 'RULE_3_OUT_OF_PILOT',
      targetStatus: idCaptured ? null : 'MORE_INFO_REQUIRED',
      template: 'provider_area_waitlist',
      approvedSkills: null,
      heldSkills: null,
      waitlist: true,
      areaLabel: input.serviceAreas[0]?.trim() || 'your area',
    }
  }

  if (!idCaptured) {
    return {
      rule: 'RULE_1_NO_ID',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_registration_continue',
      approvedSkills: null,
      heldSkills: null,
      waitlist: false,
      areaLabel: null,
    }
  }

  const slugs = input.skills.map(normaliseSkill)
  const held = slugs.filter(isHighRisk)
  const approved = slugs.filter((s) => !isHighRisk(s))

  if (approved.length === 0) {
    return {
      rule: 'RULE_2B_HIGH_RISK_ONLY',
      targetStatus: 'MORE_INFO_REQUIRED',
      template: 'provider_high_risk_cert_nudge',
      approvedSkills: null,
      heldSkills: held,
      waitlist: false,
      areaLabel: null,
    }
  }

  return {
    rule: 'RULE_2_PARTIAL_APPROVE',
    targetStatus: 'APPROVED',
    template: 'provider_high_risk_cert_nudge',
    approvedSkills: approved,
    heldSkills: held,
    waitlist: false,
    areaLabel: null,
  }
}
```

Note for the implementer: `areaInPilot` and `getCategoryPolicy` are real modules with no side effects on import; the tests import the script directly (real-module rule). If importing the script pulls in `@/lib/db` transitively via Task 3's additions, keep the classification pure by placing all db-touching imports inside the CLI functions (dynamic `await import(...)`) so the test file never opens a connection.

- [ ] **Step 4: Run to verify pass**

```bash
pnpm vitest run __tests__/scripts/application-triage-sweep.test.ts
```

Expected: 10/10 PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/scripts/application-triage-sweep.ts field-service/__tests__/scripts/application-triage-sweep.test.ts
git commit -m "feat(applications): triage sweep classification core (TDD)"
```

---

### Task 3: Execution paths + CLI + PR

**Files:**
- Modify: `field-service/scripts/application-triage-sweep.ts` (append execution + CLI half)
- Modify: `field-service/__tests__/scripts/application-triage-sweep.test.ts` (add execution-path tests)

**Interfaces:**
- Consumes: `classifyApplication` (Task 2); `syncProviderRecord` from `@/lib/provider-record`; `sendTemplate` from `@/lib/whatsapp`; `sendProviderKycNudge` pattern from the KYC drive (`lib/kyc-drive/nudge.ts` — reuse its exported run helper if present, else call `sendProviderKycNudge` with `issueProviderIdentityVerificationLink`).
- Produces: CLI with `--dry-run` default / `--execute` / `--rule=N`; `runSweep(opts)` exported for tests.

- [ ] **Step 1: Add execution-path tests**

Append to the test file:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockDb, mockSendTemplate, mockSync } = vi.hoisted(() => ({
  mockDb: {
    providerApplication: { findMany: vi.fn(), update: vi.fn() },
    provider: { findMany: vi.fn().mockResolvedValue([]) },
    providerIdentityVerification: { findMany: vi.fn().mockResolvedValue([]) },
    messageEvent: { findFirst: vi.fn().mockResolvedValue(null) },
    serviceAreaWaitlist: { upsert: vi.fn() },
    auditLog: { create: vi.fn() },
  },
  mockSendTemplate: vi.fn().mockResolvedValue({ externalId: 'wamid-1' }),
  mockSync: vi.fn().mockResolvedValue({ providerId: 'prov-1' }),
}))

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@/lib/whatsapp', () => ({ sendTemplate: mockSendTemplate }))
vi.mock('@/lib/provider-record', () => ({ syncProviderRecord: mockSync }))

describe('runSweep', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const pendingApp = {
    id: 'app-1', name: 'Sipho T', phone: '+27820000001',
    skills: ['plumbing', 'painting'], serviceAreas: ['Honeydew'],
    idNumber: '9001015800081', status: 'PENDING', notes: null, providerId: null,
  }

  it('dry-run performs zero writes and zero sends', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: false, rules: [1, 2, 3] })

    expect(report.rows).toHaveLength(1)
    expect(mockDb.providerApplication.update).not.toHaveBeenCalled()
    expect(mockDb.auditLog.create).not.toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(mockSync).not.toHaveBeenCalled()
  })

  it('execute rule 2: syncProviderRecord with approved skills, AuditLog, cert nudge, notes marker', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    await runSweep({ execute: true, rules: [2] })

    expect(mockSync).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      skills: ['painting'],
      verified: true,
    }))
    expect(mockDb.providerApplication.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'app-1' },
      data: expect.objectContaining({
        status: 'APPROVED',
        notes: expect.stringContaining('[triage-sweep'),
      }),
    }))
    expect(mockDb.auditLog.create).toHaveBeenCalled()
    expect(mockSendTemplate).toHaveBeenCalledWith(expect.objectContaining({
      template: 'provider_high_risk_cert_nudge',
      to: '+27820000001',
    }))
  })

  it('message dedup: recent same-template send → status change still applies, send skipped', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([pendingApp])
    mockDb.messageEvent.findFirst.mockResolvedValue({ id: 'me-recent' })
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: true, rules: [2] })

    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(report.rows[0].sendSkippedReason).toBe('RECENTLY_MESSAGED')
  })

  it('rule 3 without Meta approval: status+waitlist apply, send deferred', async () => {
    mockDb.providerApplication.findMany.mockResolvedValue([
      { ...pendingApp, serviceAreas: ['Midrand'] },
    ])
    const { runSweep } = await import('../../scripts/application-triage-sweep')
    const report = await runSweep({ execute: true, rules: [3], waitlistTemplateApproved: false })

    expect(mockDb.serviceAreaWaitlist.upsert).toHaveBeenCalled()
    expect(mockSendTemplate).not.toHaveBeenCalled()
    expect(report.rows[0].sendSkippedReason).toBe('TEMPLATE_NOT_APPROVED')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm vitest run __tests__/scripts/application-triage-sweep.test.ts
```

Expected: classification tests still PASS; `runSweep` tests FAIL (not exported).

- [ ] **Step 3: Implement `runSweep` + CLI**

Append to the script. Key contract (full code to be written by the implementer following these exact behaviors):

```typescript
export interface SweepOptions {
  execute: boolean
  rules: number[]                       // subset of [1,2,3,4]
  waitlistTemplateApproved?: boolean    // injected in tests; CLI resolves via Graph API
  now?: Date
}
export interface SweepRow {
  applicationId: string
  name: string
  phoneTail: string                     // last 4 digits only
  rule: TriageRule
  statusChange: string | null           // "PENDING → APPROVED" | null
  template: string | null
  sendSkippedReason: 'RECENTLY_MESSAGED' | 'TEMPLATE_NOT_APPROVED' | null
}
export interface SweepReport { rows: SweepRow[]; kyc?: { targeted: number; sent: number; skipped: number } }
export async function runSweep(opts: SweepOptions): Promise<SweepReport>
```

Implementation requirements (each maps to a Global Constraint):
1. All db/whatsapp/provider-record imports are DYNAMIC (`const { db } = await import('@/lib/db')`) inside `runSweep`, keeping `classifyApplication` importable without a DB connection.
2. Load queue: `providerApplication.findMany({ where: { status: { in: ['PENDING','MORE_INFO_REQUIRED'] } } })`; load active provider phones + verification rows in two batched queries; build `TriageInput[]`.
3. For each decision, when `opts.execute`:
   - Status change → `providerApplication.update` with `status` (when non-null) + `notes` append `\n[triage-sweep ${yyyy-mm-dd} rule-${n}]` + `reviewedAt: now`; then `auditLog.create({ actorId: 'triage-sweep', actorRole: 'SYSTEM', action: 'application.triage_sweep', entityType: 'ProviderApplication', entityId, before: { status: old }, after: { status: new, rule } })`.
   - RULE_2_PARTIAL_APPROVE additionally calls `syncProviderRecord(db, { phone, name, skills: decision.approvedSkills, serviceAreas, verified: true })` — trusting its KYC gate; then sends `provider_high_risk_cert_nudge` (components: `[{ type: 'body', parameters: [{ type: 'text', text: firstName }] }]`).
   - RULE_3 upserts `serviceAreaWaitlist` (`where: { phone_city: { phone, city } }`, city = `areaLabel`), sends `provider_area_waitlist` with `[firstName, areaLabel]` body params ONLY if `waitlistTemplateApproved`.
   - Before ANY send: `messageEvent.findFirst({ where: { to: phone, templateName, sentAt: { gte: now-7d } } })` → skip with `RECENTLY_MESSAGED`.
   - 300ms sleep between sends.
4. Rule 4 (only when `rules.includes(4)` and `opts.execute`): dynamic-import the KYC-drive run helper (`lib/kyc-drive/nudge.ts`) and invoke its existing entry point for the unverified-provider set; report `{ targeted, sent, skipped }`. Do NOT reimplement spacing/caps.
5. Dry-run: classification + report only — constraint 3/4 blocks entirely skipped.
6. `main()`: parse `--execute`, `--rule=N` (repeatable), resolve `waitlistTemplateApproved` via Graph API template-status query (reuse the fetch pattern from `register-whatsapp-templates.mjs --check-status`), print the report as an aligned table with phone tails, then `db.$disconnect()` in a `finally`.

- [ ] **Step 4: Run all tests + typecheck**

```bash
pnpm vitest run __tests__/scripts/application-triage-sweep.test.ts
pnpm tsc --noEmit
```

Expected: 14/14 PASS; typecheck clean.

- [ ] **Step 5: Dry-run smoke against prod (read-only by design)**

```bash
pnpm tsx scripts/application-triage-sweep.ts | head -40
```

Expected: table of 29 rows with rule assignments matching the spec §2 bucket counts (4 / 10 / 15, plus the Vigilance duplicate flag).

- [ ] **Step 6: Commit + PR**

```bash
git add field-service/scripts/application-triage-sweep.ts field-service/__tests__/scripts/application-triage-sweep.test.ts
git commit -m "feat(applications): triage sweep execution paths + CLI"
git push -u origin feat/application-triage-sweep
gh pr create --title "feat(applications): triage sweep — 4-rule queue cleanout" --body "Spec: docs/superpowers/specs/2026-07-01-application-triage-sweep-design.md. Dry-run default; per-rule execution; new provider_area_waitlist template. 14 tests."
```

---

## Plan self-review

**Spec coverage:** §3 decision table → Task 2 `classifyApplication` (all six rows incl. rule 0 + 2b + Bernard edge). §4 template → Task 1. §5 script modes/safety rails → Task 3 (constraints 1-6 map 1:1). §6 sequence → Task 3 Step 6 + post-merge ops (outside plan). §7 tests → Tasks 2-3 (14 cases incl. dry-run-zero-writes, dedup, template-not-approved). §8 observation → no task (correctly— it's an observation).
**Placeholders:** none — Task 3 Step 3 gives the full contract + behavior list rather than literal code for the ~150-line CLI half; every behavior is individually specified with exact field names.
**Type consistency:** `TriageDecision`/`TriageInput`/`SweepOptions`/`SweepRow` names match across Tasks 2-3 and tests.

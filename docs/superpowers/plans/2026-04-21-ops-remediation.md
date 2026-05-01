# Ops Remediation — Production Readiness Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five audit-identified blockers that prevent ops from running the Plug A Pro platform safely through real-world failures without engineering intervention.

**Architecture:** Three delivery waves. Wave 1 (Tasks 1–4) unblocks pre-launch ops. Wave 2 (Tasks 5–6) hardens data stewardship and permissions. Wave 3 (Task 7) adds resilience and hygiene. Every task ships behind a feature flag and produces a green CI run.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Supabase Postgres, `crudAction()` mutation wrapper, Zod, React Hook Form, Tailwind CSS v4, shadcn/Radix UI, Vitest.

---

## File Map

```
field-service/
├── lib/
│   ├── audit-entities.ts           NEW  canonical entity-name constants
│   ├── crud-action.ts              MOD  add reason + full before snapshot
│   └── audit.ts                   MOD  re-export AUDIT_ENTITIES
├── prisma/schema.prisma            MOD  Case, CaseEvent, CaseNote models
├── scripts/backfill-cases.ts       NEW  idempotent open-entity → Case rows
├── app/(admin)/admin/
│   ├── _actions/case/
│   │   └── index.ts               NEW  claimCase, resolveCase, addCaseNote…
│   ├── _components/
│   │   ├── case-activity-timeline.tsx  NEW  chronological event list
│   │   ├── case-notes.tsx              NEW  note list + add-note form
│   │   └── resolve-case-dialog.tsx     NEW  modal with outcome + reason code
│   ├── bookings/[id]/actions.ts    NEW  rescheduleBooking, correctBooking
│   ├── quotes/actions.ts           NEW  voidQuote, expireQuote
│   ├── payments/actions.ts         NEW  reconcilePayment, writeOffPayment
│   ├── disputes/actions.ts         NEW  resolveDispute, escalateDispute
│   ├── messages/actions.ts         NEW  retryMessage, resendMessage
│   ├── customers/actions.ts        MOD  fix block metadata fields
│   └── providers/actions.ts        MOD  fix status reason persistence
├── app/api/admin/
│   ├── customers/export/route.ts   MOD  add export audit + role guard
│   └── providers/export/route.ts   MOD  add export audit + role guard
├── app/api/webhooks/payments/route.ts MOD  return 500 on unknown handler error
└── __tests__/
    ├── lib/audit-entities.test.ts  NEW
    ├── lib/crud-action-reason.test.ts  NEW
    ├── admin/case-actions.test.ts  NEW
    ├── admin/booking-actions.test.ts  NEW
    └── admin/customer-block.test.ts   NEW
```

---

## Wave 1 — Pre-launch blockers

---

### Task 1: Audit infrastructure — entity constants + diff capture + reason discipline

**Branch:** `ops/audit-infrastructure`
**Flag:** none (pure correctness fix)
**Files:**
- Create: `field-service/lib/audit-entities.ts`
- Modify: `field-service/lib/crud-action.ts`
- Modify: `field-service/app/(admin)/admin/validation/page.tsx`
- Modify: `field-service/app/(admin)/admin/dispatch/page.tsx`
- Modify: `field-service/app/(admin)/admin/quotes/page.tsx`
- Create: `field-service/__tests__/lib/audit-entities.test.ts`
- Create: `field-service/__tests__/lib/crud-action-reason.test.ts`

#### Step 1.1 — Write the failing test for entity constants

```typescript
// field-service/__tests__/lib/audit-entities.test.ts
import { AUDIT_ENTITY } from '@/lib/audit-entities'

it('exports canonical entity name strings', () => {
  expect(AUDIT_ENTITY.JOB_REQUEST).toBe('JobRequest')
  expect(AUDIT_ENTITY.QUOTE).toBe('Quote')
  expect(AUDIT_ENTITY.BOOKING).toBe('Booking')
  expect(AUDIT_ENTITY.PAYMENT).toBe('Payment')
  expect(AUDIT_ENTITY.DISPUTE).toBe('Dispute')
  expect(AUDIT_ENTITY.CUSTOMER).toBe('Customer')
  expect(AUDIT_ENTITY.PROVIDER).toBe('Provider')
})
```

- [ ] Write the test at `field-service/__tests__/lib/audit-entities.test.ts`
- [ ] Run: `cd field-service && pnpm test __tests__/lib/audit-entities.test.ts`
- Expected: FAIL — `Cannot find module '@/lib/audit-entities'`

#### Step 1.2 — Create `audit-entities.ts`

```typescript
// field-service/lib/audit-entities.ts
/**
 * Canonical entity name strings used in AuditLog.entityType and
 * AdminAuditEvent.entityType. Always use these constants — never bare
 * string literals — so reads and writes always match.
 */
export const AUDIT_ENTITY = {
  CUSTOMER: 'Customer',
  CUSTOMER_NOTE: 'CustomerNote',
  PROVIDER: 'Provider',
  PROVIDER_NOTE: 'ProviderNote',
  JOB_REQUEST: 'JobRequest',
  QUOTE: 'Quote',
  BOOKING: 'Booking',
  JOB: 'Job',
  PAYMENT: 'Payment',
  DISPUTE: 'Dispute',
  LOCATION_NODE: 'LocationNode',
  CATEGORY: 'Category',
  ADMIN_USER: 'AdminUser',
  FEATURE_FLAG: 'FeatureFlag',
  CASE: 'Case',
  CASE_NOTE: 'CaseNote',
} as const

export type AuditEntityType = (typeof AUDIT_ENTITY)[keyof typeof AUDIT_ENTITY]
```

- [ ] Create `field-service/lib/audit-entities.ts` with the content above
- [ ] Run: `cd field-service && pnpm test __tests__/lib/audit-entities.test.ts`
- Expected: PASS

#### Step 1.3 — Write failing test for reason capture in crudAction

```typescript
// field-service/__tests__/lib/crud-action-reason.test.ts
import { vi, it, expect, beforeEach } from 'vitest'

// Mock dependencies — crudAction imports db, auth, flags
vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn() },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      adminUser: { findUnique: vi.fn() },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth', () => ({ getSession: vi.fn() }))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))

import { crudAction } from '@/lib/crud-action'
import { db } from '@/lib/db'
import { getSession } from '@/lib/auth'

const mockSession = { id: 'user-1' }
const mockAdmin = { id: 'admin-1', role: 'ADMIN', active: true }

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockSession)
  ;(db.adminUser.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(mockAdmin)
  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
    const txMock = {
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(txMock)
  })
})

it('includes reason in audit payload when provided', async () => {
  let capturedAuditData: Record<string, unknown> | undefined

  ;(db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (fn) => {
    const txMock = {
      auditLog: {
        create: vi.fn(async (args) => { capturedAuditData = args.data; return {} }),
      },
      adminAuditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    return fn(txMock)
  })

  await crudAction({
    entity: 'Customer',
    entityId: 'cust-1',
    action: 'customer.block',
    requiredRole: ['OPS'],
    reason: 'Fraud detected',
    run: async () => ({ id: 'cust-1' }),
  })

  expect(capturedAuditData?.reason).toBe('Fraud detected')
})
```

- [ ] Write the test at `field-service/__tests__/lib/crud-action-reason.test.ts`
- [ ] Run: `cd field-service && pnpm test __tests__/lib/crud-action-reason.test.ts`
- Expected: FAIL — `reason` not in audit payload

#### Step 1.4 — Add `reason` to `crudAction`

In `field-service/lib/crud-action.ts`, make two changes:

**Change 1** — Add `reason` to the options interface (after line 77):
```typescript
  /**
   * Optional human-readable justification for this action.
   * Written into both audit rows so reviewers can reconstruct why the
   * change was made, not only what changed.
   */
  reason?: string
```

**Change 2** — Include `reason` in both audit creates (lines ~154–173). Replace the `auditLog.create` call with:
```typescript
    await tx.auditLog.create({
      data: {
        actorId: session.id,
        actorRole: adminUser.role,
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: toAuditJson(opts.before),
        after: toAuditJson(result),
        ...(opts.reason ? { metadata: toAuditJson({ reason: opts.reason }) } : {}),
      },
    })

    await tx.adminAuditEvent.create({
      data: {
        adminId: adminUser.id,
        action: opts.action,
        entityType: opts.entity,
        entityId,
        before: toAuditJson(opts.before),
        after: toAuditJson(result),
        ...(opts.reason ? { metadata: toAuditJson({ reason: opts.reason }) } : {}),
      },
    })
```

> Note: `AuditLog` has an `ipAddress`/`userAgent` field but no `metadata` column. Check `field-service/prisma/schema.prisma` for the actual column names on `AuditLog` and `AdminAuditEvent`. If `metadata` exists only on `AdminAuditEvent`, write to `metadata` there and to a JSON-merged `after` on `AuditLog`. The goal is that reason is *somewhere* in each row.

- [ ] Apply both changes to `field-service/lib/crud-action.ts`
- [ ] Run: `cd field-service && pnpm test __tests__/lib/crud-action-reason.test.ts`
- Expected: PASS

#### Step 1.5 — Fix entity-name mismatches in queue pages

Three files query `entityType` with the wrong casing. Fix each to import `AUDIT_ENTITY` and use the constant.

**`field-service/app/(admin)/admin/validation/page.tsx` line ~85:**
```typescript
// Before:
where: { entityId: { in: requestIds }, entityType: 'job_request' },
// After:
import { AUDIT_ENTITY } from '@/lib/audit-entities'
// ...
where: { entityId: { in: requestIds }, entityType: AUDIT_ENTITY.JOB_REQUEST },
```

**`field-service/app/(admin)/admin/dispatch/page.tsx` line ~278-283:**
Find the audit query that reads `entityType: 'job_request'` (or similar) and replace with `AUDIT_ENTITY.JOB_REQUEST`.

**`field-service/app/(admin)/admin/quotes/page.tsx` line ~102:**
```typescript
// Before:
where: { entityId: { in: quoteIds }, entityType: 'quote' },
// After:
import { AUDIT_ENTITY } from '@/lib/audit-entities'
// ...
where: { entityId: { in: quoteIds }, entityType: AUDIT_ENTITY.QUOTE },
```

- [ ] Apply all three fixes
- [ ] Run: `cd field-service && pnpm lint && pnpm test`
- Expected: lint clean, all tests pass (entity constants are strings, runtime behaviour unchanged)

#### Step 1.6 — Commit

```bash
cd field-service && git add lib/audit-entities.ts lib/crud-action.ts \
  app/(admin)/admin/validation/page.tsx \
  app/(admin)/admin/dispatch/page.tsx \
  app/(admin)/admin/quotes/page.tsx \
  __tests__/lib/audit-entities.test.ts \
  __tests__/lib/crud-action-reason.test.ts
git commit -m "fix(audit): add AUDIT_ENTITY constants, reason field, fix entity-name mismatches"
```

---

### Task 2: Case lifecycle — schema + server actions

**Branch:** `ops/case-lifecycle`
**Flag:** `ops.v2.cases` (seeded disabled)
**Files:**
- Modify: `field-service/prisma/schema.prisma`
- Create: `field-service/scripts/backfill-cases.ts`
- Create: `field-service/app/(admin)/admin/_actions/case/index.ts`
- Modify: `field-service/scripts/seed-flags.ts`
- Create: `field-service/__tests__/admin/case-actions.test.ts`

#### Step 2.1 — Add Case, CaseEvent, CaseNote to the Prisma schema

Open `field-service/prisma/schema.prisma` and append these models before the closing of the file:

```prisma
// ─── Ops Case lifecycle ───────────────────────────────────────────────────────

enum CaseQueueType {
  VALIDATION
  DISPATCH
  FIELD
  QUOTES
  FINANCE
  TRUST
  SUPPLY
}

enum CaseEntityType {
  JOB_REQUEST
  MATCH
  BOOKING
  PAYMENT
  DISPUTE
  APPLICATION
}

enum CaseState {
  OPEN
  IN_PROGRESS
  RESOLVED
  CANCELLED
  REOPENED
}

enum CaseEventType {
  STATE_CHANGE
  SYSTEM_EVENT
  OPS_ACTION
  NOTE_ADDED
  ASSIGNMENT_CHANGE
  CUSTOMER_CONTACTED
  ESCALATION
  BREACH_DETECTED
}

model Case {
  id           String          @id @default(cuid())
  queueType    CaseQueueType
  entityType   CaseEntityType
  entityId     String
  state        CaseState       @default(OPEN)
  outcome      String?
  reasonCode   String?
  ownerUserId  String?
  slaDueAt     DateTime
  resolvedAt   DateTime?
  resolvedBy   String?
  createdAt    DateTime        @default(now())
  updatedAt    DateTime        @updatedAt

  events       CaseEvent[]
  notes        CaseNote[]

  @@unique([entityType, entityId, queueType, state])
  @@index([queueType, state, slaDueAt])
}

model CaseEvent {
  id          String        @id @default(cuid())
  caseId      String
  type        CaseEventType
  payload     Json
  actorUserId String?
  createdAt   DateTime      @default(now())

  case        Case          @relation(fields: [caseId], references: [id], onDelete: Cascade)

  @@index([caseId, createdAt])
}

enum CaseNoteVisibility {
  INTERNAL_ONLY
}

model CaseNote {
  id           String             @id @default(cuid())
  caseId       String
  authorUserId String
  body         String             @db.Text
  visibility   CaseNoteVisibility @default(INTERNAL_ONLY)
  createdAt    DateTime           @default(now())

  case         Case               @relation(fields: [caseId], references: [id], onDelete: Cascade)
}
```

- [ ] Append the models above to `field-service/prisma/schema.prisma`
- [ ] Run: `cd field-service && pnpm db:migrate` — name the migration `add_case_lifecycle`
- Expected: migration applied, Prisma client regenerated

#### Step 2.2 — Seed the `ops.v2.cases` flag

In `field-service/scripts/seed-flags.ts`, add to the flags array:
```typescript
{ key: 'ops.v2.cases', description: 'Case lifecycle: claim, note, resolve, reopen across all queues' },
```

- [ ] Add the flag entry
- [ ] Run: `cd field-service && pnpm db:seed` (or `npx tsx scripts/seed-flags.ts`)
- Expected: `ops.v2.cases` appears in the `feature_flags` table, disabled

#### Step 2.3 — Write failing tests for case actions

```typescript
// field-service/__tests__/admin/case-actions.test.ts
import { vi, it, expect, describe, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => {
  const mockCase = {
    id: 'case-1',
    state: 'OPEN',
    ownerUserId: null,
    queueType: 'DISPATCH',
    entityType: 'JOB_REQUEST',
    entityId: 'jr-1',
    slaDueAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  return {
    db: {
      adminUser: { findUnique: vi.fn() },
      case: {
        findUnique: vi.fn().mockResolvedValue(mockCase),
        update: vi.fn().mockResolvedValue({ ...mockCase, ownerUserId: 'admin-1' }),
      },
      caseEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
      caseNote: { create: vi.fn().mockResolvedValue({ id: 'note-1' }) },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
      $transaction: vi.fn(async (fn) => fn({
        case: { findUnique: vi.fn().mockResolvedValue(mockCase), update: vi.fn().mockResolvedValue(mockCase) },
        caseEvent: { create: vi.fn().mockResolvedValue({ id: 'evt-1' }) },
        caseNote: { create: vi.fn().mockResolvedValue({ id: 'note-1' }) },
        auditLog: { create: vi.fn() },
        adminAuditEvent: { create: vi.fn() },
      })),
    },
  }
})
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'user-1', adminUserId: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

describe('claimCaseAction', () => {
  it('returns ok:true when case exists', async () => {
    const { claimCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    const result = await claimCaseAction('case-1')
    expect(result.ok).toBe(true)
  })
})

describe('resolveCaseAction', () => {
  it('returns ok:true with outcome and reason code', async () => {
    const { resolveCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    const result = await resolveCaseAction({
      caseId: 'case-1',
      outcome: 'Resolved by reassignment',
      reasonCode: 'COVERAGE_GAP',
      note: 'Provider was reassigned manually',
    })
    expect(result.ok).toBe(true)
  })

  it('requires note when reasonCode is OTHER', async () => {
    const { resolveCaseAction } = await import('@/app/(admin)/admin/_actions/case/index')
    await expect(
      resolveCaseAction({ caseId: 'case-1', outcome: 'x', reasonCode: 'OTHER', note: '' })
    ).rejects.toThrow('note is required')
  })
})
```

- [ ] Write the test file at `field-service/__tests__/admin/case-actions.test.ts`
- [ ] Run: `cd field-service && pnpm test __tests__/admin/case-actions.test.ts`
- Expected: FAIL — module not found

#### Step 2.4 — Implement case server actions

Create `field-service/app/(admin)/admin/_actions/case/index.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { requireAdmin } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import type { CaseEventType } from '@prisma/client'

const FLAG = 'ops.v2.cases'

const ResolveCaseSchema = z.object({
  caseId: z.string().min(1),
  outcome: z.string().min(1).max(500),
  reasonCode: z.string().min(1),
  note: z.string().max(2000),
}).refine(
  (d) => d.reasonCode !== 'OTHER' || d.note.trim().length > 0,
  { message: 'note is required when reasonCode is OTHER', path: ['note'] }
)

const ReopenCaseSchema = z.object({
  caseId: z.string().min(1),
  note: z.string().min(1).max(2000),
})

const AddCaseNoteSchema = z.object({
  caseId: z.string().min(1),
  body: z.string().min(1).max(2000),
})

// ─── helpers ─────────────────────────────────────────────────────────────────

async function appendCaseEvent(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  caseId: string,
  type: CaseEventType,
  payload: Record<string, unknown>,
  actorUserId?: string
) {
  await tx.caseEvent.create({ data: { caseId, type, payload, actorUserId: actorUserId ?? null } })
}

function caseRevalidate(caseId: string) {
  // Broad revalidation — queue pages will also pick up state changes
  revalidatePath('/admin/dispatch')
  revalidatePath('/admin/validation')
  revalidatePath('/admin/quotes')
  revalidatePath('/admin/field-exceptions')
  revalidatePath('/admin/payments')
  revalidatePath('/admin/bookings')
  revalidatePath('/admin/disputes')
}

// ─── claimCase ────────────────────────────────────────────────────────────────

export async function claimCaseAction(caseId: string) {
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  return crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: caseId,
    action: 'case.claim',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      const existing = await tx.case.findUnique({ where: { id: caseId }, select: { id: true, state: true } })
      if (!existing) throw new CrudActionError('NOT_FOUND', `Case ${caseId} not found.`)
      await tx.case.update({
        where: { id: caseId },
        data: { ownerUserId: admin.id, state: 'IN_PROGRESS' },
      })
      await appendCaseEvent(tx, caseId, 'ASSIGNMENT_CHANGE', { claimedBy: admin.id }, admin.id)
      return { id: caseId }
    },
  }).then(r => { caseRevalidate(caseId); return r })
}

// ─── releaseCase ──────────────────────────────────────────────────────────────

export async function releaseCaseAction(caseId: string) {
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  return crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: caseId,
    action: 'case.release',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      await tx.case.update({
        where: { id: caseId },
        data: { ownerUserId: null, state: 'OPEN' },
      })
      await appendCaseEvent(tx, caseId, 'ASSIGNMENT_CHANGE', { releasedBy: admin.id }, admin.id)
      return { id: caseId }
    },
  }).then(r => { caseRevalidate(caseId); return r })
}

// ─── resolveCase ──────────────────────────────────────────────────────────────

export async function resolveCaseAction(input: z.infer<typeof ResolveCaseSchema>) {
  const parsed = ResolveCaseSchema.parse(input) // throws ZodError if invalid
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  return crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: parsed.caseId,
    action: 'case.resolve',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    reason: `${parsed.reasonCode}: ${parsed.outcome}`,
    run: async (_input, tx) => {
      const now = new Date()
      await tx.case.update({
        where: { id: parsed.caseId },
        data: {
          state: 'RESOLVED',
          outcome: parsed.outcome,
          reasonCode: parsed.reasonCode,
          resolvedAt: now,
          resolvedBy: admin.id,
        },
      })
      await appendCaseEvent(tx, parsed.caseId, 'STATE_CHANGE', {
        from: 'IN_PROGRESS',
        to: 'RESOLVED',
        outcome: parsed.outcome,
        reasonCode: parsed.reasonCode,
      }, admin.id)
      if (parsed.note.trim()) {
        await tx.caseNote.create({
          data: {
            caseId: parsed.caseId,
            authorUserId: admin.id,
            body: parsed.note,
            visibility: 'INTERNAL_ONLY',
          },
        })
        await appendCaseEvent(tx, parsed.caseId, 'NOTE_ADDED', { noteAuthor: admin.id }, admin.id)
      }
      return { id: parsed.caseId }
    },
  }).then(r => { caseRevalidate(parsed.caseId); return r })
}

// ─── reopenCase ───────────────────────────────────────────────────────────────

export async function reopenCaseAction(input: z.infer<typeof ReopenCaseSchema>) {
  const parsed = ReopenCaseSchema.parse(input)
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  return crudAction({
    entity: AUDIT_ENTITY.CASE,
    entityId: parsed.caseId,
    action: 'case.reopen',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    reason: parsed.note,
    run: async (_input, tx) => {
      const existing = await tx.case.findUnique({
        where: { id: parsed.caseId },
        select: { resolvedAt: true },
      })
      if (!existing?.resolvedAt) {
        throw new CrudActionError('CONFLICT', 'Case is not resolved — cannot reopen.')
      }
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      if (existing.resolvedAt < thirtyDaysAgo) {
        throw new CrudActionError('CONFLICT', 'Case resolved more than 30 days ago — cannot reopen.')
      }
      await tx.case.update({
        where: { id: parsed.caseId },
        data: { state: 'REOPENED', resolvedAt: null, resolvedBy: null, outcome: null, reasonCode: null },
      })
      await appendCaseEvent(tx, parsed.caseId, 'STATE_CHANGE', {
        from: 'RESOLVED',
        to: 'REOPENED',
        note: parsed.note,
      }, admin.id)
      return { id: parsed.caseId }
    },
  }).then(r => { caseRevalidate(parsed.caseId); return r })
}

// ─── addCaseNote ──────────────────────────────────────────────────────────────

export async function addCaseNoteAction(input: z.infer<typeof AddCaseNoteSchema>) {
  const parsed = AddCaseNoteSchema.parse(input)
  const admin = await requireAdmin()
  if (!(await isEnabled(FLAG, admin.id))) {
    throw new CrudActionError('FLAG_DISABLED', `Feature '${FLAG}' is not enabled.`)
  }

  return crudAction({
    entity: AUDIT_ENTITY.CASE_NOTE,
    action: 'case.note.add',
    requiredRole: ['OPS', 'FINANCE', 'TRUST', 'ADMIN', 'OWNER'],
    run: async (_input, tx) => {
      const note = await tx.caseNote.create({
        data: {
          caseId: parsed.caseId,
          authorUserId: admin.id,
          body: parsed.body,
          visibility: 'INTERNAL_ONLY',
        },
        select: { id: true },
      })
      await appendCaseEvent(tx, parsed.caseId, 'NOTE_ADDED', { noteId: note.id }, admin.id)
      return { id: note.id }
    },
  }).then(r => { caseRevalidate(parsed.caseId); return r })
}
```

- [ ] Create `field-service/app/(admin)/admin/_actions/case/index.ts` with the content above
- [ ] Run: `cd field-service && pnpm test __tests__/admin/case-actions.test.ts`
- Expected: PASS

#### Step 2.5 — Write the backfill script

Create `field-service/scripts/backfill-cases.ts`:

```typescript
import { db } from '@/lib/db'
import type { CaseQueueType, CaseEntityType } from '@prisma/client'

// SLA targets in hours per queue type
const SLA_HOURS: Record<CaseQueueType, number> = {
  VALIDATION: 4,
  DISPATCH: 1,
  FIELD: 2,
  QUOTES: 24,
  FINANCE: 48,
  TRUST: 24,
  SUPPLY: 24,
}

function slaDueAt(queueType: CaseQueueType, createdAt: Date): Date {
  const h = SLA_HOURS[queueType]
  return new Date(createdAt.getTime() + h * 60 * 60 * 1000)
}

async function upsertCase(
  entityType: CaseEntityType,
  entityId: string,
  queueType: CaseQueueType,
  createdAt: Date
) {
  const existing = await db.case.findFirst({
    where: { entityType, entityId, queueType, state: { in: ['OPEN', 'IN_PROGRESS'] } },
    select: { id: true },
  })
  if (existing) return { created: false, id: existing.id }

  const c = await db.case.create({
    data: {
      entityType,
      entityId,
      queueType,
      state: 'OPEN',
      slaDueAt: slaDueAt(queueType, createdAt),
      events: {
        create: {
          type: 'SYSTEM_EVENT',
          payload: { backfilled: true, backfilledAt: new Date().toISOString() },
        },
      },
    },
    select: { id: true },
  })
  return { created: true, id: c.id }
}

async function main() {
  let created = 0, skipped = 0

  // Open job requests → VALIDATION queue
  const openJRs = await db.jobRequest.findMany({
    where: { status: { in: ['PENDING', 'REVIEWING'] } },
    select: { id: true, createdAt: true },
  })
  for (const jr of openJRs) {
    const r = await upsertCase('JOB_REQUEST', jr.id, 'VALIDATION', jr.createdAt)
    r.created ? created++ : skipped++
  }

  // Unmatched job requests → DISPATCH queue
  const dispatchJRs = await db.jobRequest.findMany({
    where: { status: 'MATCHING' },
    select: { id: true, createdAt: true },
  })
  for (const jr of dispatchJRs) {
    const r = await upsertCase('JOB_REQUEST', jr.id, 'DISPATCH', jr.createdAt)
    r.created ? created++ : skipped++
  }

  // Open bookings → FIELD queue
  const openBookings = await db.booking.findMany({
    where: { status: { in: ['CONFIRMED', 'IN_PROGRESS'] } },
    select: { id: true, createdAt: true },
  })
  for (const b of openBookings) {
    const r = await upsertCase('BOOKING', b.id, 'FIELD', b.createdAt)
    r.created ? created++ : skipped++
  }

  // Open disputes → TRUST queue
  const openDisputes = await db.dispute.findMany({
    where: { status: { notIn: ['RESOLVED', 'CLOSED'] } },
    select: { id: true, createdAt: true },
  })
  for (const d of openDisputes) {
    const r = await upsertCase('DISPUTE', d.id, 'TRUST', d.createdAt)
    r.created ? created++ : skipped++
  }

  // Pending payments → FINANCE queue
  const pendingPayments = await db.payment.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] } },
    select: { id: true, createdAt: true },
  })
  for (const p of pendingPayments) {
    const r = await upsertCase('PAYMENT', p.id, 'FINANCE', p.createdAt)
    r.created ? created++ : skipped++
  }

  console.log(`Backfill complete: created=${created}, skipped=${skipped}`)
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] Create `field-service/scripts/backfill-cases.ts` with the content above
- [ ] Run (against staging DB only): `cd field-service && npx tsx scripts/backfill-cases.ts`
- Expected: output line like `Backfill complete: created=N, skipped=0`
- [ ] Run a second time to confirm idempotency: output should show `created=0, skipped=N`

#### Step 2.6 — Commit

```bash
cd field-service && git add prisma/schema.prisma scripts/backfill-cases.ts \
  scripts/seed-flags.ts \
  app/(admin)/admin/_actions/case/index.ts \
  __tests__/admin/case-actions.test.ts
git commit -m "feat(ops): add Case/CaseEvent/CaseNote schema + server actions (ops.v2.cases)"
```

---

### Task 3: Case UI — timeline, notes, resolve dialog, queue mounting

**Branch:** `ops/case-ui`
**Flag:** `ops.v2.cases`
**Files:**
- Create: `field-service/app/(admin)/admin/_components/case-activity-timeline.tsx`
- Create: `field-service/app/(admin)/admin/_components/case-notes.tsx`
- Create: `field-service/app/(admin)/admin/_components/resolve-case-dialog.tsx`
- Modify: `field-service/app/(admin)/admin/field-exceptions/page.tsx`
- Modify: `field-service/app/(admin)/admin/quotes/page.tsx`
- Modify: `field-service/app/(admin)/admin/payments/page.tsx`
- Modify: `field-service/app/(admin)/admin/bookings/[id]/page.tsx`
- Modify: `field-service/app/(admin)/admin/disputes/page.tsx`

#### Step 3.1 — CaseActivityTimeline component

Create `field-service/app/(admin)/admin/_components/case-activity-timeline.tsx`:

```typescript
import { formatDistanceToNow } from 'date-fns'
import type { CaseEvent, CaseEventType } from '@prisma/client'

const EVENT_ICONS: Record<CaseEventType, string> = {
  STATE_CHANGE: '⚡',
  SYSTEM_EVENT: '🤖',
  OPS_ACTION: '🛠',
  NOTE_ADDED: '📝',
  ASSIGNMENT_CHANGE: '👤',
  CUSTOMER_CONTACTED: '📞',
  ESCALATION: '🔺',
  BREACH_DETECTED: '⚠️',
}

const EVENT_LABELS: Record<CaseEventType, string> = {
  STATE_CHANGE: 'Status changed',
  SYSTEM_EVENT: 'System event',
  OPS_ACTION: 'Ops action',
  NOTE_ADDED: 'Note added',
  ASSIGNMENT_CHANGE: 'Assignment changed',
  CUSTOMER_CONTACTED: 'Customer contacted',
  ESCALATION: 'Escalated',
  BREACH_DETECTED: 'SLA breach detected',
}

interface Props {
  events: Pick<CaseEvent, 'id' | 'type' | 'payload' | 'actorUserId' | 'createdAt'>[]
}

export function CaseActivityTimeline({ events }: Props) {
  if (events.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <ol className="space-y-3">
      {events
        .slice()
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .map((evt) => (
          <li key={evt.id} className="flex gap-3 text-sm">
            <span className="mt-0.5 text-base leading-none" aria-hidden>
              {EVENT_ICONS[evt.type]}
            </span>
            <div className="flex-1">
              <span className="font-medium">{EVENT_LABELS[evt.type]}</span>
              {evt.actorUserId && (
                <span className="text-muted-foreground"> by {evt.actorUserId}</span>
              )}
              <span
                className="ml-2 text-xs text-muted-foreground"
                title={new Date(evt.createdAt).toISOString()}
              >
                {formatDistanceToNow(new Date(evt.createdAt), { addSuffix: true })}
              </span>
            </div>
          </li>
        ))}
    </ol>
  )
}
```

- [ ] Create the component file

#### Step 3.2 — CaseNotes component

Create `field-service/app/(admin)/admin/_components/case-notes.tsx`:

```typescript
'use client'

import { useRef, useTransition } from 'react'
import { formatDistanceToNow } from 'date-fns'
import type { CaseNote } from '@prisma/client'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { addCaseNoteAction } from '../_actions/case'
import { toast } from 'sonner'

interface Props {
  caseId: string
  notes: Pick<CaseNote, 'id' | 'body' | 'authorUserId' | 'createdAt'>[]
}

export function CaseNotes({ caseId, notes }: Props) {
  const formRef = useRef<HTMLFormElement>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    const body = (formData.get('body') as string ?? '').trim()
    if (!body) return
    startTransition(async () => {
      const result = await addCaseNoteAction({ caseId, body })
      if (result.ok) {
        formRef.current?.reset()
        toast.success('Note added')
      } else {
        toast.error('Failed to add note')
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {notes.length === 0 && (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        )}
        {notes.map((note) => (
          <div key={note.id} className="rounded-md border p-3 text-sm">
            <p className="whitespace-pre-wrap">{note.body}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {note.authorUserId} ·{' '}
              {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
            </p>
          </div>
        ))}
      </div>

      <form ref={formRef} action={handleSubmit} className="space-y-2">
        <Textarea name="body" placeholder="Add an internal note…" rows={3} required />
        <Button type="submit" size="sm" disabled={isPending}>
          {isPending ? 'Saving…' : 'Add note'}
        </Button>
      </form>
    </div>
  )
}
```

- [ ] Create the component file

#### Step 3.3 — ResolveCaseDialog component

Create `field-service/app/(admin)/admin/_components/resolve-case-dialog.tsx`:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { resolveCaseAction } from '../_actions/case'
import { toast } from 'sonner'

const REASON_CODES = [
  'COVERAGE_GAP',
  'DUPLICATE_REQUEST',
  'CUSTOMER_CANCELLED',
  'FRAUD_SUSPECTED',
  'PROVIDER_UNRESPONSIVE',
  'OUT_OF_SCOPE',
  'RESOLVED_SUCCESSFULLY',
  'OTHER',
]

interface Props {
  caseId: string
  trigger?: React.ReactNode
}

export function ResolveCaseDialog({ caseId, trigger }: Props) {
  const [open, setOpen] = useState(false)
  const [reasonCode, setReasonCode] = useState('')
  const [outcome, setOutcome] = useState('')
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()

  const noteRequired = reasonCode === 'OTHER'

  function handleResolve() {
    if (!reasonCode || !outcome) {
      toast.error('Outcome and reason code are required')
      return
    }
    if (noteRequired && !note.trim()) {
      toast.error('Note is required when reason is OTHER')
      return
    }
    startTransition(async () => {
      try {
        await resolveCaseAction({ caseId, outcome, reasonCode, note })
        toast.success('Case resolved')
        setOpen(false)
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Failed to resolve case')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? <Button size="sm" variant="default">Resolve</Button>}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Resolve case</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="outcome">Outcome summary</Label>
            <Textarea
              id="outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              placeholder="Brief summary of how this was resolved"
              rows={2}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reasonCode">Reason code</Label>
            <Select onValueChange={setReasonCode}>
              <SelectTrigger id="reasonCode">
                <SelectValue placeholder="Select reason" />
              </SelectTrigger>
              <SelectContent>
                {REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>{code}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="note">
              Note {noteRequired ? <span className="text-destructive">*</span> : '(optional)'}
            </Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={noteRequired ? 'Required for OTHER reason code' : 'Additional context'}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={isPending}>
              {isPending ? 'Resolving…' : 'Resolve case'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] Create the component file

#### Step 3.4 — Mount components on field-exceptions page

In `field-service/app/(admin)/admin/field-exceptions/page.tsx`, find the section (around line 244–269) where claim/release buttons render for a selected exception and add below the existing action buttons:

```typescript
// Add import at top of file:
import { isEnabled } from '@/lib/flags'
import { CaseActivityTimeline } from '../_components/case-activity-timeline'
import { CaseNotes } from '../_components/case-notes'
import { ResolveCaseDialog } from '../_components/resolve-case-dialog'

// In the server component, fetch the case for the selected exception:
const casesEnabled = await isEnabled('ops.v2.cases')
let activeCase = null
if (casesEnabled && selectedExceptionId) {
  activeCase = await db.case.findFirst({
    where: { entityType: 'BOOKING', entityId: selectedExceptionId, state: { in: ['OPEN', 'IN_PROGRESS'] } },
    include: {
      events: { orderBy: { createdAt: 'desc' }, take: 50 },
      notes: { orderBy: { createdAt: 'desc' } },
    },
  })
}

// In the JSX, below the existing action buttons, add:
{casesEnabled && activeCase && (
  <div className="space-y-6 border-t pt-4 mt-4">
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold">Case actions</h3>
      <ResolveCaseDialog caseId={activeCase.id} />
    </div>
    <div>
      <h4 className="text-xs font-medium text-muted-foreground mb-2">Activity</h4>
      <CaseActivityTimeline events={activeCase.events} />
    </div>
    <div>
      <h4 className="text-xs font-medium text-muted-foreground mb-2">Notes</h4>
      <CaseNotes caseId={activeCase.id} notes={activeCase.notes} />
    </div>
  </div>
)}
```

- [ ] Apply the changes to `field-service/app/(admin)/admin/field-exceptions/page.tsx`

#### Step 3.5 — Mount on bookings detail, quotes, payments, disputes

Repeat Step 3.4's pattern for each queue page, adjusting `entityType` appropriately:

| File | entityType | State filter |
|------|-----------|--------------|
| `bookings/[id]/page.tsx` | `'BOOKING'` | `OPEN,IN_PROGRESS` |
| `quotes/page.tsx` | `'QUOTE'` | `OPEN,IN_PROGRESS` |
| `payments/page.tsx` | `'PAYMENT'` | `OPEN,IN_PROGRESS` |
| `disputes/page.tsx` | `'DISPUTE'` | `OPEN,IN_PROGRESS` |

- [ ] Apply the Case UI to each of the four additional pages

#### Step 3.6 — Run full test + lint

```bash
cd field-service && pnpm lint && pnpm test
```
- Expected: lint clean (warnings OK), all existing tests pass

#### Step 3.7 — Commit

```bash
cd field-service && git add \
  app/(admin)/admin/_components/case-activity-timeline.tsx \
  app/(admin)/admin/_components/case-notes.tsx \
  app/(admin)/admin/_components/resolve-case-dialog.tsx \
  app/(admin)/admin/field-exceptions/page.tsx \
  app/(admin)/admin/bookings/[id]/page.tsx \
  app/(admin)/admin/quotes/page.tsx \
  app/(admin)/admin/payments/page.tsx \
  app/(admin)/admin/disputes/page.tsx
git commit -m "feat(ops): case activity timeline + notes + resolve dialog on all queue detail pages"
```

---

### Task 4: Ops workflows — booking, quote, payment, dispute, message

**Branch:** `ops/transactional-workflows`
**Flag:** each sub-action behind its own flag or `admin.crud.*`
**Files:**
- Create: `field-service/app/(admin)/admin/bookings/[id]/actions.ts`
- Modify: `field-service/app/(admin)/admin/bookings/[id]/page.tsx`
- Create: `field-service/app/(admin)/admin/quotes/actions.ts`
- Modify: `field-service/app/(admin)/admin/quotes/page.tsx`
- Create: `field-service/app/(admin)/admin/payments/actions.ts`
- Modify: `field-service/app/(admin)/admin/payments/page.tsx`
- Create: `field-service/app/(admin)/admin/disputes/actions.ts`
- Modify: `field-service/app/(admin)/admin/disputes/page.tsx`
- Create: `field-service/app/(admin)/admin/messages/actions.ts`
- Modify: `field-service/app/(admin)/admin/messages/page.tsx`
- Modify: `field-service/app/api/webhooks/payments/route.ts`
- Create: `field-service/__tests__/admin/booking-actions.test.ts`

#### Step 4.1 — Write failing test for booking reschedule

```typescript
// field-service/__tests__/admin/booking-actions.test.ts
import { vi, it, expect, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn() },
    booking: {
      findUnique: vi.fn().mockResolvedValue({
        id: 'bk-1', status: 'CONFIRMED', scheduledDate: new Date(),
      }),
      update: vi.fn().mockResolvedValue({ id: 'bk-1' }),
    },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn) => fn({
      booking: {
        findUnique: vi.fn().mockResolvedValue({ id: 'bk-1', status: 'CONFIRMED' }),
        update: vi.fn().mockResolvedValue({ id: 'bk-1' }),
      },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'user-1', adminUserId: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

it('rescheduleBookingAction returns ok:true', async () => {
  const { rescheduleBookingAction } = await import(
    '@/app/(admin)/admin/bookings/[id]/actions'
  )
  const result = await rescheduleBookingAction({
    bookingId: 'bk-1',
    newDate: new Date(Date.now() + 86400000).toISOString(),
    reason: 'Customer requested reschedule',
  })
  expect(result.ok).toBe(true)
})
```

- [ ] Write the test
- [ ] Run: `cd field-service && pnpm test __tests__/admin/booking-actions.test.ts`
- Expected: FAIL — module not found

#### Step 4.2 — Booking actions

Create `field-service/app/(admin)/admin/bookings/[id]/actions.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.bookings'

const RescheduleBookingSchema = z.object({
  bookingId: z.string().min(1),
  newDate: z.string().datetime(),
  reason: z.string().min(1).max(500),
})

const CancelBookingSchema = z.object({
  bookingId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type RescheduleInput = z.infer<typeof RescheduleBookingSchema>
type CancelInput = z.infer<typeof CancelBookingSchema>

export async function rescheduleBookingAction(input: RescheduleInput) {
  // Fetch before-snapshot for audit
  const before = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, scheduledDate: true, scheduledStartAt: true, scheduledEndAt: true, status: true },
  })

  const result = await crudAction<RescheduleInput, { id: string }>({
    entity: AUDIT_ENTITY.BOOKING,
    entityId: input.bookingId,
    action: 'booking.reschedule',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: RescheduleBookingSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: { id: true, status: true },
      })
      if (!booking) throw new CrudActionError('NOT_FOUND', `Booking ${data.bookingId} not found.`)
      if (booking.status === 'CANCELLED' || booking.status === 'COMPLETED') {
        throw new CrudActionError('CONFLICT', `Cannot reschedule a ${booking.status} booking.`)
      }
      const newDate = new Date(data.newDate)
      await tx.booking.update({
        where: { id: data.bookingId },
        data: {
          scheduledDate: newDate,
          scheduledStartAt: newDate,
          rescheduleCount: { increment: 1 },
          notes: data.reason,
        },
      })
      return { id: data.bookingId }
    },
  })
  revalidatePath(`/admin/bookings/${input.bookingId}`)
  return result
}

export async function cancelBookingAction(input: CancelInput) {
  const before = await db.booking.findUnique({
    where: { id: input.bookingId },
    select: { id: true, status: true },
  })

  const result = await crudAction<CancelInput, { id: string }>({
    entity: AUDIT_ENTITY.BOOKING,
    entityId: input.bookingId,
    action: 'booking.cancel',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: CancelBookingSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: data.bookingId },
        select: { id: true, status: true },
      })
      if (!booking) throw new CrudActionError('NOT_FOUND', `Booking ${data.bookingId} not found.`)
      if (booking.status === 'CANCELLED') {
        throw new CrudActionError('CONFLICT', 'Booking is already cancelled.')
      }
      await tx.booking.update({
        where: { id: data.bookingId },
        data: { status: 'CANCELLED', cancelReason: data.reason },
      })
      return { id: data.bookingId }
    },
  })
  revalidatePath(`/admin/bookings/${input.bookingId}`)
  return result
}

export async function rescheduleBookingFromFormAction(formData: FormData) {
  try {
    return await rescheduleBookingAction({
      bookingId: formData.get('bookingId') as string,
      newDate: (formData.get('newDate') as string ?? '').trim(),
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to reschedule booking' }
  }
}
```

- [ ] Create `field-service/app/(admin)/admin/bookings/[id]/actions.ts`
- [ ] Run: `cd field-service && pnpm test __tests__/admin/booking-actions.test.ts`
- Expected: PASS

> Also add `admin.crud.bookings` to the seed-flags array in `field-service/scripts/seed-flags.ts`.

#### Step 4.3 — Quote actions

Create `field-service/app/(admin)/admin/quotes/actions.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.quotes'

const VoidQuoteSchema = z.object({
  quoteId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

const ExpireQuoteSchema = z.object({
  quoteId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type VoidInput = z.infer<typeof VoidQuoteSchema>
type ExpireInput = z.infer<typeof ExpireQuoteSchema>

export async function voidQuoteAction(input: VoidInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, amount: true },
  })

  const result = await crudAction<VoidInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.void',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: VoidQuoteSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const quote = await tx.quote.findUnique({
        where: { id: data.quoteId },
        select: { id: true, status: true },
      })
      if (!quote) throw new CrudActionError('NOT_FOUND', `Quote ${data.quoteId} not found.`)
      if (quote.status === 'DECLINED' || quote.status === 'APPROVED') {
        throw new CrudActionError('CONFLICT', `Cannot void a ${quote.status} quote.`)
      }
      await tx.quote.update({
        where: { id: data.quoteId },
        data: { status: 'DECLINED', notes: data.reason, declinedAt: new Date() },
      })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function expireQuoteAction(input: ExpireInput) {
  const before = await db.quote.findUnique({
    where: { id: input.quoteId },
    select: { id: true, status: true, validUntil: true },
  })

  const result = await crudAction<ExpireInput, { id: string }>({
    entity: AUDIT_ENTITY.QUOTE,
    entityId: input.quoteId,
    action: 'quote.expire',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ExpireQuoteSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      await tx.quote.update({
        where: { id: data.quoteId },
        data: { validUntil: new Date(), notes: data.reason },
      })
      return { id: data.quoteId }
    },
  })
  revalidatePath('/admin/quotes')
  return result
}

export async function voidQuoteFromFormAction(formData: FormData) {
  try {
    return await voidQuoteAction({
      quoteId: formData.get('quoteId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to void quote' }
  }
}
```

- [ ] Create `field-service/app/(admin)/admin/quotes/actions.ts`
- [ ] Add `admin.crud.quotes` to `scripts/seed-flags.ts`

#### Step 4.4 — Payment actions + webhook safety

Create `field-service/app/(admin)/admin/payments/actions.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.payments'

const ReconcilePaymentSchema = z.object({
  paymentId: z.string().min(1),
  note: z.string().min(1).max(1000),
  confirmedPaid: z.boolean(),
})

const WriteOffPaymentSchema = z.object({
  paymentId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type ReconcileInput = z.infer<typeof ReconcilePaymentSchema>
type WriteOffInput = z.infer<typeof WriteOffPaymentSchema>

export async function reconcilePaymentAction(input: ReconcileInput) {
  const before = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, amount: true, pspReference: true },
  })

  const result = await crudAction<ReconcileInput, { id: string }>({
    entity: AUDIT_ENTITY.PAYMENT,
    entityId: input.paymentId,
    action: 'payment.reconcile',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ReconcilePaymentSchema,
    input,
    before: before ?? undefined,
    reason: input.note,
    run: async (data, tx) => {
      await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: data.confirmedPaid ? 'PAID' : 'FAILED',
          metadata: { reconciled: true, note: data.note, reconciledAt: new Date().toISOString() },
        },
      })
      return { id: data.paymentId }
    },
  })
  revalidatePath('/admin/payments')
  return result
}

export async function writeOffPaymentAction(input: WriteOffInput) {
  const before = await db.payment.findUnique({
    where: { id: input.paymentId },
    select: { id: true, status: true, amount: true },
  })

  const result = await crudAction<WriteOffInput, { id: string }>({
    entity: AUDIT_ENTITY.PAYMENT,
    entityId: input.paymentId,
    action: 'payment.write_off',
    requiredRole: ['FINANCE', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: WriteOffPaymentSchema,
    input,
    before: before ?? undefined,
    reason: input.reason,
    run: async (data, tx) => {
      const payment = await tx.payment.findUnique({
        where: { id: data.paymentId },
        select: { id: true, status: true },
      })
      if (!payment) throw new CrudActionError('NOT_FOUND', `Payment ${data.paymentId} not found.`)
      await tx.payment.update({
        where: { id: data.paymentId },
        data: {
          status: 'FAILED',
          failureReason: `Written off: ${data.reason}`,
          metadata: { writtenOff: true, reason: data.reason, at: new Date().toISOString() },
        },
      })
      return { id: data.paymentId }
    },
  })
  revalidatePath('/admin/payments')
  return result
}

export async function reconcilePaymentFromFormAction(formData: FormData) {
  try {
    return await reconcilePaymentAction({
      paymentId: formData.get('paymentId') as string,
      note: (formData.get('note') as string ?? '').trim(),
      confirmedPaid: formData.get('confirmedPaid') === 'true',
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to reconcile payment' }
  }
}
```

**Fix webhook handler** — in `field-service/app/api/webhooks/payments/route.ts`, change the catch block:

```typescript
// Before (line ~89-92):
  } catch (err) {
    console.error(`[webhook/payments:${reqId}] Handler error:`, err)
    // Return 200 to prevent retries on known-bad events
    return NextResponse.json({ status: 'error' })
  }

// After:
  } catch (err) {
    console.error(`[webhook/payments:${reqId}] Handler error:`, err)
    // Return 500 so the PSP retries — swallowing errors hides real failures.
    // Add the specific event types that are intentionally ignored above this
    // catch block with early return 200, not here.
    return NextResponse.json({ status: 'error' }, { status: 500 })
  }
```

- [ ] Create `field-service/app/(admin)/admin/payments/actions.ts`
- [ ] Fix webhook catch block in `field-service/app/api/webhooks/payments/route.ts`
- [ ] Add `admin.crud.payments` to `scripts/seed-flags.ts`

#### Step 4.5 — Dispute actions

Create `field-service/app/(admin)/admin/disputes/actions.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.disputes'

const ResolveDisputeSchema = z.object({
  disputeId: z.string().min(1),
  resolution: z.string().min(1).max(1000),
  outcome: z.enum(['RESOLVED_REFUND', 'RESOLVED_REDO', 'RESOLVED_NO_ACTION', 'ESCALATED_LEGAL']),
})

const EscalateDisputeSchema = z.object({
  disputeId: z.string().min(1),
  note: z.string().min(1).max(500),
})

type ResolveInput = z.infer<typeof ResolveDisputeSchema>
type EscalateInput = z.infer<typeof EscalateDisputeSchema>

export async function resolveDisputeAction(input: ResolveInput) {
  const before = await db.dispute.findUnique({
    where: { id: input.disputeId },
    select: { id: true, status: true, resolution: true },
  })

  const result = await crudAction<ResolveInput, { id: string }>({
    entity: AUDIT_ENTITY.DISPUTE,
    entityId: input.disputeId,
    action: 'dispute.resolve',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: ResolveDisputeSchema,
    input,
    before: before ?? undefined,
    reason: `${input.outcome}: ${input.resolution}`,
    run: async (data, tx) => {
      const dispute = await tx.dispute.findUnique({
        where: { id: data.disputeId },
        select: { id: true, status: true },
      })
      if (!dispute) throw new CrudActionError('NOT_FOUND', `Dispute ${data.disputeId} not found.`)
      await tx.dispute.update({
        where: { id: data.disputeId },
        data: {
          status: 'RESOLVED',
          resolution: `${data.outcome}: ${data.resolution}`,
          resolvedAt: new Date(),
        },
      })
      return { id: data.disputeId }
    },
  })
  revalidatePath('/admin/disputes')
  return result
}

export async function escalateDisputeAction(input: EscalateInput) {
  const before = await db.dispute.findUnique({
    where: { id: input.disputeId },
    select: { id: true, status: true },
  })

  const result = await crudAction<EscalateInput, { id: string }>({
    entity: AUDIT_ENTITY.DISPUTE,
    entityId: input.disputeId,
    action: 'dispute.escalate',
    requiredRole: ['TRUST', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: EscalateDisputeSchema,
    input,
    before: before ?? undefined,
    reason: input.note,
    run: async (data, tx) => {
      await tx.dispute.update({
        where: { id: data.disputeId },
        data: { status: 'ESCALATED', resolution: data.note },
      })
      return { id: data.disputeId }
    },
  })
  revalidatePath('/admin/disputes')
  return result
}

export async function resolveDisputeFromFormAction(formData: FormData) {
  try {
    return await resolveDisputeAction({
      disputeId: formData.get('disputeId') as string,
      resolution: (formData.get('resolution') as string ?? '').trim(),
      outcome: formData.get('outcome') as ResolveInput['outcome'],
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to resolve dispute' }
  }
}
```

- [ ] Create `field-service/app/(admin)/admin/disputes/actions.ts`
- [ ] Add `admin.crud.disputes` to `scripts/seed-flags.ts`

#### Step 4.6 — Message retry action

Create `field-service/app/(admin)/admin/messages/actions.ts`:

```typescript
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { AUDIT_ENTITY } from '@/lib/audit-entities'
import { db } from '@/lib/db'

const FLAG = 'admin.crud.messages'

const RetryMessageSchema = z.object({
  messageEventId: z.string().min(1),
  reason: z.string().min(1).max(500),
})

type RetryInput = z.infer<typeof RetryMessageSchema>

export async function retryMessageAction(input: RetryInput) {
  const result = await crudAction<RetryInput, { id: string; queued: boolean }>({
    entity: 'MessageEvent',
    action: 'message.retry',
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: RetryMessageSchema,
    input,
    reason: input.reason,
    run: async (data, tx) => {
      const msg = await tx.messageEvent.findUnique({
        where: { id: data.messageEventId },
        select: { id: true, status: true },
      })
      if (!msg) throw new CrudActionError('NOT_FOUND', `MessageEvent ${data.messageEventId} not found.`)
      // Mark as pending retry — the sending layer picks this up via polling or trigger
      await tx.messageEvent.update({
        where: { id: data.messageEventId },
        data: { status: 'PENDING', metadata: { retryReason: data.reason, retryAt: new Date().toISOString() } },
      })
      return { id: data.messageEventId, queued: true }
    },
  })
  revalidatePath('/admin/messages')
  return result
}

export async function retryMessageFromFormAction(formData: FormData) {
  try {
    return await retryMessageAction({
      messageEventId: formData.get('messageEventId') as string,
      reason: (formData.get('reason') as string ?? '').trim(),
    })
  } catch (err) {
    if (err instanceof CrudActionError) return { ok: false as const, error: err.message }
    return { ok: false as const, error: 'Failed to queue message retry' }
  }
}
```

> Note: Check `field-service/prisma/schema.prisma` for the actual `MessageEvent` model field names (`status`, `metadata`) — adjust if the column names differ.

- [ ] Create `field-service/app/(admin)/admin/messages/actions.ts`
- [ ] Add `admin.crud.messages` to `scripts/seed-flags.ts`

#### Step 4.7 — Run full suite + commit

```bash
cd field-service && pnpm lint && pnpm test
```
- Expected: lint clean, all tests pass

```bash
git add \
  app/(admin)/admin/bookings/[id]/actions.ts \
  app/(admin)/admin/quotes/actions.ts \
  app/(admin)/admin/payments/actions.ts \
  app/(admin)/admin/disputes/actions.ts \
  app/(admin)/admin/messages/actions.ts \
  app/api/webhooks/payments/route.ts \
  scripts/seed-flags.ts \
  __tests__/admin/booking-actions.test.ts
git commit -m "feat(ops): add booking/quote/payment/dispute/message admin workflows + fix webhook 500"
```

---

## Wave 2 — Data stewardship and role hardening

---

### Task 5: Fix customer block metadata + provider status reason persistence

**Branch:** `ops/data-stewardship`
**Flag:** existing flags (`admin.crud.customers`, `admin.crud.providers`)
**Files:**
- Modify: `field-service/app/(admin)/admin/customers/actions.ts`
- Modify: `field-service/app/(admin)/admin/providers/actions.ts`
- Create: `field-service/__tests__/admin/customer-block.test.ts`

#### Step 5.1 — Write failing test for block metadata

```typescript
// field-service/__tests__/admin/customer-block.test.ts
import { vi, it, expect, beforeEach } from 'vitest'

let capturedUpdate: Record<string, unknown> | undefined

vi.mock('@/lib/db', () => ({
  db: {
    adminUser: { findUnique: vi.fn() },
    customer: {
      findUnique: vi.fn().mockResolvedValue({ id: 'cust-1', isBlocked: false }),
      update: vi.fn(async (args) => { capturedUpdate = args.data; return { id: 'cust-1' } }),
    },
    auditLog: { create: vi.fn() },
    adminAuditEvent: { create: vi.fn() },
    $transaction: vi.fn(async (fn) => fn({
      customer: {
        findUnique: vi.fn().mockResolvedValue({ id: 'cust-1', isBlocked: false }),
        update: vi.fn(async (args) => { capturedUpdate = args.data; return { id: 'cust-1' } }),
      },
      auditLog: { create: vi.fn() },
      adminAuditEvent: { create: vi.fn() },
    })),
  },
}))
vi.mock('@/lib/auth', () => ({
  getSession: vi.fn().mockResolvedValue({ id: 'user-1' }),
  requireAdmin: vi.fn().mockResolvedValue({ id: 'user-1', adminUserId: 'admin-1', role: 'OPS' }),
}))
vi.mock('@/lib/flags', () => ({ isEnabled: vi.fn().mockResolvedValue(true) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

it('blockCustomerAction writes blockedReason and blockedAt, not notes', async () => {
  const { blockCustomerAction } = await import('@/app/(admin)/admin/customers/actions')
  await blockCustomerAction({ customerId: 'cust-1', reason: 'Fraud detected' })
  expect(capturedUpdate?.blockedReason).toBe('Fraud detected')
  expect(capturedUpdate?.blockedAt).toBeDefined()
  expect(capturedUpdate?.notes).toBeUndefined()
})
```

- [ ] Write the test
- [ ] Run: `cd field-service && pnpm test __tests__/admin/customer-block.test.ts`
- Expected: FAIL — `blockedReason` is undefined (currently writes to `notes`)

#### Step 5.2 — Fix `blockCustomerAction` and `deactivateCustomerAction`

In `field-service/app/(admin)/admin/customers/actions.ts`:

**In `blockCustomerAction` run function** (currently around line 191–194), replace:
```typescript
      await tx.customer.update({
        where: { id: data.customerId },
        data: { isBlocked: true, notes: data.reason },
      })
```
with:
```typescript
      await tx.customer.update({
        where: { id: data.customerId },
        data: {
          isBlocked: true,
          blockedReason: data.reason,
          blockedAt: new Date(),
        },
      })
```

**In `deactivateCustomerAction` run function** (around line 333–336), replace:
```typescript
        data: { active: false, isBlocked: true, notes: data.reason },
```
with:
```typescript
        data: {
          active: false,
          isBlocked: true,
          blockedReason: data.reason,
          blockedAt: new Date(),
        },
```

- [ ] Apply both fixes
- [ ] Run: `cd field-service && pnpm test __tests__/admin/customer-block.test.ts`
- Expected: PASS

#### Step 5.3 — Fix provider status reason persistence

In `field-service/app/(admin)/admin/providers/actions.ts`, find `setProviderStatusAction` (the run function that calls `tx.provider.update`). The current implementation updates `status` but does not persist `reason` to `suspendedReason` or `archiveReason`. Fix:

```typescript
// In setProviderStatusAction run:
const isSuspend = data.status === 'SUSPENDED'
const isArchive = data.status === 'ARCHIVED' || data.status === 'BANNED'

await tx.provider.update({
  where: { id: data.providerId },
  data: {
    status: data.status as ProviderStatus,
    ...(isSuspend ? {
      suspendedReason: data.reason,
      suspendedUntil: null,  // ops sets a date if needed via separate action
    } : {}),
    ...(isArchive ? {
      archiveReason: data.reason,
      archivedAt: new Date(),
    } : {}),
  },
})
```

Also add `reason: data.reason` to the `crudAction()` call's `reason` field so it appears in the audit row.

- [ ] Apply the fix to `field-service/app/(admin)/admin/providers/actions.ts`

#### Step 5.4 — Run full suite + commit

```bash
cd field-service && pnpm lint && pnpm test
```
- Expected: all tests pass

```bash
git add \
  app/(admin)/admin/customers/actions.ts \
  app/(admin)/admin/providers/actions.ts \
  __tests__/admin/customer-block.test.ts
git commit -m "fix(data): persist block metadata to dedicated fields, provider status reason to schema columns"
```

---

### Task 6: Export audit events + permission hardening for sensitive reads

**Branch:** `ops/export-controls`
**Flag:** none (security fix, not a feature)
**Files:**
- Modify: `field-service/app/api/admin/customers/export/route.ts`
- Modify: `field-service/app/api/admin/providers/export/route.ts`
- Modify: `field-service/lib/auth.ts` (add `requireRole` guard helper for export)

#### Step 6.1 — Add explicit export audit to customer export route

Open `field-service/app/api/admin/customers/export/route.ts`. After the existing `requireAdmin()` call, add a role check and audit event:

```typescript
import { requireAdmin, requireRole } from '@/lib/auth'
import { db } from '@/lib/db'
import { AUDIT_ENTITY } from '@/lib/audit-entities'

export async function GET(request: Request) {
  // Require ADMIN or OWNER for data exports — OPS/FINANCE/TRUST must not
  // export raw customer PII without explicit grant.
  const actor = await requireRole(['ADMIN', 'OWNER'])

  // Write an explicit export audit event before streaming any data
  await db.adminAuditEvent.create({
    data: {
      adminId: actor.adminUserId ?? actor.id,
      action: 'customer.export',
      entityType: AUDIT_ENTITY.CUSTOMER,
      entityId: 'bulk',
      metadata: {
        exportedAt: new Date().toISOString(),
        requestUrl: request.url,
      },
    },
  })

  // … rest of existing export logic unchanged …
}
```

- [ ] Apply the change to the customer export route

#### Step 6.2 — Apply the same pattern to provider export route

Mirror Step 6.1 in `field-service/app/api/admin/providers/export/route.ts`, using `AUDIT_ENTITY.PROVIDER` and `action: 'provider.export'`.

- [ ] Apply the change to the provider export route

#### Step 6.3 — Run full suite + commit

```bash
cd field-service && pnpm lint && pnpm test
```
- Expected: lint and tests pass

```bash
git add \
  app/api/admin/customers/export/route.ts \
  app/api/admin/providers/export/route.ts
git commit -m "fix(security): require ADMIN/OWNER for CSV exports, write explicit export audit events"
```

---

## Wave 3 — Resilience and hygiene

---

### Task 7: Reason code seed + marketing lint fix

**Branch:** `ops/hygiene`
**Files:**
- Create: `field-service/scripts/seed-reason-codes.ts`
- Modify: `marketing/scripts/generate-disciplined-edge-carousel.js`

#### Step 7.1 — Seed reason codes as governed data

The reason codes currently live only in `ResolveCaseDialog` as a hardcoded array. Move them to the DB via a seed script. First, confirm there is a `ReasonCode` model in the schema or create one:

Check `field-service/prisma/schema.prisma` for an existing `ReasonCode` model. If absent, add:

```prisma
model ReasonCode {
  key         String   @id
  queueType   String   // matches CaseQueueType string values
  label       String
  requireNote Boolean  @default(false)
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
}
```

Then create `field-service/scripts/seed-reason-codes.ts`:

```typescript
import { db } from '@/lib/db'

const CODES = [
  // Dispatch
  { key: 'COVERAGE_GAP',          queueType: 'DISPATCH', label: 'No eligible providers in area',     requireNote: false },
  { key: 'DUPLICATE_REQUEST',     queueType: 'DISPATCH', label: 'Duplicate customer request',        requireNote: false },
  { key: 'CUSTOMER_CANCELLED',    queueType: 'DISPATCH', label: 'Customer cancelled before dispatch', requireNote: false },
  { key: 'FRAUD_SUSPECTED',       queueType: 'DISPATCH', label: 'Fraud suspected',                   requireNote: true  },
  { key: 'PROVIDER_UNRESPONSIVE', queueType: 'DISPATCH', label: 'Provider did not respond to lead',  requireNote: false },
  { key: 'OUT_OF_SCOPE',          queueType: 'DISPATCH', label: 'Request outside platform scope',    requireNote: false },
  { key: 'OTHER',                 queueType: 'DISPATCH', label: 'Other (explain in note)',            requireNote: true  },
  // Field exceptions
  { key: 'PROVIDER_NO_SHOW',       queueType: 'FIELD', label: 'Provider did not arrive',             requireNote: false },
  { key: 'CUSTOMER_NO_SHOW',       queueType: 'FIELD', label: 'Customer not available',              requireNote: false },
  { key: 'SITE_ACCESS_BLOCKED',    queueType: 'FIELD', label: 'Site access was blocked',             requireNote: false },
  { key: 'ADDITIONAL_SCOPE',       queueType: 'FIELD', label: 'Additional scope required',           requireNote: true  },
  { key: 'EQUIPMENT_MISSING',      queueType: 'FIELD', label: 'Required equipment not available',    requireNote: false },
  { key: 'OTHER',                  queueType: 'FIELD', label: 'Other (explain in note)',              requireNote: true  },
  // Finance
  { key: 'REFUND_ISSUED',     queueType: 'FINANCE', label: 'Refund issued to customer',              requireNote: false },
  { key: 'RETRIED_OK',        queueType: 'FINANCE', label: 'Payment retried successfully',           requireNote: false },
  { key: 'WRITTEN_OFF',       queueType: 'FINANCE', label: 'Written off',                            requireNote: true  },
  { key: 'CUSTOMER_CONTACTED',queueType: 'FINANCE', label: 'Customer contacted to resolve',         requireNote: false },
  { key: 'OTHER',             queueType: 'FINANCE', label: 'Other (explain in note)',                requireNote: true  },
  // Trust/disputes
  { key: 'RESOLVED_REFUND',    queueType: 'TRUST', label: 'Resolved — refund issued',                requireNote: false },
  { key: 'RESOLVED_REDO',      queueType: 'TRUST', label: 'Resolved — redo scheduled',              requireNote: false },
  { key: 'RESOLVED_NO_ACTION', queueType: 'TRUST', label: 'Resolved — no further action',           requireNote: false },
  { key: 'ESCALATED_LEGAL',    queueType: 'TRUST', label: 'Escalated to legal',                     requireNote: true  },
  { key: 'OTHER',              queueType: 'TRUST', label: 'Other (explain in note)',                 requireNote: true  },
]

async function main() {
  let upserted = 0
  for (const code of CODES) {
    await db.reasonCode.upsert({
      where: { key: code.key },
      update: { label: code.label, requireNote: code.requireNote, active: true },
      create: code,
    })
    upserted++
  }
  console.log(`Seeded ${upserted} reason codes.`)
  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
```

> Note: `key` is not unique across queue types (e.g. `OTHER` appears in each queue). If your schema uses `@id` on `key`, change to `@@unique([key, queueType])` and adjust the `upsert` `where` clause accordingly.

- [ ] Add `ReasonCode` model to schema if absent + run `pnpm db:migrate` (name: `add_reason_codes`)
- [ ] Create `field-service/scripts/seed-reason-codes.ts`
- [ ] Run: `cd field-service && npx tsx scripts/seed-reason-codes.ts`
- Expected: `Seeded N reason codes.`

#### Step 7.2 — Fix marketing lint

The marketing lint fails because `scripts/generate-disciplined-edge-carousel.js` uses `require()`. Convert to ES module imports:

Open `marketing/scripts/generate-disciplined-edge-carousel.js`. Find the top require statements (lines 3–5 per the lint output) and replace:

```javascript
// Before:
const fs = require('fs')
const path = require('path')
const something = require('./something')

// After:
import fs from 'fs'
import path from 'path'
import something from './something'
```

Also add `"type": "module"` to `marketing/package.json` if it is missing, or rename the file to `.mjs` if the package does not use ES modules globally.

To check: run `cd marketing && node --input-type=module < /dev/null` to confirm the package's module type, then choose the appropriate approach.

- [ ] Fix `marketing/scripts/generate-disciplined-edge-carousel.js`
- [ ] Run: `cd marketing && pnpm lint`
- Expected: lint passes or only warnings remain (zero errors)

#### Step 7.3 — Commit

```bash
# from repo root
git add field-service/prisma/schema.prisma \
  field-service/scripts/seed-reason-codes.ts \
  marketing/scripts/generate-disciplined-edge-carousel.js \
  marketing/package.json
git commit -m "feat(ops): seed reason code registry; fix marketing lint"
```

---

## Self-Review

### Spec coverage check

| Audit finding | Task that covers it |
|---|---|
| Audit payloads too thin (P0) | Task 1 — reason field in crudAction + AUDIT_ENTITY constants |
| Entity-name mismatches in queue activity feeds (P1) | Task 1 — AUDIT_ENTITY fix in validation/dispatch/quotes pages |
| No first-class case lifecycle (P0) | Tasks 2 + 3 — schema, actions, UI components |
| Booking CRUD insufficient (P0) | Task 4 — rescheduleBookingAction, cancelBookingAction |
| Quote CRUD insufficient (P0) | Task 4 — voidQuoteAction, expireQuoteAction |
| Payment reconciliation missing (P0) | Task 4 — reconcilePaymentAction, writeOffPaymentAction |
| Dispute workflow weak (P0) | Task 4 — resolveDisputeAction, escalateDisputeAction |
| Message retry missing (P1) | Task 4 — retryMessageAction |
| Webhook returns 200 on handler error (P1) | Task 4 — webhook catch returns 500 |
| Customer block writes to `notes` not `blockedReason` (P1) | Task 5 |
| Provider suspension reason not persisted structurally (P1) | Task 5 |
| CSV exports too broadly available (P1) | Task 6 |
| No export audit event (P1) | Task 6 |
| Reason code registry missing (P1) | Task 7 — seed script |
| Marketing lint red (P2) | Task 7 |

### Type consistency check

- `CaseQueueType`, `CaseEntityType`, `CaseState`, `CaseEventType`, `CaseNoteVisibility` — defined in schema (Task 2), imported by `@prisma/client` in all subsequent tasks ✓
- `AUDIT_ENTITY` constants used in Task 1 and re-used in Tasks 4, 5, 6 ✓
- `claimCaseAction`, `releaseCaseAction`, `resolveCaseAction`, `reopenCaseAction`, `addCaseNoteAction` — defined in `_actions/case/index.ts` (Task 2), imported by UI components in Task 3 ✓
- `ResolveCaseSchema` validation in `resolveCaseAction` matches the `ResolveCaseDialog` form shape (Task 3) ✓

### Known gaps deferred

- **Feature-flag management UI** (P2) — ops.v2.cases flag exists in DB; admin UI to toggle flags is not in this plan
- **Structured customer address CRUD** (P1) — scope is significant; separate plan required
- **Provider duplicate merge tooling** (P1) — separate plan required
- **Role capability matrix** (P1, Finding 7) — replacing cumulative hierarchy with explicit grants requires broader auth refactor; deferred to avoid auth regressions
- **Ops launch readiness checklist** (P2) — document-only deliverable; deferred

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-21-ops-remediation.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — execute tasks in this session using executing-plans, with checkpoints between waves

**Which approach?**

# Category Risk Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `riskTier` field (LOW | STANDARD) to the existing `Category` model so that LOW-risk provider categories are auto-approved when a provider becomes ACTIVE, eliminating unnecessary ops queue volume for safe categories like cleaning, garden, and DIY.

**Architecture:** Service-layer hooks in a new `lib/provider-categories.ts` module — three focused functions (`resolveInitialApprovalStatus`, `autoApproveLowRiskCategories`, `autoApproveProvidersForCategory`) wired into the two provider-approval paths and all three `provider_categories` write sites. System-triggered events write to `AuditLog` (no FK); ops UI mutations use the existing `AdminAuditEvent` via `crudAction()`.

**Tech Stack:** Prisma (schema migration), Vitest (unit tests with mocked DB), Next.js Server Actions, `crudAction()` from `lib/crud-action.ts`, `AuditLog` model, `shadcn/ui` Select for inline tier control.

**Spec:** `docs/superpowers/specs/2026-05-22-category-risk-grading-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| **Create** | `lib/provider-categories.ts` | 3 service functions — resolveInitialApprovalStatus, autoApproveLowRiskCategories, autoApproveProvidersForCategory |
| **Create** | `__tests__/lib/provider-categories.test.ts` | Unit tests for all 3 service functions |
| **Create** | `scripts/seed-categories.ts` | Idempotent upsert of initial category risk tiers |
| **Modify** | `prisma/schema.prisma` | Add `CategoryRiskTier` enum + `riskTier` field on `Category` |
| **Modify** | `lib/feature-flags-registry.ts` | Register `admin.categories.risk_tier` |
| **Modify** | `scripts/seed-flags.ts` | Add `admin.categories.risk_tier` to the seeded flags list |
| **Modify** | `lib/category-config.ts` | Add `riskTier` to `CategoryAdminRecord` type + `listCategoriesForAdmin` select |
| **Modify** | `app/(admin)/admin/categories/actions.ts` | Slug immutability guard + new `updateCategoryRiskTierAction` |
| **Modify** | `app/(admin)/admin/categories/categories-client.tsx` | Risk Tier column + inline Select + STANDARD→LOW confirmation dialog |
| **Modify** | `app/(admin)/admin/categories/page.tsx` | Read `riskTierEnabled` flag, pass to client |
| **Modify** | `app/(admin)/admin/providers/actions.ts` | Call `autoApproveLowRiskCategories` in `setProviderStatusAction` (ACTIVE) + `verifyProviderAction` |
| **Modify** | `lib/whatsapp-flows/registration.ts` | Replace hardcoded `'PENDING_REVIEW'` with `resolveInitialApprovalStatus` |
| **Modify** | `app/(admin)/admin/applications/page.tsx` | Replace hardcoded `'APPROVED'` with `'PENDING_REVIEW'`; call `autoApproveLowRiskCategories` post-transaction |

---

## Task 1: Schema Migration

**Files:**
- Modify: `field-service/prisma/schema.prisma`

- [ ] **Step 1: Add the enum and field**

Open `prisma/schema.prisma`. Find the `Category` model (line 2161). Add the `CategoryRiskTier` enum before it, and add the `riskTier` field inside the model:

```prisma
// Add this enum near the other enums (before or after the Category model block)
enum CategoryRiskTier {
  LOW
  STANDARD
}

model Category {
  id                  String                        @id @default(cuid())
  slug                String                        @unique
  label               String
  description         String?
  active              Boolean                       @default(true)
  bookingOnAssignment Boolean                       @default(false)
  regulated           Boolean                       @default(false)
  sortOrder           Int                           @default(0)
  riskTier            CategoryRiskTier              @default(STANDARD)   // ← add this line
  createdAt           DateTime                      @default(now())
  updatedAt           DateTime                      @updatedAt

  requiredCertifications CategoryRequiredCertification[]
  requiredEquipment      CategoryRequiredEquipment[]
  requiredVehicleTypes   CategoryRequiredVehicleType[]
  providerCategories     ProviderCategory[]
  providerRates          ProviderRate[]

  @@index([active, sortOrder])
  @@map("categories")
}
```

- [ ] **Step 2: Run the migration**

```bash
cd field-service
pnpm prisma migrate dev --name add_category_risk_tier
```

Expected output: `✔ Generated Prisma Client` and a new migration folder under `prisma/migrations/`.

- [ ] **Step 3: Verify the Prisma client regenerated**

```bash
pnpm prisma generate
```

After this step, `import { CategoryRiskTier } from '@prisma/client'` will compile.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add CategoryRiskTier enum and riskTier field to Category"
```

---

## Task 2: Core Service Module

**Files:**
- Create: `field-service/lib/provider-categories.ts`

- [ ] **Step 1: Create the file**

```typescript
// lib/provider-categories.ts
import { db } from '@/lib/db'
import { CategoryRiskTier } from '@prisma/client'

export type CategoryApprovalStatus = 'APPROVED' | 'PENDING_REVIEW'

/**
 * Determines the initial approvalStatus for a new provider_categories row.
 * Returns APPROVED only when the provider is ACTIVE and the category is LOW risk.
 * Falls back to PENDING_REVIEW for any unknown category slug.
 */
export async function resolveInitialApprovalStatus(
  providerId: string,
  categorySlug: string,
): Promise<CategoryApprovalStatus> {
  const [provider, category] = await Promise.all([
    db.provider.findUnique({ where: { id: providerId }, select: { status: true } }),
    db.category.findUnique({ where: { slug: categorySlug }, select: { riskTier: true } }),
  ])

  if (provider?.status === 'ACTIVE' && category?.riskTier === CategoryRiskTier.LOW) {
    console.log('[provider-categories] auto-approved on upsert', { providerId, categorySlug })
    return 'APPROVED'
  }
  return 'PENDING_REVIEW'
}

/**
 * On provider approval: sets all PENDING_REVIEW provider_categories rows for
 * LOW-risk categories to APPROVED. Called after provider status transitions to ACTIVE.
 */
export async function autoApproveLowRiskCategories(providerId: string): Promise<void> {
  const pendingRows = await db.providerCategory.findMany({
    where: { providerId, approvalStatus: 'PENDING_REVIEW' },
    select: { id: true, categorySlug: true },
  })
  if (pendingRows.length === 0) return

  const lowRiskCategories = await db.category.findMany({
    where: {
      slug: { in: pendingRows.map((r) => r.categorySlug) },
      riskTier: CategoryRiskTier.LOW,
    },
    select: { slug: true },
  })
  const lowRiskSlugs = new Set(lowRiskCategories.map((c) => c.slug))
  const toApprove = pendingRows.filter((r) => lowRiskSlugs.has(r.categorySlug))
  if (toApprove.length === 0) return

  await db.providerCategory.updateMany({
    where: { id: { in: toApprove.map((r) => r.id) } },
    data: { approvalStatus: 'APPROVED' },
  })

  await db.auditLog.createMany({
    data: toApprove.map((row) => ({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      entityType: 'ProviderCategory',
      entityId: row.id,
      after: {
        approvalStatus: 'APPROVED',
        reason: 'LOW_RISK_CATEGORY',
        categorySlug: row.categorySlug,
        providerId,
      } as object,
    })),
  })

  console.log('[provider-categories] auto-approved', {
    providerId,
    count: toApprove.length,
    slugs: toApprove.map((r) => r.categorySlug),
  })
}

/**
 * When ops changes a category from STANDARD → LOW: bulk-approves all
 * ACTIVE providers' PENDING_REVIEW rows for this specific slug.
 * Returns the count of rows approved.
 */
export async function autoApproveProvidersForCategory(categorySlug: string): Promise<number> {
  const rows = await db.providerCategory.findMany({
    where: {
      categorySlug,
      approvalStatus: 'PENDING_REVIEW',
      provider: { status: 'ACTIVE' },
    },
    select: { id: true, providerId: true },
  })
  if (rows.length === 0) return 0

  await db.providerCategory.updateMany({
    where: { id: { in: rows.map((r) => r.id) } },
    data: { approvalStatus: 'APPROVED' },
  })

  await db.auditLog.createMany({
    data: rows.map((row) => ({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      entityType: 'ProviderCategory',
      entityId: row.id,
      after: {
        approvalStatus: 'APPROVED',
        reason: 'CATEGORY_RISK_TIER_CHANGED_TO_LOW',
        categorySlug,
        providerId: row.providerId,
      } as object,
    })),
  })

  console.log('[provider-categories] bulk auto-approved on tier change', {
    categorySlug,
    count: rows.length,
  })

  return rows.length
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep provider-categories
```

Expected: no output (zero errors in the new file).

- [ ] **Step 3: Commit**

```bash
git add lib/provider-categories.ts
git commit -m "feat(provider-categories): add resolveInitialApprovalStatus, autoApproveLowRiskCategories, autoApproveProvidersForCategory"
```

---

## Task 3: Unit Tests for Service Module

**Files:**
- Create: `field-service/__tests__/lib/provider-categories.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// __tests__/lib/provider-categories.test.ts
import { vi, describe, it, expect, beforeEach } from 'vitest'

const mockDb = {
  provider: { findUnique: vi.fn() },
  category: { findUnique: vi.fn(), findMany: vi.fn() },
  providerCategory: { findMany: vi.fn(), updateMany: vi.fn() },
  auditLog: { createMany: vi.fn() },
}

vi.mock('@/lib/db', () => ({ db: mockDb }))
vi.mock('@prisma/client', () => ({
  CategoryRiskTier: { LOW: 'LOW', STANDARD: 'STANDARD' },
}))

import {
  resolveInitialApprovalStatus,
  autoApproveLowRiskCategories,
  autoApproveProvidersForCategory,
} from '@/lib/provider-categories'

beforeEach(() => {
  vi.clearAllMocks()
  mockDb.auditLog.createMany.mockResolvedValue({ count: 0 })
  mockDb.providerCategory.updateMany.mockResolvedValue({ count: 0 })
})

// ─── resolveInitialApprovalStatus ────────────────────────────────────────────

describe('resolveInitialApprovalStatus', () => {
  it('returns APPROVED for an ACTIVE provider with a LOW-risk category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'LOW' })

    const result = await resolveInitialApprovalStatus('prov-1', 'garden')

    expect(result).toBe('APPROVED')
  })

  it('returns PENDING_REVIEW for an ACTIVE provider with a STANDARD category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'STANDARD' })

    const result = await resolveInitialApprovalStatus('prov-1', 'plumbing')

    expect(result).toBe('PENDING_REVIEW')
  })

  it('returns PENDING_REVIEW for a non-ACTIVE provider even with LOW-risk category', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'APPLICATION_PENDING' })
    mockDb.category.findUnique.mockResolvedValue({ riskTier: 'LOW' })

    const result = await resolveInitialApprovalStatus('prov-1', 'garden')

    expect(result).toBe('PENDING_REVIEW')
  })

  it('returns PENDING_REVIEW when no Category row exists (unknown slug = STANDARD)', async () => {
    mockDb.provider.findUnique.mockResolvedValue({ status: 'ACTIVE' })
    mockDb.category.findUnique.mockResolvedValue(null)

    const result = await resolveInitialApprovalStatus('prov-1', 'unknown-service')

    expect(result).toBe('PENDING_REVIEW')
  })
})

// ─── autoApproveLowRiskCategories ─────────────────────────────────────────────

describe('autoApproveLowRiskCategories', () => {
  it('approves only LOW-risk pending rows, leaves STANDARD rows untouched', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'garden' },
      { id: 'pc-2', categorySlug: 'plumbing' },
    ])
    mockDb.category.findMany.mockResolvedValue([
      { slug: 'garden' }, // only garden is LOW
    ])

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.providerCategory.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pc-1'] } },
      data: { approvalStatus: 'APPROVED' },
    })
  })

  it('writes one AuditLog entry per approved row', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'garden' },
      { id: 'pc-2', categorySlug: 'cleaning' },
    ])
    mockDb.category.findMany.mockResolvedValue([
      { slug: 'garden' },
      { slug: 'cleaning' },
    ])

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.auditLog.createMany).toHaveBeenCalledOnce()
    const { data } = mockDb.auditLog.createMany.mock.calls[0][0]
    expect(data).toHaveLength(2)
    expect(data[0]).toMatchObject({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      entityId: 'pc-1',
    })
  })

  it('no-ops cleanly when provider has no PENDING_REVIEW rows', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
    expect(mockDb.auditLog.createMany).not.toHaveBeenCalled()
  })

  it('no-ops when all pending rows are STANDARD risk', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', categorySlug: 'plumbing' },
    ])
    mockDb.category.findMany.mockResolvedValue([]) // no LOW-risk matches

    await autoApproveLowRiskCategories('prov-1')

    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
  })
})

// ─── autoApproveProvidersForCategory ─────────────────────────────────────────

describe('autoApproveProvidersForCategory', () => {
  it('approves all ACTIVE providers\' PENDING_REVIEW rows for the given slug', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', providerId: 'prov-1' },
      { id: 'pc-2', providerId: 'prov-2' },
    ])

    const count = await autoApproveProvidersForCategory('garden')

    expect(mockDb.providerCategory.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['pc-1', 'pc-2'] } },
      data: { approvalStatus: 'APPROVED' },
    })
    expect(count).toBe(2)
  })

  it('writes one AuditLog entry per approved row with CATEGORY_RISK_TIER_CHANGED_TO_LOW reason', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([
      { id: 'pc-1', providerId: 'prov-1' },
    ])

    await autoApproveProvidersForCategory('garden')

    const { data } = mockDb.auditLog.createMany.mock.calls[0][0]
    expect(data[0]).toMatchObject({
      actorId: 'system',
      actorRole: 'SYSTEM',
      action: 'provider_category.auto_approved',
      after: expect.objectContaining({ reason: 'CATEGORY_RISK_TIER_CHANGED_TO_LOW', categorySlug: 'garden' }),
    })
  })

  it('returns 0 and skips DB writes when no matching rows exist', async () => {
    mockDb.providerCategory.findMany.mockResolvedValue([])

    const count = await autoApproveProvidersForCategory('garden')

    expect(count).toBe(0)
    expect(mockDb.providerCategory.updateMany).not.toHaveBeenCalled()
    expect(mockDb.auditLog.createMany).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (module not yet wired)**

```bash
cd field-service
pnpm vitest run __tests__/lib/provider-categories.test.ts
```

Expected: all tests fail with import errors or mock assertion failures — that's correct at this stage.

- [ ] **Step 3: Verify tests pass after Task 2 code is in place**

```bash
pnpm vitest run __tests__/lib/provider-categories.test.ts
```

Expected: `13 tests | 13 passed`.

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/provider-categories.test.ts
git commit -m "test(provider-categories): unit tests for risk-tier auto-approval service functions"
```

---

## Task 4: Feature Flag Registration

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`
- Modify: `field-service/scripts/seed-flags.ts`

- [ ] **Step 1: Register the flag in the registry**

In `lib/feature-flags-registry.ts`, add to the `Admin CRUD surfaces` section (after `admin.crud.categories`):

```typescript
'admin.categories.risk_tier': {
  description: 'Enable riskTier column and inline LOW/STANDARD selector on the Categories admin page.',
  owner: 'ops',
  defaultValue: false,
},
```

- [ ] **Step 2: Add the flag to seed-flags.ts**

In `scripts/seed-flags.ts`, add to the `FLAGS` array (after the `admin.crud.categories` entry):

```typescript
{
  key: 'admin.categories.risk_tier',
  description: 'Enable riskTier column and inline LOW/STANDARD selector on the Categories admin page.',
},
```

- [ ] **Step 3: Verify TypeScript compiles — isEnabled now accepts the new key**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/feature-flags-registry.ts scripts/seed-flags.ts
git commit -m "feat(flags): register admin.categories.risk_tier feature flag"
```

---

## Task 5: Seed Initial Category Risk Tiers

**Files:**
- Create: `field-service/scripts/seed-categories.ts`

- [ ] **Step 1: Create the seed script**

```typescript
/**
 * seed-categories.ts
 *
 * Upserts initial Category rows with risk tiers.
 * Safe to re-run — uses upsert by slug throughout.
 *
 * Run after deploying the add_category_risk_tier migration:
 *   npx tsx scripts/seed-categories.ts
 */
import { PrismaClient, CategoryRiskTier } from '@prisma/client'

const db = new PrismaClient()

const CATEGORIES: Array<{ slug: string; label: string; riskTier: CategoryRiskTier }> = [
  { slug: 'cleaning',     label: 'Cleaning',                riskTier: CategoryRiskTier.LOW },
  { slug: 'garden',       label: 'Garden & Landscaping',    riskTier: CategoryRiskTier.LOW },
  { slug: 'diy',          label: 'DIY & Assembly',          riskTier: CategoryRiskTier.LOW },
  { slug: 'moving',       label: 'Moving & Packing',        riskTier: CategoryRiskTier.LOW },
  { slug: 'painting',     label: 'Painting',                riskTier: CategoryRiskTier.LOW },
  { slug: 'plumbing',     label: 'Plumbing',                riskTier: CategoryRiskTier.STANDARD },
  { slug: 'electrical',   label: 'Electrical',              riskTier: CategoryRiskTier.STANDARD },
  { slug: 'hvac',         label: 'HVAC',                    riskTier: CategoryRiskTier.STANDARD },
  { slug: 'pest-control', label: 'Pest Control',            riskTier: CategoryRiskTier.STANDARD },
]

async function main() {
  console.log(`Seeding ${CATEGORIES.length} categories…`)
  for (const cat of CATEGORIES) {
    await db.category.upsert({
      where: { slug: cat.slug },
      update: { riskTier: cat.riskTier },
      create: {
        slug: cat.slug,
        label: cat.label,
        riskTier: cat.riskTier,
      },
    })
    console.log(`  ${cat.riskTier === 'LOW' ? '✓ LOW     ' : '○ STANDARD'} ${cat.slug}`)
  }
  console.log('Done.')
}

main()
  .catch((err) => { console.error(err); process.exit(1) })
  .finally(() => db.$disconnect())
```

- [ ] **Step 2: Add a script entry to package.json**

In `field-service/package.json`, add to the `scripts` section:

```json
"seed:categories": "tsx scripts/seed-categories.ts"
```

- [ ] **Step 3: Run the seed against local DB to verify**

```bash
cd field-service
npx tsx scripts/seed-categories.ts
```

Expected output:
```
Seeding 9 categories…
  ✓ LOW      cleaning
  ✓ LOW      garden
  ...
  ○ STANDARD plumbing
  ...
Done.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/seed-categories.ts package.json
git commit -m "feat(seed): seed initial category risk tiers (5 LOW, 4 STANDARD)"
```

---

## Task 6: Slug Immutability Guard

**Files:**
- Modify: `field-service/app/(admin)/admin/categories/actions.ts`

- [ ] **Step 1: Find the update action**

In `categories/actions.ts`, the `updateCategory` run function at line ~140 calls `tx.category.update(...)` and allows `slug` to change. Add a guard before the slug-collision check:

```typescript
// Inside the run: async (data, tx) => { ... } block,
// AFTER the existing category existence check (line ~141-148),
// BEFORE the duplicate slug check:

// Block slug changes if provider_categories rows exist for this slug
if (data.slug !== category.slug) {  // category is already fetched above
  const linkedRows = await tx.providerCategory.count({
    where: { categorySlug: category.slug },
  })
  if (linkedRows > 0) {
    throw new CrudActionError(
      'CONFLICT',
      `Slug "${category.slug}" cannot be changed — ${linkedRows} provider category row(s) reference it. Rename them first or contact engineering.`,
    )
  }
}
```

The full patched block will look like this:

```typescript
run: async (data, tx) => {
  const category = await tx.category.findUnique({
    where: { id: data.categoryId },
    select: { id: true, slug: true },   // ← add slug to select
  })
  if (!category) {
    throw new CrudActionError('NOT_FOUND', `Category ${data.categoryId} not found.`)
  }

  // ← NEW: slug immutability guard
  if (data.slug !== category.slug) {
    const linkedRows = await tx.providerCategory.count({
      where: { categorySlug: category.slug },
    })
    if (linkedRows > 0) {
      throw new CrudActionError(
        'CONFLICT',
        `Slug "${category.slug}" cannot be changed — ${linkedRows} provider category row(s) reference it.`,
      )
    }
  }

  const duplicate = await tx.category.findUnique({
    where: { slug: data.slug },
    select: { id: true },
  })
  if (duplicate && duplicate.id !== data.categoryId) {
    throw new CrudActionError('CONFLICT', `Category slug ${data.slug} already exists.`)
  }

  // ... rest of update unchanged
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep categories/actions
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add app/(admin)/admin/categories/actions.ts
git commit -m "feat(categories): guard slug changes when provider_categories rows exist"
```

---

## Task 7: `updateCategoryRiskTierAction` + Category Config Type

**Files:**
- Modify: `field-service/app/(admin)/admin/categories/actions.ts`
- Modify: `field-service/lib/category-config.ts`

- [ ] **Step 1: Add `riskTier` to `CategoryAdminRecord` type in `lib/category-config.ts`**

Find the `CategoryAdminRecord` type definition (line 12) and add `riskTier`:

```typescript
export type CategoryAdminRecord = {
  id: string
  slug: string
  label: string
  description: string | null
  active: boolean
  bookingOnAssignment: boolean
  regulated: boolean
  sortOrder: number
  riskTier: 'LOW' | 'STANDARD'   // ← add this
  requiredCertifications: Array<{ code: string }>
  requiredEquipment: Array<{ tag: string }>
  requiredVehicleTypes: Array<{ vehicleType: string }>
}
```

- [ ] **Step 2: Add `riskTier` to the `listCategoriesForAdmin` select**

In `listCategoriesForAdmin` (line ~100), add `riskTier: true` to the `select` object:

```typescript
const categories = await (db as any).category?.findMany?.({
  orderBy: [{ sortOrder: 'asc' }, { label: 'asc' }],
  select: {
    id: true,
    slug: true,
    label: true,
    description: true,
    active: true,
    bookingOnAssignment: true,
    regulated: true,
    sortOrder: true,
    riskTier: true,   // ← add this
    requiredCertifications: { select: { code: true }, orderBy: { code: 'asc' } },
    requiredEquipment: { select: { tag: true }, orderBy: { tag: 'asc' } },
    requiredVehicleTypes: { select: { vehicleType: true }, orderBy: { vehicleType: 'asc' } },
  },
})
```

Also update the policy fallback at the bottom of the function to include `riskTier: 'STANDARD' as const` for legacy entries (so TypeScript doesn't complain):

```typescript
return listCategoryPolicies().map((policy, index) => ({
  id: policy.normalizedCategory,
  slug: policy.normalizedCategory,
  label: policy.normalizedCategory,
  description: null,
  active: true,
  bookingOnAssignment: policy.bookingOnAssignment,
  regulated: policy.regulated,
  sortOrder: index,
  riskTier: 'STANDARD' as const,   // ← add this; legacy policy rows are always STANDARD
  requiredCertifications: policy.requiredCertificationCodes.map((code) => ({ code })),
  requiredEquipment: policy.requiredEquipmentTags.map((tag) => ({ tag })),
  requiredVehicleTypes: policy.requiredVehicleTypes.map((vehicleType) => ({ vehicleType })),
}))
```

- [ ] **Step 3: Add `updateCategoryRiskTierAction` to `categories/actions.ts`**

Add the following at the bottom of `categories/actions.ts`, after the last existing action:

```typescript
import { autoApproveProvidersForCategory } from '@/lib/provider-categories'
import { CategoryRiskTier } from '@prisma/client'

// ─── updateCategoryRiskTier ───────────────────────────────────────────────────

const UpdateCategoryRiskTierSchema = z.object({
  categoryId: z.string().min(1),
  riskTier: z.nativeEnum(CategoryRiskTier),
})

type UpdateRiskTierInput = z.infer<typeof UpdateCategoryRiskTierSchema>

export async function updateCategoryRiskTierAction(input: UpdateRiskTierInput) {
  const result = await crudAction<UpdateRiskTierInput, { id: string; slug: string; riskTier: string; bulkApproved: number }>({
    entity: 'Category',
    entityId: input.categoryId,
    action: 'category.update_risk_tier',
    requiredRole: ['OWNER'],
    requiredFlag: 'admin.categories.risk_tier',
    schema: UpdateCategoryRiskTierSchema,
    input,
    run: async (data, tx) => {
      const category = await tx.category.findUnique({
        where: { id: data.categoryId },
        select: { id: true, slug: true, riskTier: true },
      })
      if (!category) {
        throw new CrudActionError('NOT_FOUND', `Category ${data.categoryId} not found.`)
      }
      if (category.riskTier === data.riskTier) {
        return { id: category.id, slug: category.slug, riskTier: category.riskTier as string, bulkApproved: 0 }
      }

      await tx.category.update({
        where: { id: data.categoryId },
        data: { riskTier: data.riskTier },
      })

      return {
        id: category.id,
        slug: category.slug,
        riskTier: data.riskTier,
        bulkApproved: 0,
        // Pass old tier through metadata for audit log — crudAction records before/after
        _before: { riskTier: category.riskTier },
      } as { id: string; slug: string; riskTier: string; bulkApproved: number }
    },
    before: async (tx, data) => {
      const cat = await tx.category.findUnique({
        where: { id: data.categoryId },
        select: { riskTier: true },
      })
      return cat ? { riskTier: cat.riskTier } : undefined
    },
  })

  // If changing STANDARD → LOW, bulk-approve all affected providers (outside transaction)
  if (result.ok && result.data.riskTier === CategoryRiskTier.LOW) {
    const bulkApproved = await autoApproveProvidersForCategory(result.data.slug)
    revalidatePath('/admin/categories')
    return { ...result, data: { ...result.data, bulkApproved } }
  }

  revalidatePath('/admin/categories')
  return result
}
```

- [ ] **Step 4: Check if `crudAction` supports a `before` parameter**

Run:
```bash
grep -n "before" field-service/lib/crud-action.ts | head -20
```

If `crudAction` does not have a `before` parameter, simplify `updateCategoryRiskTierAction` to fetch the old tier inside the `run` function and include it in metadata manually via the `crudAction`'s `metadata` param if available. The pattern from existing actions (e.g., `updateCategory` action which uses `crudAction`) is the reference — match its structure exactly.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep -E "categories/actions|category-config"
```

Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/admin/categories/actions.ts lib/category-config.ts
git commit -m "feat(categories): add updateCategoryRiskTierAction + riskTier to CategoryAdminRecord"
```

---

## Task 8: Provider Approval Hooks

**Files:**
- Modify: `field-service/app/(admin)/admin/providers/actions.ts`

- [ ] **Step 1: Import `autoApproveLowRiskCategories`**

At the top of `providers/actions.ts`, add the import:

```typescript
import { autoApproveLowRiskCategories } from '@/lib/provider-categories'
```

- [ ] **Step 2: Wire into `setProviderStatusAction`**

After the `crudAction` call in `setProviderStatusAction` (line ~280), add:

```typescript
export async function setProviderStatusAction(input: SetStatusInput) {
  const isOwnerOnlyStatus = input.status === 'ARCHIVED' || input.status === 'BANNED'
  const result = await crudAction<SetStatusInput, { id: string }>({
    // ... existing crudAction config unchanged ...
  })

  // ← NEW: auto-approve LOW-risk categories when provider transitions to ACTIVE
  if (result.ok && input.status === 'ACTIVE') {
    await autoApproveLowRiskCategories(input.providerId)
  }

  revalidatePath('/admin/providers')
  revalidatePath('/admin/technicians')
  revalidatePath(`/admin/providers/${input.providerId}`)
  revalidatePath(`/admin/technicians/${input.providerId}`)
  return result
}
```

- [ ] **Step 3: Wire into `verifyProviderAction`**

After the `crudAction` call in `verifyProviderAction` (line ~305), add:

```typescript
export async function verifyProviderAction(providerId: string) {
  const result = await crudAction<{ providerId: string }, { id: string }>({
    // ... existing crudAction config unchanged ...
  })

  // ← NEW: auto-approve LOW-risk categories — verifyProvider always sets status ACTIVE
  if (result.ok) {
    await autoApproveLowRiskCategories(providerId)
  }

  revalidatePath(`/admin/providers/${providerId}`)
  revalidatePath(`/admin/technicians/${providerId}`)
  return result
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep providers/actions
```

Expected: no output.

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
pnpm vitest run
```

Expected: all tests pass (the new `autoApproveLowRiskCategories` calls are no-ops when `provider_categories` has no rows in test fixtures).

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/admin/providers/actions.ts
git commit -m "feat(providers): call autoApproveLowRiskCategories after ACTIVE transition in setProviderStatus and verifyProvider"
```

---

## Task 9: Registration Call Site

**Files:**
- Modify: `field-service/lib/whatsapp-flows/registration.ts`

- [ ] **Step 1: Import `resolveInitialApprovalStatus`**

Find the import block at the top of `registration.ts`. Add:

```typescript
import { resolveInitialApprovalStatus } from '@/lib/provider-categories'
```

- [ ] **Step 2: Replace the hardcoded `'PENDING_REVIEW'` at line 2431**

The current code (lines 2422–2432):

```typescript
const providerCategoryRows = submitData.skills.map((skill) => ({
  certificationRequired: Boolean(getServiceComplianceRequirement(skill).certificationRequiredForApproval),
  certificationStatus: getServiceComplianceRequirement(skill).certificationRecommended
    ? (uniqueStrings(ctx.data.certificationProofAttachmentIds ?? []).length > 0 ? 'SUBMITTED' : 'REQUESTED')
    : 'NOT_REQUIRED',
  providerId,
  categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
  yearsExperience: yearsExperienceFromLabel(ctx.data.experience),
  skillLevel: skillLevelFromExperienceLabel(ctx.data.experience),
  approvalStatus: 'PENDING_REVIEW',   // ← this line
}))
```

Replace with:

```typescript
const providerCategoryRows = await Promise.all(
  submitData.skills.map(async (skill) => {
    const categorySlug = resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_')
    const approvalStatus = await resolveInitialApprovalStatus(providerId, categorySlug)
    return {
      certificationRequired: Boolean(getServiceComplianceRequirement(skill).certificationRequiredForApproval),
      certificationStatus: getServiceComplianceRequirement(skill).certificationRecommended
        ? (uniqueStrings(ctx.data.certificationProofAttachmentIds ?? []).length > 0 ? 'SUBMITTED' : 'REQUESTED')
        : 'NOT_REQUIRED',
      providerId,
      categorySlug,
      yearsExperience: yearsExperienceFromLabel(ctx.data.experience),
      skillLevel: skillLevelFromExperienceLabel(ctx.data.experience),
      approvalStatus,
    }
  })
)
```

Note: `providerCategoryRows` is now a `Promise.all` — the downstream `createMany` call takes `data: providerCategoryRows` which is already awaited so no change needed there.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep registration
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/whatsapp-flows/registration.ts
git commit -m "feat(registration): use resolveInitialApprovalStatus for provider_categories on self-registration"
```

---

## Task 10: Application Approval Call Site

**Files:**
- Modify: `field-service/app/(admin)/admin/applications/page.tsx`

- [ ] **Step 1: Import `autoApproveLowRiskCategories`**

At the top of `applications/page.tsx`, add:

```typescript
import { autoApproveLowRiskCategories } from '@/lib/provider-categories'
```

- [ ] **Step 2: Replace hardcoded `'APPROVED'` at lines 281–298**

The current code:

```typescript
const providerCategoryRows = app.skills.map((skill) => ({
  providerId,
  categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
  approvalStatus: 'APPROVED',
}))

if (providerCategoryRows.length > 0) {
  await tx.providerCategory.createMany({
    data: providerCategoryRows,
    skipDuplicates: true,
  })
  await tx.providerCategory.updateMany({
    where: {
      providerId,
      categorySlug: { in: providerCategoryRows.map((row) => row.categorySlug) },
    },
    data: { approvalStatus: 'APPROVED' },
  })
}
```

Replace with:

```typescript
const providerCategoryRows = app.skills.map((skill) => ({
  providerId,
  categorySlug: resolveServiceCategoryTag(skill) ?? skill.toLowerCase().replace(/\s+/g, '_'),
  approvalStatus: 'PENDING_REVIEW',   // risk-grading handles promotion post-transaction
}))

if (providerCategoryRows.length > 0) {
  await tx.providerCategory.createMany({
    data: providerCategoryRows,
    skipDuplicates: true,
  })
  // Removed: the updateMany that forced APPROVED for all categories.
  // autoApproveLowRiskCategories (called after this transaction) promotes LOW-risk rows.
}
```

- [ ] **Step 3: Call `autoApproveLowRiskCategories` after the crudAction resolves**

Find where the `crudAction` result is used after the approval (after the `await crudAction(...)` call). Add the auto-approve call after it:

```typescript
const approvalResult = await crudAction({ /* ... existing ... */ })

// ← NEW: promote LOW-risk categories for the newly ACTIVE provider
if (approvalResult.ok && approvalResult.data.approvedNow) {
  await autoApproveLowRiskCategories(approvalResult.data.providerId)
}
```

Note: `approvalResult.data.providerId` is already returned by the `run` function at line ~275 (`return { id: app.id, status: ..., providerId, ... }`).

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep applications/page
```

Expected: no output.

- [ ] **Step 5: Run full test suite**

```bash
cd field-service
pnpm vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/(admin)/admin/applications/page.tsx
git commit -m "feat(applications): use PENDING_REVIEW default + autoApproveLowRiskCategories post-approval"
```

---

## Task 11: Admin UI — Risk Tier Column and Inline Select

**Files:**
- Modify: `field-service/app/(admin)/admin/categories/page.tsx`
- Modify: `field-service/app/(admin)/admin/categories/categories-client.tsx`

- [ ] **Step 1: Pass `riskTierEnabled` flag from page.tsx**

In `app/(admin)/admin/categories/page.tsx`, add the flag check and pass it to the client:

```typescript
export default async function CategoriesPage() {
  const actor = await requireAdmin()
  const crudEnabled = await isEnabled('admin.crud.categories', { userId: actor.id })
  const riskTierEnabled = await isEnabled('admin.categories.risk_tier', { userId: actor.id })  // ← add
  const categories = await listCategoriesForAdmin()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Categories</h1>
        <p className="text-sm text-muted-foreground">
          Categories now resolve from the database when present, with the legacy policy file retained as a compatibility fallback.
        </p>
      </div>

      <CategoriesClient
        categories={categories}
        crudEnabled={crudEnabled}
        riskTierEnabled={riskTierEnabled}  // ← add
      />
    </div>
  )
}
```

- [ ] **Step 2: Update `CategoriesClient` props type**

In `categories-client.tsx`, update the `Props` type:

```typescript
type Props = {
  categories: CategoryAdminRecord[]
  crudEnabled: boolean
  riskTierEnabled: boolean   // ← add
}
```

Update the function signature:

```typescript
export function CategoriesClient({ categories, crudEnabled, riskTierEnabled }: Props) {
```

- [ ] **Step 3: Add the import for `updateCategoryRiskTierAction`**

```typescript
import {
  createCategoryAction,
  deleteCategoryAction,
  updateCategoryAction,
  updateCategoryRiskTierAction,   // ← add
} from './actions'
```

- [ ] **Step 4: Add the Risk Tier cell to the category table**

Find where the category table renders rows in `categories-client.tsx`. Add a Risk Tier column after the existing columns. The column only renders when `riskTierEnabled` is true.

The relevant cell (add this inside the row map, after the label/slug cells):

```tsx
{riskTierEnabled && (
  <td className="px-4 py-2 align-middle">
    <RiskTierCell
      categoryId={category.id}
      currentTier={category.riskTier}
      crudEnabled={crudEnabled}
    />
  </td>
)}
```

- [ ] **Step 5: Add the `RiskTierCell` component**

Add this component inside `categories-client.tsx` (before the `CategoriesClient` export):

```tsx
function RiskTierCell({
  categoryId,
  currentTier,
  crudEnabled,
}: {
  categoryId: string
  currentTier: 'LOW' | 'STANDARD'
  crudEnabled: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = React.useTransition()
  const [confirmOpen, setConfirmOpen] = React.useState(false)
  const [pendingTier, setPendingTier] = React.useState<'LOW' | 'STANDARD' | null>(null)

  const handleChange = (value: string) => {
    const tier = value as 'LOW' | 'STANDARD'
    if (tier === currentTier) return
    if (tier === 'LOW') {
      // STANDARD → LOW: show confirmation — this will auto-approve providers
      setPendingTier('LOW')
      setConfirmOpen(true)
      return
    }
    // LOW → STANDARD: no confirmation needed
    applyChange('STANDARD')
  }

  const applyChange = (tier: 'LOW' | 'STANDARD') => {
    startTransition(async () => {
      try {
        const result = await updateCategoryRiskTierAction({ categoryId, riskTier: tier })
        if (!result.ok) {
          toast.error(result.error ?? 'Failed to update risk tier.')
          return
        }
        if (result.data.bulkApproved > 0) {
          toast.success(`Risk tier set to LOW. ${result.data.bulkApproved} provider category row(s) auto-approved.`)
        } else {
          toast.success('Risk tier updated.')
        }
        router.refresh()
      } catch {
        toast.error('Failed to update risk tier.')
      }
    })
  }

  if (!crudEnabled) {
    return (
      <span className="text-sm text-muted-foreground">{currentTier}</span>
    )
  }

  return (
    <>
      <Select
        value={currentTier}
        onValueChange={handleChange}
        disabled={pending}
      >
        <SelectTrigger className="h-7 w-28 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="STANDARD">STANDARD</SelectItem>
          <SelectItem value="LOW">LOW</SelectItem>
        </SelectContent>
      </Select>

      <DestructiveConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Change to LOW risk?"
        description="This will auto-approve this category for all currently active providers awaiting review. This takes effect immediately."
        confirmLabel="Yes, set to LOW"
        onConfirm={() => {
          setConfirmOpen(false)
          applyChange('LOW')
        }}
      />
    </>
  )
}
```

- [ ] **Step 6: Add missing imports to categories-client.tsx**

Add at the top of `categories-client.tsx`:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
```

`DestructiveConfirmDialog` is already imported from `@/components/admin/crud`.

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd field-service
pnpm tsc --noEmit 2>&1 | grep categories
```

Expected: no output.

- [ ] **Step 8: Run full test suite**

```bash
cd field-service
pnpm vitest run
```

Expected: `131+ tests | 0 failing`.

- [ ] **Step 9: Commit**

```bash
git add app/(admin)/admin/categories/page.tsx app/(admin)/admin/categories/categories-client.tsx
git commit -m "feat(admin/categories): add risk tier column with inline LOW/STANDARD selector and confirmation dialog"
```

---

## Self-Review Checklist

Spec coverage verified:

| Spec requirement | Task |
|---|---|
| `CategoryRiskTier` enum + `riskTier @default(STANDARD)` on Category | Task 1 |
| `resolveInitialApprovalStatus` — ACTIVE + LOW → APPROVED | Task 2, tested in Task 3 |
| `autoApproveLowRiskCategories` — on provider approval | Task 2, wired in Task 8 |
| `autoApproveProvidersForCategory` — on tier change | Task 2, wired in Task 7 |
| Service-layer only, no Postgres trigger | Tasks 2, 7, 8 |
| `AuditLog` (not `AdminAuditEvent`) for system events | Task 2 |
| `AdminAuditEvent` via `crudAction()` for ops tier change | Task 7 |
| `admin.categories.risk_tier` flag registered | Task 4 |
| Seed initial 9 categories idempotently | Task 5 |
| Slug immutability guard on `updateCategory` | Task 6 |
| `updateCategoryRiskTierAction` — OWNER only, before/after in audit | Task 7 |
| `riskTier` in `CategoryAdminRecord` type + `listCategoriesForAdmin` | Task 7 |
| Provider approval hooks — `setProviderStatusAction` + `verifyProviderAction` | Task 8 |
| Registration call site — `registration.ts` | Task 9 |
| Application approval call site — `applications/page.tsx` | Task 10 |
| Admin UI — Risk Tier column + inline select + STANDARD→LOW confirmation | Task 11 |
| STANDARD→LOW confirmation dialog text | Task 11 |
| LOW→STANDARD: no confirmation, no retroactive row changes | Task 11 |
| `bulkApproved` count surfaced in toast | Task 11 |

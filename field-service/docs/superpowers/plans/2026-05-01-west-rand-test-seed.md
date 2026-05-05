# West Rand Test-Lead Seed Script — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a safe, idempotent TypeScript seed script that inserts three West Rand test customers, service requests, image attachments, and lead-chain records (DispatchDecision → MatchAttempt → AssignmentHold → Lead) so Fannie's provider account can test the full lead-acceptance journey without going through WhatsApp.

**Architecture:** A single self-contained CLI script (`scripts/seed-west-rand-test-leads.ts`) driven by a co-located config module (`scripts/seed-west-rand-test-leads.config.ts`). The script imports existing library code (`lib/provider-wallet.ts`, `lib/provider-lead-access.ts`, `lib/db.ts`) and Vercel Blob directly — it does NOT call the WhatsApp dispatch function. Image classification is config-driven (UUID filenames require manual assignment in the config); unclassified images are reported and skipped. All test records carry `isTestRequest: true`, `isTestLead: true`, and `cohortName: 'west-rand-pilot-seed'` for easy targeted cleanup.

**Tech Stack:** TypeScript + tsx, Prisma ORM, `@vercel/blob` `put()`, `lib/provider-lead-access.ts` `createProviderLeadAccessToken()`, `lib/provider-wallet.ts` `creditPromoCreditsInTransaction()`, Vitest for unit tests.

---

## Environment prerequisites

The script reads these env vars at runtime (set them in `.env.local`):

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Prisma pooled connection |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob upload token |
| `PROVIDER_LEAD_ACCESS_SECRET` | Token signing key (falls back to `NEXTAUTH_SECRET`) |
| `PROVIDER_LEAD_APP_URL` | Base URL for lead links (falls back to `NEXT_PUBLIC_APP_URL`) |
| `ALLOW_TEST_DATA_IMPORT` | Must be `true` to allow writes |

Run with:
```bash
cd field-service
npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --dry-run
```

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `scripts/seed-west-rand-test-leads.config.ts` | CREATE | Static customer data, address coords, image-to-customer mapping |
| `scripts/seed-west-rand-test-leads.ts` | CREATE | CLI entry point, orchestrator, report printer |
| `__tests__/scripts/seed-west-rand-test-leads.test.ts` | CREATE | Unit tests for pure-function utilities |
| `package.json` | MODIFY | Add `seed:test-leads` and `seed:test-leads:reset` scripts |

---

## Task 1: Config module

**Files:**
- Create: `scripts/seed-west-rand-test-leads.config.ts`

- [ ] **Step 1: Write the config file**

```typescript
// scripts/seed-west-rand-test-leads.config.ts
// Static seed data for West Rand pilot test leads.
// Edit the imageMapping section after viewing the source images to classify them.

export const COHORT = 'west-rand-pilot-seed' as const

export type CustomerKey = 'masego-mataboge' | 'seth-mataboge' | 'emma-mafoko'

export interface CustomerConfig {
  key: CustomerKey
  name: string
  phone: string            // E.164 normalised
  category: string         // JobRequest.category slug
  title: string
  description: string
  availability: 'urgent' | 'mornings' | 'flexible'
  address: AddressConfig
}

export interface AddressConfig {
  label: string
  street: string
  suburb: string
  city: string
  province: string
  postalCode: string
  lat: number
  lng: number
}

export interface ImageMappingEntry {
  customerKey: CustomerKey
  label: string     // attachment label: 'evidence' | 'before' | etc.
  caption?: string
}

export const CUSTOMERS: CustomerConfig[] = [
  {
    key: 'masego-mataboge',
    name: 'Masego Mataboge',
    phone: '+27827006695',
    category: 'plumbing',
    title: 'Blocked shower drain',
    description:
      'Blocked shower drain. Water drains slowly and backs up during use.',
    availability: 'urgent',
    address: {
      label: 'Home',
      street: '14 Sunset Road',
      suburb: 'Ruimsig',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1724',
      lat: -26.0800,
      lng: 27.8530,
    },
  },
  {
    key: 'seth-mataboge',
    name: 'Seth Mataboge',
    phone: '+27764010810',
    category: 'plumbing',
    title: 'Geyser leaking',
    description:
      'Geyser leaking. Water visible around the geyser area and needs urgent inspection.',
    availability: 'mornings',
    address: {
      label: 'Home',
      street: '7 Acacia Avenue',
      suburb: 'Wilgeheuwel',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1724',
      lat: -26.0620,
      lng: 27.9080,
    },
  },
  {
    key: 'emma-mafoko',
    name: 'Emma Mafoko',
    phone: '+27824978565',
    category: 'handyman',
    title: 'Light fittings — handyman / electrical',
    description:
      'Light fittings need handyman/electrical help. Some lights are not working and may need replacement or repair.',
    availability: 'flexible',
    address: {
      label: 'Home',
      street: '23 Maple Close',
      suburb: 'Little Falls',
      city: 'Roodepoort',
      province: 'Gauteng',
      postalCode: '1735',
      lat: -26.0830,
      lng: 27.9170,
    },
  },
]

// ─── Image mapping ────────────────────────────────────────────────────────────
// Keys are UUID filenames WITHOUT the file extension (case-sensitive).
// Fill in this section after viewing the source images in:
//   /Users/shimane/Desktop/defects/plugapro/images
//
// Available customer keys: 'masego-mataboge' | 'seth-mataboge' | 'emma-mafoko'
// Available labels: 'evidence' | 'before' | 'after'
//
// Example entry:
//   '55B6FEAD-AE90-49AB-B9FA-823E994E5B2B': {
//     customerKey: 'masego-mataboge',
//     label: 'evidence',
//     caption: 'Blocked shower drain — standing water',
//   },
//
// Leave this empty to run the script without images; all images will appear
// in the needs_review section of the dry-run report.

export const IMAGE_MAPPING: Record<string, ImageMappingEntry> = {
  // ← fill in after reviewing images
}

// ─── Fannie provider lookup ───────────────────────────────────────────────────
// The script searches for a provider whose name contains this string (case-insensitive).
// If Fannie's name in the DB differs, update this value.
export const FANNIE_NAME_FRAGMENT = 'Fannie'

// ─── Lead timing ─────────────────────────────────────────────────────────────
export const LEAD_TTL_MINUTES = 30     // how long Fannie has to respond
export const REQUEST_EXPIRES_DAYS = 30 // how far in the future the request expires
export const MIN_PROMO_CREDITS = 5     // ensure Fannie has at least this many credits
export const TOP_UP_PROMO_CREDITS = 10 // add this many promo credits if below minimum
```

- [ ] **Step 2: Commit config**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.config.ts
git commit -m "feat(seed): add west-rand test-lead config module"
```

---

## Task 2: Phone normalization utility + tests

**Files:**
- Create: `__tests__/scripts/seed-west-rand-test-leads.test.ts` (phone section)
- The implementation goes inline in the main script (Task 3+), but write the tests first.

- [ ] **Step 1: Write the failing tests (phone normalization)**

```typescript
// __tests__/scripts/seed-west-rand-test-leads.test.ts
import { describe, it, expect } from 'vitest'
import { normalisePhone } from '../../scripts/seed-west-rand-test-leads'

describe('normalisePhone', () => {
  it('converts 082-format to E.164', () => {
    expect(normalisePhone('0827006695')).toBe('+27827006695')
  })
  it('converts +27 format unchanged', () => {
    expect(normalisePhone('+27827006695')).toBe('+27827006695')
  })
  it('converts 27-prefix to E.164', () => {
    expect(normalisePhone('27764010810')).toBe('+27764010810')
  })
  it('strips spaces and hyphens', () => {
    expect(normalisePhone('+27 82 700 6695')).toBe('+27827006695')
  })
  it('strips spaces and hyphens in local format', () => {
    expect(normalisePhone('082 700 6695')).toBe('+27827006695')
  })
  it('throws on non-SA number', () => {
    expect(() => normalisePhone('+1 555 000 1234')).toThrow(/South African/)
  })
  it('throws on short number', () => {
    expect(() => normalisePhone('12345')).toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- --reporter=verbose __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: `Cannot find module '../../scripts/seed-west-rand-test-leads'`

- [ ] **Step 3: Create stub script with normalisePhone export only**

```typescript
// scripts/seed-west-rand-test-leads.ts
// ─── Utilities (exported for testing) ────────────────────────────────────────

export function normalisePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-().]/g, '')

  // Already E.164 with +27
  if (/^\+27\d{9}$/.test(stripped)) return stripped

  // 27xxxxxxxxx → +27...
  if (/^27\d{9}$/.test(stripped)) return `+${stripped}`

  // 0xxxxxxxxx → +27...
  if (/^0\d{9}$/.test(stripped)) return `+27${stripped.slice(1)}`

  if (/^\+[^2]|^\+2[^7]/.test(stripped)) {
    throw new Error(`Not a South African number: ${raw}`)
  }

  throw new Error(`Cannot normalise phone number: ${raw}`)
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- --reporter=verbose __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: all 7 `normalisePhone` tests pass.

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): normalisePhone utility + tests"
```

---

## Task 3: Image classification utility + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts` (add `classifyImages`)
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { classifyImages } from '../../scripts/seed-west-rand-test-leads'
import type { ImageMappingEntry } from '../../scripts/seed-west-rand-test-leads.config'

describe('classifyImages', () => {
  const mapping: Record<string, ImageMappingEntry> = {
    'ABCDEF': { customerKey: 'masego-mataboge', label: 'evidence', caption: 'Drain' },
  }

  it('classifies a known file', () => {
    const result = classifyImages(['ABCDEF.PNG', 'UNKNOWN.PNG'], mapping)
    expect(result.classified).toHaveLength(1)
    expect(result.classified[0].filename).toBe('ABCDEF.PNG')
    expect(result.classified[0].customerKey).toBe('masego-mataboge')
    expect(result.needsReview).toEqual(['UNKNOWN.PNG'])
  })

  it('returns all files in needsReview when mapping is empty', () => {
    const result = classifyImages(['A.PNG', 'B.PNG'], {})
    expect(result.classified).toHaveLength(0)
    expect(result.needsReview).toHaveLength(2)
  })

  it('is case-insensitive on extension', () => {
    const result = classifyImages(['ABCDEF.png'], mapping)
    expect(result.classified).toHaveLength(1)
  })

  it('strips extension when looking up mapping key', () => {
    const result = classifyImages(['ABCDEF.PNG'], mapping)
    expect(result.classified[0].entry.label).toBe('evidence')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: `classifyImages is not a function`

- [ ] **Step 3: Add classifyImages to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import type { ImageMappingEntry } from './seed-west-rand-test-leads.config'

export interface ClassifiedImage {
  filename: string
  baseName: string   // UUID without extension
  ext: string
  customerKey: string
  entry: ImageMappingEntry
}

export interface ClassificationResult {
  classified: ClassifiedImage[]
  needsReview: string[]   // filenames
}

export function classifyImages(
  filenames: string[],
  mapping: Record<string, ImageMappingEntry>,
): ClassificationResult {
  const classified: ClassifiedImage[] = []
  const needsReview: string[] = []

  for (const filename of filenames) {
    const dotIndex = filename.lastIndexOf('.')
    const baseName = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename
    const ext = dotIndex >= 0 ? filename.slice(dotIndex + 1).toLowerCase() : ''

    const entry = mapping[baseName]
    if (entry) {
      classified.push({ filename, baseName, ext, customerKey: entry.customerKey, entry })
    } else {
      needsReview.push(filename)
    }
  }

  return { classified, needsReview }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: all classification tests pass.

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): classifyImages utility + tests"
```

---

## Task 4: Availability window builder + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { buildAvailabilityWindow } from '../../scripts/seed-west-rand-test-leads'

describe('buildAvailabilityWindow', () => {
  const base = new Date('2026-05-01T08:00:00.000Z')

  it('urgent: window starts in 2h, ends in 4h', () => {
    const w = buildAvailabilityWindow('urgent', base)
    expect(w.start.getTime()).toBe(base.getTime() + 2 * 3600_000)
    expect(w.end.getTime()).toBe(base.getTime() + 4 * 3600_000)
  })

  it('mornings: tomorrow 07:00–12:00 SAST', () => {
    const w = buildAvailabilityWindow('mornings', base)
    // Start must be > base
    expect(w.start.getTime()).toBeGreaterThan(base.getTime())
    // Window is 5 hours
    expect(w.end.getTime() - w.start.getTime()).toBe(5 * 3600_000)
  })

  it('flexible: day after tomorrow 07:00–17:00 SAST', () => {
    const w = buildAvailabilityWindow('flexible', base)
    expect(w.start.getTime()).toBeGreaterThan(base.getTime())
    expect(w.end.getTime() - w.start.getTime()).toBe(10 * 3600_000)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: `buildAvailabilityWindow is not a function`

- [ ] **Step 3: Add buildAvailabilityWindow to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
export function buildAvailabilityWindow(
  availability: 'urgent' | 'mornings' | 'flexible',
  now = new Date(),
): { start: Date; end: Date } {
  const SAST_OFFSET_MS = 2 * 3600_000 // UTC+2

  function nextDayAt(daysFromNow: number, hourSAST: number): Date {
    const d = new Date(now.getTime() + daysFromNow * 86_400_000)
    // Set to 00:00 UTC, then add SAST offset and hour
    d.setUTCHours(0, 0, 0, 0)
    return new Date(d.getTime() - SAST_OFFSET_MS + hourSAST * 3600_000)
  }

  if (availability === 'urgent') {
    return {
      start: new Date(now.getTime() + 2 * 3600_000),
      end: new Date(now.getTime() + 4 * 3600_000),
    }
  }

  if (availability === 'mornings') {
    return {
      start: nextDayAt(1, 7),
      end: nextDayAt(1, 12),
    }
  }

  // flexible
  return {
    start: nextDayAt(2, 7),
    end: nextDayAt(2, 17),
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: all availability tests pass.

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): buildAvailabilityWindow utility + tests"
```

---

## Task 5: Customer upsert + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

The `upsertCustomer` function touches the DB, so tests use a `vi.mock` on `../lib/db`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { vi } from 'vitest'

// Hoist the mock so it runs before imports
const mockDb = {
  customer: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
}
vi.mock('../../lib/db', () => ({ db: mockDb }))

import { upsertCustomer } from '../../scripts/seed-west-rand-test-leads'
import type { CustomerConfig } from '../../scripts/seed-west-rand-test-leads.config'

const testCustomer: CustomerConfig = {
  key: 'masego-mataboge',
  name: 'Masego Mataboge',
  phone: '+27827006695',
  category: 'plumbing',
  title: 'Blocked shower drain',
  description: 'Water drains slowly.',
  availability: 'urgent',
  address: {
    label: 'Home', street: '14 Sunset Road', suburb: 'Ruimsig',
    city: 'Roodepoort', province: 'Gauteng', postalCode: '1724',
    lat: -26.08, lng: 27.853,
  },
}

describe('upsertCustomer', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns existing customer when found', async () => {
    const existing = { id: 'cust-1', phone: '+27827006695', name: 'Masego Mataboge' }
    mockDb.customer.findUnique.mockResolvedValueOnce(existing)

    const result = await upsertCustomer(testCustomer, true)
    expect(result.customer).toBe(existing)
    expect(result.created).toBe(false)
    expect(mockDb.customer.create).not.toHaveBeenCalled()
  })

  it('creates customer when not found', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce(null)
    const created = { id: 'cust-2', phone: '+27827006695', name: 'Masego Mataboge' }
    mockDb.customer.create.mockResolvedValueOnce(created)

    const result = await upsertCustomer(testCustomer, true)
    expect(result.customer).toBe(created)
    expect(result.created).toBe(true)
    expect(mockDb.customer.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          phone: '+27827006695',
          name: 'Masego Mataboge',
          isTestUser: true,
          cohortName: 'west-rand-pilot-seed',
          channel: 'PWA',
          whatsappServiceOptIn: false,
        }),
      }),
    )
  })

  it('does not call create in dry-run mode', async () => {
    mockDb.customer.findUnique.mockResolvedValueOnce(null)
    const result = await upsertCustomer(testCustomer, false)
    expect(mockDb.customer.create).not.toHaveBeenCalled()
    expect(result.customer).toBeNull()
    expect(result.created).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: `upsertCustomer is not a function`

- [ ] **Step 3: Add upsertCustomer to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import { db } from '../lib/db'
import { COHORT, type CustomerConfig } from './seed-west-rand-test-leads.config'

export interface UpsertCustomerResult {
  customer: { id: string; phone: string; name: string } | null
  created: boolean
}

export async function upsertCustomer(
  config: CustomerConfig,
  commit: boolean,
): Promise<UpsertCustomerResult> {
  const phone = normalisePhone(config.phone)

  const existing = await db.customer.findUnique({ where: { phone } })
  if (existing) return { customer: existing, created: false }

  if (!commit) return { customer: null, created: false }

  const customer = await db.customer.create({
    data: {
      phone,
      name: config.name,
      isTestUser: true,
      cohortName: COHORT,
      channel: 'PWA',
      active: true,
      whatsappServiceOptIn: false,
      whatsappMarketingOptIn: false,
      notes: `[TEST SEED] ${COHORT}`,
    },
  })

  return { customer, created: true }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: all upsertCustomer tests pass.

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): upsertCustomer utility + tests"
```

---

## Task 6: Address upsert + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { upsertAddress } from '../../scripts/seed-west-rand-test-leads'
import type { AddressConfig } from '../../scripts/seed-west-rand-test-leads.config'

const testAddress: AddressConfig = {
  label: 'Home', street: '14 Sunset Road', suburb: 'Ruimsig',
  city: 'Roodepoort', province: 'Gauteng', postalCode: '1724',
  lat: -26.08, lng: 27.853,
}

describe('upsertAddress', () => {
  afterEach(() => vi.clearAllMocks())

  it('finds existing address by customerId + street + suburb', async () => {
    const existing = { id: 'addr-1', street: '14 Sunset Road', suburb: 'Ruimsig' }
    mockDb.address = { findFirst: vi.fn().mockResolvedValueOnce(existing), create: vi.fn() }
    const result = await upsertAddress('cust-1', testAddress, true)
    expect(result.address).toBe(existing)
    expect(result.created).toBe(false)
    expect(mockDb.address.create).not.toHaveBeenCalled()
  })

  it('creates address when not found', async () => {
    const created = { id: 'addr-2', street: '14 Sunset Road', suburb: 'Ruimsig' }
    mockDb.address = { findFirst: vi.fn().mockResolvedValueOnce(null), create: vi.fn().mockResolvedValueOnce(created) }
    const result = await upsertAddress('cust-1', testAddress, true)
    expect(result.address).toBe(created)
    expect(result.created).toBe(true)
    expect(mockDb.address.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          street: '14 Sunset Road',
          suburb: 'Ruimsig',
          city: 'Roodepoort',
          province: 'Gauteng',
          postalCode: '1724',
          lat: -26.08,
          lng: 27.853,
          isDefault: true,
        }),
      }),
    )
  })

  it('skips create in dry-run', async () => {
    mockDb.address = { findFirst: vi.fn().mockResolvedValueOnce(null), create: vi.fn() }
    const result = await upsertAddress('cust-1', testAddress, false)
    expect(result.address).toBeNull()
    expect(mockDb.address.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add upsertAddress to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import type { AddressConfig } from './seed-west-rand-test-leads.config'

export interface UpsertAddressResult {
  address: { id: string } | null
  created: boolean
}

export async function upsertAddress(
  customerId: string,
  config: AddressConfig,
  commit: boolean,
): Promise<UpsertAddressResult> {
  const existing = await db.address.findFirst({
    where: { customerId, street: config.street, suburb: config.suburb },
  })
  if (existing) return { address: existing, created: false }

  if (!commit) return { address: null, created: false }

  const address = await db.address.create({
    data: {
      customerId,
      label: config.label,
      street: config.street,
      suburb: config.suburb,
      city: config.city,
      province: config.province,
      postalCode: config.postalCode,
      lat: config.lat,
      lng: config.lng,
      isDefault: true,
    },
  })

  return { address, created: true }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): upsertAddress utility + tests"
```

---

## Task 7: JobRequest upsert + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { upsertJobRequest } from '../../scripts/seed-west-rand-test-leads'

describe('upsertJobRequest', () => {
  afterEach(() => vi.clearAllMocks())

  it('returns existing request for same customer + cohort + category', async () => {
    const existing = { id: 'jr-1', status: 'OPEN' }
    mockDb.jobRequest = { findFirst: vi.fn().mockResolvedValueOnce(existing), create: vi.fn() }

    const result = await upsertJobRequest(
      { id: 'cust-1', phone: '+27827006695', name: 'Masego' },
      { id: 'addr-1' } as any,
      testCustomer,
      true,
    )
    expect(result.jobRequest).toBe(existing)
    expect(result.created).toBe(false)
  })

  it('creates job request when not found', async () => {
    const created = { id: 'jr-2', status: 'OPEN' }
    mockDb.jobRequest = { findFirst: vi.fn().mockResolvedValueOnce(null), create: vi.fn().mockResolvedValueOnce(created) }

    const result = await upsertJobRequest(
      { id: 'cust-1', phone: '+27827006695', name: 'Masego' },
      { id: 'addr-1' } as any,
      testCustomer,
      true,
    )
    expect(result.created).toBe(true)
    expect(mockDb.jobRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: 'cust-1',
          addressId: 'addr-1',
          category: 'plumbing',
          title: 'Blocked shower drain',
          isTestRequest: true,
          cohortName: 'west-rand-pilot-seed',
          status: 'OPEN',
        }),
      }),
    )
  })

  it('skips create in dry-run', async () => {
    mockDb.jobRequest = { findFirst: vi.fn().mockResolvedValueOnce(null), create: vi.fn() }
    const result = await upsertJobRequest(
      { id: 'cust-1', phone: '+27827006695', name: 'Masego' },
      null,
      testCustomer,
      false,
    )
    expect(result.jobRequest).toBeNull()
    expect(mockDb.jobRequest.create).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add upsertJobRequest to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
export interface UpsertJobRequestResult {
  jobRequest: { id: string; status: string } | null
  created: boolean
}

export async function upsertJobRequest(
  customer: { id: string; phone: string; name: string },
  address: { id: string } | null,
  config: CustomerConfig,
  commit: boolean,
): Promise<UpsertJobRequestResult> {
  const existing = await db.jobRequest.findFirst({
    where: { customerId: customer.id, cohortName: COHORT, category: config.category },
    orderBy: { createdAt: 'desc' },
  })
  if (existing) return { jobRequest: existing, created: false }

  if (!commit) return { jobRequest: null, created: false }

  const now = new Date()
  const window = buildAvailabilityWindow(config.availability, now)

  const jobRequest = await db.jobRequest.create({
    data: {
      customerId: customer.id,
      addressId: address?.id ?? null,
      category: config.category,
      title: config.title,
      description: config.description,
      requestedWindowStart: window.start,
      requestedWindowEnd: window.end,
      status: 'OPEN',
      assignmentMode: 'AUTO_ASSIGN',
      isTestRequest: true,
      cohortName: COHORT,
      expiresAt: new Date(now.getTime() + REQUEST_EXPIRES_DAYS * 86_400_000),
    },
  })

  return { jobRequest, created: true }
}
```

At the top of the file, add this import (alongside existing imports):
```typescript
import { COHORT, REQUEST_EXPIRES_DAYS, type CustomerConfig } from './seed-west-rand-test-leads.config'
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): upsertJobRequest utility + tests"
```

---

## Task 8: Image upload to Vercel Blob + attachment creation

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

This function is tested with mocks on `@vercel/blob` and `db`.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { uploadAndAttach } from '../../scripts/seed-west-rand-test-leads'

vi.mock('@vercel/blob', () => ({
  put: vi.fn().mockResolvedValue({
    url: 'https://blob.example.com/job-requests/jr-1/photo.png',
    pathname: 'job-requests/jr-1/photo.png',
  }),
}))

// mock fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn().mockReturnValue(Buffer.from('fakedata')),
  statSync: vi.fn().mockReturnValue({ size: 8 }),
  existsSync: vi.fn().mockReturnValue(true),
}))

describe('uploadAndAttach', () => {
  afterEach(() => vi.clearAllMocks())

  it('calls put with correct blob key pattern', async () => {
    const { put } = await import('@vercel/blob')
    mockDb.attachment = { create: vi.fn().mockResolvedValueOnce({ id: 'att-1' }) }

    await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: 'Drain photo',
      uploadedBy: 'system:seed-script',
      commit: true,
    })

    expect(put).toHaveBeenCalledWith(
      expect.stringMatching(/^job-requests\/jr-1\//),
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'image/png' }),
    )
  })

  it('creates attachment record after upload', async () => {
    mockDb.attachment = { create: vi.fn().mockResolvedValueOnce({ id: 'att-1' }) }

    const result = await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: 'Drain photo',
      uploadedBy: 'system:seed-script',
      commit: true,
    })

    expect(result?.id).toBe('att-1')
    expect(mockDb.attachment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'jr-1',
          label: 'evidence',
          uploadedBy: 'system:seed-script',
          mimeType: 'image/png',
        }),
      }),
    )
  })

  it('skips upload in dry-run', async () => {
    const { put } = await import('@vercel/blob')
    vi.mocked(put).mockClear()
    mockDb.attachment = { create: vi.fn() }

    const result = await uploadAndAttach({
      jobRequestId: 'jr-1',
      imagePath: '/images/ABCDEF.PNG',
      label: 'evidence',
      caption: null,
      uploadedBy: 'system:seed-script',
      commit: false,
    })

    expect(put).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add uploadAndAttach to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import { put } from '@vercel/blob'
import { readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'

const MIME_MAP: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  heic: 'image/heic',
  pdf: 'application/pdf',
}

export async function uploadAndAttach(params: {
  jobRequestId: string
  imagePath: string
  label: string
  caption: string | null
  uploadedBy: string
  commit: boolean
}): Promise<{ id: string } | null> {
  const { jobRequestId, imagePath, label, caption, uploadedBy, commit } = params

  if (!commit) return null

  const ext = extname(imagePath).replace('.', '').toLowerCase()
  const mimeType = MIME_MAP[ext] ?? 'image/jpeg'
  const buffer = readFileSync(imagePath)
  const sizeBytes = statSync(imagePath).size
  const filename = basename(imagePath)

  const blobKey = `job-requests/${jobRequestId}/${Date.now()}-${label}.${ext}`

  const blob = await put(blobKey, buffer, {
    access: 'public',
    addRandomSuffix: true,
    contentType: mimeType,
  })

  const attachment = await db.attachment.create({
    data: {
      jobRequestId,
      url: blob.url,
      blobKey: blob.pathname,
      mimeType,
      sizeBytes,
      label,
      caption: caption ?? null,
      uploadedBy,
    },
  })

  return attachment
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): uploadAndAttach utility + tests"
```

---

## Task 9: Lead chain creation (DispatchDecision → MatchAttempt → AssignmentHold → Lead)

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

This is the core record chain that makes the lead testable in the PWA.

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { createLeadChain } from '../../scripts/seed-west-rand-test-leads'

describe('createLeadChain', () => {
  beforeEach(() => {
    mockDb.lead = { findUnique: vi.fn(), upsert: vi.fn() }
    mockDb.dispatchDecision = { create: vi.fn() }
    mockDb.matchAttempt = { create: vi.fn() }
    mockDb.assignmentHold = { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() }
  })
  afterEach(() => vi.clearAllMocks())

  it('skips creation in dry-run and returns null', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(null)

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: { id: 'prov-1', phone: '+27820000001', name: 'Fannie' } as any,
      commit: false,
    })

    expect(result).toBeNull()
    expect(mockDb.dispatchDecision.create).not.toHaveBeenCalled()
  })

  it('returns existing lead if already SENT and not reset', async () => {
    const existingLead = { id: 'lead-1', status: 'SENT', expiresAt: new Date(Date.now() + 30 * 60_000) }
    mockDb.lead.findUnique.mockResolvedValueOnce(existingLead)

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: { id: 'prov-1', phone: '+27820000001', name: 'Fannie' } as any,
      commit: true,
      resetExisting: false,
    })

    expect(result?.leadId).toBe('lead-1')
    expect(result?.alreadyExisted).toBe(true)
    expect(mockDb.dispatchDecision.create).not.toHaveBeenCalled()
  })

  it('creates all 4 records on commit when lead does not exist', async () => {
    mockDb.lead.findUnique.mockResolvedValueOnce(null)
    mockDb.assignmentHold.findFirst.mockResolvedValueOnce(null)

    const decision = { id: 'dec-1' }
    const attempt = { id: 'att-1' }
    const hold = { id: 'hold-1' }
    const lead = { id: 'lead-1', status: 'SENT' }

    mockDb.dispatchDecision.create.mockResolvedValueOnce(decision)
    mockDb.matchAttempt.create.mockResolvedValueOnce(attempt)
    mockDb.assignmentHold.create.mockResolvedValueOnce(hold)
    mockDb.lead.upsert.mockResolvedValueOnce(lead)
    // update dispatchDecision selectedMatchAttemptId
    mockDb.dispatchDecision.update = vi.fn().mockResolvedValueOnce(decision)

    const result = await createLeadChain({
      jobRequestId: 'jr-1',
      provider: { id: 'prov-1', phone: '+27820000001', name: 'Fannie' } as any,
      commit: true,
    })

    expect(mockDb.dispatchDecision.create).toHaveBeenCalledOnce()
    expect(mockDb.matchAttempt.create).toHaveBeenCalledOnce()
    expect(mockDb.assignmentHold.create).toHaveBeenCalledOnce()
    expect(mockDb.lead.upsert).toHaveBeenCalledOnce()

    expect(result?.leadId).toBe('lead-1')
    expect(result?.alreadyExisted).toBe(false)
    expect(result?.holdId).toBe('hold-1')
    expect(result?.dispatchDecisionId).toBe('dec-1')
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add createLeadChain to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import { COHORT, LEAD_TTL_MINUTES } from './seed-west-rand-test-leads.config'

export interface LeadChainResult {
  leadId: string
  holdId: string
  dispatchDecisionId: string
  matchAttemptId: string
  alreadyExisted: boolean
}

export async function createLeadChain(params: {
  jobRequestId: string
  provider: { id: string; phone: string; name: string }
  commit: boolean
  resetExisting?: boolean
}): Promise<LeadChainResult | null> {
  const { jobRequestId, provider, commit, resetExisting = false } = params

  // Check for existing lead
  const existingLead = await db.lead.findUnique({
    where: { jobRequestId_providerId: { jobRequestId, providerId: provider.id } },
  })

  if (existingLead && !resetExisting) {
    // Return existing lead without creating new records
    if (existingLead.assignmentHoldId && existingLead.matchAttemptId && existingLead.dispatchDecisionId) {
      return {
        leadId: existingLead.id,
        holdId: existingLead.assignmentHoldId,
        dispatchDecisionId: existingLead.dispatchDecisionId,
        matchAttemptId: existingLead.matchAttemptId,
        alreadyExisted: true,
      }
    }
  }

  if (!commit) return null

  const now = new Date()
  const expiresAt = new Date(now.getTime() + LEAD_TTL_MINUTES * 60_000)

  // 1. DispatchDecision
  const decision = await db.dispatchDecision.create({
    data: {
      jobRequestId,
      mode: 'AUTO_ASSIGN',
      status: 'OFFERING',
      initiatedById: 'system:seed-script',
      initiatedByRole: 'system',
      selectedProviderId: provider.id,
      consideredCount: 1,
      eligibleCount: 1,
      scoreWeights: {},
      rankingSummary: { source: 'seed-script', candidateCount: 1 },
      filterSummary: {},
      explanation: `Test seed — ${COHORT}`,
    },
  })

  // 2. MatchAttempt
  const attempt = await db.matchAttempt.create({
    data: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      attemptNumber: 1,
      rankedPosition: 1,
      stage: 'OFFERED',
      hardFilterPassed: true,
      score: 1.0,
      scoreBreakdown: { source: 'seed-script' },
      offeredAt: now,
    },
  })

  // 3. Update DispatchDecision with selectedMatchAttemptId
  await db.dispatchDecision.update({
    where: { id: decision.id },
    data: { selectedMatchAttemptId: attempt.id },
  })

  // 4. Release any prior active hold for this job+provider
  await db.assignmentHold.updateMany({
    where: { jobRequestId, providerId: provider.id, status: 'ACTIVE' },
    data: { status: 'RELEASED', outcomeReasonCode: 'SUPERSEDED_BY_SEED', releasedAt: now },
  })

  // 5. AssignmentHold
  const hold = await db.assignmentHold.create({
    data: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      status: 'ACTIVE',
      offeredAt: now,
      expiresAt,
    },
  })

  // 6. Lead (upsert on jobRequestId + providerId unique index)
  const lead = await db.lead.upsert({
    where: { jobRequestId_providerId: { jobRequestId, providerId: provider.id } },
    create: {
      jobRequestId,
      providerId: provider.id,
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: now,
      expiresAt,
      isTestLead: true,
      cohortName: COHORT,
    },
    update: {
      dispatchDecisionId: decision.id,
      matchAttemptId: attempt.id,
      assignmentHoldId: hold.id,
      status: 'SENT',
      sentAt: now,
      expiresAt,
      respondedAt: null,
    },
  })

  return {
    leadId: lead.id,
    holdId: hold.id,
    dispatchDecisionId: decision.id,
    matchAttemptId: attempt.id,
    alreadyExisted: false,
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): createLeadChain utility + tests"
```

---

## Task 10: Fannie lookup + promo credit top-up + tests

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts`
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { findFannie, ensureFannieHasCredits } from '../../scripts/seed-west-rand-test-leads'

describe('findFannie', () => {
  afterEach(() => vi.clearAllMocks())

  it('finds provider by name fragment (case-insensitive)', async () => {
    const fannie = { id: 'prov-1', name: 'Fannie Dlamini', phone: '+27820000001', status: 'ACTIVE', active: true, verified: true }
    mockDb.provider = { findFirst: vi.fn().mockResolvedValueOnce(fannie) }
    const result = await findFannie('Fannie')
    expect(result).toBe(fannie)
    expect(mockDb.provider.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          name: { contains: 'Fannie', mode: 'insensitive' },
        }),
      }),
    )
  })

  it('returns null when provider not found', async () => {
    mockDb.provider = { findFirst: vi.fn().mockResolvedValueOnce(null) }
    const result = await findFannie('Fannie')
    expect(result).toBeNull()
  })
})

describe('ensureFannieHasCredits', () => {
  afterEach(() => vi.clearAllMocks())

  it('does not top up when balance already sufficient', async () => {
    mockDb.providerWallet = { findUnique: vi.fn().mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 3, promoCreditBalance: 5, status: 'ACTIVE' }) }
    mockDb.$transaction = vi.fn()

    const result = await ensureFannieHasCredits('prov-1', 5, 10, true)
    expect(result.toppedUp).toBe(false)
    expect(mockDb.$transaction).not.toHaveBeenCalled()
  })

  it('tops up when balance below minimum', async () => {
    mockDb.providerWallet = {
      findUnique: vi.fn().mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 1, promoCreditBalance: 1, status: 'ACTIVE' }),
      upsert: vi.fn().mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 1, promoCreditBalance: 1, status: 'ACTIVE' }),
      update: vi.fn().mockResolvedValueOnce({ id: 'w-1', paidCreditBalance: 1, promoCreditBalance: 11, status: 'ACTIVE' }),
    }
    mockDb.walletLedgerEntry = { create: vi.fn().mockResolvedValueOnce({ id: 'entry-1' }) }
    mockDb.$transaction = vi.fn().mockImplementation(async (fn: any) => fn(mockDb))

    const result = await ensureFannieHasCredits('prov-1', 5, 10, true)
    expect(result.toppedUp).toBe(true)
    expect(result.creditsAdded).toBe(10)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add findFannie and ensureFannieHasCredits to script**

Append to `scripts/seed-west-rand-test-leads.ts`:

```typescript
import { creditPromoCreditsInTransaction } from '../lib/provider-wallet'
import { MIN_PROMO_CREDITS, TOP_UP_PROMO_CREDITS } from './seed-west-rand-test-leads.config'

export async function findFannie(nameFragment: string) {
  return db.provider.findFirst({
    where: {
      name: { contains: nameFragment, mode: 'insensitive' },
      active: true,
    },
  })
}

export interface EnsureCreditsResult {
  toppedUp: boolean
  creditsAdded: number
  totalBalance: number
}

export async function ensureFannieHasCredits(
  providerId: string,
  minCredits: number,
  topUpCredits: number,
  commit: boolean,
): Promise<EnsureCreditsResult> {
  const wallet = await db.providerWallet.findUnique({ where: { providerId } })
  const total = (wallet?.paidCreditBalance ?? 0) + (wallet?.promoCreditBalance ?? 0)

  if (total >= minCredits) {
    return { toppedUp: false, creditsAdded: 0, totalBalance: total }
  }

  if (!commit) {
    return { toppedUp: false, creditsAdded: 0, totalBalance: total }
  }

  await db.$transaction(async (tx) => {
    await creditPromoCreditsInTransaction(tx, providerId, topUpCredits, {
      referenceType: 'seed-script',
      referenceId: `${COHORT}:promo-topup`,
      description: `Test seed top-up — ${COHORT}`,
      isTestTransaction: true,
      cohortName: COHORT,
      createdBy: 'system:seed-script',
    })
  })

  const updated = await db.providerWallet.findUnique({ where: { providerId } })
  const newTotal = (updated?.paidCreditBalance ?? 0) + (updated?.promoCreditBalance ?? 0)

  return { toppedUp: true, creditsAdded: topUpCredits, totalBalance: newTotal }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): findFannie + ensureFannieHasCredits utilities + tests"
```

---

## Task 11: Main orchestrator + CLI + safety guard + report printer

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.ts` (add `main()` and CLI)
- Modify: `__tests__/scripts/seed-west-rand-test-leads.test.ts` (add safety guard test)

- [ ] **Step 1: Write the safety guard test**

Append to `__tests__/scripts/seed-west-rand-test-leads.test.ts`:

```typescript
import { assertSafeToRun } from '../../scripts/seed-west-rand-test-leads'

describe('assertSafeToRun', () => {
  it('does not throw when ALLOW_TEST_DATA_IMPORT is true', () => {
    process.env.ALLOW_TEST_DATA_IMPORT = 'true'
    expect(() => assertSafeToRun(false)).not.toThrow()
    delete process.env.ALLOW_TEST_DATA_IMPORT
  })

  it('throws when ALLOW_TEST_DATA_IMPORT is missing and commit=true', () => {
    delete process.env.ALLOW_TEST_DATA_IMPORT
    expect(() => assertSafeToRun(true)).toThrow(/ALLOW_TEST_DATA_IMPORT/)
  })

  it('does not throw in dry-run regardless of env', () => {
    delete process.env.ALLOW_TEST_DATA_IMPORT
    expect(() => assertSafeToRun(false)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```

- [ ] **Step 3: Add assertSafeToRun + main() + CLI to script**

Add the following complete block at the top of `scripts/seed-west-rand-test-leads.ts` (before the utility exports):

```typescript
// ─── Imports (place at very top of file) ─────────────────────────────────────
// All imports must appear before other statements.
// Add to the top of the file only if not already present:
import { readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs'
import { join, basename, extname } from 'node:path'
```

Then append the following to the bottom of `scripts/seed-west-rand-test-leads.ts`:

```typescript
// ─── Safety guard ─────────────────────────────────────────────────────────────

export function assertSafeToRun(commit: boolean): void {
  if (!commit) return   // dry-runs are always safe
  if (process.env.ALLOW_TEST_DATA_IMPORT !== 'true') {
    throw new Error(
      'Refusing to write test data: set ALLOW_TEST_DATA_IMPORT=true to proceed.',
    )
  }
}

// ─── Report ───────────────────────────────────────────────────────────────────

export interface SeedReport {
  customers: Array<{ name: string; phone: string; id: string | null; created: boolean }>
  addresses: Array<{ customerId: string | null; suburb: string; created: boolean }>
  jobRequests: Array<{ customerId: string | null; category: string; id: string | null; created: boolean }>
  imagesClassified: ClassifiedImage[]
  imagesNeedsReview: string[]
  attachments: Array<{ jobRequestId: string; filename: string; attachmentId: string | null }>
  provider: { id: string | null; name: string | null; creditsAdded: number; totalCredits: number } | null
  leads: Array<{ leadId: string | null; jobRequestId: string; leadUrl: string | null; alreadyExisted: boolean }>
  warnings: string[]
}

export function printReport(report: SeedReport, commit: boolean): void {
  const mode = commit ? '[COMMIT]' : '[DRY-RUN]'
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Plug A Pro — West Rand Test Seed ${mode}`)
  console.log(`${'─'.repeat(60)}\n`)

  console.log('CUSTOMERS:')
  for (const c of report.customers) {
    const status = c.created ? 'created' : (c.id ? 'found' : 'would create')
    console.log(`  ${status.padEnd(14)} ${c.name} (${c.phone}) → id=${c.id ?? 'n/a'}`)
  }

  console.log('\nADDRESSES:')
  for (const a of report.addresses) {
    const status = a.created ? 'created' : 'found/skipped'
    console.log(`  ${status.padEnd(14)} ${a.suburb} (customerId=${a.customerId ?? 'n/a'})`)
  }

  console.log('\nJOB REQUESTS:')
  for (const jr of report.jobRequests) {
    const status = jr.created ? 'created' : (jr.id ? 'found' : 'would create')
    console.log(`  ${status.padEnd(14)} ${jr.category} → id=${jr.id ?? 'n/a'}`)
  }

  console.log('\nIMAGES:')
  console.log(`  classified    ${report.imagesClassified.length}`)
  for (const img of report.imagesClassified) {
    console.log(`    ✓ ${img.filename} → ${img.customerKey} [${img.entry.label}]`)
  }
  if (report.imagesNeedsReview.length > 0) {
    console.log(`  needs_review  ${report.imagesNeedsReview.length}`)
    for (const f of report.imagesNeedsReview) {
      console.log(`    ? ${f}  ← add to IMAGE_MAPPING in config`)
    }
  }

  console.log('\nATTACHMENTS:')
  for (const att of report.attachments) {
    const status = att.attachmentId ? 'uploaded' : 'would upload'
    console.log(`  ${status.padEnd(14)} ${att.filename} → jobRequest=${att.jobRequestId}`)
  }

  if (report.provider) {
    console.log('\nPROVIDER (Fannie):')
    console.log(`  id=${report.provider.id} name=${report.provider.name}`)
    console.log(`  credits added=${report.provider.creditsAdded}  total balance=${report.provider.totalCredits}`)
  } else {
    console.log('\nPROVIDER: ⚠ Fannie not found — check FANNIE_NAME_FRAGMENT in config')
  }

  console.log('\nLEADS:')
  for (const lead of report.leads) {
    if (lead.leadId) {
      const status = lead.alreadyExisted ? 'found' : 'created'
      console.log(`  ${status.padEnd(14)} leadId=${lead.leadId}`)
      if (lead.leadUrl) {
        console.log(`    URL: ${lead.leadUrl}`)
      }
    } else {
      console.log(`  would create  jobRequest=${lead.jobRequestId}`)
    }
  }

  if (report.warnings.length > 0) {
    console.log('\nWARNINGS:')
    for (const w of report.warnings) {
      console.log(`  ⚠ ${w}`)
    }
  }

  console.log(`\n${'─'.repeat(60)}\n`)
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2)
  const commit = args.includes('--commit') && !args.includes('--dry-run')
  const sendWhatsApp = args.includes('--send-whatsapp=true')
  const resetExisting = args.includes('--reset-existing=true')
  const imageDir = (() => {
    const flag = args.find((a) => a.startsWith('--image-dir='))
    return flag ? flag.split('=')[1] : '/Users/shimane/Desktop/defects/plugapro/images'
  })()

  if (sendWhatsApp) {
    throw new Error(
      'WhatsApp sending is not implemented in this seed script. ' +
      'Leads are created silently. Remove --send-whatsapp=true.',
    )
  }

  assertSafeToRun(commit)

  console.log(`Mode: ${commit ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Image dir: ${imageDir}`)

  // ─── Load config ────────────────────────────────────────────────────────────
  const {
    CUSTOMERS,
    IMAGE_MAPPING,
    FANNIE_NAME_FRAGMENT,
    MIN_PROMO_CREDITS,
    TOP_UP_PROMO_CREDITS,
  } = await import('./seed-west-rand-test-leads.config')

  const report: SeedReport = {
    customers: [], addresses: [], jobRequests: [],
    imagesClassified: [], imagesNeedsReview: [],
    attachments: [], provider: null, leads: [], warnings: [],
  }

  // ─── Scan and classify images ────────────────────────────────────────────────
  let imageFiles: string[] = []
  if (existsSync(imageDir)) {
    imageFiles = readdirSync(imageDir).filter((f) => /\.(png|jpg|jpeg|webp|heic)$/i.test(f))
  } else {
    report.warnings.push(`Image folder not found: ${imageDir}`)
  }

  const { classified, needsReview } = classifyImages(imageFiles, IMAGE_MAPPING)
  report.imagesClassified = classified
  report.imagesNeedsReview = needsReview

  // ─── Copy images to staging folder ──────────────────────────────────────────
  const stagingDir = join(process.cwd(), 'tmp', 'plugapro-test-import', 'images')
  if (commit && classified.length > 0) {
    mkdirSync(stagingDir, { recursive: true })
    for (const img of classified) {
      const customerConf = CUSTOMERS.find((c) => c.key === img.customerKey)!
      const slug = img.entry.label
      const destName = `${img.customerKey}-${slug}-${img.ext === 'png' ? img.baseName.slice(-4).toLowerCase() : img.baseName.slice(-4).toLowerCase()}.${img.ext}`
      copyFileSync(join(imageDir, img.filename), join(stagingDir, destName))
    }
  }

  // ─── Process each customer ───────────────────────────────────────────────────
  const customerContexts: Array<{
    config: typeof CUSTOMERS[number]
    customerId: string | null
    addressId: string | null
    jobRequestId: string | null
  }> = []

  for (const config of CUSTOMERS) {
    const custResult = await upsertCustomer(config, commit)
    report.customers.push({
      name: config.name, phone: config.phone,
      id: custResult.customer?.id ?? null,
      created: custResult.created,
    })

    let addressId: string | null = null
    if (custResult.customer) {
      const addrResult = await upsertAddress(custResult.customer.id, config.address, commit)
      report.addresses.push({
        customerId: custResult.customer.id,
        suburb: config.address.suburb,
        created: addrResult.created,
      })
      addressId = addrResult.address?.id ?? null
    } else {
      report.addresses.push({ customerId: null, suburb: config.address.suburb, created: false })
    }

    let jobRequestId: string | null = null
    if (custResult.customer) {
      const jrResult = await upsertJobRequest(
        custResult.customer,
        addressId ? { id: addressId } : null,
        config,
        commit,
      )
      report.jobRequests.push({
        customerId: custResult.customer.id,
        category: config.category,
        id: jrResult.jobRequest?.id ?? null,
        created: jrResult.created,
      })
      jobRequestId = jrResult.jobRequest?.id ?? null

      // Update JobRequest.status to MATCHING (so it's visible in matching flow)
      if (jrResult.jobRequest && commit && jrResult.created) {
        await db.jobRequest.update({
          where: { id: jrResult.jobRequest.id },
          data: { status: 'MATCHING' },
        })
      }
    } else {
      report.jobRequests.push({ customerId: null, category: config.category, id: null, created: false })
    }

    customerContexts.push({ config, customerId: custResult.customer?.id ?? null, addressId, jobRequestId })
  }

  // ─── Upload images ───────────────────────────────────────────────────────────
  for (const img of classified) {
    const ctx = customerContexts.find((c) => c.config.key === img.customerKey)
    if (!ctx?.jobRequestId) {
      report.warnings.push(`Skipping image ${img.filename}: no jobRequestId for ${img.customerKey}`)
      report.attachments.push({ jobRequestId: 'n/a', filename: img.filename, attachmentId: null })
      continue
    }

    // Skip if attachment already exists with this label for this request
    const existingAttachment = await db.attachment.findFirst({
      where: { jobRequestId: ctx.jobRequestId, label: img.entry.label },
    })
    if (existingAttachment) {
      report.attachments.push({
        jobRequestId: ctx.jobRequestId,
        filename: img.filename,
        attachmentId: existingAttachment.id,
      })
      continue
    }

    const attachment = await uploadAndAttach({
      jobRequestId: ctx.jobRequestId,
      imagePath: join(imageDir, img.filename),
      label: img.entry.label,
      caption: img.entry.caption ?? null,
      uploadedBy: 'system:seed-script',
      commit,
    })

    report.attachments.push({
      jobRequestId: ctx.jobRequestId,
      filename: img.filename,
      attachmentId: attachment?.id ?? null,
    })
  }

  // ─── Find Fannie + ensure credits ────────────────────────────────────────────
  const fannie = await findFannie(FANNIE_NAME_FRAGMENT)
  if (!fannie) {
    report.warnings.push(`Provider not found: name contains "${FANNIE_NAME_FRAGMENT}". Update FANNIE_NAME_FRAGMENT in config.`)
  }

  if (fannie) {
    const creditsResult = await ensureFannieHasCredits(
      fannie.id, MIN_PROMO_CREDITS, TOP_UP_PROMO_CREDITS, commit,
    )
    report.provider = {
      id: fannie.id,
      name: fannie.name,
      creditsAdded: creditsResult.creditsAdded,
      totalCredits: creditsResult.totalBalance,
    }
  }

  // ─── Create lead chains ───────────────────────────────────────────────────────
  if (fannie) {
    for (const ctx of customerContexts) {
      if (!ctx.jobRequestId) {
        report.leads.push({ leadId: null, jobRequestId: 'n/a', leadUrl: null, alreadyExisted: false })
        continue
      }

      const chainResult = await createLeadChain({
        jobRequestId: ctx.jobRequestId,
        provider: fannie,
        commit,
        resetExisting,
      })

      let leadUrl: string | null = null
      if (chainResult?.leadId) {
        const { createProviderLeadAccessToken, LEAD_RESPONSE_SCOPES } = await import('../lib/provider-lead-access')
        const appUrl = (
          process.env.PROVIDER_LEAD_APP_URL ||
          process.env.NEXT_PUBLIC_APP_URL ||
          'http://localhost:3000'
        ).replace(/\/+$/, '')

        const expiresAt = new Date(Date.now() + LEAD_TTL_MINUTES * 60_000)
        const token = createProviderLeadAccessToken({
          leadId: chainResult.leadId,
          providerId: fannie.id,
          jobRequestId: ctx.jobRequestId,
          providerPhone: fannie.phone,
          scopes: LEAD_RESPONSE_SCOPES,
          expiresAt,
        })
        leadUrl = `${appUrl}/leads/access/${encodeURIComponent(token)}`
      }

      report.leads.push({
        leadId: chainResult?.leadId ?? null,
        jobRequestId: ctx.jobRequestId,
        leadUrl,
        alreadyExisted: chainResult?.alreadyExisted ?? false,
      })
    }
  }

  printReport(report, commit)
  await db.$disconnect()
}

// ─── Entry point ──────────────────────────────────────────────────────────────
if (process.argv[1]?.includes('seed-west-rand-test-leads')) {
  main().catch((err) => {
    console.error('Seed script failed:', err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run all tests to confirm they pass**

```bash
cd field-service
pnpm test -- __tests__/scripts/seed-west-rand-test-leads.test.ts
```
Expected: all tests pass including `assertSafeToRun`.

- [ ] **Step 5: Commit**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.ts __tests__/scripts/seed-west-rand-test-leads.test.ts
git commit -m "feat(seed): main orchestrator, CLI args, safety guard, report printer"
```

---

## Task 12: Add npm scripts to package.json

**Files:**
- Modify: `field-service/package.json`

- [ ] **Step 1: Add scripts**

In `field-service/package.json`, inside the `"scripts"` block, add after the existing `"db:backfill-cases"` entry:

```json
"seed:test-leads": "tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --dry-run",
"seed:test-leads:commit": "ALLOW_TEST_DATA_IMPORT=true tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit",
"seed:test-leads:reset": "ALLOW_TEST_DATA_IMPORT=true tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit --reset-existing=true"
```

- [ ] **Step 2: Verify lint passes**

```bash
cd field-service
pnpm lint
```
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Run full test suite**

```bash
cd field-service
pnpm test
```
Expected: all tests pass including the new seed script tests.

- [ ] **Step 4: Dry-run smoke test (no DB writes)**

```bash
cd field-service
ALLOW_TEST_DATA_IMPORT=true npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --dry-run
```

Expected output (abbreviated):
```
Mode: DRY-RUN
Image dir: /Users/shimane/Desktop/defects/plugapro/images

────────────────────────────────────────────────────────────
Plug A Pro — West Rand Test Seed [DRY-RUN]
────────────────────────────────────────────────────────────

CUSTOMERS:
  would create   Masego Mataboge (+27827006695) → id=n/a
  would create   Seth Mataboge (+27764010810) → id=n/a
  would create   Emma Mafoko (+27824978565) → id=n/a

ADDRESSES:
  found/skipped  Ruimsig (customerId=n/a)
  found/skipped  Wilgeheuwel (customerId=n/a)
  found/skipped  Little Falls (customerId=n/a)

JOB REQUESTS:
  would create   plumbing → id=n/a
  would create   plumbing → id=n/a
  would create   handyman → id=n/a

IMAGES:
  classified    0
  needs_review  6
    ? 55B6FEAD-AE90-49AB-B9FA-823E994E5B2B.PNG  ← add to IMAGE_MAPPING in config
    ? 87A345AD-30F3-4EDE-A91D-208E6EA38F0F.PNG  ← add to IMAGE_MAPPING in config
    ? A4AFDD26-F45F-4BA7-80F4-F5DBB37AC471.PNG  ← add to IMAGE_MAPPING in config
    ? AD901123-5E38-4259-AEFB-4735644C7D7D.PNG  ← add to IMAGE_MAPPING in config
    ? B1E5333F-BBD8-4F9D-BEFB-B6CFB547A76B.PNG  ← add to IMAGE_MAPPING in config
    ? F5A063D4-71E0-4C3C-BE7F-BC9D854EF362.PNG  ← add to IMAGE_MAPPING in config

ATTACHMENTS:
  (none — update IMAGE_MAPPING in config)

PROVIDER (Fannie):
  (Fannie lookup runs against DB — verify in commit mode)

LEADS:
  would create  jobRequest=n/a
  would create  jobRequest=n/a
  would create  jobRequest=n/a

WARNINGS:
  ⚠ Image folder exists but IMAGE_MAPPING is empty. View images and add entries to config.
```

- [ ] **Step 5: Commit**

```bash
cd field-service
git add package.json
git commit -m "feat(seed): add seed:test-leads npm scripts"
```

---

## Task 13: Image classification — fill in IMAGE_MAPPING

**Files:**
- Modify: `scripts/seed-west-rand-test-leads.config.ts`

This task is **manual**. The 6 source images have UUID filenames with no naming hints.

- [ ] **Step 1: View all 6 images**

Open the folder and inspect each image:
```bash
open "/Users/shimane/Desktop/defects/plugapro/images"
```

The 6 files to classify:
```
55B6FEAD-AE90-49AB-B9FA-823E994E5B2B.PNG  (2.5 MB, Apr 28 13:01)
87A345AD-30F3-4EDE-A91D-208E6EA38F0F.PNG  (2.3 MB, Apr 28 13:01)
A4AFDD26-F45F-4BA7-80F4-F5DBB37AC471.PNG  (2.0 MB, Apr 28 14:01)
AD901123-5E38-4259-AEFB-4735644C7D7D.PNG  (1.5 MB, Apr 28 13:59)
B1E5333F-BBD8-4F9D-BEFB-B6CFB547A76B.PNG  (1.6 MB, Apr 28 13:59)
F5A063D4-71E0-4C3C-BE7F-BC9D854EF362.PNG  (1.6 MB, Apr 28 13:59)
```

- [ ] **Step 2: Fill in IMAGE_MAPPING in config**

Edit `scripts/seed-west-rand-test-leads.config.ts` and update `IMAGE_MAPPING` based on what you see. Example (fill in real mappings):

```typescript
export const IMAGE_MAPPING: Record<string, ImageMappingEntry> = {
  '55B6FEAD-AE90-49AB-B9FA-823E994E5B2B': {
    customerKey: 'masego-mataboge',
    label: 'evidence',
    caption: 'Blocked shower drain — standing water',
  },
  '87A345AD-30F3-4EDE-A91D-208E6EA38F0F': {
    customerKey: 'masego-mataboge',
    label: 'evidence',
    caption: 'Blocked shower drain — drain close-up',
  },
  // ... fill in remaining 4
}
```

If any image is ambiguous, leave it out of `IMAGE_MAPPING` — it will appear in the `needs_review` report.

- [ ] **Step 3: Re-run dry-run to confirm classification**

```bash
cd field-service
npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --dry-run
```
Expected: classified count reflects your mapping. No image appears in both classified and needs_review.

- [ ] **Step 4: Commit the filled mapping**

```bash
cd field-service
git add scripts/seed-west-rand-test-leads.config.ts
git commit -m "feat(seed): fill in IMAGE_MAPPING after manual image review"
```

---

## Task 14: Commit run + verification

**Files:** none (run the script, verify)

- [ ] **Step 1: Run commit mode**

```bash
cd field-service
ALLOW_TEST_DATA_IMPORT=true npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit
```

Expected output:
```
Mode: COMMIT
────────────────────────────────────────────────────────────
Plug A Pro — West Rand Test Seed [COMMIT]
────────────────────────────────────────────────────────────

CUSTOMERS:
  created        Masego Mataboge (+27827006695) → id=cma...
  created        Seth Mataboge (+27764010810) → id=cmb...
  created        Emma Mafoko (+27824978565) → id=cmc...
...
LEADS:
  created        leadId=cld...
    URL: http://localhost:3000/leads/access/eyJ...
  created        leadId=cle...
    URL: http://localhost:3000/leads/access/eyJ...
  created        leadId=clf...
    URL: http://localhost:3000/leads/access/eyJ...
```

- [ ] **Step 2: Rerun — confirm idempotency**

```bash
cd field-service
ALLOW_TEST_DATA_IMPORT=true npx tsx --env-file=.env.local scripts/seed-west-rand-test-leads.ts --commit
```
Expected: all records show `found` (not `created`). No duplicates. Same lead IDs.

- [ ] **Step 3: Open each lead URL in browser**

Open the three lead URLs printed in the report. Confirm:
- Lead preview page loads
- Category, suburb, and job description are visible
- Credit cost (1 credit) is shown
- Accept and Decline buttons are present
- Images are visible in the preview (if IMAGE_MAPPING was filled in)

- [ ] **Step 4: Test full acceptance journey**

1. Click Accept on one lead
2. Confirm 1 credit is deducted from Fannie's balance
3. Confirm full customer address is now visible
4. Confirm image(s) render at full resolution

- [ ] **Step 5: Test decline flow**

1. Open a second lead URL
2. Click Decline
3. Confirm lead status changes to DECLINED in the admin panel

- [ ] **Step 6: Final commit**

```bash
cd field-service
git add -A
git commit -m "test(seed): west-rand test leads verified — Fannie acceptance flow confirmed"
```

---

## Test case summary

All of these must pass before the task is closed:

| Test | Location | Type |
|------|----------|------|
| normalisePhone converts 0xx → +27 | vitest | unit |
| normalisePhone strips spaces/hyphens | vitest | unit |
| normalisePhone throws on non-SA number | vitest | unit |
| classifyImages returns correct split | vitest | unit |
| classifyImages reports needs_review | vitest | unit |
| buildAvailabilityWindow urgent = +2h..+4h | vitest | unit |
| buildAvailabilityWindow mornings = next-day 07–12 | vitest | unit |
| upsertCustomer returns existing | vitest (mocked DB) | unit |
| upsertCustomer creates with isTestUser=true | vitest (mocked DB) | unit |
| upsertCustomer skips in dry-run | vitest (mocked DB) | unit |
| upsertAddress finds existing | vitest (mocked DB) | unit |
| upsertAddress creates with lat/lng | vitest (mocked DB) | unit |
| upsertJobRequest returns existing | vitest (mocked DB) | unit |
| upsertJobRequest creates with cohortName | vitest (mocked DB) | unit |
| uploadAndAttach calls put with correct key | vitest (mocked blob) | unit |
| uploadAndAttach creates attachment record | vitest (mocked blob) | unit |
| uploadAndAttach skips in dry-run | vitest (mocked blob) | unit |
| createLeadChain skips in dry-run | vitest (mocked DB) | unit |
| createLeadChain returns existing SENT lead | vitest (mocked DB) | unit |
| createLeadChain creates all 4 records | vitest (mocked DB) | unit |
| assertSafeToRun allows dry-run without env | vitest | unit |
| assertSafeToRun throws on commit without env | vitest | unit |
| findFannie searches by name fragment | vitest (mocked DB) | unit |
| ensureFannieHasCredits skips when sufficient | vitest (mocked DB) | unit |
| ensureFannieHasCredits tops up via ledger | vitest (mocked DB) | unit |
| Dry-run prints plan without writes | manual | smoke |
| Commit creates 3 customers | manual | integration |
| Rerun is idempotent | manual | integration |
| Lead URLs open in browser | manual | e2e |
| Images render after acceptance | manual | e2e |
| Accept deducts 1 credit | manual | e2e |

---

## Self-review

**Spec coverage check:**

| Requirement | Covered by |
|-------------|-----------|
| Scans image folder | Task 11 (main: `readdirSync`) |
| Classifies images by config | Task 3 (`classifyImages`) |
| Renames/copies to staging folder | Task 11 (main: `copyFileSync`) |
| Uploads to correct storage bucket | Task 8 (`uploadAndAttach` with `job-requests/` prefix) |
| Creates customer records | Task 5 (`upsertCustomer`) |
| Creates address records | Task 6 (`upsertAddress`) |
| Creates service requests | Task 7 (`upsertJobRequest`) |
| Links images to requests | Task 8 (`uploadAndAttach` creates `Attachment`) |
| Creates lead/invite records | Task 9 (`createLeadChain`) |
| Repeatable without duplicates | All upserts check before creating; Lead unique index |
| `--dry-run` default | Task 11 (CLI: commit only when `--commit` present) |
| `--commit` flag | Task 11 |
| `--send-whatsapp=false` default | Task 11 (throws if `--send-whatsapp=true`) |
| No WhatsApp notifications | `createLeadChain` does NOT call `dispatchMatchLead` |
| No credits deducted at seed time | Credits only added (promo top-up), never debited |
| Safety guard: refuse against prod | Task 11 (`assertSafeToRun`) |
| Fannie has enough credits | Task 10 (`ensureFannieHasCredits`) |
| Lead expires in 30 min | `LEAD_TTL_MINUTES = 30` in config |
| Leads in SENT status (not accepted) | Task 9: `status: 'SENT'` |
| Phone normalised to E.164 | Task 2 (`normalisePhone`) |
| Proper-case addresses | Task 1 (config: `'Ruimsig'`, `'Gauteng'`, etc.) |
| West Rand areas | Task 1 (config: Ruimsig, Wilgeheuwel, Little Falls) |
| isTestLead / isTestRequest flags | Tasks 5, 7, 9 |
| cohortName for cleanup | All records: `'west-rand-pilot-seed'` |
| Needs-review report | Tasks 3, 11 (`imagesNeedsReview` in report) |

**Placeholder scan:** no TBDs, no "similar to above", all code is shown in full.

**Type consistency check:** `ClassifiedImage.customerKey` (string) used consistently in Tasks 3, 11. `CustomerConfig.key` (CustomerKey) matches `ImageMappingEntry.customerKey` (CustomerKey). `UpsertCustomerResult.customer` returns `{ id, phone, name }` — consumed in Task 11 correctly.

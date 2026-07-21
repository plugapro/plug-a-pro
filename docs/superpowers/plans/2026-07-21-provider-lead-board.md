# Provider Lead Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Job requests whose push offers all lapsed become browsable on `/provider/board`; in-area providers express interest (cap 3) which feeds the EXISTING Qualified Shortlist pipeline (customer picks → provider confirms → Match).

**Architecture:** The board is a pure eligibility query plus one interest action. Everything downstream — shortlist generation, customer WhatsApp notify, tokenized selection page, selected-provider notification, credit-charging acceptance — already exists in `lib/customer-shortlists.ts` / `lib/provider-opportunity-responses.ts` / `lib/matching/service.ts` and runs unflagged when called. We add: `Lead.origin` discriminator (additive), `lib/board/*` (eligibility + interest), the PWA page, and additive close-out of board leads inside the existing job-request expiry path.

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres, Vitest (fake-client idiom), existing WhatsApp interactive/template senders.

**Spec:** `docs/superpowers/specs/2026-07-21-provider-lead-board-design.md`

**Spec deltas (from subsystem discovery — reuse over rebuild):**
1. "I'm interested" collects `callOutFee` + `estimatedArrivalAt` (the existing `ProviderLeadResponse` requires them and the shortlist ranks by fee).
2. Non-selected shortlist providers are NOT closed at selection — existing deliberate cascade design (fallback if the selected provider declines). They close at job resolution/expiry.
3. NO new Meta template: customer notify reuses `notifyCustomerShortlistReady()` (`interactive:client_shortlist_ready` / `_cta`). Flag-flip gate becomes: verify that send path reaches web-origin (out-of-session) customers in staging before flipping.

## Global Constraints

- **DATA SAFETY (user-mandated): no data deletion, no destructive operations, anywhere.** No `delete`/`deleteMany` calls, no schema drops/renames, no updates to rows outside this feature's own flow. Migration is additive-only (`ADD COLUMN`). Existing rows are only ever read, or status-updated where the spec's lifecycle demands it (board-origin leads at expiry).
- Everything user-visible behind flag `provider.board.v1`, default **OFF** (registry `defaultValue: false`, `owner: 'prod'`).
- Cap **3** open interests per job request, enforced atomically; one interest per (jobRequestId, providerId) — the DB already enforces `@@unique([jobRequestId, providerId])` on `leads`.
- Pre-selection privacy: suburb label only; no customer name/phone/street address/access notes on any board surface.
- Board eligibility (spec §1) verbatim: `status IN (OPEN, MATCHING)`; `expiresAt` null-or-future; `requestedWindowEnd` null-or-future; no Match; no ACTIVE AssignmentHold; no live push lead (`SENT`/`VIEWED` with future `expiresAt`); ≥1 lead row exists (push was attempted); fewer than 3 leads in (`INTERESTED`,`SHORTLISTED`,`CUSTOMER_SELECTED`).
- KYC/credits untouched: both stay in the existing acceptance step (`acceptAssignmentOffer`).
- No `as any` without adjacent TODO. All commands from `field-service/`. Tests: `./node_modules/.bin/vitest run <path>`. Work in worktree `worktrees/provider-lead-board` off `main`.

---

### Task 1: `Lead.origin` column + `provider.board.v1` flag

**Files:**
- Modify: `prisma/schema.prisma` (Lead model, after `status`)
- Create: `prisma/migrations/<UTC-timestamp>_lead_origin/migration.sql` (hand-written; no local DB — same procedure as the funnel-hardening migrations)
- Modify: `lib/feature-flags-registry.ts`

**Interfaces:**
- Produces: `Lead.origin: String @default("PUSH")` (values `"PUSH"` | `"BOARD"`), flag key `provider.board.v1`. Tasks 2–5 rely on both.

- [ ] **Step 1: Schema + migration**

In the `Lead` model directly under `status`:

```prisma
  origin                  String     @default("PUSH") // "PUSH" (cron dispatch) | "BOARD" (provider self-serve pull)
```

Create `prisma/migrations/$(date -u +%Y%m%d%H%M%S)_lead_origin/migration.sql` (timestamp must sort after the newest existing folder):

```sql
-- Additive only: pull-based lead board discriminator. Existing rows default to PUSH.
ALTER TABLE "public"."leads" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'PUSH';
```

Run: `pnpm prisma generate && pnpm prisma validate` — both clean. (Live-DB apply is a pre-deploy gate, as with the nudge migration.)

- [ ] **Step 2: Flag registry**

In `lib/feature-flags-registry.ts`, matching neighbour shape exactly (copy `qualified_shortlist.auto_trigger`'s structure):

```ts
  'provider.board.v1': {
    description:
      'Provider lead board: /provider/board pull surface for job requests whose push offers lapsed. OFF until customer-notify path verified for web-origin customers.',
    owner: 'prod',
    defaultValue: false,
  },
```

(seed-flags auto-includes registry keys; no seed edit needed — verified in the funnel-hardening work.)

- [ ] **Step 3: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit`
Expected: clean.

```bash
git add prisma/schema.prisma prisma/migrations lib/feature-flags-registry.ts
git commit -m "feat(board): Lead.origin discriminator + provider.board.v1 flag (default OFF)"
```

---

### Task 2: Board eligibility query — `lib/board/eligibility.ts`

**Files:**
- Create: `lib/board/eligibility.ts`
- Test: `__tests__/lib/board/eligibility.test.ts`

**Interfaces:**
- Produces:
  - `boardEligibilityWhere(now: Date): Prisma.JobRequestWhereInput`-shaped object (plain object; no Prisma import needed in tests)
  - `findBoardJobsForProvider(client, providerId: string, filters?: { category?: string; suburbQuery?: string }): Promise<BoardJob[]>` where `BoardJob = { id, category, title, description, suburbLabel, requestedWindowStart, requestedWindowEnd, createdAt, interestCount }`
- Consumes: `technician_service_areas` rows (`locationNodeId`, `suburbKey`, `areaType`, `lat/lng/radiusKm`), `JobRequest.address` relation (`locationNodeId`, suburb label field), `pointFallsWithinRadius` from `lib/matching/geography.ts`.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/board/eligibility.test.ts` (fake-client idiom per `__tests__/lib/provider-registration/draft-phone-reuse.test.ts`):

```ts
import { describe, expect, it, vi } from 'vitest'
import { boardEligibilityWhere, findBoardJobsForProvider } from '@/lib/board/eligibility'

const NOW = new Date('2026-07-21T12:00:00Z')

describe('boardEligibilityWhere', () => {
  const where = boardEligibilityWhere(NOW) as any

  it('only OPEN/MATCHING requests', () => {
    expect(where.status).toEqual({ in: ['OPEN', 'MATCHING'] })
  })

  it('excludes past-due windows and expired requests (null allowed)', () => {
    expect(where.AND).toEqual(
      expect.arrayContaining([
        { OR: [{ expiresAt: null }, { expiresAt: { gt: NOW } }] },
        { OR: [{ requestedWindowEnd: null }, { requestedWindowEnd: { gt: NOW } }] },
      ]),
    )
  })

  it('excludes matched requests and live push offers', () => {
    expect(where.match).toBeNull()
    expect(where.assignmentHolds).toEqual({ none: { status: 'ACTIVE' } })
    expect(where.leads).toEqual(
      expect.objectContaining({
        none: expect.objectContaining({
          status: { in: ['SENT', 'VIEWED'] },
          expiresAt: { gt: NOW },
        }),
      }),
    )
  })

  it('requires at least one push attempt via the some-leads clause', () => {
    expect(where.AND).toEqual(
      expect.arrayContaining([expect.objectContaining({ leads: { some: {} } })]),
    )
  })
})

describe('findBoardJobsForProvider', () => {
  function client(overrides: Record<string, any> = {}) {
    return {
      provider: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'p1', active: true, verified: true,
          skills: ['plumbing', 'painting'],
        }),
      },
      technicianServiceArea: {
        findMany: vi.fn().mockResolvedValue([
          { locationNodeId: 'node-ruimsig', suburbKey: 'ruimsig', areaType: 'SUBURB', lat: null, lng: null, radiusKm: null },
        ]),
      },
      jobRequest: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'jr1', category: 'plumbing', title: 'Burst geyser', description: 'Geyser burst in roof',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-ruimsig', suburb: 'Ruimsig', lat: null, lng: null },
            leads: [{ status: 'INTERESTED' }],
          },
          {
            id: 'jr2', category: 'plumbing', title: 'Tap', description: 'Leaky tap',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-elsewhere', suburb: 'Sandton', lat: null, lng: null },
            leads: [],
          },
          {
            id: 'jr3', category: 'garden', title: 'Lawn', description: 'Mow lawn',
            requestedWindowStart: null, requestedWindowEnd: null, createdAt: NOW,
            address: { locationNodeId: 'node-ruimsig', suburb: 'Ruimsig', lat: null, lng: null },
            leads: [],
          },
        ]),
      },
      ...overrides,
    } as any // TODO: fake client for unit test
  }

  it('returns only in-area, skill-matched jobs with interest counts', async () => {
    const jobs = await findBoardJobsForProvider(client(), 'p1', {}, NOW)
    expect(jobs.map((j) => j.id)).toEqual(['jr1']) // jr2 out of area, jr3 not a skill
    expect(jobs[0]).toMatchObject({ suburbLabel: 'Ruimsig', interestCount: 1 })
    expect(jobs[0]).not.toHaveProperty('address') // privacy: no raw address object leaves the lib
  })

  it('applies the category filter on top of skills', async () => {
    const jobs = await findBoardJobsForProvider(client(), 'p1', { category: 'painting' }, NOW)
    expect(jobs).toEqual([]) // jr1 is plumbing
  })

  it('returns [] for inactive or unverified providers', async () => {
    const c = client()
    c.provider.findUnique.mockResolvedValue({ id: 'p1', active: false, verified: true, skills: ['plumbing'] })
    expect(await findBoardJobsForProvider(c, 'p1', {}, NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/board/eligibility.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/board/eligibility.ts`**

```ts
// Provider lead board: pure eligibility query over job requests whose push
// offers all lapsed. Spec: docs/superpowers/specs/2026-07-21-provider-lead-board-design.md §1.
// READ-ONLY module: no writes of any kind live here (data-safety constraint).
import { pointFallsWithinRadius } from '@/lib/matching/geography'

const OPEN_INTEREST_STATUSES = ['INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED'] as const
export const BOARD_INTEREST_CAP = 3

export function boardEligibilityWhere(now: Date) {
  return {
    status: { in: ['OPEN', 'MATCHING'] },
    match: null,
    assignmentHolds: { none: { status: 'ACTIVE' } },
    leads: { none: { status: { in: ['SENT', 'VIEWED'] }, expiresAt: { gt: now } } },
    AND: [
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      { OR: [{ requestedWindowEnd: null }, { requestedWindowEnd: { gt: now } }] },
      { leads: { some: {} } }, // push was attempted at least once
    ],
  }
}

export type BoardJob = {
  id: string
  category: string
  title: string | null
  description: string | null
  suburbLabel: string | null
  requestedWindowStart: Date | null
  requestedWindowEnd: Date | null
  createdAt: Date
  interestCount: number
}

type BoardFilters = { category?: string; suburbQuery?: string }

export async function findBoardJobsForProvider(
  client: any, // TODO: narrow to the Prisma Pick actually used; kept wide for DI in unit tests
  providerId: string,
  filters: BoardFilters = {},
  now: Date = new Date(),
): Promise<BoardJob[]> {
  const provider = await client.provider.findUnique({
    where: { id: providerId },
    select: { id: true, active: true, verified: true, skills: true },
  })
  if (!provider?.active || !provider.verified) return []

  const areas = await client.technicianServiceArea.findMany({
    where: { providerId },
    select: { locationNodeId: true, suburbKey: true, areaType: true, lat: true, lng: true, radiusKm: true },
  })
  if (areas.length === 0) return []

  const nodeIds = new Set(areas.map((a: any) => a.locationNodeId).filter(Boolean))
  const suburbKeys = new Set(
    areas.map((a: any) => (a.suburbKey ?? '').toLowerCase()).filter(Boolean),
  )
  const radiusAreas = areas.filter(
    (a: any) => a.areaType === 'RADIUS' && a.lat != null && a.lng != null && a.radiusKm != null,
  )

  const skills = new Set((provider.skills ?? []).map((s: string) => s.toLowerCase()))

  const candidates = await client.jobRequest.findMany({
    where: {
      ...boardEligibilityWhere(now),
      ...(filters.category ? { category: filters.category } : {}),
    },
    select: {
      id: true, category: true, title: true, description: true,
      requestedWindowStart: true, requestedWindowEnd: true, createdAt: true,
      address: { select: { locationNodeId: true, suburb: true, lat: true, lng: true } },
      leads: { where: { status: { in: [...OPEN_INTEREST_STATUSES] } }, select: { status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  const q = (filters.suburbQuery ?? '').trim().toLowerCase()

  return candidates
    .filter((jr: any) => skills.has(String(jr.category ?? '').toLowerCase()))
    .filter((jr: any) => {
      const addr = jr.address
      if (!addr) return false
      if (addr.locationNodeId && nodeIds.has(addr.locationNodeId)) return true
      if (addr.suburb && suburbKeys.has(String(addr.suburb).toLowerCase())) return true
      if (addr.lat != null && addr.lng != null) {
        return radiusAreas.some((a: any) =>
          pointFallsWithinRadius({
            center: { lat: a.lat, lng: a.lng },
            point: { lat: addr.lat, lng: addr.lng },
            radiusKm: a.radiusKm,
          }),
        )
      }
      return false
    })
    .filter((jr: any) => jr.leads.length < BOARD_INTEREST_CAP)
    .filter((jr: any) => (q ? String(jr.address?.suburb ?? '').toLowerCase().includes(q) : true))
    .map((jr: any) => ({
      id: jr.id,
      category: jr.category,
      title: jr.title,
      description: jr.description,
      suburbLabel: jr.address?.suburb ?? null,
      requestedWindowStart: jr.requestedWindowStart,
      requestedWindowEnd: jr.requestedWindowEnd,
      createdAt: jr.createdAt,
      interestCount: jr.leads.length,
    }))
}
```

Verify field names against schema before committing: the relation on JobRequest for holds (`assignmentHolds`), the singular `match` relation, and the Address suburb field (may be `suburb`/`suburbLabel`/`label` — check `prisma/schema.prisma` Address model and adjust BOTH the code and the test fixtures to the real name).

- [ ] **Step 4: Run tests to verify pass**

Run: `./node_modules/.bin/vitest run __tests__/lib/board/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/board/eligibility.ts __tests__/lib/board/eligibility.test.ts
git commit -m "feat(board): read-only board eligibility query with area/skill/cap filtering"
```

---

### Task 3: Express interest — `lib/board/interest.ts`

**Files:**
- Create: `lib/board/interest.ts`
- Test: `__tests__/lib/board/interest.test.ts`

**Interfaces:**
- Consumes: Task 2's `boardEligibilityWhere`, `BOARD_INTEREST_CAP`; existing `respondToProviderOpportunity` (`lib/provider-opportunity-responses.ts:126` — records `ProviderLeadResponse`, flips lead → INTERESTED, and via `maybeAutoTriggerShortlist` may generate the shortlist); existing `generateCustomerShortlistForRequest` + `notifyCustomerShortlistReady` (`lib/customer-shortlists.ts`).
- Produces: `expressBoardInterest(deps, { providerId, jobRequestId, callOutFee, estimatedArrivalAt, note? }): Promise<{ ok: true; leadId: string } | { ok: false; reason: 'FLAG_OFF' | 'NOT_ELIGIBLE_PROVIDER' | 'JOB_GONE' | 'SHORTLIST_FULL' | 'ALREADY_INTERESTED' }>` — DI-shaped like `runDraftAbandonmentNudge` so every branch unit-tests without Prisma.

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/board/interest.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { expressBoardInterest } from '@/lib/board/interest'

const NOW = new Date('2026-07-21T12:00:00Z')

function deps(overrides: Record<string, any> = {}) {
  const tx = {
    jobRequest: { findFirst: vi.fn().mockResolvedValue({ id: 'jr1', category: 'plumbing' }) },
    lead: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue(null), // no prior lead for (jr1, p1)
      create: vi.fn().mockResolvedValue({ id: 'lead-new' }),
      update: vi.fn().mockResolvedValue({ id: 'lead-revived' }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  }
  return {
    now: () => NOW,
    db: { $transaction: vi.fn(async (fn: any) => fn(tx)), _tx: tx },
    flagEnabled: vi.fn().mockResolvedValue(true),
    isProviderBoardEligible: vi.fn().mockResolvedValue(true), // active+verified+in-area+skill (Task 2 logic)
    recordInterest: vi.fn().mockResolvedValue({ ok: true }),   // respondToProviderOpportunity wrapper
    triggerShortlist: vi.fn().mockResolvedValue(undefined),    // generate + notify customer
    ...overrides,
  } as any // TODO: fake deps for unit test
}

const input = {
  providerId: 'p1', jobRequestId: 'jr1',
  callOutFee: 350, estimatedArrivalAt: new Date('2026-07-21T15:00:00Z'),
}

describe('expressBoardInterest', () => {
  it('flag off → FLAG_OFF, zero DB work', async () => {
    const d = deps({ flagEnabled: vi.fn().mockResolvedValue(false) })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'FLAG_OFF' })
    expect(d.db.$transaction).not.toHaveBeenCalled()
  })

  it('creates a BOARD-origin lead, records interest, triggers shortlist + audit', async () => {
    const d = deps()
    const result = await expressBoardInterest(d, input)
    expect(result).toEqual({ ok: true, leadId: 'lead-new' })
    expect(d.db._tx.lead.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jobRequestId: 'jr1', providerId: 'p1', origin: 'BOARD', status: 'VIEWED',
        }),
      }),
    )
    expect(d.recordInterest).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 'lead-new', callOutFee: 350 }),
    )
    expect(d.triggerShortlist).toHaveBeenCalledWith('jr1')
    expect(d.db._tx.auditLog.create).toHaveBeenCalled()
  })

  it('shortlist full at 3 → SHORTLIST_FULL, no lead created', async () => {
    const d = deps()
    d.db._tx.lead.count.mockResolvedValue(3)
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'SHORTLIST_FULL' })
    expect(d.db._tx.lead.create).not.toHaveBeenCalled()
  })

  it('job no longer eligible → JOB_GONE', async () => {
    const d = deps()
    d.db._tx.jobRequest.findFirst.mockResolvedValue(null)
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'JOB_GONE' })
  })

  it('revives a terminal prior lead for the same provider instead of creating (unique constraint)', async () => {
    const d = deps()
    d.db._tx.lead.findUnique.mockResolvedValue({ id: 'old-lead', status: 'EXPIRED' })
    const result = await expressBoardInterest(d, input)
    expect(result).toEqual({ ok: true, leadId: 'old-lead' })
    expect(d.db._tx.lead.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'old-lead' },
        data: expect.objectContaining({ origin: 'BOARD', status: 'VIEWED' }),
      }),
    )
    expect(d.db._tx.lead.create).not.toHaveBeenCalled()
  })

  it('prior lead already in an open state → ALREADY_INTERESTED', async () => {
    const d = deps()
    d.db._tx.lead.findUnique.mockResolvedValue({ id: 'old-lead', status: 'INTERESTED' })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'ALREADY_INTERESTED' })
  })

  it('ineligible provider → NOT_ELIGIBLE_PROVIDER before any transaction', async () => {
    const d = deps({ isProviderBoardEligible: vi.fn().mockResolvedValue(false) })
    expect(await expressBoardInterest(d, input)).toEqual({ ok: false, reason: 'NOT_ELIGIBLE_PROVIDER' })
    expect(d.db.$transaction).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `./node_modules/.bin/vitest run __tests__/lib/board/interest.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `lib/board/interest.ts`**

```ts
// Provider lead board: express-interest action. Creates/revives a BOARD-origin
// Lead, then feeds the EXISTING Qualified Shortlist pipeline (interest record,
// shortlist generation, customer notify). No deletes anywhere (data-safety).
import { boardEligibilityWhere, BOARD_INTEREST_CAP } from '@/lib/board/eligibility'

const OPEN_LEAD_STATUSES = [
  'SENT', 'VIEWED', 'INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED',
  'PROVIDER_ACCEPTED', 'CREDIT_REQUIRED', 'CREDIT_APPLIED', 'ACCEPTED_LOCKED', 'ACCEPTED',
  'SEND_PENDING', 'SEND_FAILED',
]
const OPEN_INTEREST_STATUSES = ['INTERESTED', 'SHORTLISTED', 'CUSTOMER_SELECTED']

export type BoardInterestInput = {
  providerId: string
  jobRequestId: string
  callOutFee: number
  estimatedArrivalAt: Date
  note?: string
}

export type BoardInterestDeps = {
  now: () => Date
  db: any // TODO: narrow to the Prisma Pick actually used; kept wide for DI in unit tests
  flagEnabled: (key: string) => Promise<boolean>
  /** active + verified + job in provider's area + category in skills (reuses Task 2 logic) */
  isProviderBoardEligible: (providerId: string, jobRequestId: string) => Promise<boolean>
  /** wraps respondToProviderOpportunity: records ProviderLeadResponse + flips lead → INTERESTED */
  recordInterest: (args: { leadId: string; providerId: string; callOutFee: number; estimatedArrivalAt: Date; note?: string }) => Promise<{ ok: boolean }>
  /** generate + publish shortlist and notify customer (idempotent per generateCustomerShortlistForRequest) */
  triggerShortlist: (jobRequestId: string) => Promise<void>
}

export async function expressBoardInterest(deps: BoardInterestDeps, input: BoardInterestInput) {
  if (!(await deps.flagEnabled('provider.board.v1'))) return { ok: false as const, reason: 'FLAG_OFF' as const }
  if (!(await deps.isProviderBoardEligible(input.providerId, input.jobRequestId))) {
    return { ok: false as const, reason: 'NOT_ELIGIBLE_PROVIDER' as const }
  }
  const now = deps.now()

  const outcome = await deps.db.$transaction(async (tx: any) => {
    const job = await tx.jobRequest.findFirst({
      where: { id: input.jobRequestId, ...boardEligibilityWhere(now) },
      select: { id: true, category: true },
    })
    if (!job) return { ok: false as const, reason: 'JOB_GONE' as const }

    const openInterests = await tx.lead.count({
      where: { jobRequestId: input.jobRequestId, status: { in: OPEN_INTEREST_STATUSES } },
    })
    if (openInterests >= BOARD_INTEREST_CAP) return { ok: false as const, reason: 'SHORTLIST_FULL' as const }

    const prior = await tx.lead.findUnique({
      where: { jobRequestId_providerId: { jobRequestId: input.jobRequestId, providerId: input.providerId } },
      select: { id: true, status: true },
    })

    let leadId: string
    if (prior) {
      if (OPEN_LEAD_STATUSES.includes(String(prior.status))) {
        return { ok: false as const, reason: 'ALREADY_INTERESTED' as const }
      }
      // Terminal prior lead (EXPIRED/DECLINED/CANCELLED/SUPERSEDED): revive it —
      // the unique (jobRequestId, providerId) constraint forbids a second row.
      await tx.lead.update({
        where: { id: prior.id },
        data: { origin: 'BOARD', status: 'VIEWED', viewedAt: now, respondedAt: null, expiresAt: null },
      })
      leadId = prior.id
    } else {
      const created = await tx.lead.create({
        data: {
          jobRequestId: input.jobRequestId,
          providerId: input.providerId,
          origin: 'BOARD',
          status: 'VIEWED',
          sentAt: now,
          viewedAt: now,
        },
        select: { id: true },
      })
      leadId = created.id
    }

    await tx.auditLog.create({
      data: {
        actorId: input.providerId, actorRole: 'provider',
        action: 'lead.board_interest_created',
        entityType: 'Lead', entityId: leadId,
        after: { jobRequestId: input.jobRequestId, callOutFee: input.callOutFee },
      },
    }).catch(() => {})

    return { ok: true as const, leadId }
  })

  if (!outcome.ok) return outcome

  // Outside the row transaction (matches existing respondToProviderOpportunity usage):
  await deps.recordInterest({
    leadId: outcome.leadId, providerId: input.providerId,
    callOutFee: input.callOutFee, estimatedArrivalAt: input.estimatedArrivalAt, note: input.note,
  })
  await deps.triggerShortlist(input.jobRequestId)
  return outcome
}
```

Then add the production wiring in the same file (thin, verified against real signatures at implementation time):

```ts
// Production deps: wire the DI seams to the real modules and export
//   expressBoardInterestProduction(input: BoardInterestInput)
// which calls expressBoardInterest with { now, db, flagEnabled: isEnabled,
// isProviderBoardEligible (built on Task 2's findBoardJobsForProvider or its
// area/skill internals), recordInterest (respondToProviderOpportunity),
// triggerShortlist (generateCustomerShortlistForRequest +
// notifyCustomerShortlistReady) }. Verify the exact exported names/signatures
// in lib/provider-opportunity-responses.ts and lib/customer-shortlists.ts;
// call the notify step ONLY when generate reports a newly published shortlist,
// mirroring how maybeAutoTriggerShortlist sequences them.
```

Adapt `respondToProviderOpportunity`'s lead-state guard if it rejects VIEWED board leads — additively (accept `origin: 'BOARD'` leads in VIEWED state), never loosening the push path.

Also verify the AuditLog `actorRole` value: grep an existing provider-actor audit write and match its exact casing.

- [ ] **Step 4: Run tests to verify pass**

Run: `./node_modules/.bin/vitest run __tests__/lib/board/`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/board/interest.ts __tests__/lib/board/interest.test.ts lib/provider-opportunity-responses.ts
git commit -m "feat(board): express-interest action feeding existing shortlist pipeline (cap 3, revive-not-duplicate)"
```

---

### Task 4: PWA page `/provider/board`

**Files:**
- Create: `app/(provider)/provider/board/page.tsx`
- Create: `app/(provider)/provider/board/actions.ts` (server action wrapping Task 3)
- Modify: the provider nav/dashboard entry point that links to `/provider/leads` (add a "Job board" link, flag-gated) — locate via grep for `href="/provider/leads"` and mirror
- Test: `__tests__/lib/board/board-page-access.test.ts` (page-level logic extracted where practical)

**Interfaces:**
- Consumes: `findBoardJobsForProvider` (Task 2), `expressBoardInterest` production wiring (Task 3), `requireProvider` from `@/lib/auth`, flag reader `isEnabled` from `@/lib/flags`.

- [ ] **Step 1: Page skeleton (mirror `/app/(provider)/provider/leads/page.tsx` conventions exactly)**

`page.tsx` (server component):

```tsx
import { notFound } from 'next/navigation'
import { requireProvider } from '@/lib/auth'
import { isEnabled } from '@/lib/flags'
import { db } from '@/lib/db'
import { findBoardJobsForProvider } from '@/lib/board/eligibility'

export const dynamic = 'force-dynamic'

export default async function ProviderBoardPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[]; q?: string | string[] }>
}) {
  if (!(await isEnabled('provider.board.v1'))) notFound()
  const provider = await requireProvider()
  const params = await searchParams
  const category = typeof params.category === 'string' ? params.category : undefined
  const suburbQuery = typeof params.q === 'string' ? params.q : undefined

  const jobs = await findBoardJobsForProvider(db, provider.id, { category, suburbQuery })
  // render: header "Job board", category select (provider's own skills),
  // suburb search input (GET form), then cards. Card fields ONLY:
  // category, title, truncated description, suburbLabel, requested window,
  // posted-ago, `${interestCount}/3 interested`, and an "I'm interested"
  // affordance opening the interest form (callOutFee + estimatedArrivalAt + note).
  // Copy the card/list styling from provider/leads/page.tsx verbatim.
  ...
}
```

(The rendering body is written by matching the leads page's existing JSX card structure — copy its classes/components; the page must never render customer name, phone, street address, or access notes: the `BoardJob` type physically cannot carry them, which is the enforcement.)

`actions.ts`:

```ts
'use server'
import { requireProvider } from '@/lib/auth'
import { expressBoardInterestProduction } from '@/lib/board/interest' // the wired variant from Task 3
import { revalidatePath } from 'next/cache'

export async function expressInterestAction(formData: FormData) {
  const provider = await requireProvider()
  const jobRequestId = String(formData.get('jobRequestId') ?? '')
  const callOutFee = Number(formData.get('callOutFee'))
  const estimatedArrivalAt = new Date(String(formData.get('estimatedArrivalAt') ?? ''))
  const note = String(formData.get('note') ?? '') || undefined
  if (!jobRequestId || !Number.isFinite(callOutFee) || callOutFee < 0 || isNaN(estimatedArrivalAt.getTime())) {
    return { ok: false as const, reason: 'INVALID_INPUT' as const }
  }
  const result = await expressBoardInterestProduction({
    providerId: provider.id, jobRequestId, callOutFee, estimatedArrivalAt, note,
  })
  revalidatePath('/provider/board')
  return result
}
```

Map each failure reason to friendly copy in the page (SHORTLIST_FULL → "This job's shortlist just filled up", JOB_GONE → "This job is no longer available", ALREADY_INTERESTED → "You've already raised your hand for this one").

- [ ] **Step 2: Typecheck + targeted tests + lint**

Run: `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/vitest run __tests__/lib/board/ && ./node_modules/.bin/eslint app/\(provider\)/provider/board lib/board`
Expected: clean, green.

- [ ] **Step 3: Commit**

```bash
git add "app/(provider)/provider/board" lib/board __tests__/lib/board
git commit -m "feat(board): /provider/board page + interest server action (flag-gated, privacy-safe cards)"
```

---

### Task 5: Close-out on expiry (additive, no deletes)

**Files:**
- Modify: `lib/job-requests/expire-job-request.ts` (`expireOpenJobRequest`)
- Test: extend the existing test file covering `expireOpenJobRequest` (locate via grep `expire-job-request` in `__tests__/`; if none exists, create `__tests__/lib/job-requests/expire-job-request-board.test.ts` with a fake client)

**Interfaces:**
- Consumes: existing `expireOpenJobRequest(jobRequestId, reason)`.
- Produces: same signature; additionally flips this job's open board-origin leads (`origin: 'BOARD'`, status in `INTERESTED`/`SHORTLISTED`/`VIEWED`) to `EXPIRED` with `expiredAt`, and best-effort sends each affected provider a courteous session text ("That job in <suburb> is no longer available — more jobs are on your board.") — swallow send failures, never block expiry.

- [ ] **Step 1: Write the failing test** — fixture: job with two leads (one `origin: 'BOARD'`/`INTERESTED`, one `origin: 'PUSH'`/`EXPIRED` already); assert after `expireOpenJobRequest`: board lead updated to `EXPIRED` (updateMany with `where: { jobRequestId, origin: 'BOARD', status: { in: ['VIEWED','INTERESTED','SHORTLISTED'] } }`), push lead untouched, NO delete calls on any model (spy every `.delete`/`.deleteMany` on the fake client and assert never called — this encodes the data-safety constraint as a test).

- [ ] **Step 2: Verify fail** — `./node_modules/.bin/vitest run <the test file>`: FAIL.

- [ ] **Step 3: Implement** — inside the existing expiry transaction, add the `updateMany` + post-transaction best-effort notify loop (reuse `sendText` from `@/lib/whatsapp-interactive`, `.catch(() => {})` per send). No other changes to the function.

- [ ] **Step 4: Verify pass + neighbours** — run the file plus any existing expire/match-leads test suites touching this module. All green.

- [ ] **Step 5: Commit**

```bash
git add lib/job-requests/expire-job-request.ts __tests__/lib/job-requests
git commit -m "feat(board): expire open board leads on job expiry with courteous notify (additive, zero deletes)"
```

---

### Task 6: Verification sweep + smoke coverage

**Files:**
- Modify: `e2e/smoke.spec.ts` (add `/provider/board` to the route inventory — expects 404/redirect while flag OFF; keep assertion aligned with how other flag-gated routes are smoked, house rule 6)

- [ ] **Step 1:** `./node_modules/.bin/vitest run` — full suite, 0 failures.
- [ ] **Step 2:** `./node_modules/.bin/tsc --noEmit && ./node_modules/.bin/eslint . && ./node_modules/.bin/next build` — all clean.
- [ ] **Step 3:** `grep -rn "deleteMany\|\.delete(" lib/board app/\(provider\)/provider/board` — expect ZERO matches (data-safety constraint, mechanical proof).
- [ ] **Step 4:** `git status --short` clean (ledger excepted); commit smoke change; hand off via superpowers:finishing-a-development-branch.

## Post-merge operational sequence (human-gated)

1. Apply the `lead_origin` migration against dev/staging DB before prod deploy (same gate as prior hand-written migrations).
2. Staging verification: with flag ON in staging only, walk one job end-to-end (board interest → customer shortlist WhatsApp → selection → provider confirm) — especially confirming `notifyCustomerShortlistReady` reaches a WEB-origin customer (out-of-session template path).
3. Flip `provider.board.v1` ON in prod. No Meta template submission needed (existing templates).

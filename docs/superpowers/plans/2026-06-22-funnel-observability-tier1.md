# Client Funnel Observability — Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the existing `WorkflowEvent` table into 7 customer-funnel stages and ship a read-only `/admin/reports/funnel` page + daily ops script behind a flag.

**Architecture:** Reuse the already-shipped `recordWorkflowEvent` helper. Each instrumentation site is a single post-tx best-effort call (`void`-wrapped so a write failure cannot break the underlying flow). Reporting reads from `WorkflowEvent` + existing `DispatchDecision` / `MessageEvent` tables — no duplicate writes for stages whose state already lives elsewhere.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Vitest, Tailwind v4, shadcn/ui, Supabase Postgres.

**Spec:** [`docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md`](../specs/2026-06-22-funnel-observability-tier1-design.md) (PR #142).

## Global Constraints

- All event writes are **post-tx, best-effort** (`void recordWorkflowEvent(...).catch(...)`). They must not block or break the underlying flow.
- No raw PII in `metadata` or `actorId`. `actorId` is an internal id; `metadata` is small structured context — no phones, emails, names, addresses, free-text descriptions.
- Schema changes are **additive only**. Two migrations already exist (`20260622000000_funnel_tier1_workflow_event_enum`, `20260622000100_funnel_tier1_message_event_fks`). No further schema edits in Tier 1.
- New admin page gated by feature flag `admin.reports.customer_funnel` (default `false`).
- New events use `entityId` as required by the schema. For `REQUEST_STARTED` (no `JobRequest` yet), use the session cookie value with `entityType='ANONYMOUS_SESSION'`.
- Insufficient-credit acceptance must **not** write `PROVIDER_ACCEPTED` — the state didn't advance.
- No historical backfill in Tier 1.
- No Vercel cron wiring in Tier 1.

## File Structure

### Create

| Path | Responsibility |
|---|---|
| `field-service/app/api/funnel/request-started/route.ts` | POST endpoint accepting REQUEST_STARTED events from the client; sets session cookie if missing |
| `field-service/lib/admin/funnel-aggregate.ts` | Read-only query layer: `fetchFunnelCounts`, `fetchFunnelByService`, `fetchFunnelBySuburb`, `fetchNotificationHealth` |
| `field-service/app/(admin)/admin/reports/funnel/page.tsx` | Server-component admin page rendering the 6-bar waterfall + breakouts |
| `field-service/scripts/daily-customer-funnel-report.ts` | CLI script printing 24h funnel report to stdout (default human; `--json` flag for automation) |
| `field-service/__tests__/api/funnel-request-started.test.ts` | Unit test for the new POST endpoint |
| `field-service/__tests__/api/customer-bookings-funnel.test.ts` | Asserts REQUEST_SUBMITTED is written when `/api/customer/bookings` succeeds |
| `field-service/__tests__/lib/matching/dispatch-funnel.test.ts` | Asserts PROVIDER_NOTIFIED fires on success AND failure paths |
| `field-service/__tests__/app/leads-access-funnel.test.ts` | Asserts PROVIDER_VIEWED + `Lead.viewedAt` + idempotency |
| `field-service/__tests__/lib/selected-provider-acceptance-funnel.test.ts` | Asserts PROVIDER_ACCEPTED on success; NOT written when INSUFFICIENT_CREDITS |
| `field-service/__tests__/lib/matching-engine-decline-funnel.test.ts` | Asserts PROVIDER_DECLINED |
| `field-service/__tests__/lib/post-match-communications-funnel.test.ts` | Asserts CLIENT_NOTIFIED alongside existing AuditLog |
| `field-service/__tests__/admin/funnel-aggregate.test.ts` | Seeded counts against the query layer |
| `field-service/__tests__/scripts/daily-customer-funnel-report.test.ts` | `--json` snapshot |

### Modify

| Path | What changes |
|---|---|
| `field-service/__tests__/lib/workflow-events/record.test.ts` | Extend with assertions for the 7 new enum values + PII key allowlist |
| `field-service/components/customer/BookingFlow.tsx` | Add `useEffect` that POSTs once per session id to `/api/funnel/request-started` |
| `field-service/lib/job-requests/create-job-request.ts` | Call `recordWorkflowEvent` after the JobRequest row is created |
| `field-service/lib/matching/dispatch.ts` | Call `recordWorkflowEvent` (delivered=true/false) after each `sendJobOffer` resolution; populate new `MessageEvent.providerId` / `leadId` columns on all `db.messageEvent.create` calls |
| `field-service/app/leads/access/[token]/page.tsx` | Set `Lead.viewedAt = now` when flipping `status='VIEWED'`; emit PROVIDER_VIEWED |
| `field-service/lib/selected-provider-acceptance.ts` | Emit PROVIDER_ACCEPTED post-tx; only on successful commit |
| `field-service/lib/matching-engine.ts` | Emit PROVIDER_DECLINED in `declineLead` |
| `field-service/lib/provider-opportunity-responses.ts` | Emit PROVIDER_DECLINED in decline branch |
| `field-service/lib/post-match-communications.ts` | Emit CLIENT_NOTIFIED alongside existing AuditLog writes (lines 600/636/677) |
| `field-service/lib/feature-flags-registry.ts` | Add `admin.reports.customer_funnel` (default `false`) |
| `field-service/scripts/seed-flags.ts` | Add seed entry for the same flag |
| `field-service/lib/admin-nav-routes.ts` | Add `/admin/reports/funnel` entry between Reports and Acquisition |

---

## Phase A — Foundation (Task 1)

### Task 1: Verify migrations + extend record.test.ts

Both Tier 1 migrations are already on disk (`20260622000000_funnel_tier1_workflow_event_enum`, `20260622000100_funnel_tier1_message_event_fks`) and the schema is updated. This task **applies and verifies** them, then extends the helper test to cover the 7 new enum values and a PII-safe metadata guard.

**Files:**
- Verify: `field-service/prisma/migrations/20260622000000_funnel_tier1_workflow_event_enum/migration.sql`
- Verify: `field-service/prisma/migrations/20260622000100_funnel_tier1_message_event_fks/migration.sql`
- Verify: `field-service/prisma/schema.prisma` (lines 1868-1903 MessageEvent, 3347-3376 WorkflowEventType)
- Modify: `field-service/__tests__/lib/workflow-events/record.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `WorkflowEventType.{REQUEST_STARTED, REQUEST_SUBMITTED, PROVIDER_NOTIFIED, PROVIDER_VIEWED, PROVIDER_ACCEPTED, PROVIDER_DECLINED, CLIENT_NOTIFIED}` available in Prisma client; `MessageEvent.providerId` and `MessageEvent.leadId` columns + indexes; `provider`/`lead` back-relations on `MessageEvent`.

- [ ] **Step 1: Apply migrations locally**

```bash
cd field-service
pnpm prisma migrate dev
```

Expected output includes:
```
Applying migration `20260622000000_funnel_tier1_workflow_event_enum`
Applying migration `20260622000100_funnel_tier1_message_event_fks`
✔ Generated Prisma Client
```

If `prisma migrate dev` errors with "shadow database" or "already applied", run `pnpm prisma generate` to regenerate the client without re-applying.

- [ ] **Step 2: Confirm Prisma client typegen surfaces the new enum values**

```bash
pnpm tsx -e "import { WorkflowEventType } from '@prisma/client'; console.log(Object.values(WorkflowEventType).filter(v => ['REQUEST_STARTED','REQUEST_SUBMITTED','PROVIDER_NOTIFIED','PROVIDER_VIEWED','PROVIDER_ACCEPTED','PROVIDER_DECLINED','CLIENT_NOTIFIED'].includes(v)).length)"
```

Expected output: `7`

- [ ] **Step 3: Write the failing test additions**

Open `field-service/__tests__/lib/workflow-events/record.test.ts` and add inside the existing `describe('recordWorkflowEvent', ...)` block (before the closing `})`):

```typescript
describe('Tier 1 funnel event types', () => {
  it.each([
    'REQUEST_STARTED',
    'REQUEST_SUBMITTED',
    'PROVIDER_NOTIFIED',
    'PROVIDER_VIEWED',
    'PROVIDER_ACCEPTED',
    'PROVIDER_DECLINED',
    'CLIENT_NOTIFIED',
  ] as const)('accepts %s as a valid eventType', async (eventType) => {
    const create = vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date('2026-06-22T12:00:00Z') })
    const client = { workflowEvent: { create } } as unknown as PrismaClient
    const capture = vi.fn().mockResolvedValue(undefined)

    await recordWorkflowEvent(
      {
        eventType,
        actorType: 'system',
        entityType: 'JOB_REQUEST',
        entityId: 'jr-1',
        source: 'test',
      },
      { client, capture },
    )

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ eventType }) }),
    )
  })
})

describe('PII metadata guard', () => {
  it('forbids known PII keys in metadata at runtime', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() })
    const client = { workflowEvent: { create } } as unknown as PrismaClient

    const piiKeys = ['phone', 'email', 'idNumber', 'address', 'customerName', 'providerName']
    for (const key of piiKeys) {
      await expect(
        recordWorkflowEvent(
          {
            eventType: 'REQUEST_SUBMITTED',
            actorType: 'customer',
            entityType: 'JOB_REQUEST',
            entityId: 'jr-1',
            source: 'test',
            metadata: { [key]: 'should-be-rejected' },
          },
          { client },
        ),
      ).rejects.toThrow(/PII/i)
    }
  })
})
```

This test asserts a guard that does not yet exist — we'll add it in the next step.

- [ ] **Step 4: Run the new tests to confirm they fail**

```bash
pnpm vitest run __tests__/lib/workflow-events/record.test.ts
```

Expected: the new enum-value tests PASS (Prisma client knows the values), the PII guard tests FAIL (no guard yet).

- [ ] **Step 5: Add the PII guard to the helper**

Open `field-service/lib/workflow-events/record.ts` and add this constant near the top (after the imports, before `RecordWorkflowEventInput`):

```typescript
// Conservative allowlist guard. Callers must use internal IDs and structured
// flags in metadata — never raw customer/provider identifiers. Keys listed
// here are denied at runtime to fail loud rather than leak silently.
const FORBIDDEN_METADATA_KEYS = new Set([
  'phone',
  'phoneNumber',
  'email',
  'emailAddress',
  'idNumber',
  'identityNumber',
  'address',
  'customerName',
  'providerName',
  'name',
  'fullName',
])

function assertNoPiiKeys(metadata: Record<string, unknown> | undefined): void {
  if (!metadata) return
  for (const key of Object.keys(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) {
      throw new Error(
        `recordWorkflowEvent: metadata key "${key}" is forbidden (PII). Use an internal id or a structured flag instead.`,
      )
    }
  }
}
```

Then inside `recordWorkflowEvent`, immediately after `const metadata = input.metadata ?? {}` (around line 106), call the guard:

```typescript
assertNoPiiKeys(metadata)
```

- [ ] **Step 6: Run the tests to confirm both blocks pass**

```bash
pnpm vitest run __tests__/lib/workflow-events/record.test.ts
```

Expected: ALL tests in `record.test.ts` PASS (existing + 7 new enum tests + 6 new PII guard tests).

- [ ] **Step 7: Commit**

```bash
git add field-service/lib/workflow-events/record.ts field-service/__tests__/lib/workflow-events/record.test.ts
git commit -m "feat(funnel): extend recordWorkflowEvent with Tier 1 enum values + PII guard"
```

---

### Phase A Checkpoint

Reviewer verifies:
- Both Tier 1 migrations applied cleanly to local DB
- Prisma client surfaces the 7 new `WorkflowEventType` values
- `__tests__/lib/workflow-events/record.test.ts` is green with the new assertions
- Existing tests still green: `pnpm vitest run __tests__/lib/workflow-events/`
- No other files touched

---

## Phase B — Instrumentation (Tasks 2–8)

### Task 2: REQUEST_STARTED — endpoint + BookingFlow hook

Server endpoint that accepts a client beacon when the user begins a booking. Stores an anonymous session cookie if the user is signed-out.

**Files:**
- Create: `field-service/app/api/funnel/request-started/route.ts`
- Create: `field-service/__tests__/api/funnel-request-started.test.ts`
- Modify: `field-service/components/customer/BookingFlow.tsx`

**Interfaces:**
- Consumes: `recordWorkflowEvent` from `@/lib/workflow-events/record`; session cookie helpers from `@/lib/auth` if present (else `cookies()` from `next/headers`)
- Produces: `POST /api/funnel/request-started` accepts `{ serviceId: string, source?: string, landingPath?: string }`. Returns 204. Writes a `WorkflowEvent` row with `eventType='REQUEST_STARTED'`, `entityType='ANONYMOUS_SESSION'`, `entityId=<cookie value>`.

- [ ] **Step 1: Write the failing test**

`field-service/__tests__/api/funnel-request-started.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { mockRecord } = vi.hoisted(() => ({ mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }) }))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (name === 'pap_session' ? { value: 'session-abc' } : undefined),
    set: vi.fn(),
  }),
}))

describe('POST /api/funnel/request-started', () => {
  it('writes a REQUEST_STARTED workflow event with the session id as entityId', async () => {
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const req = new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: JSON.stringify({ serviceId: 'plumbing', source: 'pwa', landingPath: '/book/plumbing' }),
      headers: { 'content-type': 'application/json' },
    })

    const res = await POST(req)

    expect(res.status).toBe(204)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'REQUEST_STARTED',
        actorType: 'anonymous',
        entityType: 'ANONYMOUS_SESSION',
        entityId: 'session-abc',
        source: 'pwa',
        metadata: expect.objectContaining({ serviceId: 'plumbing', landingPath: '/book/plumbing' }),
      }),
    )
  })

  it('ignores invalid payloads with 400', async () => {
    const { POST } = await import('@/app/api/funnel/request-started/route')
    const res = await POST(new NextRequest('http://localhost/api/funnel/request-started', {
      method: 'POST',
      body: '{"serviceId":""}',
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/api/funnel-request-started.test.ts
```

Expected: FAIL with "Cannot find module '@/app/api/funnel/request-started/route'".

- [ ] **Step 3: Implement the route**

`field-service/app/api/funnel/request-started/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { recordWorkflowEvent } from '@/lib/workflow-events/record'

export const dynamic = 'force-dynamic'

const SESSION_COOKIE = 'pap_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30 // 30 days

const PayloadSchema = z.object({
  serviceId: z.string().min(1).max(64),
  source: z.string().max(32).optional(),
  landingPath: z.string().max(256).optional(),
})

export async function POST(request: NextRequest) {
  let parsed: z.infer<typeof PayloadSchema>
  try {
    parsed = PayloadSchema.parse(await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid payload' }, { status: 400 })
  }

  const jar = await cookies()
  let sessionId = jar.get(SESSION_COOKIE)?.value
  if (!sessionId) {
    sessionId = cryptoRandomId()
    jar.set(SESSION_COOKIE, sessionId, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_TTL_SECONDS,
    })
  }

  try {
    await recordWorkflowEvent({
      eventType: 'REQUEST_STARTED',
      actorType: 'anonymous',
      entityType: 'ANONYMOUS_SESSION',
      entityId: sessionId,
      source: parsed.source ?? 'pwa',
      metadata: {
        serviceId: parsed.serviceId,
        landingPath: parsed.landingPath,
      },
    })
  } catch {
    // Best-effort: never block the client beacon
  }

  return new NextResponse(null, { status: 204 })
}

function cryptoRandomId(): string {
  // 24 bytes → 32 chars base64url. Crypto-safe via Web Crypto in Edge/Node.
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return Buffer.from(bytes).toString('base64url')
}
```

- [ ] **Step 4: Re-run to confirm pass**

```bash
pnpm vitest run __tests__/api/funnel-request-started.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 5: Wire BookingFlow to call the endpoint once per session**

Open `field-service/components/customer/BookingFlow.tsx`. Near the existing imports add (if not already present):

```typescript
import { useEffect, useRef } from 'react'
```

Inside the main component, find the location where `serviceId` is in scope (props or state) and add this hook (placement: with the other top-level `useEffect`s):

```typescript
const requestStartedFiredRef = useRef(false)
useEffect(() => {
  if (requestStartedFiredRef.current) return
  if (typeof window === 'undefined') return

  // Per-session dedup: don't re-fire on remount within the same tab session.
  const key = `pap.funnel.request_started.${serviceId}`
  if (sessionStorage.getItem(key)) {
    requestStartedFiredRef.current = true
    return
  }
  requestStartedFiredRef.current = true
  sessionStorage.setItem(key, '1')

  fetch('/api/funnel/request-started', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      serviceId,
      source: 'pwa',
      landingPath: window.location.pathname,
    }),
    keepalive: true,
  }).catch(() => {
    // Best-effort beacon; never surface to the user
  })
}, [serviceId])
```

If `useRef`/`useEffect` are already imported, reuse the existing import line.

- [ ] **Step 6: Run all relevant tests + type-check**

```bash
pnpm vitest run __tests__/api/funnel-request-started.test.ts
pnpm tsc --noEmit
```

Expected: tests PASS, typecheck PASS.

- [ ] **Step 7: Commit**

```bash
git add field-service/app/api/funnel/request-started/route.ts \
        field-service/__tests__/api/funnel-request-started.test.ts \
        field-service/components/customer/BookingFlow.tsx
git commit -m "feat(funnel): REQUEST_STARTED endpoint + BookingFlow beacon"
```

---

### Task 3: REQUEST_SUBMITTED at create-job-request

Write the event when a `JobRequest` row is successfully created. Hooks into the existing `lib/job-requests/create-job-request.ts` immediately after the create succeeds.

**Files:**
- Modify: `field-service/lib/job-requests/create-job-request.ts`
- Create: `field-service/__tests__/api/customer-bookings-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent` from `@/lib/workflow-events/record`
- Produces: A `WorkflowEvent` row with `eventType='REQUEST_SUBMITTED'`, `entityType='JOB_REQUEST'`, `entityId=<JobRequest.id>` on every successful create.

- [ ] **Step 1: Locate the create site**

```bash
grep -n "db.jobRequest.create\|prisma.jobRequest.create" field-service/lib/job-requests/create-job-request.ts | head -5
```

Note the line where `createJobRequest` returns the new row (the spec says ~line 533, exact line may have shifted).

- [ ] **Step 2: Write the failing test**

`field-service/__tests__/api/customer-bookings-funnel.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

const { mockRecord, mockCreate } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockCreate: vi.fn(),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))

describe('createJobRequest funnel instrumentation', () => {
  it('writes a REQUEST_SUBMITTED workflow event with the new JobRequest.id', async () => {
    // Real createJobRequest is heavy; this test stubs the smallest seam.
    // Adapt the import to your codebase's existing test pattern.
    // See __tests__/lib/job-requests/create-job-request.test.ts for the
    // canonical seam — reuse the same db mock.
    const { recordWorkflowEvent } = await import('@/lib/workflow-events/record')
    expect(recordWorkflowEvent).toBeDefined()
    // Placeholder structure — the actual test reuses the existing seam in
    // create-job-request.test.ts. See Step 4 for the integration assertion.
  })
})
```

This is a stub; the real assertion lives in the test you'll extend in Step 4.

- [ ] **Step 3: Extend the existing create-job-request test instead of duplicating**

Locate `field-service/__tests__/lib/job-requests/create-job-request.test.ts` (or the closest existing test file for `createJobRequest`):

```bash
find field-service/__tests__ -name "*create-job-request*"
```

If a test exists, add **one new `it` block** asserting:

```typescript
it('emits a REQUEST_SUBMITTED workflow event on success', async () => {
  // Setup mirrors the existing happy-path test in this file.
  // ... existing setup that mocks db.jobRequest.create to resolve with { id: 'jr-new' } ...

  await createJobRequest(/* existing happy-path input */)

  expect(mockRecord).toHaveBeenCalledWith(
    expect.objectContaining({
      eventType: 'REQUEST_SUBMITTED',
      actorType: 'customer',
      entityType: 'JOB_REQUEST',
      entityId: 'jr-new',
    }),
  )
})
```

If there is no existing test file for `createJobRequest`, delete the stub `customer-bookings-funnel.test.ts` and create a minimal new test there with `vi.mock` for `@/lib/db` and the workflow-events module, mocking only `db.jobRequest.create`.

- [ ] **Step 4: Run to confirm failure**

```bash
pnpm vitest run __tests__/lib/job-requests/
```

Expected: the new assertion FAILS — `recordWorkflowEvent` was not called.

- [ ] **Step 5: Wire the call**

In `field-service/lib/job-requests/create-job-request.ts`, find the line where the successful `JobRequest` create returns (in the same function scope where the new row's `id` is in scope, AFTER the transaction has committed). Add this import at the top of the file:

```typescript
import { recordWorkflowEvent } from '@/lib/workflow-events/record'
```

And add this block after the successful create (and after the `openCase('DISPATCH', JOB_REQUEST)` call):

```typescript
void recordWorkflowEvent({
  eventType: 'REQUEST_SUBMITTED',
  actorType: 'customer',
  actorId: customer.id, // already in scope from the upsert above
  entityType: 'JOB_REQUEST',
  entityId: jobRequest.id,
  source: input.source ?? 'pwa',
  metadata: {
    category: jobRequest.category,
    suburb: address?.suburb ?? null,
    addressId: address?.id ?? null,
    source: input.source ?? 'pwa',
  },
}).catch((err) => {
  console.error('[create-job-request] recordWorkflowEvent failed', err)
})
```

Adjust the variable names (`customer`, `jobRequest`, `address`, `input`) to match the actual locals in your code path. **Do not pass any phone/email/name field** — those are PII-blocked by the guard from Task 1.

- [ ] **Step 6: Run to confirm pass**

```bash
pnpm vitest run __tests__/lib/job-requests/
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add field-service/lib/job-requests/create-job-request.ts \
        field-service/__tests__/lib/job-requests/create-job-request.test.ts
# also include the stub test file if created and kept
git commit -m "feat(funnel): REQUEST_SUBMITTED on JobRequest create"
```

---

### Task 4: PROVIDER_NOTIFIED at dispatch

Fire on every `sendJobOffer` resolution — success and failure — in `lib/matching/dispatch.ts`. Also populate the new `MessageEvent.providerId` and `MessageEvent.leadId` columns on the three existing `db.messageEvent.create` sites.

**Files:**
- Modify: `field-service/lib/matching/dispatch.ts` (lines around 216, 230, 246, 278, 290 — verify with grep)
- Create: `field-service/__tests__/lib/matching/dispatch-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent`, existing `sendJobOffer`, `sendButtons`, `db.messageEvent.create`
- Produces: One `WorkflowEvent` per dispatch attempt (success or failure). `MessageEvent` rows now carry `providerId` + `leadId`.

- [ ] **Step 1: Confirm exact line numbers**

```bash
grep -n "sendJobOffer\|db.messageEvent.create" field-service/lib/matching/dispatch.ts | head -20
```

- [ ] **Step 2: Write the failing test**

`field-service/__tests__/lib/matching/dispatch-funnel.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRecord, mockSendJobOffer, mockSendButtons, mockUpsertLead, mockCreateMessageEvent } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockSendJobOffer: vi.fn(),
  mockSendButtons: vi.fn().mockResolvedValue({ externalId: 'wamid-button' }),
  mockUpsertLead: vi.fn().mockResolvedValue({ id: 'lead-1', providerId: 'prov-1' }),
  mockCreateMessageEvent: vi.fn().mockResolvedValue({ id: 'me-1' }),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('@/lib/whatsapp', () => ({
  sendJobOffer: mockSendJobOffer,
  sendButtons: mockSendButtons,
  hasSuccessfulMessageForRecipient: vi.fn().mockResolvedValue(false),
}))
vi.mock('@/lib/db', () => ({
  db: {
    lead: { upsert: mockUpsertLead },
    messageEvent: { create: mockCreateMessageEvent },
  },
}))

describe('dispatch.ts funnel instrumentation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('writes PROVIDER_NOTIFIED with delivered=true when sendJobOffer succeeds', async () => {
    mockSendJobOffer.mockResolvedValue({ externalId: 'wamid-success' })

    const { dispatchLeadToProvider } = await import('@/lib/matching/dispatch')
    await dispatchLeadToProvider(/* minimal happy-path args from existing fixtures */)

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_NOTIFIED',
        actorType: 'system',
        entityType: 'LEAD',
        metadata: expect.objectContaining({ delivered: true, providerId: 'prov-1' }),
      }),
    )
  })

  it('writes PROVIDER_NOTIFIED with delivered=false when sendJobOffer throws', async () => {
    mockSendJobOffer.mockRejectedValue(new Error('whatsapp 500'))

    const { dispatchLeadToProvider } = await import('@/lib/matching/dispatch')
    await dispatchLeadToProvider(/* same args */).catch(() => {})

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_NOTIFIED',
        metadata: expect.objectContaining({ delivered: false }),
      }),
    )
  })

  it('populates MessageEvent.providerId and leadId on failure-event create', async () => {
    mockSendJobOffer.mockRejectedValue(new Error('whatsapp 500'))
    const { dispatchLeadToProvider } = await import('@/lib/matching/dispatch')
    await dispatchLeadToProvider(/* same args */).catch(() => {})

    expect(mockCreateMessageEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          providerId: 'prov-1',
          leadId: 'lead-1',
        }),
      }),
    )
  })
})
```

The `dispatchLeadToProvider` function name is illustrative — match the actual exported entry point in `dispatch.ts`. Replace the args with the existing happy-path fixture from the codebase.

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm vitest run __tests__/lib/matching/dispatch-funnel.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Wire the calls in dispatch.ts**

Add the import:

```typescript
import { recordWorkflowEvent } from '@/lib/workflow-events/record'
```

Around the existing `sendJobOffer` call (~line 230), wrap with a try/catch that captures the outcome and emits PROVIDER_NOTIFIED in BOTH branches. Example shape:

```typescript
let delivered = false
let externalId: string | null = null
try {
  const result = await sendJobOffer(/* existing args */)
  externalId = result?.externalId ?? null
  delivered = true
} catch (err) {
  // The existing failure branch at line 216/246/290 already handles persistence.
  // Re-throw if and only if the existing code re-threw; otherwise just record.
  delivered = false
  // ... existing failure-path code that writes MessageEvent ...
}

void recordWorkflowEvent({
  eventType: 'PROVIDER_NOTIFIED',
  actorType: 'system',
  entityType: 'LEAD',
  entityId: lead.id,
  source: 'matching.dispatch',
  metadata: {
    providerId: lead.providerId,
    template: templateName, // already in scope from the existing send call
    channel: 'WHATSAPP',
    delivered,
    externalId,
  },
}).catch((err) => {
  console.error('[dispatch] PROVIDER_NOTIFIED record failed', err)
})
```

Then on **all three** `db.messageEvent.create` call sites (lines 216, 246, 290), extend the `data` block to include the two new FKs:

```typescript
await db.messageEvent.create({
  data: {
    // ... existing fields ...
    providerId: lead.providerId,
    leadId: lead.id,
  },
})
```

- [ ] **Step 5: Run to confirm pass**

```bash
pnpm vitest run __tests__/lib/matching/dispatch-funnel.test.ts
pnpm vitest run __tests__/lib/matching/   # full matching suite, no regressions
```

Expected: PASS in both runs.

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/matching/dispatch.ts \
        field-service/__tests__/lib/matching/dispatch-funnel.test.ts
git commit -m "feat(funnel): PROVIDER_NOTIFIED at dispatch + MessageEvent FK population"
```

---

### Task 5: PROVIDER_VIEWED + Lead.viewedAt fix

The audit found that `Lead.viewedAt` is never populated on actual page view — only on INTERESTED response. This task fixes that AND emits a `PROVIDER_VIEWED` workflow event in the same code block.

**Files:**
- Modify: `field-service/app/leads/access/[token]/page.tsx` (around line 777-787 — verify with grep)
- Create: `field-service/__tests__/app/leads-access-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent`, the existing Lead status flip
- Produces: `Lead.viewedAt` populated; one `WorkflowEvent.PROVIDER_VIEWED` per first view; idempotent on subsequent views.

- [ ] **Step 1: Locate the status flip**

```bash
grep -n "status.*VIEWED\|status: 'VIEWED'\|status:.\"VIEWED\"" field-service/app/leads/access/[token]/page.tsx
```

- [ ] **Step 2: Write the failing test**

`field-service/__tests__/app/leads-access-funnel.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRecord, mockFindLead, mockUpdateLead } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockFindLead: vi.fn(),
  mockUpdateLead: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'VIEWED', viewedAt: new Date() }),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('@/lib/db', () => ({
  db: {
    lead: { findUnique: mockFindLead, update: mockUpdateLead },
    providerLeadAccessToken: { findUnique: vi.fn().mockResolvedValue({ leadId: 'lead-1', revokedAt: null, expiresAt: new Date(Date.now() + 60000) }) },
  },
}))

describe('lead access page funnel instrumentation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('sets Lead.viewedAt and emits PROVIDER_VIEWED on first SENT→VIEWED flip', async () => {
    mockFindLead.mockResolvedValue({ id: 'lead-1', providerId: 'prov-1', status: 'SENT', viewedAt: null })

    // Adapt the import to the page's actual resolver shape — most page.tsx
    // routes export a default async component plus helpers. Either invoke
    // the component or a small extracted helper (`markLeadViewed`).
    const { markLeadViewedFromAccessPage } = await import('@/app/leads/access/[token]/page')
    await markLeadViewedFromAccessPage('lead-1', 'WHATSAPP')

    expect(mockUpdateLead).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'lead-1' },
        data: expect.objectContaining({ status: 'VIEWED', viewedAt: expect.any(Date) }),
      }),
    )
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_VIEWED',
        actorType: 'provider',
        actorId: 'prov-1',
        entityType: 'LEAD',
        entityId: 'lead-1',
      }),
    )
  })

  it('is idempotent on second view (already VIEWED)', async () => {
    mockFindLead.mockResolvedValue({ id: 'lead-1', providerId: 'prov-1', status: 'VIEWED', viewedAt: new Date('2026-06-21') })

    const { markLeadViewedFromAccessPage } = await import('@/app/leads/access/[token]/page')
    await markLeadViewedFromAccessPage('lead-1', 'WHATSAPP')

    expect(mockUpdateLead).not.toHaveBeenCalled()
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm vitest run __tests__/app/leads-access-funnel.test.ts
```

Expected: FAIL — `markLeadViewedFromAccessPage` does not exist.

- [ ] **Step 4: Extract helper + wire**

In `field-service/app/leads/access/[token]/page.tsx`:

1. Add the import:
   ```typescript
   import { recordWorkflowEvent } from '@/lib/workflow-events/record'
   ```

2. Replace the existing inline `db.lead.update({ ..., data: { status: 'VIEWED' } })` (around line 777) with a call to a small extracted helper. Add this exported helper near the top of the file (after imports, before `export default async function`):

   ```typescript
   /** Idempotent: only mutates on first SENT→VIEWED transition. */
   export async function markLeadViewedFromAccessPage(
     leadId: string,
     viewedFromChannel: 'WHATSAPP' | 'PWA' | 'EMAIL',
   ): Promise<void> {
     const lead = await db.lead.findUnique({
       where: { id: leadId },
       select: { id: true, providerId: true, status: true, viewedAt: true },
     })
     if (!lead) return
     if (lead.viewedAt || lead.status === 'VIEWED') return
     if (lead.status !== 'SENT') return

     await db.lead.update({
       where: { id: lead.id },
       data: { status: 'VIEWED', viewedAt: new Date() },
     })

     void recordWorkflowEvent({
       eventType: 'PROVIDER_VIEWED',
       actorType: 'provider',
       actorId: lead.providerId,
       entityType: 'LEAD',
       entityId: lead.id,
       source: 'leads.access.page',
       metadata: { viewedFromChannel },
     }).catch((err) => {
       console.error('[leads/access] PROVIDER_VIEWED record failed', err)
     })
   }
   ```

3. Replace the original inline update site with:

   ```typescript
   await markLeadViewedFromAccessPage(lead.id, /* infer channel from token-source or default 'WHATSAPP' */ 'WHATSAPP')
   ```

- [ ] **Step 5: Run to confirm pass**

```bash
pnpm vitest run __tests__/app/leads-access-funnel.test.ts
```

Expected: 2/2 PASS.

- [ ] **Step 6: Commit**

```bash
git add field-service/app/leads/access/[token]/page.tsx \
        field-service/__tests__/app/leads-access-funnel.test.ts
git commit -m "fix(funnel): populate Lead.viewedAt on access + emit PROVIDER_VIEWED"
```

---

### Task 6: PROVIDER_ACCEPTED at selected-provider-acceptance

Fires post-commit of the lock transaction in `acceptSelectedProviderJob`. Must NOT fire when `checkProviderLeadCreditBalanceInTransaction` returns `INSUFFICIENT_CREDITS`.

**Files:**
- Modify: `field-service/lib/selected-provider-acceptance.ts`
- Create: `field-service/__tests__/lib/selected-provider-acceptance-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent`; existing `acceptSelectedProviderJob` return value (`{ ok: true, ... }` vs `{ ok: false, code: 'INSUFFICIENT_CREDITS' }`)
- Produces: One `WorkflowEvent.PROVIDER_ACCEPTED` per successful accept.

- [ ] **Step 1: Locate the success return**

```bash
grep -n "acceptSelectedProviderJob\|INSUFFICIENT_CREDITS\|return.*ok.*true" field-service/lib/selected-provider-acceptance.ts | head -10
```

- [ ] **Step 2: Write the failing test**

`field-service/__tests__/lib/selected-provider-acceptance-funnel.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRecord } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))

describe('acceptSelectedProviderJob funnel instrumentation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('emits PROVIDER_ACCEPTED on successful lock', async () => {
    // Reuse the existing happy-path fixture from the canonical test in the
    // same directory. The result.ok===true branch must trigger the event.
    // ... existing happy-path setup mocking db.$transaction etc. ...
    const result = await acceptSelectedProviderJob(/* happy-path args */)
    expect(result.ok).toBe(true)
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_ACCEPTED',
        actorType: 'provider',
        entityType: 'LEAD',
        metadata: expect.objectContaining({ path: expect.any(String) }),
      }),
    )
  })

  it('does NOT emit PROVIDER_ACCEPTED when INSUFFICIENT_CREDITS', async () => {
    // ... setup that causes checkProviderLeadCreditBalanceInTransaction to fail ...
    const result = await acceptSelectedProviderJob(/* insufficient-credit args */)
    expect(result.ok).toBe(false)
    expect((result as { code: string }).code).toBe('INSUFFICIENT_CREDITS')
    expect(mockRecord).not.toHaveBeenCalled()
  })
})
```

Inject the real `acceptSelectedProviderJob` import and use the existing test fixtures from `__tests__/lib/selected-provider-acceptance.test.ts` if present.

- [ ] **Step 3: Run to confirm failure**

```bash
pnpm vitest run __tests__/lib/selected-provider-acceptance-funnel.test.ts
```

Expected: FAIL.

- [ ] **Step 4: Wire the call**

Open `field-service/lib/selected-provider-acceptance.ts`. Add the import:

```typescript
import { recordWorkflowEvent } from '@/lib/workflow-events/record'
```

After the `db.$transaction(...)` succeeds — and BEFORE the function returns `{ ok: true, ... }` — add:

```typescript
void recordWorkflowEvent({
  eventType: 'PROVIDER_ACCEPTED',
  actorType: 'provider',
  actorId: lead.providerId,
  entityType: 'LEAD',
  entityId: lead.id,
  source: 'matching.accept',
  metadata: {
    matchId: match.id, // already in scope from the tx
    creditsCharged: leadUnlock.creditsCharged,
    path: input.path ?? 'qualified_shortlist', // or 'quick_match', depending on entry point
  },
}).catch((err) => {
  console.error('[selected-provider-acceptance] PROVIDER_ACCEPTED record failed', err)
})
```

Verify the variable names (`lead`, `match`, `leadUnlock`, `input`) against the function body. Place the call OUTSIDE the `db.$transaction` block but BEFORE the success `return`.

- [ ] **Step 5: Run to confirm pass**

```bash
pnpm vitest run __tests__/lib/selected-provider-acceptance-funnel.test.ts
pnpm vitest run __tests__/lib/selected-provider-acceptance.test.ts # existing suite, no regressions
```

Expected: PASS in both runs.

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/selected-provider-acceptance.ts \
        field-service/__tests__/lib/selected-provider-acceptance-funnel.test.ts
git commit -m "feat(funnel): PROVIDER_ACCEPTED post-lock-commit"
```

---

### Task 7: PROVIDER_DECLINED in two paths

Fires in `lib/matching-engine.ts:declineLead` (quick-match decline) AND in `lib/provider-opportunity-responses.ts` decline branch (qualified-shortlist NOT_INTERESTED response).

**Files:**
- Modify: `field-service/lib/matching-engine.ts` (around line 306)
- Modify: `field-service/lib/provider-opportunity-responses.ts` (decline branch)
- Create: `field-service/__tests__/lib/matching-engine-decline-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent`
- Produces: `WorkflowEvent.PROVIDER_DECLINED` from both decline entry points.

- [ ] **Step 1: Write the failing test**

`field-service/__tests__/lib/matching-engine-decline-funnel.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRecord, mockUpdate } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockUpdate: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'DECLINED', providerId: 'prov-1' }),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('@/lib/db', () => ({
  db: {
    lead: {
      findUnique: vi.fn().mockResolvedValue({ id: 'lead-1', status: 'SENT', providerId: 'prov-1' }),
      update: mockUpdate,
    },
  },
}))

describe('matching-engine.declineLead funnel instrumentation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('emits PROVIDER_DECLINED on successful decline', async () => {
    const { declineLead } = await import('@/lib/matching-engine')
    await declineLead('lead-1', { reason: 'busy' })

    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'PROVIDER_DECLINED',
        actorType: 'provider',
        actorId: 'prov-1',
        entityType: 'LEAD',
        entityId: 'lead-1',
        metadata: expect.objectContaining({ reason: 'busy' }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/lib/matching-engine-decline-funnel.test.ts
```

- [ ] **Step 3: Wire matching-engine.ts**

Add import:

```typescript
import { recordWorkflowEvent } from '@/lib/workflow-events/record'
```

After the `db.lead.update(...)` that flips status to DECLINED (around line 306), add:

```typescript
void recordWorkflowEvent({
  eventType: 'PROVIDER_DECLINED',
  actorType: 'provider',
  actorId: updatedLead.providerId,
  entityType: 'LEAD',
  entityId: updatedLead.id,
  source: 'matching.decline',
  metadata: { reason: options?.reason ?? null },
}).catch((err) => {
  console.error('[matching-engine.declineLead] PROVIDER_DECLINED record failed', err)
})
```

- [ ] **Step 4: Wire provider-opportunity-responses.ts**

In the function that handles `NOT_INTERESTED` responses (around line 230 per the audit), add the same import and the same event write:

```typescript
void recordWorkflowEvent({
  eventType: 'PROVIDER_DECLINED',
  actorType: 'provider',
  actorId: response.providerId,
  entityType: 'LEAD',
  entityId: response.leadId,
  source: 'provider.opportunity.decline',
  metadata: { reason: input.reason ?? null, surface: 'qualified_shortlist' },
}).catch((err) => {
  console.error('[provider-opportunity-responses] PROVIDER_DECLINED record failed', err)
})
```

- [ ] **Step 5: Run all decline tests**

```bash
pnpm vitest run __tests__/lib/matching-engine-decline-funnel.test.ts
pnpm vitest run __tests__/lib/matching-engine.test.ts
pnpm vitest run __tests__/lib/provider-opportunity-responses.test.ts
```

Expected: PASS for new test, no regressions in existing.

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/matching-engine.ts \
        field-service/lib/provider-opportunity-responses.ts \
        field-service/__tests__/lib/matching-engine-decline-funnel.test.ts
git commit -m "feat(funnel): PROVIDER_DECLINED in both decline paths"
```

---

### Task 8: CLIENT_NOTIFIED at post-match-communications

Fires alongside the existing `AuditLog.action='post_match.customer_notified'` writes at lines 600 / 636 / 677 in `lib/post-match-communications.ts`.

**Files:**
- Modify: `field-service/lib/post-match-communications.ts`
- Create: `field-service/__tests__/lib/post-match-communications-funnel.test.ts`

**Interfaces:**
- Consumes: `recordWorkflowEvent`
- Produces: One `WorkflowEvent.CLIENT_NOTIFIED` per successful customer notify (3 templates: `post_match_customer_provider_accepted`, `customer_match_found`, `mvp1_accepted_lock_customer_confirmation`).

- [ ] **Step 1: Write the failing test**

`field-service/__tests__/lib/post-match-communications-funnel.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockRecord, mockAuditCreate, mockSendTemplate } = vi.hoisted(() => ({
  mockRecord: vi.fn().mockResolvedValue({ id: 'wf-1', occurredAt: new Date() }),
  mockAuditCreate: vi.fn().mockResolvedValue({ id: 'audit-1' }),
  mockSendTemplate: vi.fn().mockResolvedValue({ externalId: 'wamid-customer-1', messageEventId: 'me-1' }),
}))

vi.mock('@/lib/workflow-events/record', () => ({ recordWorkflowEvent: mockRecord }))
vi.mock('@/lib/whatsapp', () => ({ sendTemplate: mockSendTemplate }))
vi.mock('@/lib/db', () => ({ db: { auditLog: { create: mockAuditCreate } } }))

describe('post-match-communications funnel instrumentation', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('emits CLIENT_NOTIFIED alongside AuditLog when the primary template sends', async () => {
    // Use the existing happy-path test setup pattern from
    // __tests__/lib/post-match-communications.test.ts
    const { notifyCustomerOfProviderAcceptance } = await import('@/lib/post-match-communications')
    await notifyCustomerOfProviderAcceptance(/* happy path args */)

    expect(mockSendTemplate).toHaveBeenCalled()
    expect(mockAuditCreate).toHaveBeenCalled()
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'CLIENT_NOTIFIED',
        actorType: 'system',
        entityType: 'JOB_REQUEST',
        metadata: expect.objectContaining({ template: expect.any(String), channel: 'WHATSAPP' }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/lib/post-match-communications-funnel.test.ts
```

- [ ] **Step 3: Wire all three success paths**

Open `field-service/lib/post-match-communications.ts`. Add the import. At each of the three sites that currently call `db.auditLog.create({ data: { action: 'post_match.customer_notified', ... } })` (lines 600, 636, 677), add immediately after the audit write:

```typescript
void recordWorkflowEvent({
  eventType: 'CLIENT_NOTIFIED',
  actorType: 'system',
  entityType: 'JOB_REQUEST',
  entityId: jobRequest.id, // local — verify variable name at each site
  source: 'post_match.customer_notify',
  metadata: {
    matchId: match.id,
    template: templateName,    // already local at the send call
    channel: 'WHATSAPP',
    messageEventId: sendResult?.messageEventId ?? null,
  },
}).catch((err) => {
  console.error('[post-match-communications] CLIENT_NOTIFIED record failed', err)
})
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm vitest run __tests__/lib/post-match-communications-funnel.test.ts
pnpm vitest run __tests__/lib/post-match-communications.test.ts # no regressions
```

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/post-match-communications.ts \
        field-service/__tests__/lib/post-match-communications-funnel.test.ts
git commit -m "feat(funnel): CLIENT_NOTIFIED at customer-notify sites"
```

---

### Phase B Checkpoint

Reviewer verifies:
- All 7 events fire from their respective call sites under unit test
- Insufficient-credit accept does NOT write PROVIDER_ACCEPTED
- `Lead.viewedAt` now populates on first page view + idempotent on second
- `MessageEvent.providerId` and `leadId` populate on all three dispatch.ts message-event writes
- Full vitest suite green: `pnpm test`
- Typecheck green: `pnpm tsc --noEmit`
- No production code path now requires the event write to succeed — all are `void ...catch(...)`

---

## Phase C — Reporting (Tasks 9–12)

### Task 9: Feature flag + nav entry

Smallest pre-page task. Adds the flag to the registry + seed and the nav entry to the shared route source.

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`
- Modify: `field-service/scripts/seed-flags.ts`
- Modify: `field-service/lib/admin-nav-routes.ts`

**Interfaces:**
- Produces: `admin.reports.customer_funnel` feature flag (default `false`). Nav entry resolves to `/admin/reports/funnel`.

- [ ] **Step 1: Add the flag to the registry**

In `field-service/lib/feature-flags-registry.ts`, add an entry (follow the existing pattern — likely an object literal in an exported array/object). Example shape:

```typescript
{
  key: 'admin.reports.customer_funnel',
  defaultEnabled: false,
  description: 'Admin /admin/reports/funnel page (Tier 1 funnel observability).',
}
```

- [ ] **Step 2: Add the seed entry**

In `field-service/scripts/seed-flags.ts`, add a parallel entry so the flag exists in DB with `enabled=false`. Match the existing pattern in that file.

- [ ] **Step 3: Add the nav entry**

In `field-service/lib/admin-nav-routes.ts`, insert into `ADMIN_NAV_ITEMS` between `Reports` and the Acquisition route (if Acquisition is listed; if not, place after `Reports`):

```typescript
{ href: '/admin/reports/funnel', label: 'Funnel', icon: 'reports' as const, flag: 'admin.reports.customer_funnel' as const },
```

Note: the `flag` field ensures the sidebar hides the link while the flag is off (per the existing pattern in this file).

- [ ] **Step 4: Typecheck + smoke route inventory**

```bash
pnpm tsc --noEmit
pnpm vitest run __tests__/lib/admin-nav-routes.test.ts # if it exists
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/feature-flags-registry.ts \
        field-service/scripts/seed-flags.ts \
        field-service/lib/admin-nav-routes.ts
git commit -m "feat(funnel): register admin.reports.customer_funnel flag + nav entry"
```

---

### Task 10: Funnel aggregate query layer

`lib/admin/funnel-aggregate.ts` — four async functions that the page and the script both call.

**Files:**
- Create: `field-service/lib/admin/funnel-aggregate.ts`
- Create: `field-service/__tests__/admin/funnel-aggregate.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  fetchFunnelCounts({ from: Date, to: Date }): Promise<{ started, submitted, matched, eligible, accepted, notified }>
  fetchFunnelByService({ from: Date, to: Date }): Promise<Array<{ category, submitted, accepted, conversionRate }>>
  fetchFunnelBySuburb({ from: Date, to: Date }): Promise<Array<{ suburb, submitted, accepted, conversionRate }>>
  fetchNotificationHealth({ from: Date, to: Date }): Promise<{ sent, delivered, read, failed }>
  ```

- [ ] **Step 1: Write the failing test**

`field-service/__tests__/admin/funnel-aggregate.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'

const { mockGroupBy, mockDispatchCount, mockDispatchEligibleCount, mockMessageEventGroupBy, mockJobRequestGroupBy } = vi.hoisted(() => ({
  mockGroupBy: vi.fn(),
  mockDispatchCount: vi.fn().mockResolvedValue(40),
  mockDispatchEligibleCount: vi.fn().mockResolvedValue(35),
  mockMessageEventGroupBy: vi.fn(),
  mockJobRequestGroupBy: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  db: {
    workflowEvent: { groupBy: mockGroupBy },
    dispatchDecision: { count: mockDispatchCount },
    messageEvent: { groupBy: mockMessageEventGroupBy },
    jobRequest: { groupBy: mockJobRequestGroupBy },
  },
}))

describe('fetchFunnelCounts', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns counts for each funnel stage in the date window', async () => {
    mockGroupBy.mockResolvedValue([
      { eventType: 'REQUEST_STARTED', _count: { _all: 120 } },
      { eventType: 'REQUEST_SUBMITTED', _count: { _all: 80 } },
      { eventType: 'PROVIDER_ACCEPTED', _count: { _all: 30 } },
      { eventType: 'CLIENT_NOTIFIED', _count: { _all: 28 } },
    ])
    mockDispatchCount.mockResolvedValueOnce(40) // total matched
    mockDispatchCount.mockResolvedValueOnce(35) // eligible > 0

    const { fetchFunnelCounts } = await import('@/lib/admin/funnel-aggregate')
    const result = await fetchFunnelCounts({ from: new Date('2026-06-15'), to: new Date('2026-06-22') })

    expect(result).toEqual({
      started: 120,
      submitted: 80,
      matched: 40,
      eligible: 35,
      accepted: 30,
      notified: 28,
    })
  })

  it('treats the to-date as exclusive (no off-by-one)', async () => {
    mockGroupBy.mockResolvedValue([])
    mockDispatchCount.mockResolvedValue(0)
    const { fetchFunnelCounts } = await import('@/lib/admin/funnel-aggregate')
    await fetchFunnelCounts({ from: new Date('2026-06-22T00:00:00Z'), to: new Date('2026-06-23T00:00:00Z') })

    expect(mockGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          occurredAt: { gte: new Date('2026-06-22T00:00:00Z'), lt: new Date('2026-06-23T00:00:00Z') },
        }),
      }),
    )
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/admin/funnel-aggregate.test.ts
```

- [ ] **Step 3: Implement the library**

`field-service/lib/admin/funnel-aggregate.ts`:

```typescript
// ─── Customer funnel aggregates ──────────────────────────────────────────────
// Read-only query layer for /admin/reports/funnel and the daily script.
// Returns counts + category/suburb labels only — never customer/provider PII.
// Sources: WorkflowEvent (Tier 1 instrumentation), DispatchDecision (matching),
// MessageEvent (notification health), JobRequest (service/suburb breakouts).

import { db } from '@/lib/db'

type Range = { from: Date; to: Date }

export interface FunnelCounts {
  started: number
  submitted: number
  matched: number
  eligible: number
  accepted: number
  notified: number
}

export async function fetchFunnelCounts({ from, to }: Range): Promise<FunnelCounts> {
  const [eventGroups, matched, eligible] = await Promise.all([
    db.workflowEvent.groupBy({
      by: ['eventType'],
      where: {
        eventType: { in: ['REQUEST_STARTED', 'REQUEST_SUBMITTED', 'PROVIDER_ACCEPTED', 'CLIENT_NOTIFIED'] },
        occurredAt: { gte: from, lt: to },
      },
      _count: { _all: true },
    }),
    db.dispatchDecision.count({ where: { createdAt: { gte: from, lt: to } } }),
    db.dispatchDecision.count({
      where: { createdAt: { gte: from, lt: to }, eligibleCount: { gt: 0 } },
    }),
  ])

  const byType = new Map(eventGroups.map((g) => [g.eventType, g._count._all]))
  return {
    started: byType.get('REQUEST_STARTED') ?? 0,
    submitted: byType.get('REQUEST_SUBMITTED') ?? 0,
    matched,
    eligible,
    accepted: byType.get('PROVIDER_ACCEPTED') ?? 0,
    notified: byType.get('CLIENT_NOTIFIED') ?? 0,
  }
}

export interface FunnelBreakoutRow {
  category: string
  submitted: number
  accepted: number
  conversionRate: number // 0..1
}

export async function fetchFunnelByService({ from, to }: Range): Promise<FunnelBreakoutRow[]> {
  const requests = await db.jobRequest.groupBy({
    by: ['category'],
    where: { createdAt: { gte: from, lt: to } },
    _count: { _all: true },
  })

  const accepted = await db.workflowEvent.findMany({
    where: {
      eventType: 'PROVIDER_ACCEPTED',
      occurredAt: { gte: from, lt: to },
    },
    select: { entityId: true },
  })
  const acceptedLeadIds = accepted.map((e) => e.entityId)
  const acceptedJobRequests = acceptedLeadIds.length
    ? await db.lead.findMany({
        where: { id: { in: acceptedLeadIds } },
        select: { jobRequest: { select: { category: true } } },
      })
    : []
  const acceptedByCategory = new Map<string, number>()
  for (const lr of acceptedJobRequests) {
    const c = lr.jobRequest?.category
    if (!c) continue
    acceptedByCategory.set(c, (acceptedByCategory.get(c) ?? 0) + 1)
  }

  return requests
    .map((g) => {
      const submitted = g._count._all
      const acc = acceptedByCategory.get(g.category) ?? 0
      return {
        category: g.category,
        submitted,
        accepted: acc,
        conversionRate: submitted === 0 ? 0 : acc / submitted,
      }
    })
    .sort((a, b) => b.submitted - a.submitted)
}

export interface SuburbBreakoutRow {
  suburb: string
  submitted: number
  accepted: number
  conversionRate: number
}

export async function fetchFunnelBySuburb({ from, to }: Range): Promise<SuburbBreakoutRow[]> {
  // Suburb lives on the Address row referenced by JobRequest.addressId.
  // For Tier 1 we query JobRequest+Address inline and aggregate in memory —
  // dataset is small (West Rand pilot).
  const requests = await db.jobRequest.findMany({
    where: { createdAt: { gte: from, lt: to } },
    select: { id: true, address: { select: { suburb: true } } },
  })
  const submittedBySuburb = new Map<string, number>()
  for (const r of requests) {
    const s = r.address?.suburb ?? 'unknown'
    submittedBySuburb.set(s, (submittedBySuburb.get(s) ?? 0) + 1)
  }

  const accepted = await db.workflowEvent.findMany({
    where: { eventType: 'PROVIDER_ACCEPTED', occurredAt: { gte: from, lt: to } },
    select: { entityId: true },
  })
  const acceptedLeadIds = accepted.map((e) => e.entityId)
  const acceptedLeads = acceptedLeadIds.length
    ? await db.lead.findMany({
        where: { id: { in: acceptedLeadIds } },
        select: { jobRequest: { select: { address: { select: { suburb: true } } } } },
      })
    : []
  const acceptedBySuburb = new Map<string, number>()
  for (const l of acceptedLeads) {
    const s = l.jobRequest?.address?.suburb ?? 'unknown'
    acceptedBySuburb.set(s, (acceptedBySuburb.get(s) ?? 0) + 1)
  }

  return Array.from(submittedBySuburb.entries())
    .map(([suburb, submitted]) => {
      const acc = acceptedBySuburb.get(suburb) ?? 0
      return { suburb, submitted, accepted: acc, conversionRate: submitted === 0 ? 0 : acc / submitted }
    })
    .sort((a, b) => b.submitted - a.submitted)
}

const LEAD_NOTIFICATION_TEMPLATES = [
  'quick_match_provider_lead_offer',
  'provider_lead_offer',
  'provider_rfp_lead_invite',
]

export interface NotificationHealth {
  sent: number
  delivered: number
  read: number
  failed: number
}

export async function fetchNotificationHealth({ from, to }: Range): Promise<NotificationHealth> {
  const groups = await db.messageEvent.groupBy({
    by: ['status'],
    where: {
      templateName: { in: LEAD_NOTIFICATION_TEMPLATES },
      sentAt: { gte: from, lt: to },
    },
    _count: { _all: true },
  })
  const byStatus = new Map(groups.map((g) => [g.status, g._count._all]))
  return {
    sent: byStatus.get('SENT') ?? 0,
    delivered: byStatus.get('DELIVERED') ?? 0,
    read: byStatus.get('READ') ?? 0,
    failed: byStatus.get('FAILED') ?? 0,
  }
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm vitest run __tests__/admin/funnel-aggregate.test.ts
```

Expected: 2/2 PASS for `fetchFunnelCounts`. Add similar focused tests for `fetchFunnelByService`, `fetchFunnelBySuburb`, `fetchNotificationHealth` following the same mock pattern — minimum one happy-path each.

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/admin/funnel-aggregate.ts \
        field-service/__tests__/admin/funnel-aggregate.test.ts
git commit -m "feat(funnel): admin funnel-aggregate query layer"
```

---

### Task 11: Admin page

Server component that renders the page using the query layer from Task 10. Read-only — no `crudAction` wrapping.

**Files:**
- Create: `field-service/app/(admin)/admin/reports/funnel/page.tsx`

**Interfaces:**
- Consumes: `fetchFunnelCounts`, `fetchFunnelByService`, `fetchFunnelBySuburb`, `fetchNotificationHealth`, `requireAdmin`, `isEnabled`
- Produces: 200 OK with the rendered page; 404 if flag is OFF.

- [ ] **Step 1: Implement the page**

`field-service/app/(admin)/admin/reports/funnel/page.tsx`:

```typescript
import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { requireAdmin } from '@/lib/auth'
import {
  fetchFunnelCounts,
  fetchFunnelByService,
  fetchFunnelBySuburb,
  fetchNotificationHealth,
} from '@/lib/admin/funnel-aggregate'

export const dynamic = 'force-dynamic'

type SearchParams = { range?: '24h' | '7d' | '30d' }

const RANGE_DAYS: Record<NonNullable<SearchParams['range']>, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
}

export default async function AdminFunnelPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  await requireAdmin()
  const flagOn = await isEnabled('admin.reports.customer_funnel').catch(() => false)
  if (!flagOn) return notFound()

  const params = (await searchParams) ?? {}
  const rangeKey = (params.range && RANGE_DAYS[params.range]) ? params.range : '7d'
  const days = RANGE_DAYS[rangeKey as keyof typeof RANGE_DAYS]
  const now = new Date()
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
  const to = now

  const [counts, byService, bySuburb, notifyHealth] = await Promise.all([
    fetchFunnelCounts({ from, to }),
    fetchFunnelByService({ from, to }),
    fetchFunnelBySuburb({ from, to }),
    fetchNotificationHealth({ from, to }),
  ])

  return (
    <main className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Customer Funnel</h1>
        <p className="text-sm text-muted-foreground">
          Last {days} day{days === 1 ? '' : 's'} — {from.toISOString().slice(0, 10)} to {to.toISOString().slice(0, 10)}
        </p>
        <nav className="flex gap-2 text-sm">
          {(['24h', '7d', '30d'] as const).map((r) => (
            <a
              key={r}
              href={`/admin/reports/funnel?range=${r}`}
              className={`rounded-full border px-3 py-1 ${r === rangeKey ? 'bg-primary text-primary-foreground' : ''}`}
            >
              Last {r}
            </a>
          ))}
        </nav>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Waterfall</h2>
        <Waterfall counts={counts} />
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">By service</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Category</th><th className="text-right">Submitted</th><th className="text-right">Accepted</th><th className="text-right">Conv %</th></tr></thead>
          <tbody>
            {byService.slice(0, 20).map((r) => (
              <tr key={r.category}><td>{r.category}</td><td className="text-right">{r.submitted}</td><td className="text-right">{r.accepted}</td><td className="text-right">{(r.conversionRate * 100).toFixed(0)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">By suburb</h2>
        <table className="w-full text-sm">
          <thead><tr><th className="text-left">Suburb</th><th className="text-right">Submitted</th><th className="text-right">Accepted</th><th className="text-right">Conv %</th></tr></thead>
          <tbody>
            {bySuburb.slice(0, 20).map((r) => (
              <tr key={r.suburb}><td>{r.suburb}</td><td className="text-right">{r.submitted}</td><td className="text-right">{r.accepted}</td><td className="text-right">{(r.conversionRate * 100).toFixed(0)}%</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded-lg border p-4">
        <h2 className="text-lg font-semibold">Notification health</h2>
        <ul className="text-sm">
          <li>SENT: {notifyHealth.sent}</li>
          <li>DELIVERED: {notifyHealth.delivered}</li>
          <li>READ: {notifyHealth.read}</li>
          <li>FAILED: {notifyHealth.failed}</li>
        </ul>
      </section>
    </main>
  )
}

function Waterfall({ counts }: { counts: { started: number; submitted: number; matched: number; eligible: number; accepted: number; notified: number } }) {
  const rows: Array<{ label: string; value: number; prev?: number }> = [
    { label: 'Requests started', value: counts.started },
    { label: 'Requests submitted', value: counts.submitted, prev: counts.started },
    { label: 'Match attempted', value: counts.matched, prev: counts.submitted },
    { label: '≥1 eligible provider', value: counts.eligible, prev: counts.matched },
    { label: 'Provider accepted', value: counts.accepted, prev: counts.eligible },
    { label: 'Client notified after accept', value: counts.notified, prev: counts.accepted },
  ]
  return (
    <ol className="space-y-2 text-sm">
      {rows.map((r, i) => {
        const conv = r.prev && r.prev > 0 ? Math.round((r.value / r.prev) * 100) : null
        return (
          <li key={i} className="flex items-center justify-between rounded border px-3 py-2">
            <span>{r.label}</span>
            <span className="font-mono">
              {r.value}{conv !== null ? ` (${conv}%)` : ''}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm tsc --noEmit
```

- [ ] **Step 3: Manual page render check**

```bash
pnpm dev
# In another shell:
curl -sS http://localhost:3000/admin/reports/funnel -I | head -5
```

Expected: 200 with the flag on (set via env or DB row temporarily); 404 with flag off. If 401, sign in as admin and re-curl with the session cookie.

- [ ] **Step 4: Commit**

```bash
git add field-service/app/(admin)/admin/reports/funnel/page.tsx
git commit -m "feat(funnel): /admin/reports/funnel server-rendered page"
```

---

### Task 12: Daily customer-funnel report script

CLI mirror of the existing `scripts/daily-provider-funnel-report.ts`. Same authentication pattern, same output shape.

**Files:**
- Create: `field-service/scripts/daily-customer-funnel-report.ts`
- Create: `field-service/__tests__/scripts/daily-customer-funnel-report.test.ts`

**Interfaces:**
- Consumes: the four `funnel-aggregate.ts` functions
- Produces: stdout report (human or JSON depending on `--json` flag).

- [ ] **Step 1: Write the failing snapshot test**

`field-service/__tests__/scripts/daily-customer-funnel-report.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/admin/funnel-aggregate', () => ({
  fetchFunnelCounts: vi.fn().mockResolvedValue({
    started: 127, submitted: 83, matched: 83, eligible: 71, accepted: 39, notified: 37,
  }),
  fetchFunnelByService: vi.fn().mockResolvedValue([
    { category: 'plumbing', submitted: 29, accepted: 18, conversionRate: 0.62 },
    { category: 'handyman', submitted: 22, accepted: 10, conversionRate: 0.45 },
  ]),
  fetchFunnelBySuburb: vi.fn().mockResolvedValue([
    { suburb: 'Roodepoort', submitted: 18, accepted: 11, conversionRate: 0.61 },
  ]),
  fetchNotificationHealth: vi.fn().mockResolvedValue({ sent: 214, delivered: 198, read: 173, failed: 4 }),
}))

describe('daily-customer-funnel-report --json', () => {
  it('emits a stable JSON envelope', async () => {
    const { runReport } = await import('@/scripts/daily-customer-funnel-report')
    const json = await runReport({ days: 1, format: 'json', now: new Date('2026-06-22T00:00:00Z') })
    expect(JSON.parse(json)).toEqual({
      window: { from: '2026-06-21T00:00:00.000Z', to: '2026-06-22T00:00:00.000Z' },
      funnel: { started: 127, submitted: 83, matched: 83, eligible: 71, accepted: 39, notified: 37 },
      byService: expect.any(Array),
      bySuburb: expect.any(Array),
      notification: { sent: 214, delivered: 198, read: 173, failed: 4 },
    })
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/scripts/daily-customer-funnel-report.test.ts
```

- [ ] **Step 3: Implement the script**

`field-service/scripts/daily-customer-funnel-report.ts`:

```typescript
#!/usr/bin/env tsx
// Daily customer funnel report.
// Usage: pnpm tsx scripts/daily-customer-funnel-report.ts [--days=N] [--json]

import {
  fetchFunnelCounts,
  fetchFunnelByService,
  fetchFunnelBySuburb,
  fetchNotificationHealth,
} from '@/lib/admin/funnel-aggregate'

interface RunOpts {
  days: number
  format: 'human' | 'json'
  now?: Date
}

export async function runReport(opts: RunOpts): Promise<string> {
  const now = opts.now ?? new Date()
  const to = new Date(now.toISOString().slice(0, 10) + 'T00:00:00.000Z')
  const from = new Date(to.getTime() - opts.days * 24 * 60 * 60 * 1000)

  const [funnel, byService, bySuburb, notification] = await Promise.all([
    fetchFunnelCounts({ from, to }),
    fetchFunnelByService({ from, to }),
    fetchFunnelBySuburb({ from, to }),
    fetchNotificationHealth({ from, to }),
  ])

  if (opts.format === 'json') {
    return JSON.stringify({
      window: { from: from.toISOString(), to: to.toISOString() },
      funnel,
      byService,
      bySuburb,
      notification,
    })
  }

  const lines: string[] = []
  lines.push(`========== Plug A Pro — Customer Funnel — last ${opts.days}d ==========`)
  lines.push(`Window: ${from.toISOString().slice(0, 16).replace('T', ' ')} → ${to.toISOString().slice(0, 16).replace('T', ' ')} UTC`)
  lines.push('')
  lines.push('Funnel')
  const conv = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '—')
  lines.push(`  REQUEST_STARTED            ${funnel.started}     (-)`)
  lines.push(`  REQUEST_SUBMITTED          ${funnel.submitted}  → ${conv(funnel.submitted, funnel.started)} from started`)
  lines.push(`  MATCH_ATTEMPTED            ${funnel.matched}  → ${conv(funnel.matched, funnel.submitted)}`)
  lines.push(`  ≥1 ELIGIBLE PROVIDER       ${funnel.eligible}  → ${conv(funnel.eligible, funnel.matched)}`)
  lines.push(`  PROVIDER_ACCEPTED          ${funnel.accepted}  → ${conv(funnel.accepted, funnel.eligible)}`)
  lines.push(`  CLIENT_NOTIFIED            ${funnel.notified}  → ${conv(funnel.notified, funnel.accepted)}`)
  lines.push('')
  lines.push('By service (submitted → accepted)')
  for (const r of byService.slice(0, 10)) {
    lines.push(`  ${r.category.padEnd(18)} ${String(r.submitted).padStart(3)}  →  ${String(r.accepted).padStart(3)}  (${Math.round(r.conversionRate * 100)}%)`)
  }
  lines.push('')
  lines.push('By suburb (submitted → accepted)')
  for (const r of bySuburb.slice(0, 10)) {
    lines.push(`  ${r.suburb.padEnd(18)} ${String(r.submitted).padStart(3)}  →  ${String(r.accepted).padStart(3)}  (${Math.round(r.conversionRate * 100)}%)`)
  }
  lines.push('')
  lines.push('Notification health')
  lines.push(`  SENT      ${notification.sent}`)
  lines.push(`  DELIVERED ${notification.delivered}`)
  lines.push(`  READ      ${notification.read}`)
  lines.push(`  FAILED    ${notification.failed}`)
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const daysArg = args.find((a) => a.startsWith('--days='))
  const days = daysArg ? Number(daysArg.split('=')[1]) : 1
  const format: 'human' | 'json' = args.includes('--json') ? 'json' : 'human'
  const out = await runReport({ days, format })
  process.stdout.write(out + '\n')
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
```

- [ ] **Step 4: Run to confirm pass**

```bash
pnpm vitest run __tests__/scripts/daily-customer-funnel-report.test.ts
```

- [ ] **Step 5: Smoke-run against local DB**

```bash
pnpm tsx scripts/daily-customer-funnel-report.ts --days=7
pnpm tsx scripts/daily-customer-funnel-report.ts --days=1 --json | jq .
```

Expected: human report renders; JSON parses cleanly.

- [ ] **Step 6: Commit**

```bash
git add field-service/scripts/daily-customer-funnel-report.ts \
        field-service/__tests__/scripts/daily-customer-funnel-report.test.ts
git commit -m "feat(funnel): daily customer funnel report script"
```

---

### Phase C Checkpoint

Reviewer verifies:
- `pnpm tsc --noEmit` clean
- `pnpm vitest run` clean (all new + existing tests green)
- `/admin/reports/funnel` returns 404 with flag off (verified locally)
- `/admin/reports/funnel` returns 200 with flag on (verified locally by setting DB row)
- `pnpm tsx scripts/daily-customer-funnel-report.ts --days=7` renders without DB errors
- `--json` output is parseable

---

## Phase D — Integration (Task 13)

### Task 13: Smoke, branch hygiene, PR

Add the new admin route to the smoke list (auto-via `lib/admin-nav-routes.ts` — already done in Task 9). Final full test run, branch push, PR open.

**Files:**
- (verify only) `field-service/lib/admin-nav-routes.ts` — flag-gated route appears in `ADMIN_FLAGGED_SMOKE_ROUTES`
- (verify only) `field-service/e2e/smoke.spec.ts` — derives from the nav routes

**Interfaces:**
- Consumes: every committed change in Phase A–C
- Produces: a single feature branch + PR ready for merge

- [ ] **Step 1: Confirm the route is included in the flagged smoke list**

```bash
grep -n "/admin/reports/funnel" field-service/lib/admin-nav-routes.ts
```

Expected: one match in `ADMIN_NAV_ITEMS` with `flag: 'admin.reports.customer_funnel'`.

- [ ] **Step 2: Run the full Vitest suite**

```bash
cd field-service && pnpm vitest run
```

Expected: all green. If anything regressed, fix it before proceeding.

- [ ] **Step 3: Run typecheck + lint**

```bash
pnpm tsc --noEmit
pnpm lint
```

Expected: clean.

- [ ] **Step 4: Branch hygiene**

If you've been committing on a long-lived branch off main, no action needed. Otherwise, ensure all commits in Phase A–C are on the same branch (`fix/funnel-observability-tier1`).

```bash
git log --oneline main..HEAD
```

Expected: ~10 commits matching the task names.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin fix/funnel-observability-tier1

gh pr create --title "feat(funnel): Tier 1 client funnel observability — wire WorkflowEvent at 7 stages" --body "$(cat <<'EOF'
## Summary

Implements Tier 1 of the funnel observability spec (PR #142). Wires the existing \`WorkflowEvent\` table into 7 customer-funnel stages and adds a read-only \`/admin/reports/funnel\` page + daily ops script behind the \`admin.reports.customer_funnel\` flag (default OFF).

## What ships

- 7 new \`WorkflowEvent\` call sites: REQUEST_STARTED, REQUEST_SUBMITTED, PROVIDER_NOTIFIED (success + failure), PROVIDER_VIEWED, PROVIDER_ACCEPTED (only on successful credit-gated commit), PROVIDER_DECLINED (both decline paths), CLIENT_NOTIFIED
- \`Lead.viewedAt\` now populates on actual page view (gap closed)
- \`MessageEvent.providerId\` + \`MessageEvent.leadId\` populated on all three \`dispatch.ts\` event-creation sites
- New \`/api/funnel/request-started\` POST endpoint (anonymous session cookie)
- \`/admin/reports/funnel\` page with date range, waterfall, service/suburb breakouts, notification health
- \`scripts/daily-customer-funnel-report.ts\` (human + JSON modes)
- PII metadata guard added to \`recordWorkflowEvent\`
- 9 new or extended test files

## Out of scope (Tier 2/3 follow-ups)

VisitSession table, PaymentStatusEvent, INSUFFICIENT_CREDIT filter exclusion, SMS/email lead fallback, per-request drill-down, LeadView, Invoice enum, historical backfill, Vercel cron wiring.

## Test plan

- [x] \`pnpm vitest run\` — full suite green
- [x] \`pnpm tsc --noEmit\` — clean
- [x] \`pnpm lint\` — clean
- [x] \`/admin/reports/funnel\` returns 404 with flag off, 200 with flag on (manual local verification)
- [x] \`pnpm tsx scripts/daily-customer-funnel-report.ts --days=7\` renders
- [ ] After merge + deploy: flip \`admin.reports.customer_funnel\` flag ON in prod; verify rows accumulate in \`workflow_events\` table.

## Spec

\`docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md\` (PR #142)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 6: Log to OpenBrain after merge + deploy**

Once the PR is merged and Vercel deploys, log to OpenBrain (this step is performed at session end, not by the implementer):

- Title: `engineering — Client funnel observability Tier 1 shipped (YYYY-MM-DD)`
- Domain: `engineering`
- Tags: `funnel-observability, tier-1, workflow-events, admin-reports`
- Content: PR number, list of 7 wired call sites, link to spec.

---

### Phase D Checkpoint (Final)

Reviewer verifies:
- Single PR open with all Phase A–C commits
- CI green (or red only on the pre-existing `pnpm audit` issue noted in PR #134's history — that's not Tier 1's responsibility)
- Manual local smoke run of the admin page renders the expected sections
- After merge: flag flipped, `workflow_events` row counts increment in prod
- Memory file `project_funnel_observability_tier1.md` added/updated in `~/.claude/projects/.../memory/` indexing this work

---

## Plan self-review

**Spec coverage:** Every section of `docs/superpowers/specs/2026-06-22-funnel-observability-tier1-design.md` is implemented:
- §3 architecture: Tasks 2–8 (one task per event type)
- §4 schema: Task 1 (verify the already-staged migrations)
- §5 admin page: Tasks 9 (nav + flag), 10 (queries), 11 (page)
- §6 daily script: Task 12
- §7 tests: each task ships its own test + Task 1 covers the helper
- §8 rollout: Task 13
- §9 explicit-out-of-scope: respected throughout

**Placeholder scan:** No TBD/TODO/"implement later" strings. Where step instructions reference "the existing variable name", the implementer is told to verify against the actual file — that's a code-survey instruction, not a placeholder.

**Type consistency:** `recordWorkflowEvent` signature matches the helper definition (verified by reading `lib/workflow-events/record.ts:38-51`). `actorType` values consistently from the allowed union (`customer | provider | system | anonymous`). `entityType` values use the schema-comment vocabulary (`JOB_REQUEST`, `LEAD`, `ANONYMOUS_SESSION`). The four reporting function signatures in Task 10 match the page consumer in Task 11 and the script consumer in Task 12.

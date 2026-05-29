# Flyer Campaign Monitor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CRON_SECRET-protected internal endpoint that returns a masked, campaign-era flyer registration report for the scheduled Gmail monitor.

**Architecture:** Keep all data access, phone normalization, masking, funnel analysis, alerting and Markdown rendering in `lib/flyer-monitor.ts`. The Next.js route only authenticates the request, calls the service and returns structured JSON plus subject/body text for the external Gmail trigger.

**Tech Stack:** Next.js App Router route handler, Prisma raw SQL for cross-schema Supabase reads, Vitest unit and route tests.

---

### Task 1: Flyer Monitor Service

**Files:**
- Create: `field-service/lib/flyer-monitor.ts`
- Test: `field-service/__tests__/lib/flyer-monitor.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `field-service/__tests__/lib/flyer-monitor.test.ts` covering:

```ts
import { describe, expect, it } from 'vitest'
import {
  analyzeFlyerMonitorRows,
  buildFlyerMonitorReport,
  maskPhone,
  normalizePhone,
} from '@/lib/flyer-monitor'

describe('flyer monitor phone handling', () => {
  it('normalizes plus, bare 27 and local 0-prefixed SA phones', () => {
    expect(normalizePhone('+27 77 392 3802')).toBe('+27773923802')
    expect(normalizePhone('27773923802')).toBe('+27773923802')
    expect(normalizePhone('0773923802')).toBe('+27773923802')
  })

  it('masks phones without leaking raw 10 digit numbers', () => {
    expect(maskPhone('+27773923802')).toBe('+27****3802')
  })
})

describe('analyzeFlyerMonitorRows', () => {
  it('deduplicates excluded phones and keeps the furthest real prospect stage', () => {
    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows: [
        { stage: 'otp_sent', phone: '+27773923802', at: '2026-05-29T08:00:00.000Z', detail: 'sent', failureCode: null },
        { stage: 'otp_sent', phone: '+27821230000', at: '2026-05-29T08:00:00.000Z', detail: 'sent', failureCode: null },
        { stage: 'auth_user', phone: '27821230000', at: '2026-05-29T08:02:00.000Z', detail: null, failureCode: null },
        { stage: 'customer', phone: '+27821230000', at: '2026-05-29T08:03:00.000Z', detail: null, failureCode: null },
        { stage: 'provider_app', phone: '+27821230000', at: '2026-05-29T08:20:00.000Z', detail: 'PENDING / NO_FLAGS', failureCode: null },
      ],
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    expect(report.prospectCount).toBe(1)
    expect(report.prospects[0]).toMatchObject({
      phoneMasked: '+27****0000',
      furthestStage: 'provider_app',
    })
    expect(report.prospects[0]?.friction[0]?.code).toBe('PROVIDER_APP_PENDING')
  })

  it('alerts on production-blocking OTP failures and activity bursts', () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      stage: 'otp_sent' as const,
      phone: `+2782123000${index}`,
      at: '2026-05-29T09:00:00.000Z',
      detail: index === 0 ? 'failed' : 'sent',
      failureCode: index === 0 ? 'WA_AUTH_FAILED' : null,
    }))

    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:00:00.000Z'),
      windowStart: new Date('2026-05-29T04:00:00.000Z'),
      windowEnd: new Date('2026-05-29T10:00:00.000Z'),
      rows,
      securityEvents: [
        { severity: 'HIGH', eventType: 'OTP_REPORTED', phone: '+27821230001', at: '2026-05-29T09:05:00.000Z', status: 'NEW' },
      ],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    expect(report.alertLines).toEqual([
      'ALERT: 6 new prospects in this 6-hour window.',
      'ALERT: OTP delivery failure WA_AUTH_FAILED detected.',
      'ALERT: 1 HIGH/CRITICAL security event(s) in this window.',
    ])
  })
})

describe('buildFlyerMonitorReport', () => {
  it('renders zero-prospect sanity counts and next poll', () => {
    const report = analyzeFlyerMonitorRows({
      now: new Date('2026-05-29T10:13:00.000Z'),
      windowStart: new Date('2026-05-29T04:13:00.000Z'),
      windowEnd: new Date('2026-05-29T10:13:00.000Z'),
      rows: [],
      securityEvents: [],
      lifetimeCounts: { customers: 10, providers: 4, providerApplications: 7 },
    })

    const markdown = buildFlyerMonitorReport(report)

    expect(markdown).toContain('**0 prospects in this window.**')
    expect(markdown).toContain('- customers: 10')
    expect(markdown).toContain('_Next poll:')
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm exec vitest run __tests__/lib/flyer-monitor.test.ts`

Expected: FAIL because `@/lib/flyer-monitor` does not exist.

- [ ] **Step 3: Implement the service**

Create `field-service/lib/flyer-monitor.ts` with exported functions:

```ts
export function normalizePhone(phone: string | null | undefined): string | null
export function maskPhone(phoneE164: string): string
export function analyzeFlyerMonitorRows(input: AnalyzeInput): FlyerMonitorReport
export function buildFlyerMonitorReport(report: FlyerMonitorReport): string
export async function getFlyerMonitorReport(options?: { now?: Date }): Promise<FlyerMonitorReport>
```

The service must:
- clamp the rolling 6-hour start to `2026-05-28T07:31:00.000Z`;
- filter the explicit excluded numbers in plus and bare formats;
- group rows by normalized phone;
- choose furthest stage with priority `provider > provider_app > customer > job_request > auth_user > otp_sent > wa_inbound > conversation`;
- flag OTP failure, OTP entry, identity link, provider pending, more-info and idle welcome friction;
- alert on more than 5 prospects, `TEMPLATE_NOT_APPROVED`, `WA_AUTH_FAILED` and HIGH/CRITICAL security events;
- render only masked phones in Markdown.

- [ ] **Step 4: Run service tests to verify GREEN**

Run: `pnpm exec vitest run __tests__/lib/flyer-monitor.test.ts`

Expected: PASS.

### Task 2: Internal API Route

**Files:**
- Create: `field-service/app/api/internal/flyer-monitor/route.ts`
- Test: `field-service/__tests__/api/internal/flyer-monitor.test.ts`

- [ ] **Step 1: Write failing route tests**

Create `field-service/__tests__/api/internal/flyer-monitor.test.ts` covering:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGetFlyerMonitorReport, mockBuildFlyerMonitorReport } = vi.hoisted(() => ({
  mockGetFlyerMonitorReport: vi.fn(),
  mockBuildFlyerMonitorReport: vi.fn(),
}))

vi.mock('@/lib/flyer-monitor', () => ({
  getFlyerMonitorReport: mockGetFlyerMonitorReport,
  buildFlyerMonitorReport: mockBuildFlyerMonitorReport,
}))

import { GET } from '@/app/api/internal/flyer-monitor/route'

describe('GET /api/internal/flyer-monitor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'cron-secret'
    mockGetFlyerMonitorReport.mockResolvedValue({
      subject: 'PlugAPro flyer monitor - 0 prospect(s) - 2026-05-29 12:13 SAST',
      prospectCount: 0,
      alertLines: [],
      prospects: [],
      frictionSummary: {},
      lifetimeCounts: { customers: 1, providers: 2, providerApplications: 3 },
      window: {
        startIso: '2026-05-29T04:13:00.000Z',
        endIso: '2026-05-29T10:13:00.000Z',
        nextPollIso: '2026-05-29T16:13:00.000Z',
        startSast: '2026-05-29 06:13 SAST',
        endSast: '2026-05-29 12:13 SAST',
        nextPollSast: '2026-05-29 18:13 SAST',
        baselineApplied: false,
        mode: 'stateless_rolling_6h',
      },
    })
    mockBuildFlyerMonitorReport.mockReturnValue('## Plug A Pro flyer monitor')
  })

  it('rejects requests without the correct CRON_SECRET', async () => {
    const res = await GET(new Request('http://localhost/api/internal/flyer-monitor', {
      headers: { authorization: 'Bearer wrong' },
    }))

    expect(res.status).toBe(401)
    expect(mockGetFlyerMonitorReport).not.toHaveBeenCalled()
  })

  it('returns the structured report and markdown when authorized', async () => {
    const res = await GET(new Request('http://localhost/api/internal/flyer-monitor', {
      headers: { authorization: 'Bearer cron-secret' },
    }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.subject).toContain('PlugAPro flyer monitor')
    expect(body.markdown).toContain('Plug A Pro flyer monitor')
    expect(body.report.prospectCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify RED**

Run: `pnpm exec vitest run __tests__/api/internal/flyer-monitor.test.ts`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement route**

Create `field-service/app/api/internal/flyer-monitor/route.ts`:

```ts
import { NextResponse } from 'next/server'
import { buildFlyerMonitorReport, getFlyerMonitorReport } from '@/lib/flyer-monitor'

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const report = await getFlyerMonitorReport()
  const markdown = buildFlyerMonitorReport(report)

  return NextResponse.json({
    ok: true,
    subject: report.subject,
    markdown,
    report,
  })
}
```

- [ ] **Step 4: Run route tests to verify GREEN**

Run: `pnpm exec vitest run __tests__/api/internal/flyer-monitor.test.ts`

Expected: PASS.

### Task 3: Verification

**Files:**
- Validate: `field-service/lib/flyer-monitor.ts`
- Validate: `field-service/app/api/internal/flyer-monitor/route.ts`
- Validate: `field-service/__tests__/lib/flyer-monitor.test.ts`
- Validate: `field-service/__tests__/api/internal/flyer-monitor.test.ts`

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm exec vitest run __tests__/lib/flyer-monitor.test.ts __tests__/api/internal/flyer-monitor.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader API baseline**

Run:

```bash
pnpm exec vitest run __tests__/api/health.test.ts __tests__/api/cron/provider-auto-approve.test.ts __tests__/api/internal/flyer-monitor.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`

Expected: PASS.

- [ ] **Step 4: Run lint**

Run: `pnpm lint`

Expected: PASS.

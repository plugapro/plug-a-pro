# Status Dashboard Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public Plug A Pro service-status dashboard honest and safe for public launch — stop leaking internal diagnostics, stop showing false-green for unverified services, add stale-data + maintenance states, and fix the mobile/a11y defects — without building a status table or cron yet.

**Architecture:** Extract the health checks into one shared module. The public `/api/health` returns only opaque business-level signals (`status, db, whatsapp, payments, timestamp`) with edge caching; a new CRON_SECRET-gated `/api/internal/health` returns the full diagnostics (`auth`, `build`, per-dependency detail). The presentation model (`lib/status/health.ts`) gains stale-detection and a `maintenance` state; the dashboard renders a distinct tone for `unknown` vs `not_monitored`, announces changes via `aria-live`, and no longer truncates card titles. Payments stops claiming green from credential presence and is labelled "not monitored" until a real PSP probe exists (deferred). Verification: unit tests for the pure model + route, a static-source contract guard for the component, and a Playwright `/status` mobile smoke test.

**Tech Stack:** Next.js 16 (App Router, route handlers), TypeScript, Prisma, Vitest (node env), Playwright e2e, Tailwind v4 with CSS custom-property design tokens, lucide-react icons.

**Scope (agreed):** Option A (minimal MVP-safe) **plus** two Option B items: maintenance state and stale-data detection. NOT in scope: status cache table, scheduled cron probe, incident history, real PSP/WhatsApp-send probes (these are a separate post-launch plan).

**Repo note:** App lives in `field-service/`. All paths below are relative to `field-service/` unless stated. Run all commands from `field-service/`.

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `lib/status/health-checks.ts` | Shared: run the live checks (DB ping, WhatsApp probe w/ 60s cache, payment-cred presence, flag/auth diagnostics, build metadata) and produce both the full result and the sanitized public body. | **Create** |
| `app/api/health/route.ts` | Public endpoint: rate-limit → run checks → return **sanitized** body + `Cache-Control`. | **Modify** |
| `app/api/internal/health/route.ts` | CRON_SECRET-gated endpoint: return **full** diagnostics for ops. | **Create** |
| `lib/status/health.ts` | Presentation model: add `maintenance` status, `stale` flag + max-age detection, honest `buildBotMessage`, `unknown`→`info` tone. | **Modify** |
| `components/status/StatusDashboard.tsx` | UI: add `info` tone, `maintenance` label/icon/headline, `aria-live`, accessible status icon, untruncate titles, stale banner. | **Modify** |
| `lib/status/health-model.ts` | Orphaned duplicate. | **Delete** |
| `__tests__/lib/status-health-model.test.ts` | Add stale + maintenance + honest-aggregate unit tests. | **Modify** |
| `__tests__/api/health.test.ts` | Update to the sanitized public shape; add 429 + no-sensitive-data tests. | **Modify** |
| `__tests__/api/internal-health.test.ts` | Auth-gate + full-payload tests for the internal route. | **Create** |
| `__tests__/components/status-dashboard-contract.test.ts` | Extend the static contract guard (aria-live present, no `truncate` on title, maintenance label present). | **Modify** |
| `e2e/smoke.spec.ts` + `lib/admin-nav-routes.ts` | Add `/status` to public smoke routes + a mobile assertion. | **Modify** |

---

## Task 1: Extract shared health checks and sanitize the public `/api/health`

**Files:**
- Create: `lib/status/health-checks.ts`
- Modify: `app/api/health/route.ts` (full rewrite of the handler body)
- Test: `__tests__/api/health.test.ts`

- [ ] **Step 1: Update the existing public-shape test to expect the sanitized body (failing test)**

In `__tests__/api/health.test.ts`, replace the `build` assertions in the "returns 200" test (currently lines ~44-50) and add an exposure guard. The public body must NOT contain `build` or `auth`:

```typescript
  it('returns 200 with sanitized public body (no build, no auth) when DB responds', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])

    const { GET } = await import('../../app/api/health/route')
    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.db).toBe('ok')
    expect(typeof body.timestamp).toBe('string')
    // Public body is opaque business-level only — internals are gated elsewhere.
    expect(body).not.toHaveProperty('build')
    expect(body).not.toHaveProperty('auth')
    // Payments is no longer green-by-credential-presence.
    expect(body.payments).not.toBe('ok')
    expect(res.headers.get('cache-control')).toContain('s-maxage=15')
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/api/health.test.ts -t "sanitized public body"`
Expected: FAIL (current route still returns `build` + `auth`, `payments: 'ok'`, no Cache-Control).

- [ ] **Step 3: Create the shared checks module**

Create `lib/status/health-checks.ts`:

```typescript
import { db } from '@/lib/db'
import { isEnabled, FLAG_KEYS } from '@/lib/flags'

const COMMIT_SHA = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_COMMIT_SHA ?? null
const COMMIT_REF = process.env.VERCEL_GIT_COMMIT_REF ?? process.env.GIT_COMMIT_REF ?? null
const BUILT_AT = process.env.VERCEL_DEPLOYMENT_CREATED_AT ?? null

const WHATSAPP_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN ?? null
const WHATSAPP_PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID ?? null

type WhatsAppProbeResult = 'ok' | 'error' | 'unknown'
type FlagStatus = 'enabled' | 'disabled' | 'unknown'
type OtpSecurityReportConfigStatus = 'disabled' | 'ready' | 'missing_otp_hash_pepper' | 'unknown'

// Shared 60s cache so the public route AND the internal route share one upstream
// Graph call (finding f4a7b4b2).
const WHATSAPP_PROBE_TTL_MS = 60_000
let _whatsappProbeCache: { value: WhatsAppProbeResult; expiresAt: number } | null = null

async function runWhatsAppProbe(): Promise<WhatsAppProbeResult> {
  if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID) return 'unknown'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(
      `https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_ID}?fields=display_phone_number`,
      { headers: { Authorization: `Bearer ${WHATSAPP_TOKEN}` }, signal: controller.signal },
    )
    clearTimeout(timeout)
    return res.ok ? 'ok' : 'error'
  } catch {
    return 'error'
  }
}

async function probeWhatsApp(): Promise<WhatsAppProbeResult> {
  const now = Date.now()
  if (_whatsappProbeCache && _whatsappProbeCache.expiresAt > now) return _whatsappProbeCache.value
  const value = await runWhatsAppProbe()
  _whatsappProbeCache = { value, expiresAt: now + WHATSAPP_PROBE_TTL_MS }
  return value
}

function flagStatus(result: PromiseSettledResult<boolean>): FlagStatus {
  if (result.status !== 'fulfilled') return 'unknown'
  return result.value ? 'enabled' : 'disabled'
}

function otpSecurityReportConfigStatus(flag: FlagStatus): OtpSecurityReportConfigStatus {
  if (flag === 'unknown') return 'unknown'
  if (flag === 'disabled') return 'disabled'
  return process.env.OTP_HASH_PEPPER?.trim() ? 'ready' : 'missing_otp_hash_pepper'
}

export interface FullHealthResult {
  ok: boolean // drives the public HTTP status (200 vs 503)
  status: 'ok' | 'degraded' | 'maintenance'
  db: 'ok' | 'error'
  whatsapp: WhatsAppProbeResult
  // Payments has no live probe yet: never claim 'ok' publicly. 'unknown' → "Not monitored".
  payments: 'unknown'
  timestamp: string
  // Internal-only diagnostics (never sent to the public body):
  auth: {
    otp_whatsapp_flag: FlagStatus
    otp_security_report_flag: FlagStatus
    otp_security_report_config: OtpSecurityReportConfigStatus
    supabase_env_complete: boolean
  }
  build: { commitSha: string | null; commitShaShort: string | null; commitRef: string | null; builtAt: string | null }
}

// Ops can announce a planned outage without a deploy: set MAINTENANCE_MODE=1.
function maintenanceModeOn(): boolean {
  const v = process.env.MAINTENANCE_MODE?.trim().toLowerCase()
  return v === '1' || v === 'true'
}

export async function runHealthChecks(): Promise<FullHealthResult> {
  const timestamp = new Date().toISOString()
  const build = {
    commitSha: COMMIT_SHA,
    commitShaShort: COMMIT_SHA ? COMMIT_SHA.slice(0, 7) : null,
    commitRef: COMMIT_REF,
    builtAt: BUILT_AT,
  }

  const [dbResult, whatsappResult, otpFlagResult, otpSecurityReportFlagResult] = await Promise.allSettled([
    db.$queryRaw`SELECT 1`,
    probeWhatsApp(),
    isEnabled(FLAG_KEYS.AUTH_OTP_WHATSAPP),
    isEnabled('security.otp.report'),
  ])

  const dbOk = dbResult.status === 'fulfilled'
  const whatsapp = whatsappResult.status === 'fulfilled' ? whatsappResult.value : 'error'
  const otpSecurityReportFlag = flagStatus(otpSecurityReportFlagResult)
  const otpSecurityReportConfig = otpSecurityReportConfigStatus(otpSecurityReportFlag)

  const auth = {
    otp_whatsapp_flag: flagStatus(otpFlagResult),
    otp_security_report_flag: otpSecurityReportFlag,
    otp_security_report_config: otpSecurityReportConfig,
    supabase_env_complete: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    ),
  }

  if (maintenanceModeOn()) {
    return { ok: true, status: 'maintenance', db: dbOk ? 'ok' : 'error', whatsapp, payments: 'unknown', timestamp, auth, build }
  }

  // NOTE: a missing OTP pepper is a SECURITY-CONFIG concern, not a customer-journey
  // outage — it no longer downgrades the PUBLIC status (the internal route still
  // exposes it via `auth`). Public status reflects end-user reachability only.
  const ok = dbOk
  return {
    ok,
    status: ok ? 'ok' : 'degraded',
    db: dbOk ? 'ok' : 'error',
    whatsapp,
    payments: 'unknown',
    timestamp,
    auth,
    build,
  }
}

// The ONLY fields an unauthenticated caller may see. Opaque, business-level.
export function toPublicHealthBody(full: FullHealthResult) {
  return {
    status: full.status,
    db: full.db,
    whatsapp: full.whatsapp,
    payments: full.payments,
    timestamp: full.timestamp,
  }
}
```

- [ ] **Step 4: Rewrite the public route to use it, sanitized + cached**

Replace the entire body of `app/api/health/route.ts` with:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { checkHealthProbeLimit } from '@/lib/rate-limit'
import { trustedClientIp } from '@/lib/request-ip'
import { runHealthChecks, toPublicHealthBody } from '@/lib/status/health-checks'

export const dynamic = 'force-dynamic'

export async function GET(request?: NextRequest) {
  const timestamp = new Date().toISOString()

  // Trusted client IP (not raw X-Forwarded-For, which is spoofable).
  const ip = request ? trustedClientIp(request) : null
  const probeLimit = await checkHealthProbeLimit({ ip })
  if (!probeLimit.ok) {
    return NextResponse.json(
      { status: 'rate_limited', timestamp },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(probeLimit.retryAfterMs / 1000)) } },
    )
  }

  const full = await runHealthChecks()
  const body = toPublicHealthBody(full)
  const httpStatus = full.ok ? 200 : 503
  return NextResponse.json(body, {
    status: httpStatus,
    headers: full.ok
      // Edge-cache the healthy response so 30s client polling collapses to one
      // upstream DB hit per ~15s regardless of concurrent viewers.
      ? { 'Cache-Control': 'public, s-maxage=15, stale-while-revalidate=45' }
      : { 'Cache-Control': 'no-store' },
  })
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm exec vitest run __tests__/api/health.test.ts`
Expected: the sanitized-body test PASSES. Other tests in the file that assert `build`/`auth`/`payments:'ok'`/503-on-missing-pepper will FAIL — fix them in Step 6.

- [ ] **Step 6: Repair the remaining assertions in `health.test.ts`**

In `__tests__/api/health.test.ts`: (a) remove/adjust any assertion that the public body has `build` or `auth`; (b) the "503 when DB throws" test keeps asserting `res.status === 503` and `body.db === 'error'` but must NOT assert an `auth` block; (c) delete or move any test asserting 503 from a missing OTP pepper (that behaviour moved to the internal route + is no longer a public downgrade). Re-run:

Run: `pnpm exec vitest run __tests__/api/health.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Typecheck + lint + commit**

```bash
pnpm typecheck && pnpm exec eslint app/api/health/route.ts lib/status/health-checks.ts __tests__/api/health.test.ts
git add app/api/health/route.ts lib/status/health-checks.ts __tests__/api/health.test.ts
git commit -m "refactor(health): sanitize public /api/health, share checks, edge-cache, trusted IP"
```

---

## Task 2: Add the CRON_SECRET-gated internal health endpoint

**Files:**
- Create: `app/api/internal/health/route.ts`
- Test: `__tests__/api/internal-health.test.ts`

`/api/internal` is already public-listed in `proxy.ts` for service-to-service calls and the handlers self-enforce `CRON_SECRET` — mirror the existing pattern (e.g. `app/api/internal/cron/rebuild-candidate-pool/route.ts:15`).

- [ ] **Step 1: Write the failing auth-gate test**

Create `__tests__/api/internal-health.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/db', () => ({ db: { $queryRaw: vi.fn() } }))
vi.mock('@/lib/flags', () => ({
  FLAG_KEYS: { AUTH_OTP_WHATSAPP: 'auth.otp.whatsapp' },
  isEnabled: vi.fn().mockResolvedValue(false),
}))

function req(secret?: string) {
  return new NextRequest('http://localhost/api/internal/health', {
    headers: secret ? { authorization: `Bearer ${secret}` } : {},
  })
}

describe('GET /api/internal/health', () => {
  const originalEnv = { ...process.env }
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); process.env.CRON_SECRET = 'test-secret' })
  afterEach(() => { process.env = { ...originalEnv } })

  it('returns 401 without a valid CRON_SECRET', async () => {
    const { GET } = await import('../../app/api/internal/health/route')
    expect((await GET(req())).status).toBe(401)
    expect((await GET(req('wrong'))).status).toBe(401)
  })

  it('returns full diagnostics (auth + build) with a valid CRON_SECRET', async () => {
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('../../app/api/internal/health/route')
    const res = await GET(req('test-secret'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).toHaveProperty('auth')
    expect(body).toHaveProperty('build')
    expect(body.db).toBe('ok')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/api/internal-health.test.ts`
Expected: FAIL (route does not exist).

- [ ] **Step 3: Create the internal route**

Create `app/api/internal/health/route.ts`:

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { runHealthChecks } from '@/lib/status/health-checks'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const full = await runHealthChecks()
  // Full diagnostics for ops only. Never cache; never public.
  return NextResponse.json(full, { status: full.ok ? 200 : 503, headers: { 'Cache-Control': 'no-store' } })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run __tests__/api/internal-health.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
pnpm typecheck && pnpm exec eslint app/api/internal/health/route.ts __tests__/api/internal-health.test.ts
git add app/api/internal/health/route.ts __tests__/api/internal-health.test.ts
git commit -m "feat(health): add CRON_SECRET-gated /api/internal/health for ops diagnostics"
```

---

## Task 3: Stale-data detection in the presentation model

**Files:**
- Modify: `lib/status/health.ts`
- Test: `__tests__/lib/status-health-model.test.ts`

- [ ] **Step 1: Write the failing stale test**

Add to `__tests__/lib/status-health-model.test.ts`:

```typescript
  it('marks the model stale and overall unknown when the timestamp exceeds max age', () => {
    const oldIso = new Date(Date.now() - 5 * 60_000).toISOString() // 5 min old
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: oldIso })
    expect(model.stale).toBe(true)
    expect(model.overall).toBe('unknown')
  })

  it('is not stale for a fresh timestamp', () => {
    const model = normalizeHealthPayload({ status: 'ok', db: 'ok', timestamp: new Date().toISOString() })
    expect(model.stale).toBe(false)
    expect(model.overall).toBe('operational')
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts -t "stale"`
Expected: FAIL (`stale` is undefined).

- [ ] **Step 3: Implement stale detection**

In `lib/status/health.ts`:

1. Add the constant near the top (after `BASE_CHECK_DEFAULT`):

```typescript
// A health signal older than this is treated as unverifiable (a frozen edge
// instance or a wedged checker would otherwise show stale green indefinitely).
const MAX_HEALTH_AGE_MS = 90_000
```

2. Add `stale: boolean` to the `HealthDashboardModel` interface (after `overall: HealthStatus`):

```typescript
  stale: boolean
```

3. In `normalizeHealthPayload`, after `const platformStatus = derivePlatformStatus(...)`, compute staleness and override:

```typescript
  const asOfIso = formatTimestamp(body?.timestamp, nowIso)
  const ageMs = Date.now() - new Date(asOfIso).getTime()
  const stale = Number.isFinite(ageMs) && ageMs > MAX_HEALTH_AGE_MS
  const effectiveOverall: HealthStatus = stale ? 'unknown' : platformStatus
```

4. Use `effectiveOverall` for `overall` and the bot message in the return object, and add `stale`. Change the return block:

```typescript
  return {
    asOf: asOfIso,
    overall: effectiveOverall,
    healthEndpoint: endpointStatus,
    database: dbStatus,
    platform: platformStatus,
    whatsapp: whatsappStatus,
    payments: paymentsStatus,
    groups,
    build,
    botMessage: stale ? 'The latest health signal is out of date; status cannot be confirmed right now.' : botMessage,
    stale,
  }
```

5. In `buildFallbackHealthModel`, add `stale: true` to its returned object (the endpoint is unreachable → its data is by definition not fresh).

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts`
Expected: PASS (new + existing).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/status/health.ts __tests__/lib/status-health-model.test.ts
git commit -m "feat(health): detect stale health signals and surface as unknown"
```

---

## Task 4: Maintenance state (model + labels + icon)

**Files:**
- Modify: `lib/status/health.ts`, `components/status/StatusDashboard.tsx`
- Test: `__tests__/lib/status-health-model.test.ts`

The route already emits `status: 'maintenance'` (Task 1, `runHealthChecks` reads `MAINTENANCE_MODE`). Now the model + UI must understand it.

- [ ] **Step 1: Write the failing maintenance test**

Add to `__tests__/lib/status-health-model.test.ts`:

```typescript
  it('maps a maintenance payload to overall maintenance', () => {
    const model = normalizeHealthPayload({ status: 'maintenance', db: 'ok', timestamp: new Date().toISOString() })
    expect(model.overall).toBe('maintenance')
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts -t "maintenance"`
Expected: FAIL (`normalizeStatus` returns `unknown` for `'maintenance'`).

- [ ] **Step 3: Add `maintenance` to the model layer**

In `lib/status/health.ts`:

1. Extend the type and labels:

```typescript
export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unknown' | 'not_monitored' | 'maintenance'
```
```typescript
export const STATUS_LABELS = {
  operational: 'Running',
  degraded: 'Degraded',
  down: 'Not running',
  unknown: 'Unknown',
  not_monitored: 'Not separately monitored',
  maintenance: 'Under maintenance',
} as const
```

2. Map the string in `normalizeStatus` (add before the final `return`):

```typescript
  if (normalized === 'maintenance') return 'maintenance'
```

3. In `derivePlatformStatus`, short-circuit maintenance so it wins over operational:

```typescript
function derivePlatformStatus(healthStatus: HealthStatus, dbStatus: HealthStatus): HealthStatus {
  if (healthStatus === 'maintenance') return 'maintenance'
  return mergeStatus([healthStatus, dbStatus])
}
```

4. Add a maintenance branch to `buildBotMessage` (top of the function):

```typescript
  if (platform === 'maintenance') {
    return 'Plug A Pro is undergoing scheduled maintenance. Some services may be briefly unavailable.'
  }
```

5. Extend `statusToneFromCheck`: `unknown` becomes its own (info) tone, distinct from `not_monitored` (neutral); `maintenance` uses info too:

```typescript
export const statusToneFromCheck: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  operational: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'info',
  not_monitored: 'neutral',
  maintenance: 'info',
}
```

- [ ] **Step 4: Run the model test to confirm it passes**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `info` tone + `maintenance` rendering to the dashboard**

In `components/status/StatusDashboard.tsx`:

1. Extend the `Tone` type (line ~34): `type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'`

2. Add an `info` entry to the `T` object (uses the existing `--tone-info-*` tokens):

```typescript
  info: {
    bg: 'bg-[var(--tone-info-bg)]',
    border: 'border-[var(--tone-info-border)]',
    fg: 'text-[var(--tone-info-fg)]',
    dot: 'bg-[var(--tone-info-fg)]',
    borderL: 'border-l-[var(--tone-info-fg)]',
  },
```

3. Add maintenance to `USER_STATUS_LABELS`:

```typescript
  maintenance: 'Scheduled maintenance',
```

4. Add a `maintenance` case to `headlineFor`:

```typescript
    case 'maintenance': return 'Scheduled maintenance in progress'
```

5. Import `Wrench` from lucide-react and add a `maintenance` case to `StatusIcon`:

```typescript
    case 'maintenance':
      return <Wrench className={`${className} ${cls.fg}`} />
```

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck && pnpm exec eslint lib/status/health.ts components/status/StatusDashboard.tsx
git add lib/status/health.ts components/status/StatusDashboard.tsx __tests__/lib/status-health-model.test.ts
git commit -m "feat(health): add maintenance state and distinct unknown tone"
```

---

## Task 5: Honest aggregate copy (no overpromise)

**Files:**
- Modify: `lib/status/health.ts`
- Test: `__tests__/lib/status-health-model.test.ts`

Keep `overall = platform` (core up/down), but the operational sub-message must not imply WhatsApp/payments are verified when they are `not_monitored`.

- [ ] **Step 1: Write the failing copy test**

```typescript
  it('does not claim WhatsApp/payments are verified when they are not monitored', () => {
    const model = normalizeHealthPayload({
      status: 'ok', db: 'ok', whatsapp: 'unknown', payments: 'unknown',
      timestamp: new Date().toISOString(),
    })
    expect(model.overall).toBe('operational')
    expect(model.botMessage).not.toBe('All core services are running.')
    expect(model.botMessage.toLowerCase()).toContain('not')
  })
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts -t "not claim"`
Expected: FAIL (current message is the flat "All core services are running.").

- [ ] **Step 3: Make `buildBotMessage` aware of peripheral signals**

In `lib/status/health.ts`, change the signature and the operational branch:

```typescript
function buildBotMessage(
  overall: HealthStatus,
  platform: HealthStatus,
  whatsapp: HealthStatus,
  payments: HealthStatus,
): string {
  if (platform === 'maintenance') {
    return 'Plug A Pro is undergoing scheduled maintenance. Some services may be briefly unavailable.'
  }
  if (platform === 'down') {
    return 'Login and API checks are not responding. Customer and provider journeys may be affected.'
  }
  if (platform === 'degraded') {
    return 'Some areas may be affected. We are monitoring and will update soon.'
  }
  if (platform === 'operational') {
    const unverified: string[] = []
    if (whatsapp !== 'operational') unverified.push('WhatsApp updates')
    if (payments !== 'operational') unverified.push('payments')
    if (unverified.length === 0) return 'Bookings, search, WhatsApp updates and payments are all running.'
    return `Core booking and search services are running. ${unverified.join(' and ')} ${unverified.length === 1 ? 'is' : 'are'} not independently verified right now.`
  }
  return 'I cannot verify the latest platform health right now, but the latest saved signals are displayed.'
}
```

Update the call site (currently `buildBotMessage(platformStatus, platformStatus)`):

```typescript
  const botMessage = buildBotMessage(platformStatus, platformStatus, whatsappStatus, paymentsStatus)
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `pnpm exec vitest run __tests__/lib/status-health-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
pnpm typecheck
git add lib/status/health.ts __tests__/lib/status-health-model.test.ts
git commit -m "fix(health): honest aggregate message — flag unverified WhatsApp/payments"
```

---

## Task 6: Mobile truncation, aria-live, accessible status icon

**Files:**
- Modify: `components/status/StatusDashboard.tsx`
- Test: `__tests__/components/status-dashboard-contract.test.ts`

The repo has no jsdom/RTL harness; guard these with the existing static-source contract test (cheap, no new deps) and the e2e test in Task 8.

- [ ] **Step 1: Add failing contract assertions**

In `__tests__/components/status-dashboard-contract.test.ts`, add:

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
const SRC = readFileSync(join(process.cwd(), 'components/status/StatusDashboard.tsx'), 'utf8')

it('does not truncate the journey card title (mobile labels must wrap, not clip)', () => {
  // The label span must not use `truncate`.
  expect(SRC).not.toMatch(/font-semibold[^"]*\btruncate\b/)
})

it('announces status changes to assistive tech via an aria-live region', () => {
  expect(SRC).toContain('aria-live')
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm exec vitest run __tests__/components/status-dashboard-contract.test.ts`
Expected: FAIL (title currently has `truncate`; no `aria-live`).

- [ ] **Step 3: Fix the JourneyCard title (remove `truncate`, allow 2-line wrap)**

In `components/status/StatusDashboard.tsx`, change the title span (currently line ~305):

```tsx
          <span className="text-sm font-semibold leading-tight tracking-tight line-clamp-2">{label}</span>
```

(Removes `truncate`; `line-clamp-2` allows two lines so "WhatsApp Updates" / "Payments & Receipts" render in full on a 375px screen.)

- [ ] **Step 4: Add an aria-live region around the headline + a maintenance/stale-aware banner**

In `HeroBanner`, wrap the headline/message block (the `<div className="min-w-0">` at ~line 244) with a live region:

```tsx
          <div className="min-w-0" role="status" aria-live="polite" aria-atomic="true">
            <h1 className={`text-xl font-bold tracking-tight sm:text-2xl ${cls.fg}`}>
              {headlineFor(model.overall)}
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
              {model.botMessage}
            </p>
          </div>
```

- [ ] **Step 5: Give the status icon an accessible name**

In `StatusIcon` (line ~186), wrap the returned icon so screen readers announce the state. Change the function to accept the status label and render an `aria-label` on a wrapping span; simplest: add `aria-label` to each icon via a shared wrapper. Replace the `switch` return values with a labelled wrapper:

```tsx
function StatusIcon({ status, className = 'size-4' }: { status: HealthStatus; className?: string }) {
  const cls = T[tone(status)]
  const label = STATUS_LABELS[status]
  const Icon =
    status === 'operational' ? CheckCircle2
    : status === 'degraded' ? AlertTriangle
    : status === 'down' ? XCircle
    : status === 'maintenance' ? Wrench
    : HelpCircle
  return (
    <span role="img" aria-label={label} className="inline-flex">
      <Icon className={`${className} ${cls.fg}`} />
    </span>
  )
}
```

- [ ] **Step 6: Reduce the footer contrast risk**

In `StatusFooter` (line ~344) change `text-muted-foreground/40` → `text-muted-foreground` and bump the section label in `JourneyGrid` (line ~320) from `text-[10px]` → `text-[11px]`.

- [ ] **Step 7: Run contract test + typecheck**

Run: `pnpm exec vitest run __tests__/components/status-dashboard-contract.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
pnpm exec eslint components/status/StatusDashboard.tsx
git add components/status/StatusDashboard.tsx __tests__/components/status-dashboard-contract.test.ts
git commit -m "fix(status-ui): untruncate titles, add aria-live + accessible status icons"
```

---

## Task 7: Remove orphaned `health-model.ts`

**Files:**
- Delete: `lib/status/health-model.ts`

- [ ] **Step 1: Confirm it is unreferenced**

Run: `grep -rn "status/health-model" app components lib __tests__ --include="*.ts" --include="*.tsx" | grep -v "health-model.ts:"`
Expected: no output (orphaned).

- [ ] **Step 2: Delete and verify the build still typechecks**

```bash
git rm lib/status/health-model.ts
pnpm typecheck
```
Expected: typecheck passes (nothing imported it).

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(health): remove orphaned duplicate health-model.ts"
```

---

## Task 8: Route guard tests + `/status` e2e smoke

**Files:**
- Modify: `__tests__/api/health.test.ts`, `e2e/smoke.spec.ts`, `lib/admin-nav-routes.ts`

- [ ] **Step 1: Add the 429 + no-sensitive-data tests (failing)**

In `__tests__/api/health.test.ts`, add a mock + tests. At the top with the other mocks:

```typescript
vi.mock('@/lib/rate-limit', () => ({ checkHealthProbeLimit: vi.fn() }))
```

Tests:

```typescript
  it('returns 429 with Retry-After when the probe limit is exceeded', async () => {
    const { checkHealthProbeLimit } = await import('@/lib/rate-limit')
    ;(checkHealthProbeLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, retryAfterMs: 60_000 })
    const { GET } = await import('../../app/api/health/route')
    const res = await GET(new NextRequest('http://localhost/api/health'))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('60')
  })

  it('never leaks raw secret values in the public body', async () => {
    process.env.WHATSAPP_ACCESS_TOKEN = 'SECRET_WA_TOKEN_VALUE'
    process.env.PEACH_ACCESS_TOKEN = 'SECRET_PEACH_VALUE'
    const { checkHealthProbeLimit } = await import('@/lib/rate-limit')
    ;(checkHealthProbeLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })
    const { db } = await import('@/lib/db')
    ;(db.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ '?column?': 1 }])
    const { GET } = await import('../../app/api/health/route')
    const text = await (await GET(new NextRequest('http://localhost/api/health'))).text()
    expect(text).not.toContain('SECRET_WA_TOKEN_VALUE')
    expect(text).not.toContain('SECRET_PEACH_VALUE')
    expect(text).not.toContain('supabase_env_complete')
    expect(text).not.toContain('commitRef')
  })
```

Note: existing tests in this file don't mock rate-limit, so set a default `beforeEach`: `(checkHealthProbeLimit as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true })` so they keep passing.

- [ ] **Step 2: Run it to confirm 429/no-leak behaviour**

Run: `pnpm exec vitest run __tests__/api/health.test.ts`
Expected: PASS (route already sanitized in Task 1; rate-limit branch already exists).

- [ ] **Step 3: Add `/status` to the public smoke routes**

In `lib/admin-nav-routes.ts`, add `'/status'` to `CLIENT_PUBLIC_SMOKE_ROUTES`. Then in `e2e/smoke.spec.ts`, inside the mobile-viewport block, add:

```typescript
  test('status page loads on mobile and shows a status headline', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/status')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    // No raw slug/internal text leaked into the visible page.
    await expect(page.locator('body')).not.toContainText('commitRef')
    await expect(page.locator('body')).not.toContainText('supabase_env_complete')
  })
```

- [ ] **Step 4: Run the full unit suite**

Run: `pnpm test`
Expected: all pass. (e2e runs separately via `pnpm e2e` against a running app; note it in the PR if the environment can't run Playwright.)

- [ ] **Step 5: Commit**

```bash
git add __tests__/api/health.test.ts e2e/smoke.spec.ts lib/admin-nav-routes.ts
git commit -m "test(health): cover 429, no-sensitive-data, and /status mobile smoke"
```

---

## Final verification

- [ ] `pnpm typecheck` — clean
- [ ] `pnpm lint` — clean (report any pre-existing unrelated failures separately)
- [ ] `pnpm test` — all unit tests pass
- [ ] Manual: `curl -s localhost:3000/api/health | jq` shows ONLY `{status, db, whatsapp, payments, timestamp}` — no `auth`, no `build`. `curl -s -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/internal/health | jq` shows the full diagnostics; without the header it returns 401.
- [ ] Manual: set `MAINTENANCE_MODE=1`, reload `/status` → headline reads "Scheduled maintenance in progress".
- [ ] Manual (mobile 375px): "WhatsApp Updates" and "Payments & Receipts" render in full (no `…`); Payments card reads "Not separately monitored".

## Out of scope (next plan, post-launch)

Real per-journey DB canary probes (search/booking/onboarding/matching freshness), real PSP + WhatsApp-send probes, a `ServiceStatus` cache table + Vercel cron writing sanitized statuses (which makes "Plug A Pro Bot" a real checker), incident history, external uptime monitor + alerting, and a full jsdom/RTL component-test harness.

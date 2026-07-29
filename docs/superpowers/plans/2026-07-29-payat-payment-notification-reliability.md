# Pay@ Payment-Notification Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plug A Pro learn that a Pay@ payment succeeded — card or over-the-counter — without depending on a webhook that has never once arrived.

**Architecture:** Port the Pay@Go "doorbell + read-back" pattern onto the provider-credit rail. The webhook stops being evidence and becomes a hint; the authority becomes a `rtp/read` call to Pay@. A reconcile sweep then reads every intent's true state before the expiry cron is allowed to kill it, so a missed webhook costs nothing. Finally, any intent that still dies unpaid emits an ops-visible signal instead of failing silently.

**Tech Stack:** Next.js 16 App Router, TypeScript, Prisma 6 / Postgres (Supabase), Vitest, Pay@ YAPI integrator API (`go.payat.co.za/yapi/v1`).

## Background — why this exists

Three Pay@ intents have ever been created (2026-06-07, 2026-06-10, 2026-07-17). All three successfully created an RTP at Pay@. **Zero received an ITN.** Two expired uncredited; one (Wilson Pfidze) was credited by hand via SQL four days later, only because he complained. The platform has taken R100 of real money, once, manually.

Root cause is architectural, not a bug: `/api/payat/webhook` trusts the webhook payload and there is no other path to discovery. `lib/payat/` contains only `token.ts` and `payment.ts` — **no read capability exists at all**. The expire cron flips `PENDING_PAYMENT → EXPIRED` purely on `expiresAt < now` without ever asking Pay@ whether money arrived (`app/api/cron/expire-payment-intents/route.ts:33-39`). Its recovery loop only rescues intents already at `ITN_RECEIVED`, so a *missing* webhook is invisible to it.

Rail B (`lib/payat-go/`) already does this correctly and is the template being copied.

## Global Constraints

- **Additive migrations only.** No schema drops or renames in feature PRs. (CLAUDE.md house rule 2)
- **Every admin-facing feature ships behind a flag**, flipped separately. (house rule 5)
- **No `as any`** without a nearby TODO explaining why. (house rule 7)
- New flags must be registered in `field-service/lib/feature-flags-registry.ts` **before** use anywhere else — `isEnabled()` is compile-time validated against that registry.
- Never log the raw `PAYAT_MERCHANT_IDENTIFIER`, raw Pay@ response bodies in production, or provider PII. Follow the existing masking helpers in `lib/payat/payment.ts`.
- All money mutations go through the existing ledger-first path (`creditProviderWalletFromPayatWebhook`). Do not write wallet balances directly.
- Amounts are **integer cents** everywhere. Never apply a magnitude heuristic to convert — see the comment block at `app/api/payat/webhook/route.ts:95-101` explaining why that would let an R1 payment satisfy an R100 intent.
- Run from `field-service/`: tests `pnpm test`, lint `pnpm lint`.

---

## Ops prerequisites (NOT code — must be done in the Pay@ merchant portal)

These block Tasks 2–4 from working against production. Code and tests can be written and merged first; the flags stay OFF until these are confirmed.

- [ ] **P1. Add `rtp:read` to the `PAYAT_*` credential's scopes.** Today `PAYAT_SCOPES` defaults to `rtp:create:single` (`lib/payat/token.ts:56`) — create-only. Without this, every read in this plan returns 403. The Pay@Go credential already has `rtp:read` (`PAYAT_GO_SCOPES`), so the entitlement exists on the account; it needs granting to this client id.
- [ ] **P2. Register the webhook URL** `https://app.plugapro.co.za/api/payat/webhook` in the Pay@ merchant portal, and record which signature encoding it sends (hex vs base64). `PAYAT_WEBHOOK_SECRET` is already set in Vercel production. The 0-for-3 ITN record means this is either unregistered or encoding-mismatched — `route.ts:47-56` logs `signature length mismatch` if it is the latter.
- [ ] **P3. Confirm the read key.** `rtp/read` in Pay@Go is keyed by `clientAccountNumber` (`lib/payat-go/client.ts:564`). Confirm with Pay@ whether the same merchant endpoint also supports lookup by `requestToPayId`. **This determines whether the two historical stranded intents can be recovered programmatically** — we hold their `requestToPayId` (335645, 335763) and `sourceReference`, but never persisted their `clientAccountNumber`. If read-by-`requestToPayId` is unsupported, those two can only be resolved via the portal by hand.
- [ ] **P4. Manually check the two stranded till references in the portal** and credit if collected: Moses Ntshalintshali `1170041885683103429129986` (06-07), Prince Charles Ncube `1170041885645516334701782` (06-10). Independent of this plan; both providers are still ACTIVE at 0 paid credits.

---

## File Structure

**Created:**
- `field-service/lib/payat/read.ts` — `readPayatSingleRtp()`; the authoritative "what does Pay@ think happened" call. Isolated from `payment.ts` so the create path and read path can be tested and rate-limited independently.
- `field-service/lib/payat/reconcile.ts` — `reconcilePayatIntent()`; the single decision function shared by the webhook and the cron. Both callers ask this one question, so push and pull can never diverge.
- `field-service/__tests__/lib/payat-read.test.ts`
- `field-service/__tests__/lib/payat-reconcile.test.ts`
- `field-service/prisma/migrations/<timestamp>_add_payment_intent_client_account_number/migration.sql`

**Modified:**
- `field-service/prisma/schema.prisma` — add `clientAccountNumber` to `PaymentIntent`
- `field-service/lib/payat/payment.ts` — return the generated `clientAccountNumber` instead of discarding it
- `field-service/lib/provider-credit-payment-intents.ts:659` — persist it
- `field-service/lib/feature-flags-registry.ts` — register two flags
- `field-service/app/api/payat/webhook/route.ts` — doorbell mode
- `field-service/app/api/cron/expire-payment-intents/route.ts` — reconcile before expiring
- `field-service/__tests__/lib/payat-payment.test.ts`, `field-service/__tests__/api/payat-webhook.test.ts`

**Reused, not rewritten:**
- `mapPayAtGoAccountStateToInternalStatus()` from `lib/payat-go/status.ts:25` — a pure function over Pay@ `accountState` values with no config dependency. Pay@ and Pay@Go are the same platform; duplicating this mapping would let the two rails drift.

---

### Task 1: Persist `clientAccountNumber` on PaymentIntent

Today `generateClientAccountNumber()` is called inline inside the fetch body at `lib/payat/payment.ts:195` and thrown away — it is never returned or stored. Since `rtp/read` is keyed by it, **no read-back is possible for any intent until this lands.** This task is a hard prerequisite for Tasks 2–4.

**Files:**
- Modify: `field-service/prisma/schema.prisma` (model `PaymentIntent`, ~line 1364)
- Modify: `field-service/lib/payat/payment.ts:59` (generator), `:195` (call site), `:89` (parse return)
- Modify: `field-service/lib/provider-credit-payment-intents.ts:659`
- Test: `field-service/__tests__/lib/payat-payment.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `PaymentIntent.clientAccountNumber: string | null`; `createPayatRtp()` return type gains `clientAccountNumber: string`

- [ ] **Step 1: Write the failing test**

Add to `field-service/__tests__/lib/payat-payment.test.ts`:

```typescript
it('returns the generated clientAccountNumber so it can be persisted for rtp:read', async () => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () => JSON.stringify({
      paymentLink: 'https://go.payat.co.za/pay/abc',
      sourceReference: '1170041885683103429129986',
      requestToPayId: 335645,
    }),
  })
  vi.stubGlobal('fetch', fetchMock)

  const result = await createPayatRtp({
    topupId: 'intent-1',
    amountCents: 10000,
    description: 'Plug A Pro credits top-up',
    providerPhone: '+27820000000',
    providerName: 'Test Provider',
    providerEmail: 'test@example.com',
  })

  // The value we send to Pay@ must be the value we keep.
  const sentBody = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
  expect(result.clientAccountNumber).toBe(sentBody.clientAccountNumber)
  expect(result.clientAccountNumber).toMatch(/^\d{14}$/)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __tests__/lib/payat-payment.test.ts -t 'clientAccountNumber'`
Expected: FAIL — `result.clientAccountNumber` is `undefined`.

- [ ] **Step 3: Thread the value through `payment.ts`**

Hoist the generated value above the fetch so it can be both sent and returned. At `lib/payat/payment.ts`, before the `fetch(` call (currently ~line 186):

```typescript
const clientAccountNumber = generateClientAccountNumber()
```

Replace the inline call in the request body (line ~195):

```typescript
        body: JSON.stringify({
          clientAccountNumber,
```

Extend the parse result type (~line 18) and the parse return (~line 89):

```typescript
  sourceReference?: string
  requestToPayId?: number
  clientAccountNumber: string
```

```typescript
  return { reference: fallbackReference, paymentLink: rawLink, sourceReference, requestToPayId, clientAccountNumber }
```

Ensure the value flows into whatever object `createPayatRtp` returns — pass `clientAccountNumber` into the parse helper as an argument rather than re-generating it, so the sent and returned values cannot diverge.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run __tests__/lib/payat-payment.test.ts -t 'clientAccountNumber'`
Expected: PASS

- [ ] **Step 5: Add the schema column**

In `field-service/prisma/schema.prisma`, model `PaymentIntent`, add beside the existing Pay@ fields (near `sourceReference` / `requestToPayId`):

```prisma
  // Pay@ RTP lookup key. Required for rtp:read reconciliation — without it an
  // intent cannot be checked against Pay@. Nullable because intents created
  // before 2026-07-29 never captured it.
  clientAccountNumber    String?
```

And add to the index block at the end of the model:

```prisma
  @@index([clientAccountNumber])
```

- [ ] **Step 6: Generate the migration**

Run: `pnpm prisma migrate dev --name add_payment_intent_client_account_number`
Expected: a new additive migration; verify the generated SQL contains only `ADD COLUMN` and `CREATE INDEX`, no `DROP`.

- [ ] **Step 7: Persist it at intent-creation**

In `field-service/lib/provider-credit-payment-intents.ts`, extend the type at ~line 400:

```typescript
  sourceReference?: string | null
  requestToPayId?: number | null
  clientAccountNumber?: string | null
```

And the write at ~line 659:

```typescript
        sourceReference: payat.sourceReference,
        requestToPayId: payat.requestToPayId,
        clientAccountNumber: payat.clientAccountNumber,
```

- [ ] **Step 8: Run the full suite**

Run: `pnpm test`
Expected: all green. `pnpm lint` clean.

- [ ] **Step 9: Commit**

```bash
git add field-service/prisma/schema.prisma field-service/prisma/migrations field-service/lib/payat/payment.ts field-service/lib/provider-credit-payment-intents.ts field-service/__tests__/lib/payat-payment.test.ts
git commit -m "feat(payat): persist clientAccountNumber so RTPs can be read back"
```

---

### Task 2: Add the Pay@ RTP read client

**Files:**
- Create: `field-service/lib/payat/read.ts`
- Test: `field-service/__tests__/lib/payat-read.test.ts`

**Interfaces:**
- Consumes: `getPayatToken()` from `lib/payat/token.ts`; `PayatApiError`, `PayatConfigError` from `lib/payat/payment.ts`; `mapPayAtGoAccountStateToInternalStatus` + `InternalPayAtGoStatus` from `lib/payat-go/status.ts`
- Produces:

```typescript
export type PayatRtpState = {
  clientAccountNumber: string
  accountState: string
  internalStatus: InternalPayAtGoStatus
  amountCents: number | null
  amountPaidCents: number | null
  paidAt: Date | null
  expiresAt: Date | null
}
export async function readPayatSingleRtp(clientAccountNumber: string): Promise<PayatRtpState>
```

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/payat-read.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readPayatSingleRtp } from '@/lib/payat/read'

vi.mock('@/lib/payat/token', () => ({ getPayatToken: vi.fn().mockResolvedValue('tok') }))

describe('readPayatSingleRtp', () => {
  beforeEach(() => {
    vi.stubEnv('PAYAT_API_BASE', 'https://go.payat.co.za/yapi/v1')
    vi.stubEnv('PAYAT_MERCHANT_IDENTIFIER', 'merchant-abc')
  })

  it('maps a completed payment to PAID with paid amount and timestamp', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        accountState: 'PAYMENT_COMPLETED',
        amount: 10000,
        amountPaid: 10000,
        dateTimePaid: '2026-07-17T14:38:00Z',
        dateTimeExpire: '2026-07-18T12:29:00Z',
      }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('PAID')
    expect(state.amountPaidCents).toBe(10000)
    expect(state.paidAt).toEqual(new Date('2026-07-17T14:38:00Z'))
  })

  it('maps an outstanding payment to SENT and reports no paid amount', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accountState: 'PAYMENT_OUTSTANDING', amount: 10000, amountPaid: 0 }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('SENT')
    expect(state.amountPaidCents).toBe(0)
    expect(state.paidAt).toBeNull()
  })

  it('maps a partial payment to FAILED so it can never satisfy an intent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ accountState: 'PARTIAL_PAYMENT_RECEIVED', amount: 10000, amountPaid: 500 }),
    }))

    const state = await readPayatSingleRtp('12345678901234')

    expect(state.internalStatus).toBe('FAILED')
  })

  it('throws PayatApiError on a non-2xx response rather than reporting a false state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'insufficient_scope',
    }))

    await expect(readPayatSingleRtp('12345678901234')).rejects.toThrow(/403/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __tests__/lib/payat-read.test.ts`
Expected: FAIL — cannot resolve `@/lib/payat/read`.

- [ ] **Step 3: Implement the read client**

Create `field-service/lib/payat/read.ts`:

```typescript
import { getPayatToken } from './token'
import { PayatApiError, PayatConfigError } from './payment'
import {
  mapPayAtGoAccountStateToInternalStatus,
  type InternalPayAtGoStatus,
} from '@/lib/payat-go/status'

export type PayatRtpState = {
  clientAccountNumber: string
  accountState: string
  internalStatus: InternalPayAtGoStatus
  amountCents: number | null
  amountPaidCents: number | null
  paidAt: Date | null
  expiresAt: Date | null
}

function requireConfig(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new PayatConfigError(name)
  return value
}

function parseOptionalInt(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return null
}

function parseSafeDate(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Read the authoritative state of a single RTP from Pay@.
 *
 * This is the source of truth for whether money arrived — for BOTH settlement
 * channels. A card payment and a till payment resolve the same RTP object; only
 * the timing differs. Requires the `rtp:read` scope on PAYAT_CLIENT_ID.
 */
export async function readPayatSingleRtp(clientAccountNumber: string): Promise<PayatRtpState> {
  const token = await getPayatToken()
  const apiBase = requireConfig('PAYAT_API_BASE').replace(/\/$/, '')
  const merchantIdentifier = requireConfig('PAYAT_MERCHANT_IDENTIFIER')

  let response: Response
  try {
    response = await fetch(
      `${apiBase}/integrator/rtp/read/${merchantIdentifier}/${clientAccountNumber}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      },
    )
  } catch (error) {
    const errorName = error instanceof Error ? error.name : 'unknown_error'
    throw new PayatApiError('rtp_read_failed', undefined, `Pay@ RTP read failed before response (${errorName})`)
  }

  const rawBody = await response.text().catch(() => '')

  if (!response.ok) {
    // Never echo the body in production — it can contain provider PII.
    throw new PayatApiError('rtp_read_failed', response.status, `Pay@ RTP read failed with HTTP ${response.status}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    throw new PayatApiError('rtp_read_failed', response.status, 'Pay@ RTP read returned unparseable JSON')
  }

  const accountState = typeof parsed.accountState === 'string' ? parsed.accountState : 'UNKNOWN'

  return {
    clientAccountNumber,
    accountState,
    internalStatus: mapPayAtGoAccountStateToInternalStatus(accountState),
    amountCents: parseOptionalInt(parsed.amount),
    amountPaidCents: parseOptionalInt(parsed.amountPaid),
    paidAt: parseSafeDate(parsed.dateTimePaid),
    expiresAt: parseSafeDate(parsed.dateTimeExpire),
  }
}
```

If `PayatApiError`'s first parameter does not accept `'rtp_read_failed'`, widen that union in `lib/payat/payment.ts` in this same step rather than casting.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run __tests__/lib/payat-read.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add field-service/lib/payat/read.ts field-service/__tests__/lib/payat-read.test.ts field-service/lib/payat/payment.ts
git commit -m "feat(payat): add rtp:read client for authoritative payment state"
```

---

### Task 3: Add the shared reconcile decision

One function both the webhook and the cron call, so push and pull can never disagree about what counts as paid.

**Files:**
- Create: `field-service/lib/payat/reconcile.ts`
- Modify: `field-service/lib/feature-flags-registry.ts`
- Test: `field-service/__tests__/lib/payat-reconcile.test.ts`

**Interfaces:**
- Consumes: `readPayatSingleRtp()` (Task 2); `creditProviderWalletFromPayatWebhook(intentId): Promise<{credited:true;ledgerEntryId:string}|{credited:false;reason:string}>` from `lib/provider-credit-gateway-itn`
- Produces:

```typescript
export type ReconcileOutcome =
  | { action: 'credited'; ledgerEntryId: string }
  | { action: 'not_paid'; internalStatus: string }
  | { action: 'skipped'; reason: string }
export async function reconcilePayatIntent(intentId: string): Promise<ReconcileOutcome>
```

**Note on creditable states:** `GATEWAY_CREDITABLE_STATUSES` in `lib/provider-credit-gateway-itn.ts:40` is `['PENDING_PAYMENT','ITN_RECEIVED','CANCELLED']` — **`EXPIRED` is not creditable.** This is precisely why the sweep in Task 4 must run *before* the expiry update, not after.

- [ ] **Step 1: Register the feature flags**

In `field-service/lib/feature-flags-registry.ts`, add to `FEATURE_FLAGS_REGISTRY`:

```typescript
  // ─── Pay@ payment reconciliation ─────────────────────────────────────────────
  'payments.payat.readback_verification': {
    description:
      'Treat the Pay@ ITN webhook as a doorbell only: ignore its status/amount and verify against rtp:read before crediting. Requires the rtp:read scope on PAYAT_CLIENT_ID. Keep OFF until that scope is granted, otherwise every webhook 403s on read and credits nothing.',
    owner: 'eng',
    defaultValue: false,
  },
  'payments.payat.reconcile_sweep': {
    description:
      'Before the expire-payment-intents cron marks a PENDING_PAYMENT intent EXPIRED, read its true state from Pay@ and credit it if paid. This is the safety net that catches every missed ITN. Requires the rtp:read scope on PAYAT_CLIENT_ID.',
    owner: 'eng',
    defaultValue: false,
  },
```

- [ ] **Step 2: Write the failing test**

Create `field-service/__tests__/lib/payat-reconcile.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const readPayatSingleRtp = vi.fn()
const creditProviderWalletFromPayatWebhook = vi.fn()
const findUnique = vi.fn()

vi.mock('@/lib/payat/read', () => ({ readPayatSingleRtp }))
vi.mock('@/lib/provider-credit-gateway-itn', () => ({ creditProviderWalletFromPayatWebhook }))
vi.mock('@/lib/db', () => ({ db: { paymentIntent: { findUnique } } }))

const { reconcilePayatIntent } = await import('@/lib/payat/reconcile')

describe('reconcilePayatIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findUnique.mockResolvedValue({
      id: 'intent-1',
      amountCents: 10000,
      clientAccountNumber: '12345678901234',
      status: 'PENDING_PAYMENT',
      creditedAt: null,
    })
  })

  it('credits when Pay@ reports PAID for at least the intent amount', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 10000 })
    creditProviderWalletFromPayatWebhook.mockResolvedValue({ credited: true, ledgerEntryId: 'led-1' })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'credited', ledgerEntryId: 'led-1' })
  })

  it('does NOT credit an underpayment even when Pay@ reports PAID', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'PAID', amountPaidCents: 500 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'not_paid', internalStatus: 'PAID' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('does not credit while payment is still outstanding', async () => {
    readPayatSingleRtp.mockResolvedValue({ internalStatus: 'SENT', amountPaidCents: 0 })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'not_paid', internalStatus: 'SENT' })
    expect(creditProviderWalletFromPayatWebhook).not.toHaveBeenCalled()
  })

  it('skips intents with no clientAccountNumber instead of throwing', async () => {
    findUnique.mockResolvedValue({
      id: 'legacy', amountCents: 10000, clientAccountNumber: null,
      status: 'PENDING_PAYMENT', creditedAt: null,
    })

    const result = await reconcilePayatIntent('legacy')

    expect(result).toEqual({ action: 'skipped', reason: 'no clientAccountNumber' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })

  it('skips an already-credited intent without calling Pay@', async () => {
    findUnique.mockResolvedValue({
      id: 'intent-1', amountCents: 10000, clientAccountNumber: '12345678901234',
      status: 'CREDITED', creditedAt: new Date(),
    })

    const result = await reconcilePayatIntent('intent-1')

    expect(result).toEqual({ action: 'skipped', reason: 'already credited' })
    expect(readPayatSingleRtp).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run __tests__/lib/payat-reconcile.test.ts`
Expected: FAIL — cannot resolve `@/lib/payat/reconcile`.

- [ ] **Step 4: Implement the reconcile decision**

Create `field-service/lib/payat/reconcile.ts`:

```typescript
import { db } from '@/lib/db'
import { readPayatSingleRtp } from './read'
import { creditProviderWalletFromPayatWebhook } from '@/lib/provider-credit-gateway-itn'

export type ReconcileOutcome =
  | { action: 'credited'; ledgerEntryId: string }
  | { action: 'not_paid'; internalStatus: string }
  | { action: 'skipped'; reason: string }

/**
 * Ask Pay@ what actually happened to an intent, and credit it if paid.
 *
 * This is the single decision point for both the webhook (push) and the
 * reconcile sweep (pull) so the two can never disagree. The webhook payload is
 * never trusted for status or amount — only this read is.
 */
export async function reconcilePayatIntent(intentId: string): Promise<ReconcileOutcome> {
  const intent = await db.paymentIntent.findUnique({
    where: { id: intentId },
    select: {
      id: true,
      amountCents: true,
      clientAccountNumber: true,
      status: true,
      creditedAt: true,
    },
  })

  if (!intent) return { action: 'skipped', reason: 'intent not found' }
  if (intent.status === 'CREDITED' || intent.creditedAt) {
    return { action: 'skipped', reason: 'already credited' }
  }
  // Intents created before clientAccountNumber was persisted cannot be read
  // back. They must be resolved via the Pay@ merchant portal by hand.
  if (!intent.clientAccountNumber) {
    return { action: 'skipped', reason: 'no clientAccountNumber' }
  }

  const state = await readPayatSingleRtp(intent.clientAccountNumber)

  // Both conditions are required. PARTIAL_PAYMENT_RECEIVED already maps to
  // FAILED, but the amount guard is kept as defence in depth so a future
  // mapping change cannot let an underpayment through.
  const paidEnough =
    state.amountPaidCents !== null && state.amountPaidCents >= intent.amountCents

  if (state.internalStatus !== 'PAID' || !paidEnough) {
    return { action: 'not_paid', internalStatus: state.internalStatus }
  }

  const credited = await creditProviderWalletFromPayatWebhook(intent.id)
  if (credited.credited) {
    return { action: 'credited', ledgerEntryId: credited.ledgerEntryId }
  }
  return { action: 'skipped', reason: credited.reason }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm vitest run __tests__/lib/payat-reconcile.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add field-service/lib/payat/reconcile.ts field-service/lib/feature-flags-registry.ts field-service/__tests__/lib/payat-reconcile.test.ts
git commit -m "feat(payat): add shared reconcile decision + reconciliation flags"
```

---

### Task 4: Make the webhook a doorbell

Behind `payments.payat.readback_verification`. Flag OFF preserves today's behaviour exactly.

**Files:**
- Modify: `field-service/app/api/payat/webhook/route.ts` (the `PAYMENT_COMPLETE_STATUSES` branch, ~line 165 onward)
- Test: `field-service/__tests__/api/payat-webhook.test.ts`

**Interfaces:**
- Consumes: `reconcilePayatIntent()` (Task 3); `isEnabled()` from `lib/flags`
- Produces: no new exports

- [ ] **Step 1: Write the failing test**

Add to `field-service/__tests__/api/payat-webhook.test.ts`. Follow the existing signing helper in that file for `x-payat-signature`; if none exists, compute `createHmac('sha256', secret).update(rawBody).digest('hex')`.

```typescript
it('ignores a webhook-claimed amount and credits from the Pay@ read instead', async () => {
  vi.mocked(isEnabled).mockResolvedValue(true)
  vi.mocked(reconcilePayatIntent).mockResolvedValue({ action: 'credited', ledgerEntryId: 'led-1' })

  // Webhook lies: claims R1 paid against an R100 intent.
  const body = JSON.stringify({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 100 })
  const res = await POST(signedRequest(body))

  expect(res.status).toBe(200)
  // The decision came from the read, not the payload.
  expect(reconcilePayatIntent).toHaveBeenCalledWith('intent-1')
})

it('returns 200 without crediting when the read says the payment is not complete', async () => {
  vi.mocked(isEnabled).mockResolvedValue(true)
  vi.mocked(reconcilePayatIntent).mockResolvedValue({ action: 'not_paid', internalStatus: 'SENT' })

  const body = JSON.stringify({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10000 })
  const res = await POST(signedRequest(body))

  expect(res.status).toBe(200)
  expect(await res.json()).toMatchObject({ received: true })
})

it('falls back to legacy payload-trusting behaviour when the flag is off', async () => {
  vi.mocked(isEnabled).mockResolvedValue(false)

  const body = JSON.stringify({ clientReferenceNumber: 'intent-1', status: 'PAID', amount: 10000 })
  const res = await POST(signedRequest(body))

  expect(res.status).toBe(200)
  expect(reconcilePayatIntent).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __tests__/api/payat-webhook.test.ts -t 'read'`
Expected: FAIL — `reconcilePayatIntent` never called.

- [ ] **Step 3: Add the doorbell branch**

In `field-service/app/api/payat/webhook/route.ts`, add imports:

```typescript
import { isEnabled } from '@/lib/flags'
import { reconcilePayatIntent } from '@/lib/payat/reconcile'
```

Immediately after the `PAYMENT_COMPLETE_STATUSES` guard passes and before the existing `db.paymentIntent.findUnique` lookup, insert:

```typescript
  // Doorbell mode: the signed webhook tells us WHICH intent moved, never
  // WHETHER it was paid or for how much. Pay@ is asked directly. This is the
  // only path that is safe when the webhook is unreliable — which, on this
  // account, it demonstrably is (0 of 3 ITNs delivered as of 2026-07-28).
  if (await isEnabled('payments.payat.readback_verification')) {
    if (!payload.reference) {
      return NextResponse.json({ received: true, ignored: 'no_reference' })
    }

    const outcome = await reconcilePayatIntent(payload.reference)

    console.info(JSON.stringify({
      event: 'payat.webhook_reconciled',
      intentId: payload.reference,
      action: outcome.action,
      // Recorded so a webhook that consistently disagrees with the read is
      // visible in logs rather than silently tolerated.
      webhookClaimedStatus: payload.status,
    }))

    return NextResponse.json({ received: true })
  }
```

Leave every existing line below untouched — that is the flag-off path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run __tests__/api/payat-webhook.test.ts`
Expected: PASS — new tests plus all pre-existing webhook tests still green.

- [ ] **Step 5: Commit**

```bash
git add field-service/app/api/payat/webhook/route.ts field-service/__tests__/api/payat-webhook.test.ts
git commit -m "feat(payat): verify webhooks against rtp:read before crediting"
```

---

### Task 5: Reconcile before expiry, and alert on silent expiry

The safety net. Even with the webhook completely dead, a paid intent gets credited within one cron cycle.

**Files:**
- Modify: `field-service/app/api/cron/expire-payment-intents/route.ts`
- Test: `field-service/__tests__/api/cron-expire-payment-intents.test.ts` (already exists — extend it)

**Interfaces:**
- Consumes: `reconcilePayatIntent()` (Task 3); `isEnabled()`
- Produces: cron JSON response gains `payatReconciled`, `payatReconcileSkipped`, `silentExpiries`

**Cron auth:** the route is `GET` and requires `Authorization: Bearer ${process.env.CRON_SECRET}` (`route.ts:19-22`); it 401s if `CRON_SECRET` is unset. Follow whatever request helper the existing test file already uses. If it has none, use:

```typescript
function cronRequest() {
  vi.stubEnv('CRON_SECRET', 'test-secret')
  return new Request('https://app.plugapro.co.za/api/cron/expire-payment-intents', {
    headers: { authorization: 'Bearer test-secret' },
  })
}
```

- [ ] **Step 1: Write the failing test**

Add to the existing describe block in `field-service/__tests__/api/cron-expire-payment-intents.test.ts`:

```typescript
it('credits a paid-but-unnotified intent instead of expiring it', async () => {
  vi.mocked(isEnabled).mockResolvedValue(true)
  vi.mocked(findMany).mockResolvedValueOnce([{ id: 'intent-1' }])   // due-for-expiry sweep
  vi.mocked(findMany).mockResolvedValueOnce([])                      // ITN recovery batch
  vi.mocked(reconcilePayatIntent).mockResolvedValue({ action: 'credited', ledgerEntryId: 'led-1' })

  const res = await GET(cronRequest())
  const body = await res.json()

  expect(reconcilePayatIntent).toHaveBeenCalledWith('intent-1')
  expect(body.payatReconciled).toBe(1)
  // Credited intents must not then be expired.
  expect(body.expired).toBe(0)
})

it('counts an intent that expires unpaid as a silent expiry', async () => {
  vi.mocked(isEnabled).mockResolvedValue(true)
  vi.mocked(findMany).mockResolvedValueOnce([{ id: 'intent-2' }])
  vi.mocked(findMany).mockResolvedValueOnce([])
  vi.mocked(reconcilePayatIntent).mockResolvedValue({ action: 'not_paid', internalStatus: 'SENT' })

  const res = await GET(cronRequest())
  const body = await res.json()

  expect(body.silentExpiries).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run __tests__/api/cron-expire-payment-intents.test.ts`
Expected: FAIL — `payatReconciled` is `undefined`.

- [ ] **Step 3: Reconcile before the expiry update**

In `field-service/app/api/cron/expire-payment-intents/route.ts`, insert **above** the existing `updateMany` at line ~33 (it must run first — `EXPIRED` is not a creditable status):

```typescript
    let payatReconciled = 0
    let payatReconcileSkipped = 0
    let silentExpiries = 0

    if (await isEnabled('payments.payat.reconcile_sweep')) {
      // Every Pay@ intent about to be expired gets one last authoritative check.
      // Order matters: creditProviderWalletFromGatewayIntent does not accept
      // EXPIRED, so this must happen before the updateMany below.
      const dueForExpiry = await db.paymentIntent.findMany({
        where: {
          paymentMethod: 'PAYAT',
          status: 'PENDING_PAYMENT',
          expiresAt: { lt: now, not: null },
          clientAccountNumber: { not: null },
        },
        select: { id: true },
        take: PAYAT_RECONCILE_BATCH,
      })

      for (const intent of dueForExpiry) {
        try {
          const outcome = await reconcilePayatIntent(intent.id)
          if (outcome.action === 'credited') {
            payatReconciled += 1
            continue
          }
          if (outcome.action === 'not_paid') {
            silentExpiries += 1
            // Loud on purpose: money was requested, the window closed, and no
            // payment was found. If this is ever non-zero while providers say
            // they paid, the read path itself is wrong.
            console.error(JSON.stringify({
              event: 'payat.silent_expiry',
              intentId: intent.id,
              internalStatus: outcome.internalStatus,
            }))
            continue
          }
          payatReconcileSkipped += 1
        } catch (error) {
          payatReconcileSkipped += 1
          console.error(JSON.stringify({
            event: 'payat.reconcile_failed',
            intentId: intent.id,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          }))
        }
      }
    }
```

Add near the other module constants:

```typescript
const PAYAT_RECONCILE_BATCH = 50
```

Add the imports:

```typescript
import { isEnabled } from '@/lib/flags'
import { reconcilePayatIntent } from '@/lib/payat/reconcile'
```

- [ ] **Step 4: Report the counters**

Extend the final `NextResponse.json(...)` (~line 88):

```typescript
    return NextResponse.json({
      expired: result.count,
      payatReconciled,
      payatReconcileSkipped,
      silentExpiries,
      payatItnRecovered: recovered,
      payatItnSkipped: skipped,
      payatItnFailed: failed,
      durationMs: duration,
    })
```

And add the counters to the existing completion log line so they land in Vercel logs:

```typescript
    console.log(`[cron/expire-payment-intents:${reqId}] payat-reconciled=${payatReconciled}, silent-expiries=${silentExpiries}`)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run __tests__/api/cron-expire-payment-intents.test.ts`
Expected: PASS

- [ ] **Step 6: Run the full suite and lint**

Run: `pnpm test && pnpm lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add field-service/app/api/cron/expire-payment-intents/route.ts field-service/__tests__/api/cron-expire-payment-intents.test.ts
git commit -m "feat(payat): reconcile intents against Pay@ before expiring them"
```

---

## Rollout

Order matters — the flags are useless and actively noisy until the `rtp:read` scope exists.

1. Merge and deploy with **both flags OFF**. Behaviour is unchanged; only the new `clientAccountNumber` column starts being populated.
2. Complete **P1** (grant `rtp:read`). Verify with one manual `readPayatSingleRtp()` call against a freshly created intent.
3. Enable `payments.payat.reconcile_sweep` first — it is the pure safety net and cannot double-credit (the ledger path is idempotent and already-credited intents short-circuit). The cron runs hourly (`0 * * * *`), so worst-case detection lag is ~1 hour after expiry.
4. Complete **P2** (register the webhook), then enable `payments.payat.readback_verification`.
5. **End-to-end test:** create a real R100 intent, pay it at a till, confirm credit lands without manual intervention. Then repeat via the `paymentLink` (card) path — both must resolve through the same code.
6. Watch `payat.silent_expiry` in logs. A non-zero count alongside a provider reporting payment means the read path is wrong, not the provider.

## Known limitations

- **The two historical stranded intents are not recoverable by this plan.** They predate `clientAccountNumber` persistence, so `reconcilePayatIntent` returns `skipped: no clientAccountNumber`. They need P3/P4 — the portal, by hand.
- **`SENTRY_DSN` is unset in production**, so `console.error` is the only alerting channel. `payat.silent_expiry` will sit in Vercel logs with nothing paging on it. Wiring a real alert is out of scope here but should follow; the structured event name is the hook.
- The 24-hour expiry window (`daysValid: 1` at `lib/payat/payment.ts:209`, deliberately mirrored by `expiresAt` per the comment at `lib/provider-credit-payment-intents.ts:564`) is aggressive for OTC, where paying "later today" is the normal case. Widening it is a separate decision — the reconcile sweep reduces the harm either way, but does not eliminate it for someone who pays on day 2.
- The cron reconciles at most `PAYAT_RECONCILE_BATCH` (50) intents per run. At current volume (3 intents total, ever) this is irrelevant, but the cap is silent — revisit if volume grows.

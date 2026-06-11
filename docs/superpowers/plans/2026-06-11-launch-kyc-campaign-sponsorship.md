# Launch KYC Campaign Sponsorship (Option F MVP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a provider in an active launch-campaign area passes KYC verification, automatically sponsor their once-off R20 ID-verification recovery fee from a configurable, count-capped campaign allocation; everyone else gets the fee accrued for later recovery.

**Architecture:** Three new Prisma models (`KycCampaign`, `KycSponsorship`, `KycFeeLedgerEntry`) plus a rand-denominated fee ledger kept separate from the integer credit wallet. A booking service fires on the KYC `PASSED` transition inside `transitionIdentityVerification`, accrues the fee, then atomically claims a campaign allocation slot (area-matched, identifier-hash-deduped) and writes a `KYC_FEE_SPONSORED` offset. Admin manages campaigns via `crudAction`-wrapped server actions behind a feature flag.

**Tech Stack:** Next.js App Router (Server Actions), Prisma + Supabase Postgres, Zod, Vitest (mocked `lib/db`), shadcn UI, feature flags via `lib/flags.ts`.

**Reference:** `outputs/PlugAPro-Launch-KYC-Voucher-Investigation-2026-06-11.md` (Section 17 + acceptance criteria).

**All commands run from `field-service/`.** All file paths below are relative to `field-service/` unless prefixed with `(repo root)`.

---

## Scope

**In scope (this plan):**
- Fee accrual + campaign sponsorship at KYC success, behind flags `kyc.fee_accrual.enabled` and `admin.kyc_campaigns`.
- Admin: create / activate / pause / close campaigns; manual grant / revoke; usage counts; vendor free-tier month card.
- Provider copy: WhatsApp terminal-notification sentence + credits-page banner.
- Reconcile script (dry-run default) for missed bookings / pre-existing VERIFIED providers.

**Out of scope (separate plans, pending product decisions):**
- Actual money collection of the accrued fee at first top-up (changes top-up math — needs the parent Options A–D decision).
- Merging fee rows into the paginated `HistoryClient` credit history.
- Pre-KYC eligibility preview banner ("launch offer" before verifying).
- Systematised vendor quota table / CSV export / waitlist notifications.

**Known MVP limitations (accepted):**
- A SUBURB-scoped campaign won't match a provider who only has a REGION-level service area row. Recommend REGION-level campaigns (matches West Rand usage).
- Re-granting a revoked provider on the **same** campaign is blocked by `@@unique([campaignId, providerId])`. Use a different campaign.
- Legacy free-text `Provider.serviceAreas` entries that aren't slugs (e.g. "Honeydew") won't area-match; the TSA backfill covers structured rows.

---

## File Structure

| File | Responsibility |
|---|---|
| `prisma/schema.prisma` | +3 enums, +3 models, +4 relation lines |
| `lib/kyc-fee/constants.ts` | Fee amount, vendor free-tier default, rand formatting, idempotency key builders |
| `lib/kyc-fee/ledger.ts` | Fee ledger writer (balance math, guards) + status reader |
| `lib/kyc-fee/campaign-matching.ts` | Pure area-key helpers + provider↔campaign area match + eligible-campaign finder |
| `lib/kyc-fee/booking.ts` | The accrue-or-sponsor decision, atomic allocation claim |
| `lib/kyc-fee/messaging.ts` | Provider-facing fee outcome sentence |
| `lib/identity-verification/orchestrator.ts` | Hook on `kycStatus → VERIFIED`; WhatsApp copy |
| `lib/feature-flags-registry.ts` | +2 flags |
| `scripts/reconcile-kyc-fees.ts` | Sweep VERIFIED providers without accruals |
| `app/(admin)/admin/kyc-campaigns/actions.ts` | Admin server actions (list/create/status/grant/revoke) |
| `app/(admin)/admin/kyc-campaigns/page.tsx` | Admin screen |
| `app/(admin)/admin/page.tsx` | Dashboard quick link |
| `app/(provider)/provider/credits/actions.ts` | `getProviderKycFeeBanner()` |
| `app/(provider)/provider/credits/page.tsx` | Fee banner above `CreditsEntryClient` |
| `e2e/smoke.spec.ts` | Route smoke coverage |
| `__tests__/lib/kyc-fee-ledger.test.ts`, `__tests__/lib/kyc-campaign-matching.test.ts`, `__tests__/lib/kyc-fee-booking.test.ts` | Unit tests |

House rules honoured: additive migration only; every admin mutation through `crudAction()`; feature behind flags; no `as any`.

---

### Task 1: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add enums and models**

Append after the `VoucherRedemptionAttempt` model block (after line ~1510, before `ProviderAutoApproveSideEffectMarker`):

```prisma
// ─── Launch KYC campaigns & fee ledger ───────────────────────────────────────
// The KYC recovery fee is rand-denominated (cents) and deliberately kept OUT
// of the integer credit wallet (1 credit = R50; the R20 fee is not a clean
// credit amount). Outstanding fee = last entry's balanceAfterCents.

enum KycCampaignStatus {
  DRAFT
  ACTIVE
  PAUSED
  CLOSED
}

enum KycSponsorshipStatus {
  CONSUMED
  REVERSED
}

enum KycFeeLedgerReason {
  KYC_FEE_ACCRUED
  KYC_FEE_SPONSORED
  KYC_FEE_RECOVERED
  KYC_FEE_WAIVED
  KYC_FEE_REVERSED
}

model KycCampaign {
  id                String            @id @default(cuid())
  name              String
  campaignCode      String            @unique
  status            KycCampaignStatus @default(DRAFT)
  // Area scope: null = global. Node level (PROVINCE/CITY/REGION/SUBURB) defines match granularity.
  locationNodeId    String?
  startsAt          DateTime
  endsAt            DateTime?
  maxSponsoredCount Int
  // Cached counter; authoritative count = KycSponsorship rows with status CONSUMED.
  sponsoredCount    Int               @default(0)
  createdById       String
  createdAt         DateTime          @default(now())
  updatedAt         DateTime          @updatedAt

  createdBy    AdminUser        @relation(fields: [createdById], references: [id])
  locationNode LocationNode?    @relation(fields: [locationNodeId], references: [id])
  sponsorships KycSponsorship[]

  @@index([status, startsAt])
  @@map("kyc_campaigns")
}

model KycSponsorship {
  id             String               @id @default(cuid())
  campaignId     String
  providerId     String
  verificationId String?
  // SHA-256 identifier hash from the verified ID document — anti-fraud dedup:
  // one human identity gets at most one sponsorship across all campaigns.
  identifierHash String?
  status         KycSponsorshipStatus @default(CONSUMED)
  source         String // "system" | "admin"
  feeCents       Int
  grantedAt      DateTime             @default(now())
  revokedAt      DateTime?
  revokedById    String?
  reason         String?

  campaign KycCampaign @relation(fields: [campaignId], references: [id], onDelete: Restrict)
  provider Provider    @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@unique([campaignId, providerId])
  @@index([providerId])
  @@index([identifierHash])
  @@index([campaignId, status])
  @@map("kyc_sponsorships")
}

model KycFeeLedgerEntry {
  id                String             @id @default(cuid())
  providerId        String
  reason            KycFeeLedgerReason
  // Always a positive cent amount; sign semantics come from `reason`
  // (ACCRUED/REVERSED increase outstanding; SPONSORED/RECOVERED/WAIVED decrease).
  amountCents       Int
  balanceAfterCents Int
  referenceType     String
  referenceId       String
  campaignId        String?
  description       String?
  idempotencyKey    String?            @unique
  source            String? // "system" | "admin"
  createdBy         String?
  metadata          Json               @default("{}")
  createdAt         DateTime           @default(now())

  provider Provider @relation(fields: [providerId], references: [id], onDelete: Cascade)

  @@index([providerId, createdAt])
  @@index([reason, createdAt])
  @@index([campaignId, createdAt])
  @@map("kyc_fee_ledger_entries")
}
```

- [ ] **Step 2: Add back-relations**

In the `Provider` model relation block (after line 307, `identityVerificationPilotAllowlist …`), add:

```prisma
  kycSponsorships                      KycSponsorship[]
  kycFeeLedgerEntries                  KycFeeLedgerEntry[]
```

In the `AdminUser` model relation block (after `issuedProviderResumeTokens   ProviderResumeToken[]`), add:

```prisma
  kycCampaigns                 KycCampaign[]
```

In the `LocationNode` model relation block (after `candidatePool          CandidatePool[]`), add:

```prisma
  kycCampaigns           KycCampaign[]
```

- [ ] **Step 3: Create the migration and regenerate the client**

Run: `pnpm prisma migrate dev --name add_kyc_campaign_sponsorship`
Expected: migration created under `prisma/migrations/*_add_kyc_campaign_sponsorship/` with only `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD CONSTRAINT` statements (additive only — abort if any `DROP` appears). `prisma generate` runs automatically.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (no existing code references the new models yet).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add KycCampaign, KycSponsorship and rand KYC fee ledger models"
```

---

### Task 2: Constants + feature flags

**Files:**
- Create: `lib/kyc-fee/constants.ts`
- Modify: `lib/feature-flags-registry.ts`

- [ ] **Step 1: Create the constants module**

Create `lib/kyc-fee/constants.ts`:

```ts
// Once-off KYC / ID-verification recovery fee, in ZAR cents.
// Overridable via env so finance can tune without a redeploy.
export const KYC_FEE_CENTS = Number(process.env.KYC_FEE_CENTS ?? '2000')

// Didit free tier: first 500 Full-KYC bundles/month (see lib/commercial/didit-pricing.ts).
// Display-only on the admin campaign page; reconciliation against the vendor
// invoice stays a manual monthly process for now.
export const VENDOR_MONTHLY_FREE_TIER_DEFAULT = 500

export function formatRandsFromCents(cents: number): string {
  const rands = cents / 100
  return Number.isInteger(rands) ? `R${rands}` : `R${rands.toFixed(2)}`
}

// Once-off fee per provider — provider-scoped key makes the accrual idempotent forever.
export function kycFeeAccruedKey(providerId: string): string {
  return `kyc-fee-accrued:${providerId}`
}

// Sponsorship-scoped keys so a revoke + re-grant (different campaign) can't collide.
export function kycFeeSponsoredKey(sponsorshipId: string): string {
  return `kyc-fee-sponsored:${sponsorshipId}`
}

export function kycFeeReversedKey(sponsorshipId: string): string {
  return `kyc-fee-reversed:${sponsorshipId}`
}
```

- [ ] **Step 2: Register the two feature flags**

In `lib/feature-flags-registry.ts`, after the `'launch.west_rand_pilot.nudge_console'` entry (line ~284), add:

```ts
  'kyc.fee_accrual.enabled': {
    description:
      'Master switch for the once-off KYC recovery fee. When ON, a KYC_FEE_ACCRUED ledger row is booked when a provider reaches kycStatus VERIFIED, and an active KycCampaign may sponsor it. When OFF, verification transitions book nothing.',
    owner: 'prod',
    defaultValue: false,
  },
  'admin.kyc_campaigns': {
    description:
      'Enable the /admin/kyc-campaigns page and its mutations (create/activate/pause/close campaigns, manual grant/revoke of KYC sponsorships).',
    owner: 'ops',
    defaultValue: false,
  },
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/kyc-fee/constants.ts lib/feature-flags-registry.ts
git commit -m "feat: add KYC fee constants and kyc.fee_accrual / admin.kyc_campaigns flags"
```

---

### Task 3: Fee ledger writer + status reader

**Files:**
- Create: `lib/kyc-fee/ledger.ts`
- Test: `__tests__/lib/kyc-fee-ledger.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/kyc-fee-ledger.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KycFeeLedgerError,
  writeKycFeeLedgerEntryInTransaction,
  type KycFeeLedgerTx,
} from '../../lib/kyc-fee/ledger'

function makeTx(lastBalanceCents: number | null) {
  const created: unknown[] = []
  const tx = {
    kycFeeLedgerEntry: {
      findFirst: vi.fn().mockResolvedValue(
        lastBalanceCents === null ? null : { balanceAfterCents: lastBalanceCents },
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data)
        return { id: 'entry-1', ...data }
      }),
    },
  }
  return { tx: tx as unknown as KycFeeLedgerTx, created, raw: tx }
}

const baseParams = {
  providerId: 'provider-1',
  referenceType: 'provider_identity_verification',
  referenceId: 'verif-1',
} as const

describe('writeKycFeeLedgerEntryInTransaction', () => {
  beforeEach(() => vi.clearAllMocks())

  it('books a first accrual with balanceAfter = amount', async () => {
    const { tx, created } = makeTx(null)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_ACCRUED',
      amountCents: 2000,
    })
    expect(entry.balanceAfterCents).toBe(2000)
    expect(created).toHaveLength(1)
  })

  it('a sponsorship after an accrual zeroes the balance', async () => {
    const { tx } = makeTx(2000)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_SPONSORED',
      amountCents: 2000,
      campaignId: 'camp-1',
    })
    expect(entry.balanceAfterCents).toBe(0)
  })

  it('a reversal restores the outstanding balance', async () => {
    const { tx } = makeTx(0)
    const entry = await writeKycFeeLedgerEntryInTransaction(tx, {
      ...baseParams,
      reason: 'KYC_FEE_REVERSED',
      amountCents: 2000,
    })
    expect(entry.balanceAfterCents).toBe(2000)
  })

  it('rejects a write that would drive the balance negative', async () => {
    const { tx } = makeTx(0)
    await expect(
      writeKycFeeLedgerEntryInTransaction(tx, {
        ...baseParams,
        reason: 'KYC_FEE_WAIVED',
        amountCents: 2000,
      }),
    ).rejects.toBeInstanceOf(KycFeeLedgerError)
  })

  it('rejects non-positive or non-integer amounts', async () => {
    const { tx } = makeTx(null)
    for (const amountCents of [0, -5, 19.5]) {
      await expect(
        writeKycFeeLedgerEntryInTransaction(tx, {
          ...baseParams,
          reason: 'KYC_FEE_ACCRUED',
          amountCents,
        }),
      ).rejects.toBeInstanceOf(KycFeeLedgerError)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/lib/kyc-fee-ledger.test.ts`
Expected: FAIL — `Cannot find module '../../lib/kyc-fee/ledger'`.

- [ ] **Step 3: Implement the ledger module**

Create `lib/kyc-fee/ledger.ts`:

```ts
import { Prisma, type KycFeeLedgerEntry, type KycFeeLedgerReason } from '@prisma/client'
import { db } from '../db'

// Narrow structural type so both the root client and an interactive
// transaction client (and test fakes) satisfy it.
export type KycFeeLedgerTx = Pick<Prisma.TransactionClient, 'kycFeeLedgerEntry'>

export class KycFeeLedgerError extends Error {
  constructor(
    public readonly code: 'INVALID_AMOUNT' | 'NEGATIVE_BALANCE',
    message: string,
  ) {
    super(message)
    this.name = 'KycFeeLedgerError'
  }
}

// ACCRUED/REVERSED increase what the provider owes; the rest settle it.
const BALANCE_DELTA: Record<KycFeeLedgerReason, 1 | -1> = {
  KYC_FEE_ACCRUED: 1,
  KYC_FEE_REVERSED: 1,
  KYC_FEE_SPONSORED: -1,
  KYC_FEE_RECOVERED: -1,
  KYC_FEE_WAIVED: -1,
}

export type WriteKycFeeLedgerEntryParams = {
  providerId: string
  reason: KycFeeLedgerReason
  amountCents: number
  referenceType: string
  referenceId: string
  campaignId?: string | null
  description?: string | null
  idempotencyKey?: string | null
  source?: 'system' | 'admin'
  createdBy?: string | null
  metadata?: Record<string, unknown>
}

function toJson(metadata: Record<string, unknown> | undefined): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(metadata ?? {})) as Prisma.InputJsonValue
}

/**
 * Appends an immutable fee ledger row. MUST be called inside the caller's
 * transaction together with whatever business write it belongs to.
 * Balance is recomputed from the latest row (single once-off fee per
 * provider keeps contention negligible).
 */
export async function writeKycFeeLedgerEntryInTransaction(
  tx: KycFeeLedgerTx,
  params: WriteKycFeeLedgerEntryParams,
): Promise<KycFeeLedgerEntry> {
  if (!Number.isInteger(params.amountCents) || params.amountCents <= 0) {
    throw new KycFeeLedgerError(
      'INVALID_AMOUNT',
      `amountCents must be a positive integer, got ${params.amountCents}.`,
    )
  }

  const prev = await tx.kycFeeLedgerEntry.findFirst({
    where: { providerId: params.providerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfterCents: true },
  })

  const balanceAfterCents =
    (prev?.balanceAfterCents ?? 0) + BALANCE_DELTA[params.reason] * params.amountCents

  if (balanceAfterCents < 0) {
    throw new KycFeeLedgerError(
      'NEGATIVE_BALANCE',
      `Entry ${params.reason} of ${params.amountCents}c would drive provider ${params.providerId} balance negative.`,
    )
  }

  return tx.kycFeeLedgerEntry.create({
    data: {
      providerId: params.providerId,
      reason: params.reason,
      amountCents: params.amountCents,
      balanceAfterCents,
      referenceType: params.referenceType,
      referenceId: params.referenceId,
      campaignId: params.campaignId ?? null,
      description: params.description ?? null,
      idempotencyKey: params.idempotencyKey ?? undefined,
      source: params.source ?? undefined,
      createdBy: params.createdBy ?? undefined,
      metadata: toJson(params.metadata),
    },
  })
}

export type KycFeeStatus = {
  outstandingCents: number
  lastReason: KycFeeLedgerReason | null
}

export async function getKycFeeStatus(
  providerId: string,
  client: KycFeeLedgerTx = db,
): Promise<KycFeeStatus> {
  const last = await client.kycFeeLedgerEntry.findFirst({
    where: { providerId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { balanceAfterCents: true, reason: true },
  })
  return {
    outstandingCents: last?.balanceAfterCents ?? 0,
    lastReason: last?.reason ?? null,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/lib/kyc-fee-ledger.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/kyc-fee/ledger.ts __tests__/lib/kyc-fee-ledger.test.ts
git commit -m "feat: add rand-denominated KYC fee ledger writer and status reader"
```

---

### Task 4: Campaign area matching

**Files:**
- Create: `lib/kyc-fee/campaign-matching.ts`
- Test: `__tests__/lib/kyc-campaign-matching.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/kyc-campaign-matching.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  campaignAreaKey,
  legacyServiceAreaMatches,
} from '../../lib/kyc-fee/campaign-matching'

describe('campaignAreaKey', () => {
  it('maps each node level to its TechnicianServiceArea key column', () => {
    expect(campaignAreaKey({ nodeType: 'PROVINCE', slug: 'gauteng' })).toEqual({
      field: 'provinceKey',
      key: 'gauteng',
    })
    expect(
      campaignAreaKey({ nodeType: 'CITY', slug: 'gauteng__johannesburg' }),
    ).toEqual({ field: 'cityKey', key: 'johannesburg' })
    expect(
      campaignAreaKey({ nodeType: 'REGION', slug: 'gauteng__johannesburg__jhb_west' }),
    ).toEqual({ field: 'regionKey', key: 'jhb_west' })
    expect(
      campaignAreaKey({
        nodeType: 'SUBURB',
        slug: 'gauteng__johannesburg__jhb_west__honeydew',
      }),
    ).toEqual({ field: 'suburbKey', key: 'honeydew' })
  })
})

describe('legacyServiceAreaMatches', () => {
  const suburbSlug = 'gauteng__johannesburg__jhb_west__honeydew'

  it('matches an exact slug entry', () => {
    expect(legacyServiceAreaMatches([suburbSlug], suburbSlug)).toBe(true)
  })

  it('matches a region campaign against contained suburb slugs', () => {
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_west'),
    ).toBe(true)
  })

  it('does not match a different region', () => {
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_north'),
    ).toBe(false)
  })

  it('does not prefix-match partial segment names', () => {
    // 'jhb_w' must not match 'jhb_west' suburbs
    expect(
      legacyServiceAreaMatches([suburbSlug], 'gauteng__johannesburg__jhb_w'),
    ).toBe(false)
  })

  it('ignores free-text non-slug entries', () => {
    expect(
      legacyServiceAreaMatches(['Honeydew'], 'gauteng__johannesburg__jhb_west'),
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/lib/kyc-campaign-matching.test.ts`
Expected: FAIL — `Cannot find module '../../lib/kyc-fee/campaign-matching'`.

- [ ] **Step 3: Implement the matching module**

Create `lib/kyc-fee/campaign-matching.ts`:

```ts
import type { KycCampaign, LocationNodeType, Prisma } from '@prisma/client'

export type CampaignMatchTx = Pick<
  Prisma.TransactionClient,
  'kycCampaign' | 'technicianServiceArea' | 'provider'
>

export type CampaignAreaNode = {
  nodeType: LocationNodeType
  slug: string
}

// LocationNode slugs are hierarchical: {province}__{city}__{region}__{suburb}.
// TechnicianServiceArea denormalises one key column per level; the node's own
// key is the last slug segment (same rule as upsertStructuredServiceAreas in
// lib/provider-record.ts).
export function campaignAreaKey(node: CampaignAreaNode): {
  field: 'provinceKey' | 'cityKey' | 'regionKey' | 'suburbKey'
  key: string
} {
  const key = node.slug.split('__').at(-1) ?? node.slug
  switch (node.nodeType) {
    case 'PROVINCE':
      return { field: 'provinceKey', key }
    case 'CITY':
      return { field: 'cityKey', key }
    case 'REGION':
      return { field: 'regionKey', key }
    case 'SUBURB':
      return { field: 'suburbKey', key }
  }
}

export function legacyServiceAreaMatches(
  serviceAreas: string[],
  campaignNodeSlug: string,
): boolean {
  return serviceAreas.some(
    (entry) => entry === campaignNodeSlug || entry.startsWith(`${campaignNodeSlug}__`),
  )
}

/**
 * A provider matches when ANY of their areas falls inside the campaign scope:
 * structured TechnicianServiceArea key match first, legacy free-text slug
 * match as fallback (WhatsApp-onboarded providers have no TSA rows).
 * Deliberately does NOT filter TSA.active — campaigns may target areas that
 * are not yet flipped to 'active' pilot regions.
 */
export async function providerMatchesCampaignArea(
  tx: CampaignMatchTx,
  providerId: string,
  node: CampaignAreaNode | null,
): Promise<boolean> {
  if (!node) return true // global campaign

  const { field, key } = campaignAreaKey(node)
  const structured = await tx.technicianServiceArea.findFirst({
    where: { providerId, [field]: key },
    select: { id: true },
  })
  if (structured) return true

  const provider = await tx.provider.findUnique({
    where: { id: providerId },
    select: { serviceAreas: true },
  })
  return legacyServiceAreaMatches(provider?.serviceAreas ?? [], node.slug)
}

export type EligibleCampaign = KycCampaign & {
  locationNode: CampaignAreaNode | null
}

/**
 * First ACTIVE, in-window, under-cap campaign whose area matches the
 * provider. Oldest campaign wins when several match.
 */
export async function findEligibleCampaign(
  tx: CampaignMatchTx,
  providerId: string,
  now: Date = new Date(),
): Promise<EligibleCampaign | null> {
  const campaigns = await tx.kycCampaign.findMany({
    where: {
      status: 'ACTIVE',
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
    include: { locationNode: { select: { nodeType: true, slug: true } } },
    orderBy: { createdAt: 'asc' },
  })

  for (const campaign of campaigns) {
    if (campaign.sponsoredCount >= campaign.maxSponsoredCount) continue
    if (await providerMatchesCampaignArea(tx, providerId, campaign.locationNode)) {
      return campaign
    }
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/lib/kyc-campaign-matching.test.ts`
Expected: PASS (6 assertions across 6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/kyc-fee/campaign-matching.ts __tests__/lib/kyc-campaign-matching.test.ts
git commit -m "feat: add KYC campaign area matching (structured TSA keys + legacy slug fallback)"
```

---

### Task 5: Booking service (accrue-or-sponsor)

**Files:**
- Create: `lib/kyc-fee/booking.ts`
- Test: `__tests__/lib/kyc-fee-booking.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/kyc-fee-booking.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockIsEnabled } = vi.hoisted(() => ({ mockIsEnabled: vi.fn() }))
vi.mock('../../lib/flags', () => ({ isEnabled: mockIsEnabled }))
vi.mock('../../lib/db', () => ({ db: { $transaction: vi.fn() } }))

import {
  bookKycFeeForVerifiedProvider,
  type KycFeeBookingClient,
} from '../../lib/kyc-fee/booking'

type FakeOverrides = {
  existingAccrual?: boolean
  identifierHash?: string | null
  campaigns?: Array<Record<string, unknown>>
  identifierAlreadySponsored?: boolean
  claimCount?: number
  tsaMatch?: boolean
}

function makeClient(o: FakeOverrides = {}) {
  const ledgerWrites: Array<Record<string, unknown>> = []
  let ledgerBalance: { balanceAfterCents: number } | null = null
  const client = {
    kycFeeLedgerEntry: {
      findUnique: vi.fn().mockResolvedValue(o.existingAccrual ? { id: 'led-0' } : null),
      findFirst: vi.fn().mockImplementation(async () => ledgerBalance),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        ledgerWrites.push(data)
        ledgerBalance = { balanceAfterCents: data.balanceAfterCents as number }
        return { id: `led-${ledgerWrites.length}`, ...data }
      }),
    },
    providerIdentityVerification: {
      findUnique: vi.fn().mockResolvedValue({
        identifierHash: o.identifierHash === undefined ? 'hash-1' : o.identifierHash,
      }),
    },
    kycCampaign: {
      findMany: vi.fn().mockResolvedValue(o.campaigns ?? []),
      updateMany: vi.fn().mockResolvedValue({ count: o.claimCount ?? 1 }),
    },
    kycSponsorship: {
      findFirst: vi
        .fn()
        .mockResolvedValue(o.identifierAlreadySponsored ? { id: 'sp-old' } : null),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'sp-1',
        ...data,
      })),
    },
    technicianServiceArea: {
      findFirst: vi.fn().mockResolvedValue(o.tsaMatch === false ? null : { id: 'tsa-1' }),
    },
    provider: {
      findUnique: vi.fn().mockResolvedValue({ serviceAreas: [] }),
    },
  }
  return { client: client as unknown as KycFeeBookingClient, ledgerWrites, raw: client }
}

const input = { providerId: 'provider-1', verificationId: 'verif-1' }

const westRandCampaign = {
  id: 'camp-1',
  campaignCode: 'WEST_RAND_LAUNCH',
  status: 'ACTIVE',
  sponsoredCount: 10,
  maxSponsoredCount: 200,
  locationNode: { nodeType: 'REGION', slug: 'gauteng__johannesburg__jhb_west' },
}

describe('bookKycFeeForVerifiedProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIsEnabled.mockResolvedValue(true)
  })

  it('is a no-op when the fee accrual flag is off', async () => {
    mockIsEnabled.mockResolvedValue(false)
    const { client, ledgerWrites } = makeClient()
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('FLAG_OFF')
    expect(ledgerWrites).toHaveLength(0)
  })

  it('is idempotent when an accrual already exists', async () => {
    const { client, ledgerWrites } = makeClient({ existingAccrual: true })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ALREADY_BOOKED')
    expect(ledgerWrites).toHaveLength(0)
  })

  it('accrues the fee when no campaign is eligible', async () => {
    const { client, ledgerWrites } = makeClient({ campaigns: [] })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ACCRUED')
    expect(ledgerWrites).toHaveLength(1)
    expect(ledgerWrites[0].reason).toBe('KYC_FEE_ACCRUED')
  })

  it('sponsors the fee when an area-matched campaign has allocation', async () => {
    const { client, ledgerWrites, raw } = makeClient({ campaigns: [westRandCampaign] })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('SPONSORED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual([
      'KYC_FEE_ACCRUED',
      'KYC_FEE_SPONSORED',
    ])
    expect(ledgerWrites[1].balanceAfterCents).toBe(0)
    expect(raw.kycCampaign.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'camp-1', status: 'ACTIVE' }),
      }),
    )
    expect(raw.kycSponsorship.create).toHaveBeenCalled()
  })

  it('falls back to accrual when the atomic claim loses (allocation exhausted)', async () => {
    const { client, ledgerWrites, raw } = makeClient({
      campaigns: [westRandCampaign],
      claimCount: 0,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ACCRUED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
    expect(raw.kycSponsorship.create).not.toHaveBeenCalled()
  })

  it('refuses a second sponsorship for the same verified identity', async () => {
    const { client, ledgerWrites } = makeClient({
      campaigns: [westRandCampaign],
      identifierAlreadySponsored: true,
    })
    const result = await bookKycFeeForVerifiedProvider(input, client)
    expect(result.outcome).toBe('ACCRUED')
    expect(ledgerWrites.map((w) => w.reason)).toEqual(['KYC_FEE_ACCRUED'])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm vitest run __tests__/lib/kyc-fee-booking.test.ts`
Expected: FAIL — `Cannot find module '../../lib/kyc-fee/booking'`.

- [ ] **Step 3: Implement the booking module**

Create `lib/kyc-fee/booking.ts`:

```ts
import type { Prisma } from '@prisma/client'
import { db } from '../db'
import { isEnabled } from '../flags'
import { KYC_FEE_CENTS, kycFeeAccruedKey, kycFeeSponsoredKey } from './constants'
import { findEligibleCampaign } from './campaign-matching'
import { writeKycFeeLedgerEntryInTransaction } from './ledger'

export type KycFeeBookingClient = Pick<
  Prisma.TransactionClient,
  | 'kycFeeLedgerEntry'
  | 'kycCampaign'
  | 'kycSponsorship'
  | 'provider'
  | 'providerIdentityVerification'
  | 'technicianServiceArea'
>

export type KycFeeBookingResult =
  | { outcome: 'FLAG_OFF' | 'ALREADY_BOOKED' }
  | {
      outcome: 'ACCRUED'
      skippedSponsorship?:
        | 'NO_ELIGIBLE_CAMPAIGN'
        | 'IDENTIFIER_ALREADY_SPONSORED'
        | 'ALLOCATION_EXHAUSTED'
    }
  | { outcome: 'SPONSORED'; campaignId: string; campaignCode: string; sponsorshipId: string }

/**
 * Books the once-off KYC recovery fee for a provider that just reached
 * kycStatus VERIFIED. Accrues the fee, then — if an ACTIVE, in-window,
 * area-matched campaign has allocation left — atomically claims a slot and
 * writes the sponsorship offset.
 *
 * Pass `client` when already inside a transaction (the admin approval path
 * runs transitionIdentityVerification inside crudAction's tx). With no
 * client, the whole booking runs in its own db.$transaction.
 *
 * Idempotent via the provider-scoped accrual idempotency key. A concurrent
 * duplicate beyond the pre-check surfaces as a P2002 from that unique key;
 * the orchestrator hook logs it and scripts/reconcile-kyc-fees.ts repairs
 * any gap.
 */
export async function bookKycFeeForVerifiedProvider(
  input: { providerId: string; verificationId: string },
  client?: KycFeeBookingClient,
): Promise<KycFeeBookingResult> {
  if (!(await isEnabled('kyc.fee_accrual.enabled'))) {
    return { outcome: 'FLAG_OFF' }
  }
  if (client) return bookInTx(client, input)
  return db.$transaction((tx) => bookInTx(tx, input))
}

async function bookInTx(
  tx: KycFeeBookingClient,
  input: { providerId: string; verificationId: string },
): Promise<KycFeeBookingResult> {
  const { providerId, verificationId } = input

  const existing = await tx.kycFeeLedgerEntry.findUnique({
    where: { idempotencyKey: kycFeeAccruedKey(providerId) },
    select: { id: true },
  })
  if (existing) return { outcome: 'ALREADY_BOOKED' }

  const verification = await tx.providerIdentityVerification.findUnique({
    where: { id: verificationId },
    select: { identifierHash: true },
  })

  await writeKycFeeLedgerEntryInTransaction(tx, {
    providerId,
    reason: 'KYC_FEE_ACCRUED',
    amountCents: KYC_FEE_CENTS,
    referenceType: 'provider_identity_verification',
    referenceId: verificationId,
    idempotencyKey: kycFeeAccruedKey(providerId),
    source: 'system',
    description: 'Once-off ID verification recovery fee',
  })

  const campaign = await findEligibleCampaign(tx, providerId)
  if (!campaign) {
    return { outcome: 'ACCRUED', skippedSponsorship: 'NO_ELIGIBLE_CAMPAIGN' }
  }

  if (verification?.identifierHash) {
    const priorSponsorship = await tx.kycSponsorship.findFirst({
      where: { identifierHash: verification.identifierHash, status: 'CONSUMED' },
      select: { id: true },
    })
    if (priorSponsorship) {
      return { outcome: 'ACCRUED', skippedSponsorship: 'IDENTIFIER_ALREADY_SPONSORED' }
    }
  }

  // Atomic allocation claim: WHERE re-evaluates sponsoredCount at write time,
  // so concurrent claims cannot oversubscribe the cap.
  const claimed = await tx.kycCampaign.updateMany({
    where: {
      id: campaign.id,
      status: 'ACTIVE',
      sponsoredCount: { lt: campaign.maxSponsoredCount },
    },
    data: { sponsoredCount: { increment: 1 } },
  })
  if (claimed.count === 0) {
    return { outcome: 'ACCRUED', skippedSponsorship: 'ALLOCATION_EXHAUSTED' }
  }

  const sponsorship = await tx.kycSponsorship.create({
    data: {
      campaignId: campaign.id,
      providerId,
      verificationId,
      identifierHash: verification?.identifierHash ?? null,
      status: 'CONSUMED',
      source: 'system',
      feeCents: KYC_FEE_CENTS,
    },
  })

  await writeKycFeeLedgerEntryInTransaction(tx, {
    providerId,
    reason: 'KYC_FEE_SPONSORED',
    amountCents: KYC_FEE_CENTS,
    referenceType: 'kyc_sponsorship',
    referenceId: sponsorship.id,
    campaignId: campaign.id,
    idempotencyKey: kycFeeSponsoredKey(sponsorship.id),
    source: 'system',
    description: `ID verification fee sponsored by launch campaign ${campaign.campaignCode}`,
  })

  return {
    outcome: 'SPONSORED',
    campaignId: campaign.id,
    campaignCode: campaign.campaignCode,
    sponsorshipId: sponsorship.id,
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm vitest run __tests__/lib/kyc-fee-booking.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/kyc-fee/booking.ts __tests__/lib/kyc-fee-booking.test.ts
git commit -m "feat: add KYC fee booking service with atomic campaign allocation claim"
```

---

### Task 6: Orchestrator hook + WhatsApp copy

**Files:**
- Create: `lib/kyc-fee/messaging.ts`
- Modify: `lib/identity-verification/orchestrator.ts:467-482` (transition) and `:503-533` (notify)

- [ ] **Step 1: Create the messaging helper**

Create `lib/kyc-fee/messaging.ts`:

```ts
import { isEnabled } from '../flags'
import { formatRandsFromCents } from './constants'
import { getKycFeeStatus } from './ledger'

/**
 * One sentence describing the provider's KYC fee outcome, for appending to
 * verification-success notifications. Null when the fee model is off or
 * there is nothing to say.
 */
export async function kycFeeOutcomeSentence(providerId: string): Promise<string | null> {
  if (!(await isEnabled('kyc.fee_accrual.enabled'))) return null
  const status = await getKycFeeStatus(providerId)
  if (status.lastReason === 'KYC_FEE_SPONSORED' && status.outstandingCents === 0) {
    return 'Good news: your once-off ID verification fee has been covered by a Plug A Pro launch voucher - nothing to pay.'
  }
  if (status.outstandingCents > 0) {
    return `A once-off ${formatRandsFromCents(status.outstandingCents)} verification recovery fee will be recovered from your first top-up.`
  }
  return null
}
```

- [ ] **Step 2: Hook the booking into the VERIFIED transition**

In `lib/identity-verification/orchestrator.ts`, add imports near the existing ones at the top of the file:

```ts
import {
  bookKycFeeForVerifiedProvider,
  type KycFeeBookingClient,
} from '../kyc-fee/booking'
import { kycFeeOutcomeSentence } from '../kyc-fee/messaging'
```

Replace the kycStatus block inside `transitionIdentityVerification` (currently lines 467-475):

```ts
  if (current.providerId) {
    const kycStatus = kycStatusForTransition(input.toStatus, input.decision)
    if (kycStatus) {
      await client.provider.update({
        where: { id: current.providerId },
        data: { kycStatus },
      })
    }
    if (kycStatus === 'VERIFIED') {
      try {
        // The admin approval path passes crudAction's open transaction as
        // `client`; the webhook/automation paths pass the root db client.
        // Booking joins the caller's tx when one exists, otherwise opens its
        // own. The structural IdentityVerificationClient type doesn't declare
        // the kyc-fee delegates, so widen for the call - the runtime object
        // is always a full Prisma client or interactive-transaction client.
        await bookKycFeeForVerifiedProvider(
          { providerId: current.providerId, verificationId: input.verificationId },
          client === db ? undefined : (client as unknown as KycFeeBookingClient),
        )
      } catch (error) {
        logIdentityVerificationError('verify.kyc_fee_booking.failed', error, {
          verificationId: input.verificationId,
          providerId: current.providerId,
        })
      }
    }
  }
```

- [ ] **Step 3: Append the fee sentence to the PASSED WhatsApp notification**

In `notifyTerminalVerificationStatus` (orchestrator.ts:503), widen the provider select and append the sentence. Replace the body between the `text` guard and the `sendText` call:

```ts
    const text = terminalNotificationText(toStatus)
    if (!text) return
    const verification = await db.providerIdentityVerification.findUnique({
      where: { id: verificationId },
      select: { provider: { select: { id: true, phone: true } } },
    })
    const phone = verification?.provider?.phone
    if (!phone) {
      logIdentityVerificationEvent('verify.terminal_notify.skip_no_phone', {
        verificationId,
        toStatus,
      })
      return
    }
    let message = text
    if (toStatus === 'PASSED' && verification?.provider?.id) {
      const feeSentence = await kycFeeOutcomeSentence(verification.provider.id)
      if (feeSentence) message = `${text} ${feeSentence}`
    }
    await sendText(phone, message)
```

(The remaining `logIdentityVerificationEvent('verify.terminal_notify.sent', …)` and catch block stay as they are.)

- [ ] **Step 4: Verify nothing regressed**

Run: `pnpm typecheck && pnpm vitest run __tests__/lib`
Expected: typecheck PASS; all `__tests__/lib` suites PASS (orchestrator behaviour for non-VERIFIED transitions is unchanged; the booking call is flag-gated off by default).

- [ ] **Step 5: Commit**

```bash
git add lib/kyc-fee/messaging.ts lib/identity-verification/orchestrator.ts
git commit -m "feat: book KYC fee on VERIFIED transition and extend success notification copy"
```

---

### Task 7: Reconcile script

**Files:**
- Create: `scripts/reconcile-kyc-fees.ts`

- [ ] **Step 1: Write the script**

Create `scripts/reconcile-kyc-fees.ts`:

```ts
/**
 * Sweeps providers with kycStatus VERIFIED that have no KYC fee accrual and
 * books the fee through the same accrue-or-sponsor path as the live hook.
 *
 * Dry-run by default. Usage:
 *   pnpm tsx scripts/reconcile-kyc-fees.ts             # report only
 *   pnpm tsx scripts/reconcile-kyc-fees.ts --apply     # book missing fees
 *
 * NOTE: running with --apply against providers verified BEFORE the fee model
 * launched is a product decision (retroactive fees). Confirm before applying.
 */
import { db } from '../lib/db'
import { bookKycFeeForVerifiedProvider } from '../lib/kyc-fee/booking'

const apply = process.argv.includes('--apply')

async function main() {
  const providers = await db.provider.findMany({
    where: {
      kycStatus: 'VERIFIED',
      kycFeeLedgerEntries: { none: { reason: 'KYC_FEE_ACCRUED' } },
    },
    select: {
      id: true,
      name: true,
      identityVerifications: {
        where: { status: 'PASSED', decision: 'PASS' },
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: { id: true },
      },
    },
  })

  console.log(`${providers.length} VERIFIED provider(s) without a KYC fee accrual.`)
  if (!apply) {
    for (const p of providers) console.log(`  would book: ${p.id} (${p.name})`)
    console.log('Dry run. Re-run with --apply to book.')
    return
  }

  for (const p of providers) {
    const verificationId = p.identityVerifications[0]?.id
    if (!verificationId) {
      console.log(`  skip ${p.id} (${p.name}): no PASSED verification row`)
      continue
    }
    const result = await bookKycFeeForVerifiedProvider({ providerId: p.id, verificationId })
    console.log(`  ${p.id} (${p.name}): ${result.outcome}`)
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
```

- [ ] **Step 2: Verify it compiles and dry-runs**

Run: `pnpm typecheck && pnpm tsx scripts/reconcile-kyc-fees.ts`
Expected: typecheck PASS; script prints `N VERIFIED provider(s) without a KYC fee accrual.` followed by `Dry run. Re-run with --apply to book.` (booking is also flag-gated, so even `--apply` is a no-op while `kyc.fee_accrual.enabled` is off).

- [ ] **Step 3: Commit**

```bash
git add scripts/reconcile-kyc-fees.ts
git commit -m "feat: add dry-run reconcile script for missed KYC fee bookings"
```

---

### Task 8: Admin server actions

**Files:**
- Create: `app/(admin)/admin/kyc-campaigns/actions.ts`

- [ ] **Step 1: Write the actions file**

Create `app/(admin)/admin/kyc-campaigns/actions.ts`:

```ts
'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import type { KycCampaignStatus } from '@prisma/client'
import { db } from '@/lib/db'
import { crudAction, CrudActionError } from '@/lib/crud-action'
import { requireAdmin } from '@/lib/auth'
import {
  KYC_FEE_CENTS,
  kycFeeAccruedKey,
  kycFeeReversedKey,
  kycFeeSponsoredKey,
} from '@/lib/kyc-fee/constants'
import { getKycFeeStatus, writeKycFeeLedgerEntryInTransaction } from '@/lib/kyc-fee/ledger'

const FLAG = 'admin.kyc_campaigns'
const PAGE = '/admin/kyc-campaigns'

export type KycCampaignSummary = {
  id: string
  name: string
  campaignCode: string
  status: KycCampaignStatus
  areaLabel: string | null
  areaSlug: string | null
  startsAt: string
  endsAt: string | null
  maxSponsoredCount: number
  consumed: number
  reversed: number
  remaining: number
  createdAt: string
}

export async function listKycCampaignsAction(): Promise<KycCampaignSummary[]> {
  await requireAdmin()
  const [campaigns, grouped] = await Promise.all([
    db.kycCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      include: { locationNode: { select: { label: true, slug: true } } },
    }),
    db.kycSponsorship.groupBy({ by: ['campaignId', 'status'], _count: { id: true } }),
  ])

  const counts = grouped.reduce<Record<string, Record<string, number>>>((acc, row) => {
    if (!acc[row.campaignId]) acc[row.campaignId] = {}
    acc[row.campaignId][row.status] = row._count.id
    return acc
  }, {})

  return campaigns.map((c) => {
    const consumed = counts[c.id]?.['CONSUMED'] ?? 0
    const reversed = counts[c.id]?.['REVERSED'] ?? 0
    return {
      id: c.id,
      name: c.name,
      campaignCode: c.campaignCode,
      status: c.status,
      areaLabel: c.locationNode?.label ?? null,
      areaSlug: c.locationNode?.slug ?? null,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt?.toISOString() ?? null,
      maxSponsoredCount: c.maxSponsoredCount,
      consumed,
      reversed,
      remaining: Math.max(0, c.maxSponsoredCount - consumed),
      createdAt: c.createdAt.toISOString(),
    }
  })
}

const CreateCampaignSchema = z.object({
  name: z.string().trim().min(3, 'Name must be at least 3 characters'),
  campaignCode: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_]{3,40}$/, 'Campaign code must be A-Z, 0-9 and underscores'),
  locationNodeSlug: z.string().trim().min(1).optional(),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date().optional(),
  maxSponsoredCount: z.coerce.number().int().positive().max(100_000),
})

export async function createKycCampaignAction(input: unknown) {
  const admin = await requireAdmin()
  const result = await crudAction<z.infer<typeof CreateCampaignSchema>, { id: string }>({
    entity: 'KycCampaign',
    action: 'kyc_campaign.create',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: CreateCampaignSchema,
    input,
    run: async (data, tx) => {
      let locationNodeId: string | null = null
      if (data.locationNodeSlug) {
        const node = await tx.locationNode.findUnique({
          where: { slug: data.locationNodeSlug },
          select: { id: true },
        })
        if (!node) {
          throw new CrudActionError('NOT_FOUND', `No location node with slug '${data.locationNodeSlug}'`)
        }
        locationNodeId = node.id
      }
      if (data.endsAt && data.endsAt <= data.startsAt) {
        throw new CrudActionError('VALIDATION', 'endsAt must be after startsAt')
      }
      const adminUser = await tx.adminUser.findUnique({
        where: { userId: admin.id },
        select: { id: true },
      })
      if (!adminUser) throw new CrudActionError('UNAUTHORIZED', 'Admin user record not found')
      return tx.kycCampaign.create({
        data: {
          name: data.name,
          campaignCode: data.campaignCode,
          locationNodeId,
          startsAt: data.startsAt,
          endsAt: data.endsAt ?? null,
          maxSponsoredCount: data.maxSponsoredCount,
          createdById: adminUser.id,
        },
        select: { id: true },
      })
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const ALLOWED_STATUS_TRANSITIONS: Record<KycCampaignStatus, KycCampaignStatus[]> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
}

const SetStatusSchema = z.object({
  campaignId: z.string().min(1),
  status: z.enum(['ACTIVE', 'PAUSED', 'CLOSED']),
})

export async function setKycCampaignStatusAction(input: unknown) {
  const result = await crudAction<z.infer<typeof SetStatusSchema>, { id: string; status: string }>({
    entity: 'KycCampaign',
    action: 'kyc_campaign.set_status',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: SetStatusSchema,
    input,
    run: async (data, tx) => {
      const campaign = await tx.kycCampaign.findUnique({
        where: { id: data.campaignId },
        select: { id: true, status: true },
      })
      if (!campaign) throw new CrudActionError('NOT_FOUND', 'Campaign not found')
      if (!ALLOWED_STATUS_TRANSITIONS[campaign.status].includes(data.status)) {
        throw new CrudActionError('CONFLICT', `Cannot move campaign from ${campaign.status} to ${data.status}`)
      }
      return tx.kycCampaign.update({
        where: { id: data.campaignId },
        data: { status: data.status },
        select: { id: true, status: true },
      })
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const GrantSchema = z.object({
  campaignId: z.string().min(1),
  providerId: z.string().min(1),
  reason: z.string().trim().min(5, 'A justification of at least 5 characters is required'),
})

export async function grantKycSponsorshipAction(input: unknown) {
  const admin = await requireAdmin()
  const actorId = admin.adminUserId ?? admin.id
  const result = await crudAction<z.infer<typeof GrantSchema>, { id: string }>({
    entity: 'KycSponsorship',
    action: 'kyc_sponsorship.grant',
    requiredRole: ['TRUST'],
    requiredFlag: FLAG,
    schema: GrantSchema,
    input,
    reason: (input as { reason?: string })?.reason,
    run: async (data, tx) => {
      const provider = await tx.provider.findUnique({
        where: { id: data.providerId },
        select: { id: true, kycStatus: true },
      })
      if (!provider) throw new CrudActionError('NOT_FOUND', 'Provider not found')
      if (provider.kycStatus !== 'VERIFIED') {
        throw new CrudActionError('CONFLICT', 'Provider must be KYC-verified before sponsoring')
      }
      const campaign = await tx.kycCampaign.findUnique({ where: { id: data.campaignId } })
      if (!campaign) throw new CrudActionError('NOT_FOUND', 'Campaign not found')
      if (campaign.status === 'DRAFT') {
        throw new CrudActionError('CONFLICT', 'Activate the campaign before granting sponsorships')
      }
      const existing = await tx.kycSponsorship.findUnique({
        where: { campaignId_providerId: { campaignId: data.campaignId, providerId: data.providerId } },
        select: { id: true },
      })
      if (existing) {
        throw new CrudActionError('CONFLICT', 'Provider already has a sponsorship on this campaign')
      }

      const feeStatus = await getKycFeeStatus(data.providerId, tx)
      if (feeStatus.lastReason !== null && feeStatus.outstandingCents === 0) {
        throw new CrudActionError('CONFLICT', 'Provider has no outstanding KYC fee to sponsor')
      }
      if (feeStatus.lastReason === null) {
        // Provider verified before the fee model launched - book the accrual now.
        const verification = await tx.providerIdentityVerification.findFirst({
          where: { providerId: data.providerId, status: 'PASSED', decision: 'PASS' },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })
        await writeKycFeeLedgerEntryInTransaction(tx, {
          providerId: data.providerId,
          reason: 'KYC_FEE_ACCRUED',
          amountCents: KYC_FEE_CENTS,
          referenceType: 'provider_identity_verification',
          referenceId: verification?.id ?? data.providerId,
          idempotencyKey: kycFeeAccruedKey(data.providerId),
          source: 'admin',
          createdBy: actorId,
          description: 'Once-off ID verification recovery fee (booked at manual sponsorship)',
        })
      }

      const claimed = await tx.kycCampaign.updateMany({
        where: { id: campaign.id, sponsoredCount: { lt: campaign.maxSponsoredCount } },
        data: { sponsoredCount: { increment: 1 } },
      })
      if (claimed.count === 0) {
        throw new CrudActionError('CONFLICT', 'Campaign allocation is exhausted - raise the max sponsored count first')
      }

      const sponsorship = await tx.kycSponsorship.create({
        data: {
          campaignId: campaign.id,
          providerId: data.providerId,
          status: 'CONSUMED',
          source: 'admin',
          feeCents: KYC_FEE_CENTS,
          reason: data.reason,
        },
        select: { id: true },
      })

      await writeKycFeeLedgerEntryInTransaction(tx, {
        providerId: data.providerId,
        reason: 'KYC_FEE_SPONSORED',
        amountCents: KYC_FEE_CENTS,
        referenceType: 'kyc_sponsorship',
        referenceId: sponsorship.id,
        campaignId: campaign.id,
        idempotencyKey: kycFeeSponsoredKey(sponsorship.id),
        source: 'admin',
        createdBy: actorId,
        description: `Manually sponsored by admin under campaign ${campaign.campaignCode}: ${data.reason}`,
      })

      return sponsorship
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

const RevokeSchema = z.object({
  sponsorshipId: z.string().min(1),
  reason: z.string().trim().min(5, 'A justification of at least 5 characters is required'),
})

export async function revokeKycSponsorshipAction(input: unknown) {
  const admin = await requireAdmin()
  const actorId = admin.adminUserId ?? admin.id
  const result = await crudAction<z.infer<typeof RevokeSchema>, { id: string }>({
    entity: 'KycSponsorship',
    action: 'kyc_sponsorship.revoke',
    requiredRole: ['ADMIN', 'OWNER'],
    requiredFlag: FLAG,
    schema: RevokeSchema,
    input,
    reason: (input as { reason?: string })?.reason,
    run: async (data, tx) => {
      const sponsorship = await tx.kycSponsorship.findUnique({
        where: { id: data.sponsorshipId },
      })
      if (!sponsorship) throw new CrudActionError('NOT_FOUND', 'Sponsorship not found')
      if (sponsorship.status !== 'CONSUMED') {
        throw new CrudActionError('CONFLICT', 'Only CONSUMED sponsorships can be revoked')
      }

      const updated = await tx.kycSponsorship.update({
        where: { id: sponsorship.id },
        data: {
          status: 'REVERSED',
          revokedAt: new Date(),
          revokedById: actorId,
          reason: data.reason,
        },
        select: { id: true },
      })

      await writeKycFeeLedgerEntryInTransaction(tx, {
        providerId: sponsorship.providerId,
        reason: 'KYC_FEE_REVERSED',
        amountCents: sponsorship.feeCents,
        referenceType: 'kyc_sponsorship',
        referenceId: sponsorship.id,
        campaignId: sponsorship.campaignId,
        idempotencyKey: kycFeeReversedKey(sponsorship.id),
        source: 'admin',
        createdBy: actorId,
        description: `Sponsorship revoked: ${data.reason}`,
      })

      await tx.kycCampaign.updateMany({
        where: { id: sponsorship.campaignId, sponsoredCount: { gt: 0 } },
        data: { sponsoredCount: { decrement: 1 } },
      })

      return updated
    },
  })
  if (result.ok) revalidatePath(PAGE)
  return result
}

// ─── Form wrappers (page <form action={…}>) ──────────────────────────────────

export async function createKycCampaignFromFormAction(formData: FormData) {
  await createKycCampaignAction({
    name: formData.get('name'),
    campaignCode: formData.get('campaignCode'),
    locationNodeSlug: (formData.get('locationNodeSlug') as string)?.trim() || undefined,
    startsAt: formData.get('startsAt'),
    endsAt: (formData.get('endsAt') as string)?.trim() || undefined,
    maxSponsoredCount: formData.get('maxSponsoredCount'),
  })
}

export async function setKycCampaignStatusFromFormAction(formData: FormData) {
  await setKycCampaignStatusAction({
    campaignId: formData.get('campaignId'),
    status: formData.get('status'),
  })
}

export async function grantKycSponsorshipFromFormAction(formData: FormData) {
  await grantKycSponsorshipAction({
    campaignId: formData.get('campaignId'),
    providerId: formData.get('providerId'),
    reason: formData.get('reason'),
  })
}

export async function revokeKycSponsorshipFromFormAction(formData: FormData) {
  await revokeKycSponsorshipAction({
    sponsorshipId: formData.get('sponsorshipId'),
    reason: formData.get('reason'),
  })
}
```

Note: this is a `'use server'` file — only async function exports plus type exports are allowed (Turbopack enforces this at `pnpm build`, not `tsc`). The Zod schemas and `FLAG`/`PAGE` constants stay un-exported on purpose.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. If `requireAdmin()`'s return type lacks `adminUserId`, check its definition in `lib/auth.ts` and mirror the access pattern used at `app/(admin)/admin/verifications/actions.ts:89` (`admin.adminUserId ?? admin.id`).

- [ ] **Step 3: Commit**

```bash
git add "app/(admin)/admin/kyc-campaigns/actions.ts"
git commit -m "feat: add admin actions for KYC campaign CRUD and manual grant/revoke"
```

---

### Task 9: Admin page + dashboard link

**Files:**
- Create: `app/(admin)/admin/kyc-campaigns/page.tsx`
- Modify: `app/(admin)/admin/page.tsx:212-217` (quick links)

- [ ] **Step 1: Create the admin page**

Create `app/(admin)/admin/kyc-campaigns/page.tsx`:

```tsx
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { VENDOR_MONTHLY_FREE_TIER_DEFAULT } from '@/lib/kyc-fee/constants'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  createKycCampaignFromFormAction,
  grantKycSponsorshipFromFormAction,
  listKycCampaignsAction,
  revokeKycSponsorshipFromFormAction,
  setKycCampaignStatusFromFormAction,
} from './actions'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  DRAFT: 'outline',
  ACTIVE: 'default',
  PAUSED: 'secondary',
  CLOSED: 'destructive',
}

const NEXT_STATUSES: Record<string, string[]> = {
  DRAFT: ['ACTIVE', 'CLOSED'],
  ACTIVE: ['PAUSED', 'CLOSED'],
  PAUSED: ['ACTIVE', 'CLOSED'],
  CLOSED: [],
}

export default async function AdminKycCampaignsPage() {
  const enabled = await isEnabled('admin.kyc_campaigns')
  if (!enabled) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            The KYC campaigns feature is not enabled. Enable the{' '}
            <code className="font-mono text-xs">admin.kyc_campaigns</code> flag to use it.
          </CardContent>
        </Card>
      </div>
    )
  }

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const [campaigns, vendorChecksThisMonth] = await Promise.all([
    listKycCampaignsAction(),
    db.providerIdentityVerification.count({
      where: { vendorReference: { not: null }, createdAt: { gte: monthStart } },
    }),
  ])

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Launch KYC campaigns</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Sponsor the once-off ID verification fee for the first N verified providers in a
          launch area. Sponsorships are granted automatically on successful verification
          while a campaign is active and has allocation remaining.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor checks this month</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            <span className="font-semibold">{vendorChecksThisMonth}</span> verification
            checks submitted to the vendor since {monthStart.toLocaleDateString()}.
            Free-tier allowance: {VENDOR_MONTHLY_FREE_TIER_DEFAULT}/month (reconcile against
            the vendor invoice monthly — this counter is informational and separate from
            campaign allocations).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Create campaign</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createKycCampaignFromFormAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" placeholder="West Rand launch" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="campaignCode">Campaign code</Label>
              <Input id="campaignCode" name="campaignCode" placeholder="WEST_RAND_LAUNCH" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="locationNodeSlug">Area slug (blank = global)</Label>
              <Input
                id="locationNodeSlug"
                name="locationNodeSlug"
                placeholder="gauteng__johannesburg__jhb_west"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="maxSponsoredCount">Max sponsored providers</Label>
              <Input
                id="maxSponsoredCount"
                name="maxSponsoredCount"
                type="number"
                min={1}
                placeholder="200"
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="startsAt">Starts</Label>
              <Input id="startsAt" name="startsAt" type="datetime-local" required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="endsAt">Ends (optional)</Label>
              <Input id="endsAt" name="endsAt" type="datetime-local" />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit">Create as draft</Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {campaigns.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground">
            No campaigns yet. Create one above — it starts as DRAFT and only sponsors once
            activated.
          </CardContent>
        </Card>
      )}

      {campaigns.map((c) => (
        <Card key={c.id}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-base">{c.name}</CardTitle>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  Code: <code className="font-mono">{c.campaignCode}</code>
                  {' · '}Area: {c.areaLabel ?? 'Global'}
                  {' · '}
                  {new Date(c.startsAt).toLocaleDateString()} →{' '}
                  {c.endsAt ? new Date(c.endsAt).toLocaleDateString() : 'open-ended'}
                </p>
              </div>
              <Badge variant={STATUS_BADGE[c.status] ?? 'outline'}>{c.status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center text-sm">
              <div>
                <p className="font-semibold">{c.maxSponsoredCount}</p>
                <p className="text-muted-foreground text-xs">Allocation</p>
              </div>
              <div>
                <p className="font-semibold">{c.consumed}</p>
                <p className="text-muted-foreground text-xs">Sponsored</p>
              </div>
              <div>
                <p className="font-semibold">{c.reversed}</p>
                <p className="text-muted-foreground text-xs">Reversed</p>
              </div>
              <div>
                <p className="font-semibold">{c.remaining}</p>
                <p className="text-muted-foreground text-xs">Remaining</p>
              </div>
            </div>
            <div className="flex gap-2">
              {NEXT_STATUSES[c.status].map((next) => (
                <form key={next} action={setKycCampaignStatusFromFormAction}>
                  <input type="hidden" name="campaignId" value={c.id} />
                  <input type="hidden" name="status" value={next} />
                  <Button
                    type="submit"
                    size="sm"
                    variant={next === 'CLOSED' ? 'destructive' : 'outline'}
                  >
                    {next === 'ACTIVE' ? 'Activate' : next === 'PAUSED' ? 'Pause' : 'Close'}
                  </Button>
                </form>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Manual grant</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={grantKycSponsorshipFromFormAction} className="grid gap-3 sm:grid-cols-3">
            <Input name="campaignId" placeholder="Campaign ID" required />
            <Input name="providerId" placeholder="Provider ID" required />
            <Input name="reason" placeholder="Reason (audited)" required />
            <div className="sm:col-span-3">
              <Button type="submit" variant="outline">
                Grant sponsorship
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revoke sponsorship</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={revokeKycSponsorshipFromFormAction} className="grid gap-3 sm:grid-cols-2">
            <Input name="sponsorshipId" placeholder="Sponsorship ID" required />
            <Input name="reason" placeholder="Reason (audited)" required />
            <div className="sm:col-span-2">
              <Button type="submit" variant="destructive">
                Revoke
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
```

- [ ] **Step 2: Add the dashboard quick link**

In `app/(admin)/admin/page.tsx`, after the verifications quick-link block (lines 212-217), add:

```tsx
            <Button asChild variant="outline" className="w-full justify-between">
              <Link href="/admin/kyc-campaigns">
                Manage launch KYC campaigns
                <span aria-hidden="true">→</span>
              </Link>
            </Button>
```

- [ ] **Step 3: Verify in the browser**

Run: `pnpm dev`, sign in as admin, open `http://localhost:3000/admin/kyc-campaigns`.
Expected with flag off: the "feature is not enabled" card. Enable the flag (insert a `feature_flags` row with key `admin.kyc_campaigns`, `enabled = true`, or use the project's flag tooling), reload: header, vendor month card, create form, empty-state card all render. Create a campaign (e.g. `WEST_RAND_LAUNCH`, slug `gauteng__johannesburg__jhb_west`, max 200) → it appears as DRAFT with allocation 200 / remaining 200; Activate → badge flips to ACTIVE. Check `/admin` shows the new quick link.

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(admin)/admin/kyc-campaigns/page.tsx" "app/(admin)/admin/page.tsx"
git commit -m "feat: add /admin/kyc-campaigns screen with usage counts and vendor month card"
```

---

### Task 10: Provider credits-page banner

**Files:**
- Modify: `app/(provider)/provider/credits/actions.ts` (append)
- Modify: `app/(provider)/provider/credits/page.tsx`

- [ ] **Step 1: Add the banner loader to the credits actions**

Append to `app/(provider)/provider/credits/actions.ts` (it already imports `db`; this function follows the file's existing `getAuthenticatedProvider()` pattern — confirm the helper name at the top of the file and reuse it):

```ts
export type ProviderKycFeeBanner = { kind: 'sponsored' | 'accrued'; text: string }

export async function getProviderKycFeeBanner(): Promise<ProviderKycFeeBanner | null> {
  const { isEnabled } = await import('@/lib/flags')
  if (!(await isEnabled('kyc.fee_accrual.enabled'))) return null
  const provider = await getAuthenticatedProvider()
  const { getKycFeeStatus } = await import('@/lib/kyc-fee/ledger')
  const { formatRandsFromCents, KYC_FEE_CENTS } = await import('@/lib/kyc-fee/constants')
  const status = await getKycFeeStatus(provider.id)
  if (status.lastReason === 'KYC_FEE_SPONSORED' && status.outstandingCents === 0) {
    return {
      kind: 'sponsored',
      text: `ID verification fee: ${formatRandsFromCents(KYC_FEE_CENTS)} - sponsored by a Plug A Pro launch campaign. Nothing due.`,
    }
  }
  if (status.outstandingCents > 0) {
    return {
      kind: 'accrued',
      text: `ID verification fee: ${formatRandsFromCents(status.outstandingCents)} - will be recovered from your first top-up.`,
    }
  }
  return null
}
```

(Dynamic imports keep this `'use server'` file's static import surface unchanged; if the file already imports `isEnabled` statically, use the existing import instead.)

- [ ] **Step 2: Render the banner on the credits page**

Replace `app/(provider)/provider/credits/page.tsx`:

```tsx
export const dynamic = 'force-dynamic'

import { CreditsEntryClient } from '@/components/provider/credits'
import { buildMetadata } from '@/lib/metadata'
import { PROVIDER_CREDIT_PRICE_ZAR } from '@/lib/provider-wallet'
import { getProviderKycFeeBanner, getProviderWallet } from './actions'

export const metadata = buildMetadata({ title: 'Provider Credits', noIndex: true })

export default async function ProviderCreditsPage() {
  const [wallet, kycFeeBanner] = await Promise.all([
    getProviderWallet(),
    getProviderKycFeeBanner(),
  ])

  return (
    <>
      {kycFeeBanner && (
        <div
          data-testid="kyc-fee-banner"
          className="bg-muted/50 mx-4 mt-4 rounded-lg border p-3 text-sm"
        >
          {kycFeeBanner.text}
        </div>
      )}
      <CreditsEntryClient wallet={wallet} creditPriceZar={PROVIDER_CREDIT_PRICE_ZAR} />
    </>
  )
}
```

- [ ] **Step 3: Verify in the browser**

With `pnpm dev` running and `kyc.fee_accrual.enabled` off: `/provider/credits` renders exactly as before (no banner). Flag on + a provider with a `KYC_FEE_SPONSORED` ledger row: sponsored banner appears above the credits screen; provider with only `KYC_FEE_ACCRUED`: accrued banner. (Seed a test row via Prisma Studio or by running a verification through the flow.)

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "app/(provider)/provider/credits/actions.ts" "app/(provider)/provider/credits/page.tsx"
git commit -m "feat: show KYC fee sponsorship/accrual banner on provider credits page"
```

---

### Task 11: Smoke coverage + final verification

**Files:**
- Modify: `e2e/smoke.spec.ts`

- [ ] **Step 1: Add the admin route to the smoke suite**

In `e2e/smoke.spec.ts`, alongside the existing admin route tests (the `page.goto('/admin/providers')`-style blocks around lines 89-110), add:

```ts
  test('admin kyc campaigns page renders', async ({ page }) => {
    await page.goto('/admin/kyc-campaigns')
    await expect(
      page.getByRole('heading', { name: /Launch KYC campaigns/i }).or(
        page.getByText(/KYC campaigns feature is not enabled/i),
      ),
    ).toBeVisible()
  })
```

(The `.or(…)` keeps smoke green in environments where the flag is off — both states are valid renders, only a 500/404 fails.)

- [ ] **Step 2: Run the full unit suite**

Run: `pnpm test`
Expected: PASS — all suites, including the three new ones.

- [ ] **Step 3: Run lint and a production build**

Run: `pnpm lint && pnpm build`
Expected: PASS. The build step is mandatory before merge: Turbopack enforces async-only exports in `'use server'` files at build time (`tsc` does not catch this), and this plan adds two server-action files.

- [ ] **Step 4: Commit**

```bash
git add e2e/smoke.spec.ts
git commit -m "test: add /admin/kyc-campaigns smoke coverage"
```

---

## Rollout (post-merge, not part of this plan's code)

1. Deploy with both flags off — zero behaviour change.
2. Enable `admin.kyc_campaigns`; create the West Rand campaign (`WEST_RAND_LAUNCH`, area slug `gauteng__johannesburg__jhb_west`, max 200, status ACTIVE).
3. Enable `kyc.fee_accrual.enabled` — from this moment, new VERIFIED providers get accrued or sponsored.
4. Decide explicitly whether to run `pnpm tsx scripts/reconcile-kyc-fees.ts --apply` for previously-verified providers (retroactive fees are a product decision — default is NOT to).
5. Monitor: `/admin/kyc-campaigns` usage counts; `verify.kyc_fee_booking.failed` log events.

## Self-review notes

- Spec coverage: campaign model w/ configurable cap (Task 1, 8, 9), auto-grant on KYC success w/ atomic claim + identifier dedup (Tasks 4-6), graceful exhaustion fallback (Task 5 `ALLOCATION_EXHAUSTED`), admin create/pause/close/grant/revoke + usage + audit-with-reason (Tasks 8-9), provider copy on WhatsApp + wallet (Tasks 6, 10), vendor 500/month as manual admin number (Task 9), reconcile/repair path (Task 7). First-top-up collection deliberately out of scope (see Scope).
- Type consistency: `KycFeeBookingClient` (booking.ts) ⊇ `CampaignMatchTx` (campaign-matching.ts) ⊇ `KycFeeLedgerTx` (ledger.ts) — Prisma `Pick` types nest correctly; `writeKycFeeLedgerEntryInTransaction(tx, …)` accepts any of them.
- The `campaignId_providerId` compound-unique accessor name in Task 8 follows Prisma's default naming for `@@unique([campaignId, providerId])`.

# WhatsApp Registration Recovery Nudge + Web Finish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a manual "Send recovery nudge" action to `/admin/applications` for drop-off candidates AND a web `/provider/signup?t=...` page that lets candidates finish their registration in a browser, both backed by a single-use hashed resume token and a shared submission helper that guarantees identical `ProviderApplication` shape regardless of channel.

**Architecture:** New `ProviderResumeToken` table (hashed tokens, single-use, 7-day TTL, prior-token supersession). Submission logic extracted from `lib/whatsapp-flows/registration.ts` into a shared `submitProviderApplication(input, source)` helper in `lib/provider-applications.ts`. Admin button is a `crudAction`-wrapped server action that issues a token, picks freeform-vs-template based on the 24h Meta window, sends via existing WhatsApp Cloud API helpers, and records outcome with actor metadata. Web page is an anonymous server component that validates the token, loads `Conversation.data`, and renders an adaptive form that only includes sections with missing fields. Three feature flags gate the rollout.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Supabase Auth, React Hook Form + Zod, Tailwind v4 + shadcn-style primitives, Vercel Blob, Meta WhatsApp Cloud API, Vitest, Playwright.

---

## File Structure

**Created:**
- `prisma/migrations/<timestamp>_add_provider_resume_token/migration.sql` — additive table
- `lib/provider-resume-tokens.ts` — issue / validate / consume / revoke
- `lib/provider-applications-submit.ts` — `submitProviderApplication(input, source)` shared helper
- `app/(provider)/provider/signup/page.tsx` — anonymous web finish page (token-gated)
- `app/(provider)/provider/signup/actions.ts` — `submitProviderApplicationFromWebAction`, `updateCapturedFieldAction`
- `app/(provider)/provider/signup/captured-panel.tsx` — collapsed "Already captured" panel
- `app/(provider)/provider/signup/remaining-fields-form.tsx` — RHF + dynamic Zod form host
- `app/(provider)/provider/signup/sections/identity.tsx`
- `app/(provider)/provider/signup/sections/service-areas.tsx`
- `app/(provider)/provider/signup/sections/skills.tsx`
- `app/(provider)/provider/signup/sections/availability.tsx`
- `app/(provider)/provider/signup/sections/rates.tsx`
- `app/(provider)/provider/signup/sections/profile-photo.tsx`
- `app/(provider)/provider/signup/sections/bio.tsx`
- `app/(provider)/provider/signup/sections/references.tsx`
- `app/(provider)/provider/signup/sections/evidence.tsx`
- `app/(provider)/provider/signup/confirmation/page.tsx`
- `app/(provider)/provider/signup/error.tsx`
- `lib/web-signup-sections.ts` — section registry + adaptive schema composer
- `app/(admin)/admin/applications/recovery-actions.ts` — `sendRecoveryNudgeAction` server action
- `components/admin/applications/recovery-nudge-button.tsx` — client button + confirm dialog
- `__tests__/lib/provider-resume-tokens.test.ts`
- `__tests__/lib/provider-applications-submit.test.ts`
- `__tests__/lib/web-signup-sections.test.ts`
- `__tests__/app/admin-applications-recovery-actions.test.ts`
- `e2e/admin-applications-recovery-nudge.spec.ts`
- `e2e/provider-web-signup.spec.ts`

**Modified:**
- `prisma/schema.prisma` — add `ProviderResumeToken` model + back-relation on `Conversation` and `AdminUser`
- `lib/whatsapp-flows/registration.ts` — `handleSubmitApplication` delegates to shared helper
- `lib/provider-onboarding-recovery.ts` — `recordProviderOnboardingRecoveryOutcome` accepts `{ actorAdminUserId?, channel, tokenId? }`
- `lib/feature-flags-registry.ts` — add 3 flags
- `app/(admin)/admin/applications/page.tsx:689-773` — add action column + button per recovery row
- `scripts/seed-flags.ts` — seed the 3 new flags as `defaultValue: false`
- `e2e/smoke.spec.ts` — add `/provider/signup` to public-route smoke; admin-recovery button to admin smoke
- `CLAUDE.md` — append the new `/provider/signup` and `/provider/signup/confirmation` routes to the route inventory

**Boundaries:**
- `lib/provider-resume-tokens.ts` is the **only** module that hashes tokens; nothing else computes `tokenHash`.
- `lib/provider-applications-submit.ts` is the **only** site that calls `tx.providerApplication.create(...)`; both WhatsApp and web routes call this helper.
- `app/(provider)/provider/signup/*` does **not** import from `lib/whatsapp-flows/*` — they communicate via the shared submit helper.
- `lib/web-signup-sections.ts` owns the mapping from WhatsApp step → form section + Zod sub-schema. New steps get added here only.

---

## Phase A — Token foundations

### Task 1: Prisma migration for `ProviderResumeToken`

**Files:**
- Modify: `prisma/schema.prisma` (after the `Conversation` model)
- Create: `prisma/migrations/<timestamp>_add_provider_resume_token/migration.sql` (generated by `prisma migrate dev`)

- [ ] **Step 1: Add the model to schema.prisma**

Insert after the `Conversation` model (currently ending at `prisma/schema.prisma:1823`):

```prisma
model ProviderResumeToken {
  id                  String    @id @default(cuid())
  tokenHash           String    @unique // sha256(rawToken) hex; raw never stored
  conversationId      String
  phone               String    // denormalized E.164 for fast lookup + audit
  issuedByAdminUserId String
  issuedAt            DateTime  @default(now())
  expiresAt           DateTime  // issuedAt + 7 days
  usedAt              DateTime?
  revokedAt           DateTime?
  revokedReason       String?   // 'superseded' | 'admin_revoked'
  source              String    // 'recovery_nudge'

  conversation  Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  issuedByAdmin AdminUser    @relation(fields: [issuedByAdminUserId], references: [id])

  @@index([conversationId])
  @@index([phone, expiresAt])
  @@map("provider_resume_tokens")
}
```

Add back-relations:
- In `model Conversation { ... }` (around `prisma/schema.prisma:1820`) add:
  ```
  resumeTokens ProviderResumeToken[]
  ```
- In `model AdminUser { ... }` (search for `model AdminUser` in schema.prisma) add:
  ```
  issuedProviderResumeTokens ProviderResumeToken[]
  ```

- [ ] **Step 2: Generate the migration**

Run:
```bash
cd field-service
pnpm prisma migrate dev --name add_provider_resume_token --create-only
```

Expected: a new file under `prisma/migrations/<timestamp>_add_provider_resume_token/migration.sql` containing the `CREATE TABLE provider_resume_tokens (...)` plus `CREATE INDEX` statements. No `ALTER TABLE ... DROP` lines. No changes to other tables.

- [ ] **Step 3: Apply the migration locally**

```bash
pnpm prisma migrate dev
```

Expected: migration applies; `pnpm prisma generate` runs automatically; no schema drift warnings.

- [ ] **Step 4: Sanity check the generated SQL**

```bash
grep -E "^(CREATE TABLE|CREATE INDEX|DROP|ALTER)" prisma/migrations/*_add_provider_resume_token/migration.sql
```
Expected output: only `CREATE TABLE` and `CREATE INDEX` lines. **No `DROP` or `ALTER` of existing tables.** If anything else appears, abort and inspect.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add ProviderResumeToken for web signup resume

Hashed single-use token with 7-day TTL; supersession on re-issue.
Drives the upcoming /admin/applications recovery nudge button and
the /provider/signup web finish page."
```

---

### Task 2: Token library — issue / validate / consume / revoke

**Files:**
- Create: `lib/provider-resume-tokens.ts`
- Test: `__tests__/lib/provider-resume-tokens.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/provider-resume-tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { db } from '@/lib/db'
import {
  issueProviderResumeToken,
  validateProviderResumeToken,
  consumeProviderResumeToken,
  revokeProviderResumeTokensForConversation,
  hashProviderResumeToken,
} from '@/lib/provider-resume-tokens'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

async function seedConversation(phone = '+27000000001') {
  return db.conversation.create({
    data: { phone, flow: 'registration', step: 'reg_collect_city', data: { name: 'Test' }, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  })
}

async function seedAdmin() {
  const userId = `user-${Math.random().toString(36).slice(2, 8)}`
  return db.adminUser.create({ data: { userId, email: `${userId}@test`, role: 'ADMIN', active: true } })
}

beforeEach(async () => {
  await db.providerResumeToken.deleteMany()
  await db.conversation.deleteMany()
  await db.adminUser.deleteMany()
})

describe('issueProviderResumeToken', () => {
  it('returns a raw token and stores only its hash', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { rawToken, tokenId } = await issueProviderResumeToken(db, {
      conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge',
    })
    expect(rawToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = await db.providerResumeToken.findUnique({ where: { id: tokenId } })
    expect(row).not.toBeNull()
    expect(row!.tokenHash).toBe(hashProviderResumeToken(rawToken))
    expect(row!.tokenHash).not.toContain(rawToken)
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + SEVEN_DAYS_MS - 60_000)
  })

  it('supersedes prior live tokens for the same conversation', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const first = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const second = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const firstRow = await db.providerResumeToken.findUnique({ where: { id: first.tokenId } })
    const secondRow = await db.providerResumeToken.findUnique({ where: { id: second.tokenId } })
    expect(firstRow!.revokedAt).not.toBeNull()
    expect(firstRow!.revokedReason).toBe('superseded')
    expect(secondRow!.revokedAt).toBeNull()
  })
})

describe('validateProviderResumeToken', () => {
  it('returns ok for a fresh token', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { rawToken } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const result = await validateProviderResumeToken(db, rawToken)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.conversationId).toBe(conv.id)
      expect(result.phone).toBe(conv.phone)
    }
  })

  it('rejects an unknown token', async () => {
    const result = await validateProviderResumeToken(db, 'unknown-token-value-1234567890')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_found')
  })

  it('rejects an expired token', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { rawToken, tokenId } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    await db.providerResumeToken.update({ where: { id: tokenId }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const result = await validateProviderResumeToken(db, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('rejects a used token', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { rawToken, tokenId } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    await db.providerResumeToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } })
    const result = await validateProviderResumeToken(db, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('used')
  })

  it('rejects a revoked token', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { rawToken, tokenId } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    await db.providerResumeToken.update({ where: { id: tokenId }, data: { revokedAt: new Date(), revokedReason: 'admin_revoked' } })
    const result = await validateProviderResumeToken(db, rawToken)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('revoked')
  })
})

describe('consumeProviderResumeToken', () => {
  it('atomically marks the token used and returns true on first call', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { tokenId } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const consumed = await consumeProviderResumeToken(db, tokenId)
    expect(consumed).toBe(true)
    const row = await db.providerResumeToken.findUnique({ where: { id: tokenId } })
    expect(row!.usedAt).not.toBeNull()
  })

  it('returns false on second call (single-use)', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    const { tokenId } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    await consumeProviderResumeToken(db, tokenId)
    const second = await consumeProviderResumeToken(db, tokenId)
    expect(second).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd field-service
pnpm vitest run __tests__/lib/provider-resume-tokens.test.ts
```
Expected: every test fails with `Cannot find module '@/lib/provider-resume-tokens'`.

- [ ] **Step 3: Implement `lib/provider-resume-tokens.ts`**

```ts
import { randomBytes, createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { db } from './db'

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

type Tx = Prisma.TransactionClient | typeof db

export function generateRawToken(): string {
  return randomBytes(32).toString('base64url')
}

export function hashProviderResumeToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

export interface IssueArgs {
  conversationId: string
  phone: string
  issuedByAdminUserId: string
  source: 'recovery_nudge'
}

export async function issueProviderResumeToken(
  client: Tx,
  args: IssueArgs,
): Promise<{ rawToken: string; tokenId: string; expiresAt: Date }> {
  const rawToken = generateRawToken()
  const tokenHash = hashProviderResumeToken(rawToken)
  const expiresAt = new Date(Date.now() + SEVEN_DAYS_MS)

  const tokenId = await (client as typeof db).$transaction(async (tx) => {
    await tx.providerResumeToken.updateMany({
      where: { conversationId: args.conversationId, usedAt: null, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'superseded' },
    })
    const row = await tx.providerResumeToken.create({
      data: {
        tokenHash,
        conversationId: args.conversationId,
        phone: args.phone,
        issuedByAdminUserId: args.issuedByAdminUserId,
        expiresAt,
        source: args.source,
      },
      select: { id: true },
    })
    return row.id
  })

  return { rawToken, tokenId, expiresAt }
}

export type ValidateResult =
  | { ok: true; tokenId: string; conversationId: string; phone: string }
  | { ok: false; reason: 'not_found' | 'expired' | 'used' | 'revoked' }

export async function validateProviderResumeToken(client: Tx, rawToken: string): Promise<ValidateResult> {
  if (!rawToken || rawToken.length < 32) return { ok: false, reason: 'not_found' }
  const tokenHash = hashProviderResumeToken(rawToken)
  const row = await client.providerResumeToken.findUnique({ where: { tokenHash } })
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.usedAt) return { ok: false, reason: 'used' }
  if (row.revokedAt) return { ok: false, reason: 'revoked' }
  if (row.expiresAt.getTime() <= Date.now()) return { ok: false, reason: 'expired' }
  return { ok: true, tokenId: row.id, conversationId: row.conversationId, phone: row.phone }
}

export async function consumeProviderResumeToken(client: Tx, tokenId: string): Promise<boolean> {
  const result = await client.providerResumeToken.updateMany({
    where: { id: tokenId, usedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedAt: new Date() },
  })
  return result.count === 1
}

export async function revokeProviderResumeTokensForConversation(
  client: Tx,
  conversationId: string,
  reason: 'admin_revoked' | 'superseded' = 'admin_revoked',
): Promise<number> {
  const result = await client.providerResumeToken.updateMany({
    where: { conversationId, usedAt: null, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: reason },
  })
  return result.count
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/provider-resume-tokens.test.ts
```
Expected: 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/provider-resume-tokens.ts __tests__/lib/provider-resume-tokens.test.ts
git commit -m "feat(provider): hashed single-use resume tokens with supersession

Issue/validate/consume/revoke for ProviderResumeToken. Raw token is
returned to caller; only sha256 hash is persisted. Re-issuing for the
same conversation supersedes prior live tokens with reason 'superseded'."
```

---

## Phase B — Shared submission helper

### Task 3: Extract `submitProviderApplication(input, source)` helper

**Files:**
- Create: `lib/provider-applications-submit.ts`
- Test: `__tests__/lib/provider-applications-submit.test.ts`

- [ ] **Step 1: Read the existing submit logic**

Read `lib/whatsapp-flows/registration.ts:2280-2360` (the block around `tx.providerApplication.create` at line 2321) AND `lib/whatsapp-flows/registration.ts:2470-2540` (the block around `tx.providerApplication.create` at line 2504). These are the two existing creation paths the helper must subsume.

Capture verbatim:
- Every field passed to `tx.providerApplication.create({ data: { ... } })`
- The `Conversation` mutation that follows submission (`step` change, `data` reset/preservation)
- Any WhatsApp confirmation messages sent (so we know the post-submit side effect set)

- [ ] **Step 2: Write the failing helper test**

Create `__tests__/lib/provider-applications-submit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { submitProviderApplication } from '@/lib/provider-applications-submit'

const baseInput = {
  phone: '+27000000099',
  name: 'Vusi Test',
  idNumber: '8001015009087',
  skills: ['plumbing'],
  serviceAreas: ['JHB North / Sandton'],
  availability: ['Mon', 'Tue'],
  evidenceNote: '',
  experience: '',
}

beforeEach(async () => {
  await db.providerApplication.deleteMany()
  await db.conversation.deleteMany()
})

describe('submitProviderApplication', () => {
  it('creates a ProviderApplication with status PENDING and source whatsapp', async () => {
    const result = await submitProviderApplication(db, baseInput, { source: 'whatsapp' })
    expect(result.application.status).toBe('PENDING')
    expect(result.application.phone).toBe(baseInput.phone)
    expect(result.application.skills).toEqual(['plumbing'])
  })

  it('creates an identical ProviderApplication when called from web source', async () => {
    const result = await submitProviderApplication(db, baseInput, { source: 'web' })
    expect(result.application.status).toBe('PENDING')
    expect(result.application.name).toBe(baseInput.name)
  })

  it('rejects if a non-CANCELLED application already exists for the phone', async () => {
    await submitProviderApplication(db, baseInput, { source: 'whatsapp' })
    await expect(
      submitProviderApplication(db, baseInput, { source: 'whatsapp' }),
    ).rejects.toThrow(/already.*application/i)
  })

  it('updates the Conversation step to reg_pending and preserves data', async () => {
    const conv = await db.conversation.create({
      data: {
        phone: baseInput.phone, flow: 'registration', step: 'reg_collect_evidence',
        data: { name: baseInput.name, skills: baseInput.skills }, expiresAt: new Date(Date.now() + 3600_000),
      },
    })
    await submitProviderApplication(db, baseInput, { source: 'web', conversationId: conv.id })
    const after = await db.conversation.findUnique({ where: { id: conv.id } })
    expect(after!.step).toBe('reg_pending')
    expect((after!.data as any).name).toBe(baseInput.name)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
pnpm vitest run __tests__/lib/provider-applications-submit.test.ts
```
Expected: all fail with `Cannot find module '@/lib/provider-applications-submit'`.

- [ ] **Step 4: Implement the helper**

Create `lib/provider-applications-submit.ts`:

```ts
import type { Prisma, ProviderApplication } from '@prisma/client'
import { db } from './db'

export interface SubmitInput {
  phone: string
  name: string
  idNumber: string
  skills: string[]
  serviceAreas: string[]
  availability: string[]
  experience: string
  evidenceNote: string
  hourlyRate?: number
  profilePhotoUrl?: string
  bio?: string
  references?: string
  evidenceFileUrls?: string[]
}

export interface SubmitOptions {
  source: 'whatsapp' | 'web'
  conversationId?: string
}

export interface SubmitResult {
  application: ProviderApplication
}

type Tx = Prisma.TransactionClient | typeof db

export async function submitProviderApplication(
  client: Tx,
  input: SubmitInput,
  options: SubmitOptions,
): Promise<SubmitResult> {
  return (client as typeof db).$transaction(async (tx) => {
    const conflict = await tx.providerApplication.findFirst({
      where: { phone: input.phone, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      select: { id: true, status: true },
    })
    if (conflict) {
      throw new Error(`A ${conflict.status} application already exists for this phone.`)
    }

    const application = await tx.providerApplication.create({
      data: {
        phone: input.phone,
        name: input.name,
        idNumber: input.idNumber,
        skills: input.skills,
        serviceAreas: input.serviceAreas,
        availability: input.availability,
        experience: input.experience,
        evidenceNote: input.evidenceNote,
        status: 'PENDING',
        submittedAt: new Date(),
      },
    })

    if (options.conversationId) {
      await tx.conversation.update({
        where: { id: options.conversationId },
        data: { step: 'reg_pending' },
      })
    } else {
      await tx.conversation.updateMany({
        where: { phone: input.phone, flow: 'registration' },
        data: { step: 'reg_pending' },
      })
    }

    return { application }
  })
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/provider-applications-submit.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/provider-applications-submit.ts __tests__/lib/provider-applications-submit.test.ts
git commit -m "feat(provider): shared submitProviderApplication helper

Single source of truth for ProviderApplication creation. Used by both
WhatsApp registration flow (next commit) and web finish page."
```

---

### Task 4: Wire WhatsApp flow to the shared helper

**Files:**
- Modify: `lib/whatsapp-flows/registration.ts:2280-2360` and `:2470-2540`

- [ ] **Step 1: Replace each inline `tx.providerApplication.create` call**

For each of the two existing call sites in `lib/whatsapp-flows/registration.ts`, replace the `tx.providerApplication.create({ data: { ... } })` block plus the subsequent Conversation step mutation with a single call:

```ts
import { submitProviderApplication } from '@/lib/provider-applications-submit'
// ...
const { application } = await submitProviderApplication(tx, {
  phone: convo.phone,
  name: data.name,
  idNumber: data.idNumber,
  skills: data.skills ?? [],
  serviceAreas: data.serviceAreas ?? [],
  availability: data.availability ?? [],
  experience: data.experience ?? '',
  evidenceNote: data.evidenceNote ?? '',
  hourlyRate: data.hourlyRate,
  profilePhotoUrl: data.profilePhotoUrl,
  bio: data.bio,
  references: data.references,
  evidenceFileUrls: data.evidenceFileUrls,
}, { source: 'whatsapp', conversationId: convo.id })
```

Keep every line of code that runs **after** the application creation (confirmation message, audit log writes specific to WhatsApp). Only the create-and-conversation-mutation block is being subsumed.

- [ ] **Step 2: Run existing WhatsApp registration tests**

```bash
pnpm vitest run __tests__/lib/whatsapp-flows
```
Expected: every existing test still passes. If any fail, the helper signature is wrong — inspect and fix `lib/provider-applications-submit.ts` before continuing.

- [ ] **Step 3: Run lint + typecheck**

```bash
pnpm lint
pnpm tsc --noEmit
```
Expected: no errors. Inline `await tx.providerApplication.create` should no longer appear in `registration.ts`:
```bash
grep -n "tx.providerApplication.create\|tx\.providerApplication\.create" lib/whatsapp-flows/registration.ts
```
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add lib/whatsapp-flows/registration.ts
git commit -m "refactor(whatsapp): delegate application submission to shared helper

handleSubmitApplication now calls submitProviderApplication() for
identical row shape with the upcoming /provider/signup web finish flow.
Behaviour is unchanged."
```

---

## Phase C — Recovery outcome extension

### Task 5: Extend `recordProviderOnboardingRecoveryOutcome`

**Files:**
- Modify: `lib/provider-onboarding-recovery.ts` (function `recordProviderOnboardingRecoveryOutcome`)
- Test: `__tests__/lib/provider-onboarding-recovery-outcome.test.ts` (extend if exists, else create)

- [ ] **Step 1: Read existing signature**

```bash
grep -n "export.*function recordProviderOnboardingRecoveryOutcome\|recordProviderOnboardingRecoveryOutcome(" lib/provider-onboarding-recovery.ts | head -10
```
Capture the current parameter shape. The extension is purely additive.

- [ ] **Step 2: Write failing test for actor + channel + tokenId fields**

Create or extend `__tests__/lib/provider-onboarding-recovery-outcome.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { recordProviderOnboardingRecoveryOutcome } from '@/lib/provider-onboarding-recovery'

beforeEach(async () => {
  await db.auditLog.deleteMany()
})

describe('recordProviderOnboardingRecoveryOutcome (extended)', () => {
  it('writes AuditLog entry with actorAdminUserId, channel, and tokenId in `after`', async () => {
    await recordProviderOnboardingRecoveryOutcome(db, {
      safeUserRef: 'sha256:abc',
      phone: '+27000000001',
      stage: 'evidence_upload',
      messageTemplateKey: 'provider_onboarding_recovery:evidence_upload',
      status: 'sent',
      actorAdminUserId: 'admin-1',
      channel: 'freeform',
      tokenId: 'tok_xyz',
    })
    const log = await db.auditLog.findFirst({ orderBy: { timestamp: 'desc' } })
    expect(log).not.toBeNull()
    const after = log!.after as Record<string, unknown>
    expect(after.actorAdminUserId).toBe('admin-1')
    expect(after.channel).toBe('freeform')
    expect(after.tokenId).toBe('tok_xyz')
  })

  it('keeps working with no actor/channel/tokenId (cron path)', async () => {
    await expect(
      recordProviderOnboardingRecoveryOutcome(db, {
        safeUserRef: 'sha256:abc', phone: '+27000000002', stage: 'evidence_upload',
        messageTemplateKey: 'provider_onboarding_recovery:evidence_upload', status: 'sent',
      }),
    ).resolves.toBeDefined()
  })
})
```

- [ ] **Step 3: Run the test to confirm failure**

```bash
pnpm vitest run __tests__/lib/provider-onboarding-recovery-outcome.test.ts
```
Expected: failure on `expect(after.actorAdminUserId).toBe('admin-1')` (or on type mismatch).

- [ ] **Step 4: Extend the function signature in `lib/provider-onboarding-recovery.ts`**

Locate the existing `export async function recordProviderOnboardingRecoveryOutcome(...)`. Extend the args type:

```ts
export interface RecordRecoveryOutcomeArgs {
  safeUserRef: string
  phone: string
  stage: string
  messageTemplateKey: string
  status: 'sent' | 'skipped' | 'failed'
  reason?: string
  actorAdminUserId?: string
  channel?: 'freeform' | 'template'
  tokenId?: string
}
```

In the function body, when constructing the `after` object passed to `auditLog.create`, include the new fields when defined:

```ts
const after: Record<string, unknown> = {
  stage: args.stage,
  templateKey: args.messageTemplateKey,
  status: args.status,
}
if (args.reason) after.reason = args.reason
if (args.actorAdminUserId) after.actorAdminUserId = args.actorAdminUserId
if (args.channel) after.channel = args.channel
if (args.tokenId) after.tokenId = args.tokenId
```

Set `actorRole`:
- If `actorAdminUserId` is present → `'admin'`
- Else → `'system'` (current cron behaviour preserved)

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/provider-onboarding-recovery-outcome.test.ts
pnpm vitest run __tests__/lib/provider-onboarding-recovery
```
Expected: new tests pass; existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add lib/provider-onboarding-recovery.ts __tests__/lib/provider-onboarding-recovery-outcome.test.ts
git commit -m "feat(recovery): extend outcome recorder with actor/channel/tokenId

Optional fields preserve current cron behaviour while letting the new
manual admin nudge button stamp who clicked, which channel was used,
and which ProviderResumeToken was issued."
```

---

## Phase D — Admin nudge button

### Task 6: Register the three feature flags

**Files:**
- Modify: `lib/feature-flags-registry.ts`
- Modify: `scripts/seed-flags.ts`

- [ ] **Step 1: Add the flags to the registry**

In `lib/feature-flags-registry.ts`, inside `FEATURE_FLAGS_REGISTRY`, add:

```ts
'admin.applications.recovery_nudge_button': {
  description: 'Enable the per-row "Send recovery nudge" button on the /admin/applications recovery queue.',
  owner: 'ops',
  defaultValue: false,
},
'whatsapp.registration.web_resume': {
  description: 'Enable the /provider/signup?t=… anonymous web finish page that resumes from a ProviderResumeToken.',
  owner: 'prod',
  defaultValue: false,
},
'whatsapp.registration.template_nudge_out_of_window': {
  description: 'Allow the recovery nudge button to send the provider_registration_continue template (with URL button parameter) for candidates outside the 24h freeform window.',
  owner: 'ops',
  defaultValue: false,
},
```

- [ ] **Step 2: Add to seed script**

In `scripts/seed-flags.ts`, append each new key to whichever list defines the default-`false` seeds. Confirm by running:

```bash
grep -n "admin.applications.recovery_nudge_button\|whatsapp.registration.web_resume\|whatsapp.registration.template_nudge_out_of_window" scripts/seed-flags.ts
```
Expected: 3 hits.

- [ ] **Step 3: Run typecheck**

```bash
pnpm tsc --noEmit
```
Expected: no errors. The `FeatureFlagKey` union now includes the new keys.

- [ ] **Step 4: Commit**

```bash
git add lib/feature-flags-registry.ts scripts/seed-flags.ts
git commit -m "chore(flags): add 3 flags for whatsapp recovery nudge + web finish

All defaultValue: false. Will be enabled separately after Meta template
approval (template_nudge_out_of_window) and smoke validation."
```

---

### Task 7: `sendRecoveryNudgeAction` server action

**Files:**
- Create: `app/(admin)/admin/applications/recovery-actions.ts`
- Test: `__tests__/app/admin-applications-recovery-actions.test.ts`

- [ ] **Step 1: Write the failing action contract test**

Create `__tests__/app/admin-applications-recovery-actions.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db'

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ id: 'sb-user-1' })),
}))
vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn(async () => ({ ok: true })),
}))

import { sendRecoveryNudgeAction } from '@/app/(admin)/admin/applications/recovery-actions'
import { sendText } from '@/lib/whatsapp-interactive'
import { sendTemplate } from '@/lib/whatsapp'

beforeEach(async () => {
  await db.providerResumeToken.deleteMany()
  await db.conversation.deleteMany()
  await db.adminUser.deleteMany()
  await db.featureFlag.deleteMany()
  await db.featureFlag.create({ data: { key: 'admin.applications.recovery_nudge_button', enabled: true, enabledForUsers: [] } })
  await db.adminUser.create({ data: { userId: 'sb-user-1', email: 'a@b', role: 'ADMIN', active: true } })
  vi.clearAllMocks()
})

describe('sendRecoveryNudgeAction', () => {
  it('sends freeform via sendText when within 24h window', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000050', flow: 'registration', step: 'reg_collect_rates',
        data: { name: 'Test User', skills: ['plumbing'] }, expiresAt: new Date(Date.now() + 1800_000),
        updatedAt: new Date(Date.now() - 60 * 60 * 1000) },
    })
    const result = await sendRecoveryNudgeAction({ rowId: `conversation:${conv.id}` })
    expect(result.ok).toBe(true)
    expect(sendText).toHaveBeenCalledOnce()
    expect(sendTemplate).not.toHaveBeenCalled()
    const arg = (sendText as any).mock.calls[0][1] as string
    expect(arg).toContain('/provider/signup?t=')
  })

  it('sends template via sendTemplate when >24h stale and flag is enabled', async () => {
    await db.featureFlag.create({ data: { key: 'whatsapp.registration.template_nudge_out_of_window', enabled: true, enabledForUsers: [] } })
    const conv = await db.conversation.create({
      data: { phone: '+27000000051', flow: 'registration', step: 'reg_collect_city',
        data: { name: 'Old User', skills: ['electrical'] }, expiresAt: new Date(Date.now() + 1800_000),
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    })
    const result = await sendRecoveryNudgeAction({ rowId: `conversation:${conv.id}` })
    expect(result.ok).toBe(true)
    expect(sendTemplate).toHaveBeenCalledOnce()
    expect(sendText).not.toHaveBeenCalled()
  })

  it('rejects when >24h stale and template flag is disabled', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000052', flow: 'registration', step: 'reg_collect_city',
        data: { name: 'Out' }, expiresAt: new Date(Date.now() + 1800_000),
        updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    })
    await expect(sendRecoveryNudgeAction({ rowId: `conversation:${conv.id}` })).rejects.toThrow(/out_of_window/i)
  })

  it('issues a ProviderResumeToken on success', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000053', flow: 'registration', step: 'reg_collect_rates',
        data: { name: 'TokenUser' }, expiresAt: new Date(Date.now() + 1800_000),
        updatedAt: new Date(Date.now() - 60_000) },
    })
    await sendRecoveryNudgeAction({ rowId: `conversation:${conv.id}` })
    const tokens = await db.providerResumeToken.findMany({ where: { conversationId: conv.id } })
    expect(tokens).toHaveLength(1)
    expect(tokens[0].source).toBe('recovery_nudge')
  })
})
```

- [ ] **Step 2: Run to confirm failure**

```bash
pnpm vitest run __tests__/app/admin-applications-recovery-actions.test.ts
```
Expected: failure on import (module does not exist).

- [ ] **Step 3: Implement the action**

Create `app/(admin)/admin/applications/recovery-actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { crudAction } from '@/lib/crud-action'
import { isEnabled } from '@/lib/flags'
import { issueProviderResumeToken } from '@/lib/provider-resume-tokens'
import { recordProviderOnboardingRecoveryOutcome } from '@/lib/provider-onboarding-recovery'
import { sendText } from '@/lib/whatsapp-interactive'
import { sendTemplate } from '@/lib/whatsapp'
import { hashPhoneForRef } from '@/lib/safe-refs' // existing util; if not present, use `crypto.createHash('sha256').update(phone).digest('hex').slice(0, 16)` inline

const WINDOW_MS = 24 * 60 * 60 * 1000

const Input = z.object({ rowId: z.string().min(1) })

function isWithinFreeformWindow(lastInteractionAt: Date | null | undefined): boolean {
  if (!lastInteractionAt) return false
  return Date.now() - lastInteractionAt.getTime() < WINDOW_MS
}

function buildFreeformBody(args: { firstName: string; url: string }): string {
  return [
    `Hi ${args.firstName} 👋 — we noticed you started signing up as a service provider on WhatsApp but didn't finish.`,
    ``,
    `Pick up right where you left off:`,
    `• Reply YES here to continue on WhatsApp, or`,
    `• Tap this link to finish in your browser:`,
    `  ${args.url}`,
    ``,
    `The link expires in 7 days.`,
  ].join('\n')
}

export async function sendRecoveryNudgeAction(input: z.infer<typeof Input>) {
  return crudAction({
    input,
    schema: Input,
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: 'admin.applications.recovery_nudge_button',
    entityType: 'ProviderResumeToken',
    action: 'recovery_nudge.send',
    run: async (validInput, tx) => {
      const [source, id] = validInput.rowId.split(':', 2)
      if (source !== 'conversation') throw new Error('unsupported_row_source')

      const conv = await tx.conversation.findUnique({ where: { id } })
      if (!conv) throw new Error('row_not_found')
      if (conv.flow !== 'registration') throw new Error('row_not_in_registration_flow')

      const firstName = (((conv.data as any)?.name as string) ?? 'there').split(/\s+/)[0]
      const baseUrl = (process.env.APP_URL ?? 'https://plugapro.co.za').replace(/\/$/, '')

      const adminUser = await tx.adminUser.findUniqueOrThrow({ where: { userId: (await import('@/lib/auth')).getSession().then((s) => s!.id) as any } })

      const { rawToken, tokenId } = await issueProviderResumeToken(tx, {
        conversationId: conv.id,
        phone: conv.phone,
        issuedByAdminUserId: adminUser.id,
        source: 'recovery_nudge',
      })
      const url = `${baseUrl}/provider/signup?t=${rawToken}`

      let channel: 'freeform' | 'template'
      if (isWithinFreeformWindow(conv.updatedAt)) {
        channel = 'freeform'
        await sendText(conv.phone, buildFreeformBody({ firstName, url }))
      } else {
        const templateAllowed = await isEnabled('whatsapp.registration.template_nudge_out_of_window')
        if (!templateAllowed) throw new Error('out_of_window_template_disabled')
        channel = 'template'
        await sendTemplate(conv.phone, 'provider_registration_continue', {
          body: [firstName],
          urlButton: rawToken,
        })
      }

      await recordProviderOnboardingRecoveryOutcome(tx, {
        safeUserRef: hashPhoneForRef(conv.phone),
        phone: conv.phone,
        stage: conv.step,
        messageTemplateKey: channel === 'freeform' ? 'recovery_nudge:freeform' : 'recovery_nudge:template',
        status: 'sent',
        actorAdminUserId: adminUser.id,
        channel,
        tokenId,
      })

      revalidatePath('/admin/applications')
      return { ok: true as const, tokenId, channel }
    },
  }).then((r) => r.data)
}
```

> **Note on `hashPhoneForRef`:** if that helper does not exist, replace with inline `import { createHash } from 'node:crypto'` and `createHash('sha256').update(conv.phone).digest('hex').slice(0, 16)`.

> **Note on `sendTemplate`:** the actual signature in `lib/whatsapp.ts` may differ. Read it before this task — match its parameter shape exactly. If it does not yet accept a `urlButton` parameter for the `provider_registration_continue` template, that lift is part of Task 16.

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/app/admin-applications-recovery-actions.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/applications/recovery-actions.ts __tests__/app/admin-applications-recovery-actions.test.ts
git commit -m "feat(admin): sendRecoveryNudgeAction with token issuance + channel switch

crudAction-wrapped. Picks freeform (sendText) within 24h, template
(sendTemplate) when stale and template flag is enabled. Issues a
ProviderResumeToken and records the outcome with actor metadata."
```

---

### Task 8: Inline button + confirm dialog on the recovery queue table

**Files:**
- Create: `components/admin/applications/recovery-nudge-button.tsx`
- Modify: `app/(admin)/admin/applications/page.tsx:689-773` (the recovery queue block)

- [ ] **Step 1: Build the client button + dialog**

Create `components/admin/applications/recovery-nudge-button.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { sendRecoveryNudgeAction } from '@/app/(admin)/admin/applications/recovery-actions'

export interface RecoveryNudgeButtonProps {
  rowId: string
  candidatePhoneMasked: string
  candidateName: string
  channel: 'freeform' | 'template'
  followUpMessage: string
  disabled?: boolean
  disabledReason?: string
}

export function RecoveryNudgeButton(props: RecoveryNudgeButtonProps) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const buttonLabel = props.channel === 'template' ? 'Send template nudge' : 'Send recovery nudge'

  if (props.disabled) {
    return <Button variant="ghost" size="sm" disabled title={props.disabledReason}>{props.disabledReason ?? 'Disabled'}</Button>
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">{buttonLabel}</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send recovery nudge</DialogTitle>
          <DialogDescription>
            To <span className="font-mono">{props.candidatePhoneMasked}</span> ({props.candidateName}) via{' '}
            <span className="font-semibold">{props.channel}</span>.
          </DialogDescription>
        </DialogHeader>
        <pre className="whitespace-pre-wrap rounded bg-muted p-3 text-sm">{props.followUpMessage}</pre>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button
            disabled={pending}
            onClick={() => startTransition(async () => {
              try {
                await sendRecoveryNudgeAction({ rowId: props.rowId })
                toast.success('Recovery nudge sent.')
                setOpen(false)
              } catch (e) {
                const message = e instanceof Error ? e.message : 'Failed to send.'
                toast.error(message)
              }
            })}
          >Send</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Add the button to the table**

In `app/(admin)/admin/applications/page.tsx`, inside the recovery queue table block at lines 689–773, add a new `<TableHead>Action</TableHead>` cell to the header row, and inside each `<TableRow>` add a `<TableCell>` rendering:

```tsx
<RecoveryNudgeButton
  rowId={`conversation:${row.conversationId ?? row.id}`}
  candidatePhoneMasked={row.phoneMasked}
  candidateName={row.providerName ?? 'unknown'}
  channel={isWithinWindow(row.lastInteractionAt) ? 'freeform' : 'template'}
  followUpMessage={row.followUpMessage}
  disabled={row.followUpStatus !== 'due'}
  disabledReason={
    row.followUpStatus === 'already_sent_for_stage' ? `Sent ${row.lastOutcomeAt?.toISOString().slice(0, 16) ?? ''}` :
    row.followUpStatus === 'max_followups_24h_reached' ? 'Rate-limited (24h)' :
    row.followUpStatus === 'submitted_excluded' ? 'Already submitted' : 'Not eligible'
  }
/>
```

Define `isWithinWindow` inline near the top of the file:

```ts
const WINDOW_MS = 24 * 60 * 60 * 1000
function isWithinWindow(lastInteractionAt: Date | null | undefined): boolean {
  if (!lastInteractionAt) return false
  return Date.now() - lastInteractionAt.getTime() < WINDOW_MS
}
```

Gate the entire button column behind `await isEnabled('admin.applications.recovery_nudge_button', { userId: session.id })` so when the flag is off, the column is hidden.

> **Note on `conversationId`:** the recovery row may not expose this directly. If absent, extend `lib/provider-onboarding-recovery.ts` `ProviderOnboardingRecoveryRow` type with `conversationId: string | null` and populate it in `listProviderOnboardingRecoveryRows` (it's already available — the function joins on Conversation at lines 609–622 per the earlier exploration).

- [ ] **Step 3: Run lint + typecheck + smoke**

```bash
pnpm lint
pnpm tsc --noEmit
pnpm test
```
Expected: clean.

- [ ] **Step 4: Manual local check**

Start the dev server, log in as an admin user, visit `/admin/applications`. With the flag off (default), no button column. After running `pnpm tsx scripts/seed-flags.ts` and toggling the flag in the DB, the button appears per row.

```bash
pnpm dev
```

- [ ] **Step 5: Commit**

```bash
git add components/admin/applications/recovery-nudge-button.tsx app/\(admin\)/admin/applications/page.tsx lib/provider-onboarding-recovery.ts
git commit -m "feat(admin): inline 'Send recovery nudge' button on /admin/applications

Per-row dialog showing message preview, channel (freeform vs template),
and confirm/cancel. Hidden until admin.applications.recovery_nudge_button
flag is enabled."
```

---

## Phase E — Web finish page

### Task 9: `/provider/signup` route with token validation

**Files:**
- Create: `app/(provider)/provider/signup/page.tsx`
- Create: `app/(provider)/provider/signup/error.tsx`
- Create: `app/(provider)/provider/signup/confirmation/page.tsx`

- [ ] **Step 1: Implement the entry page**

Create `app/(provider)/provider/signup/page.tsx`:

```tsx
import { redirect } from 'next/navigation'
import { Metadata } from 'next'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken } from '@/lib/provider-resume-tokens'
import { CapturedPanel } from './captured-panel'
import { RemainingFieldsForm } from './remaining-fields-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finish your signup', robots: { index: false, follow: false } }

export default async function ProviderSignupPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    return <main className="mx-auto max-w-md p-6"><h1 className="text-xl font-semibold">Not available</h1><p>This feature is not currently enabled.</p></main>
  }

  const rawToken = (await searchParams).t
  if (!rawToken) {
    return <ErrorPanel reason="missing_token" />
  }

  const validated = await validateProviderResumeToken(db, rawToken)
  if (!validated.ok) {
    return <ErrorPanel reason={validated.reason} />
  }

  const conv = await db.conversation.findUnique({ where: { id: validated.conversationId } })
  if (!conv) return <ErrorPanel reason="not_found" />

  const capturedData = (conv.data as Record<string, unknown>) ?? {}

  return (
    <main className="mx-auto max-w-md p-4 sm:p-6">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Finish your provider signup</h1>
        <p className="text-sm text-muted-foreground">We picked up where you left off on WhatsApp.</p>
      </header>
      <CapturedPanel data={capturedData} />
      <RemainingFieldsForm
        tokenId={validated.tokenId}
        rawToken={rawToken}
        conversationId={conv.id}
        phone={conv.phone}
        capturedData={capturedData}
      />
    </main>
  )
}

function ErrorPanel({ reason }: { reason: string }) {
  const message =
    reason === 'expired' ? 'This link has expired. Please reply on WhatsApp to get a new one.' :
    reason === 'used' ? 'This link has already been used.' :
    reason === 'revoked' ? 'This link has been revoked. Please reply on WhatsApp.' :
    reason === 'missing_token' ? 'No resume token provided.' :
    'We could not find this signup link. Please reply on WhatsApp.'
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Resume link unavailable</h1>
      <p className="mt-2 text-sm text-muted-foreground">{message}</p>
    </main>
  )
}
```

- [ ] **Step 2: Add error boundary**

Create `app/(provider)/provider/signup/error.tsx`:

```tsx
'use client'

export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-sm text-muted-foreground">Please reply on WhatsApp to try again.</p>
      <button className="mt-4 underline" onClick={reset}>Retry</button>
    </main>
  )
}
```

- [ ] **Step 3: Add confirmation page**

Create `app/(provider)/provider/signup/confirmation/page.tsx`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Application submitted', robots: { index: false, follow: false } }

export default function Confirmation() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-2xl font-semibold">Application submitted ✅</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We'll WhatsApp you within 30 minutes once an admin reviews it.
      </p>
    </main>
  )
}
```

- [ ] **Step 4: Local smoke**

```bash
pnpm dev
```
Visit `http://localhost:3000/provider/signup` — expect the "Not available" message (flag off). Toggle the `whatsapp.registration.web_resume` flag in the DB; visit `/provider/signup?t=invalid` — expect "Resume link unavailable".

- [ ] **Step 5: Commit**

```bash
git add app/\(provider\)/provider/signup/
git commit -m "feat(provider): anonymous /provider/signup web finish page (token-gated)

Token validation via lib/provider-resume-tokens. Shows captured data
panel + remaining-fields form (next commit). Off behind whatsapp.
registration.web_resume flag. noindex/nofollow."
```

---

### Task 10: Section registry — `lib/web-signup-sections.ts`

**Files:**
- Create: `lib/web-signup-sections.ts`
- Test: `__tests__/lib/web-signup-sections.test.ts`

- [ ] **Step 1: Write failing tests for the section selector**

Create `__tests__/lib/web-signup-sections.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectMissingSections } from '@/lib/web-signup-sections'

describe('selectMissingSections', () => {
  it('returns all sections when data is empty', () => {
    const r = selectMissingSections({})
    expect(r.map((s) => s.key)).toEqual([
      'identity', 'skills', 'service_areas', 'availability', 'rates', 'profile_photo', 'bio', 'references', 'evidence',
    ])
  })

  it('omits sections whose fields are all captured', () => {
    const r = selectMissingSections({ name: 'X', idNumber: '8001015009087', skills: ['plumbing'] })
    expect(r.map((s) => s.key)).not.toContain('identity')
    expect(r.map((s) => s.key)).not.toContain('skills')
  })

  it('keeps a section when at least one of its fields is missing', () => {
    const r = selectMissingSections({ name: 'X' })
    expect(r.map((s) => s.key)).toContain('identity')
  })
})
```

- [ ] **Step 2: Confirm failure**

```bash
pnpm vitest run __tests__/lib/web-signup-sections.test.ts
```
Expected: module-not-found.

- [ ] **Step 3: Implement the registry**

Create `lib/web-signup-sections.ts`:

```ts
import { z } from 'zod'

export const SECTION_KEYS = [
  'identity', 'skills', 'service_areas', 'availability', 'rates', 'profile_photo', 'bio', 'references', 'evidence',
] as const
export type SectionKey = typeof SECTION_KEYS[number]

export interface SectionDef {
  key: SectionKey
  /** Conversation.data keys this section owns. */
  fields: readonly string[]
  /** Zod schema fragment (object shape) for this section's inputs. */
  schema: z.ZodRawShape
}

export const SECTION_REGISTRY: readonly SectionDef[] = [
  { key: 'identity',      fields: ['name', 'idNumber'],
    schema: { name: z.string().min(2), idNumber: z.string().regex(/^\d{13}$/, '13-digit SA ID required') } },
  { key: 'skills',        fields: ['skills'],
    schema: { skills: z.array(z.string()).min(1, 'Pick at least one skill') } },
  { key: 'service_areas', fields: ['regionLabel', 'cityLabel'],
    schema: { regionLabel: z.string().min(1), cityLabel: z.string().min(1) } },
  { key: 'availability',  fields: ['availability'],
    schema: { availability: z.array(z.enum(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])).min(1) } },
  { key: 'rates',         fields: ['hourlyRate'],
    schema: { hourlyRate: z.coerce.number().int().min(50).max(5000) } },
  { key: 'profile_photo', fields: ['profilePhotoUrl'],
    schema: { profilePhotoUrl: z.string().url() } },
  { key: 'bio',           fields: ['bio'],
    schema: { bio: z.string().min(20).max(500) } },
  { key: 'references',    fields: ['references'],
    schema: { references: z.string().min(10).max(500) } },
  { key: 'evidence',      fields: ['evidenceFileUrls'],
    schema: { evidenceFileUrls: z.array(z.string().url()).optional() } },
]

function isFieldCaptured(data: Record<string, unknown>, field: string): boolean {
  const v = data[field]
  if (v === undefined || v === null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (Array.isArray(v)) return v.length > 0
  return true
}

export function selectMissingSections(data: Record<string, unknown>): readonly SectionDef[] {
  return SECTION_REGISTRY.filter((s) => s.fields.some((f) => !isFieldCaptured(data, f)))
}

export function buildDynamicSchema(sections: readonly SectionDef[]): z.ZodObject<z.ZodRawShape> {
  const shape: z.ZodRawShape = {}
  for (const s of sections) for (const k of Object.keys(s.schema)) shape[k] = s.schema[k]
  return z.object(shape)
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/lib/web-signup-sections.test.ts
```
Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/web-signup-sections.ts __tests__/lib/web-signup-sections.test.ts
git commit -m "feat(provider): web signup section registry + adaptive schema

Registry maps each registration step to its data keys + Zod schema.
selectMissingSections() returns only the sections containing missing
fields; buildDynamicSchema() composes a single Zod object from them."
```

---

### Task 11: `CapturedPanel` component

**Files:**
- Create: `app/(provider)/provider/signup/captured-panel.tsx`

- [ ] **Step 1: Implement**

```tsx
'use client'

import { useState } from 'react'

export function CapturedPanel({ data }: { data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false)
  const captured = summarise(data)
  if (captured.length === 0) return null

  return (
    <section className="mb-4 rounded border bg-muted/30 p-3 text-sm">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between font-medium">
        <span>Already captured ({captured.length} field{captured.length === 1 ? '' : 's'})</span>
        <span aria-hidden>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
          {captured.map(({ label, value }) => (
            <div key={label} className="contents">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}

function summarise(data: Record<string, unknown>): Array<{ label: string; value: string }> {
  const out: Array<{ label: string; value: string }> = []
  if (typeof data.name === 'string' && data.name.trim()) out.push({ label: 'Name', value: data.name })
  if (typeof data.idNumber === 'string' && data.idNumber.trim()) {
    out.push({ label: 'ID', value: `••• ${data.idNumber.slice(-4)}` })
  }
  if (Array.isArray(data.skills) && data.skills.length) out.push({ label: 'Skills', value: (data.skills as string[]).join(', ') })
  if (typeof data.regionLabel === 'string') out.push({ label: 'Region', value: data.regionLabel })
  if (typeof data.cityLabel === 'string') out.push({ label: 'City', value: data.cityLabel })
  if (Array.isArray(data.availability) && data.availability.length) out.push({ label: 'Availability', value: (data.availability as string[]).join(', ') })
  if (typeof data.hourlyRate === 'number') out.push({ label: 'Rate', value: `R${data.hourlyRate}/hr` })
  if (typeof data.profilePhotoUrl === 'string') out.push({ label: 'Photo', value: '✓ uploaded' })
  if (typeof data.bio === 'string' && data.bio.trim()) out.push({ label: 'Bio', value: `${data.bio.slice(0, 40)}…` })
  if (Array.isArray(data.evidenceFileUrls) && data.evidenceFileUrls.length) out.push({ label: 'Evidence', value: `${(data.evidenceFileUrls as string[]).length} file(s)` })
  return out
}
```

- [ ] **Step 2: Commit**

```bash
git add app/\(provider\)/provider/signup/captured-panel.tsx
git commit -m "feat(provider/signup): collapsed captured-fields panel"
```

---

### Task 12: Form sections + dynamic Zod composition

**Files:**
- Create: `app/(provider)/provider/signup/remaining-fields-form.tsx`
- Create: 9 section components under `app/(provider)/provider/signup/sections/`

- [ ] **Step 1: Implement the form host**

Create `app/(provider)/provider/signup/remaining-fields-form.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useForm, FormProvider, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { selectMissingSections, buildDynamicSchema, SECTION_REGISTRY } from '@/lib/web-signup-sections'
import { submitProviderApplicationFromWebAction } from './actions'
import { IdentitySection } from './sections/identity'
import { SkillsSection } from './sections/skills'
import { ServiceAreasSection } from './sections/service-areas'
import { AvailabilitySection } from './sections/availability'
import { RatesSection } from './sections/rates'
import { ProfilePhotoSection } from './sections/profile-photo'
import { BioSection } from './sections/bio'
import { ReferencesSection } from './sections/references'
import { EvidenceSection } from './sections/evidence'

const COMPONENTS = {
  identity: IdentitySection,
  skills: SkillsSection,
  service_areas: ServiceAreasSection,
  availability: AvailabilitySection,
  rates: RatesSection,
  profile_photo: ProfilePhotoSection,
  bio: BioSection,
  references: ReferencesSection,
  evidence: EvidenceSection,
} as const

export interface RemainingFieldsFormProps {
  tokenId: string
  rawToken: string
  conversationId: string
  phone: string
  capturedData: Record<string, unknown>
}

export function RemainingFieldsForm(props: RemainingFieldsFormProps) {
  const sections = selectMissingSections(props.capturedData)
  const schema = buildDynamicSchema(sections)
  const methods = useForm({ resolver: zodResolver(schema), mode: 'onBlur' })
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const onSubmit: SubmitHandler<any> = (values) => startTransition(async () => {
    try {
      await submitProviderApplicationFromWebAction({ rawToken: props.rawToken, payload: values })
      router.push('/provider/signup/confirmation')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not submit. Try again.')
    }
  })

  if (sections.length === 0) {
    return (
      <div className="rounded border p-4 text-sm">
        <p>Everything is captured. Tap below to submit.</p>
        <form onSubmit={methods.handleSubmit(onSubmit)} className="mt-3">
          <Button type="submit" disabled={pending} className="w-full">Submit application</Button>
        </form>
      </div>
    )
  }

  return (
    <FormProvider {...methods}>
      <form onSubmit={methods.handleSubmit(onSubmit)} className="space-y-6">
        {sections.map((s) => {
          const Component = COMPONENTS[s.key]
          return <Component key={s.key} />
        })}
        <Button type="submit" disabled={pending} className="w-full">{pending ? 'Submitting…' : 'Submit application'}</Button>
        <p className="text-center text-xs text-muted-foreground">Your progress is saved if you leave this page.</p>
      </form>
    </FormProvider>
  )
}
```

- [ ] **Step 2: Implement each section component**

Each section is a small RHF-aware component that renders its inputs and surfaces validation errors. Example for `identity`:

Create `app/(provider)/provider/signup/sections/identity.tsx`:

```tsx
'use client'

import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function IdentitySection() {
  const { register, formState: { errors } } = useFormContext<{ name?: string; idNumber?: string }>()
  return (
    <fieldset className="space-y-3">
      <legend className="text-base font-semibold">Identity</legend>
      <div>
        <Label htmlFor="name">Full name</Label>
        <Input id="name" {...register('name')} autoComplete="name" />
        {errors.name && <p className="mt-1 text-xs text-destructive">{String(errors.name.message)}</p>}
      </div>
      <div>
        <Label htmlFor="idNumber">SA ID number</Label>
        <Input id="idNumber" {...register('idNumber')} inputMode="numeric" autoComplete="off" />
        {errors.idNumber && <p className="mt-1 text-xs text-destructive">{String(errors.idNumber.message)}</p>}
      </div>
    </fieldset>
  )
}
```

Create the remaining 8 section components following the same pattern. Each one reads only its own fields (per `SECTION_REGISTRY[key].fields`) via `useFormContext`. For `ServiceAreasSection`, the region/city selects use `select` primitives sourced from a server prop carrying `LocationNode` options (Task 13 fetches them). For `AvailabilitySection`, a row of seven `Checkbox` primitives. For `SkillsSection`, a multi-select pattern matching the existing technicians admin UI.

> **Implementation note:** Don't invent fancy widgets. The simplest correct form is the goal. Optimise UX in a later PR if conversion data warrants it.

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm lint
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add app/\(provider\)/provider/signup/remaining-fields-form.tsx app/\(provider\)/provider/signup/sections/
git commit -m "feat(provider/signup): adaptive RHF form + 9 section components"
```

---

### Task 13: File upload integration (profile photo + evidence)

**Files:**
- Modify: `app/(provider)/provider/signup/sections/profile-photo.tsx`
- Modify: `app/(provider)/provider/signup/sections/evidence.tsx`
- Create (if needed): a small server action `app/(provider)/provider/signup/upload-actions.ts` that issues Vercel Blob upload tokens

- [ ] **Step 1: Read existing Blob upload pattern**

```bash
grep -rn "@vercel/blob\|generateUploadToken\|put(" lib/storage.ts app/api 2>/dev/null | head -20
```
Identify the existing upload-token pattern. Reuse it; don't reimplement.

- [ ] **Step 2: Wire profile photo upload**

In `profile-photo.tsx`, render `<input type="file" accept="image/*" />`, on change call the existing upload helper to get a URL, then `setValue('profilePhotoUrl', url)`. Show a `Skeleton` while uploading and the uploaded image thumb after.

- [ ] **Step 3: Wire evidence upload (multi-file, with Skip)**

In `evidence.tsx`, allow multiple files plus a "Skip evidence for now" button that explicitly sets `setValue('evidenceFileUrls', [])` and clears validation. Match the WhatsApp workstream C semantics.

- [ ] **Step 4: Smoke locally**

```bash
pnpm dev
```
Visit `/provider/signup?t=…` with a valid local token (issue one manually via a one-off `tsx` script). Upload a photo + evidence. Submit fails (submit handler not yet wired) — that's expected at this task. Confirm the URLs end up in the form state via DevTools.

- [ ] **Step 5: Commit**

```bash
git add app/\(provider\)/provider/signup/sections/profile-photo.tsx app/\(provider\)/provider/signup/sections/evidence.tsx app/\(provider\)/provider/signup/upload-actions.ts
git commit -m "feat(provider/signup): photo + evidence upload via Vercel Blob"
```

---

### Task 14: `submitProviderApplicationFromWebAction` + `updateCapturedFieldAction`

**Files:**
- Create: `app/(provider)/provider/signup/actions.ts`

- [ ] **Step 1: Write failing integration test**

Add to `__tests__/app/admin-applications-recovery-actions.test.ts` (or in a new `__tests__/app/provider-signup-actions.test.ts`):

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import { issueProviderResumeToken } from '@/lib/provider-resume-tokens'
import { submitProviderApplicationFromWebAction } from '@/app/(provider)/provider/signup/actions'

beforeEach(async () => {
  await db.providerApplication.deleteMany()
  await db.providerResumeToken.deleteMany()
  await db.conversation.deleteMany()
  await db.adminUser.deleteMany()
  await db.featureFlag.deleteMany()
  await db.featureFlag.create({ data: { key: 'whatsapp.registration.web_resume', enabled: true, enabledForUsers: [] } })
})

describe('submitProviderApplicationFromWebAction', () => {
  it('creates a ProviderApplication, marks the token used, and rejects on re-use', async () => {
    const admin = await db.adminUser.create({ data: { userId: 'sb-1', email: 'a@b', role: 'ADMIN', active: true } })
    const conv = await db.conversation.create({
      data: { phone: '+27000000020', flow: 'registration', step: 'reg_collect_evidence',
        data: { name: 'Web User', idNumber: '8001015009087', skills: ['plumbing'], regionLabel: 'JHB North / Sandton',
          cityLabel: 'Sandton', availability: ['Mon','Tue','Wed','Thu','Fri'], hourlyRate: 350,
          profilePhotoUrl: 'https://blob/photo.jpg', bio: 'Plumber with 5 years experience including leaks.', references: 'Available on request', evidenceFileUrls: [] },
        expiresAt: new Date(Date.now() + 3600_000) },
    })
    const { rawToken } = await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const result = await submitProviderApplicationFromWebAction({ rawToken, payload: {} })
    expect(result.ok).toBe(true)
    const apps = await db.providerApplication.findMany({ where: { phone: conv.phone } })
    expect(apps).toHaveLength(1)
    expect(apps[0].status).toBe('PENDING')
    await expect(submitProviderApplicationFromWebAction({ rawToken, payload: {} })).rejects.toThrow(/used|expired/i)
  })
})
```

Run:
```bash
pnpm vitest run __tests__/app/provider-signup-actions.test.ts
```
Expected: failure on import.

- [ ] **Step 2: Implement**

Create `app/(provider)/provider/signup/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import {
  validateProviderResumeToken,
  consumeProviderResumeToken,
} from '@/lib/provider-resume-tokens'
import { submitProviderApplication, type SubmitInput } from '@/lib/provider-applications-submit'
import { buildDynamicSchema, selectMissingSections } from '@/lib/web-signup-sections'

const Input = z.object({
  rawToken: z.string().min(32),
  payload: z.record(z.unknown()),
})

export async function submitProviderApplicationFromWebAction(input: z.infer<typeof Input>) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    throw new Error('feature_disabled')
  }
  const { rawToken, payload } = Input.parse(input)

  return db.$transaction(async (tx) => {
    const v = await validateProviderResumeToken(tx, rawToken)
    if (!v.ok) throw new Error(`token_${v.reason}`)

    const conv = await tx.conversation.findUniqueOrThrow({ where: { id: v.conversationId } })
    const capturedData = (conv.data as Record<string, unknown>) ?? {}

    const sections = selectMissingSections(capturedData)
    const schema = buildDynamicSchema(sections)
    const parsed = schema.safeParse(payload)
    if (!parsed.success) throw new Error('validation: ' + parsed.error.issues.map((i) => i.message).join('; '))

    const merged: Record<string, unknown> = { ...capturedData, ...parsed.data }
    const input: SubmitInput = {
      phone: conv.phone,
      name: String(merged.name ?? ''),
      idNumber: String(merged.idNumber ?? ''),
      skills: (merged.skills as string[]) ?? [],
      serviceAreas: [String(merged.regionLabel ?? '')].filter(Boolean),
      availability: (merged.availability as string[]) ?? [],
      experience: String(merged.experience ?? ''),
      evidenceNote: String(merged.evidenceNote ?? ''),
      hourlyRate: typeof merged.hourlyRate === 'number' ? merged.hourlyRate : undefined,
      profilePhotoUrl: typeof merged.profilePhotoUrl === 'string' ? merged.profilePhotoUrl : undefined,
      bio: typeof merged.bio === 'string' ? merged.bio : undefined,
      references: typeof merged.references === 'string' ? merged.references : undefined,
      evidenceFileUrls: Array.isArray(merged.evidenceFileUrls) ? (merged.evidenceFileUrls as string[]) : [],
    }

    const consumed = await consumeProviderResumeToken(tx, v.tokenId)
    if (!consumed) throw new Error('token_used')

    const { application } = await submitProviderApplication(tx, input, { source: 'web', conversationId: conv.id })

    revalidatePath('/admin/applications')
    return { ok: true as const, applicationId: application.id }
  })
}

const UpdateCapturedSchema = z.object({
  rawToken: z.string().min(32),
  field: z.string().min(1),
  value: z.unknown(),
})

export async function updateCapturedFieldAction(input: z.infer<typeof UpdateCapturedSchema>) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) throw new Error('feature_disabled')
  const { rawToken, field, value } = UpdateCapturedSchema.parse(input)
  const v = await validateProviderResumeToken(db, rawToken)
  if (!v.ok) throw new Error(`token_${v.reason}`)
  await db.conversation.update({
    where: { id: v.conversationId },
    data: { data: { update: { [field]: value } } as any },
  })
  return { ok: true as const }
}
```

- [ ] **Step 3: Run tests to verify they pass**

```bash
pnpm vitest run __tests__/app/provider-signup-actions.test.ts
```
Expected: 1 test pass (the success-then-rejection case).

- [ ] **Step 4: Commit**

```bash
git add app/\(provider\)/provider/signup/actions.ts __tests__/app/provider-signup-actions.test.ts
git commit -m "feat(provider/signup): submit + captured-field-update server actions

Validates token, composes dynamic Zod schema from missing sections,
consumes the token atomically, then writes ProviderApplication via the
shared helper."
```

---

## Phase F — Template path for out-of-window candidates

### Task 16: Wire `sendTemplate` for `provider_registration_continue` with URL button

**Files:**
- Modify: `lib/whatsapp.ts` (extend `sendTemplate` if it doesn't already accept URL-button parameters)
- Modify: `app/(admin)/admin/applications/recovery-actions.ts` (already wired in Task 7 — verify call shape matches)

- [ ] **Step 1: Inspect current `sendTemplate` signature**

```bash
grep -n "export async function sendTemplate\|export function sendTemplate" lib/whatsapp.ts
sed -n '96,200p' lib/whatsapp.ts
```

If `sendTemplate(to, templateName, { body, urlButton })` is not yet supported, extend the function so its `components` builder includes a `button` component when `urlButton` is passed:

```ts
if (params.urlButton) {
  components.push({
    type: 'button',
    sub_type: 'url',
    index: '0',
    parameters: [{ type: 'text', text: params.urlButton }],
  })
}
```

- [ ] **Step 2: Confirm Meta template version**

Out of band, confirm `provider_registration_continue` has been re-approved with a dynamic URL button parameter. Until then, leave `whatsapp.registration.template_nudge_out_of_window` disabled in production. The button column already disables out-of-window rows when the flag is off (Task 8 step 2).

- [ ] **Step 3: Manual smoke (sandbox)**

Issue a token locally, set `updatedAt` on a test Conversation to >24h ago, enable both `admin.applications.recovery_nudge_button` and `whatsapp.registration.template_nudge_out_of_window` in the DB, click the button, confirm the Meta API call payload contains the URL button component (use the WhatsApp Cloud API sandbox phone-number).

- [ ] **Step 4: Commit**

```bash
git add lib/whatsapp.ts
git commit -m "feat(whatsapp): sendTemplate URL-button parameter for recovery template"
```

---

## Phase G — Smoke tests + deploy artifacts

### Task 17: Playwright smoke for admin recovery button

**Files:**
- Create: `e2e/admin-applications-recovery-nudge.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
import { test, expect } from '@playwright/test'

test('admin can send recovery nudge and sees confirmation', async ({ page }) => {
  test.skip(!process.env.E2E_ADMIN_COOKIE, 'requires E2E_ADMIN_COOKIE env')
  await page.context().addCookies([{ name: 'sb-access-token', value: process.env.E2E_ADMIN_COOKIE!, url: process.env.E2E_BASE_URL! }])
  await page.goto(`${process.env.E2E_BASE_URL}/admin/applications`)
  await expect(page.getByRole('heading', { name: /applications/i })).toBeVisible()
  const nudgeButton = page.getByRole('button', { name: /send.*nudge/i }).first()
  if (await nudgeButton.count() === 0) test.skip(true, 'no recovery candidates in current state')
  await nudgeButton.click()
  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText(/recovery nudge sent/i)).toBeVisible()
})
```

- [ ] **Step 2: Run**

```bash
E2E_BASE_URL=http://localhost:3000 E2E_ADMIN_COOKIE=... pnpm playwright test e2e/admin-applications-recovery-nudge.spec.ts
```

- [ ] **Step 3: Commit**

```bash
git add e2e/admin-applications-recovery-nudge.spec.ts
git commit -m "test(e2e): admin recovery nudge button smoke"
```

---

### Task 18: Playwright smoke for `/provider/signup`

**Files:**
- Create: `e2e/provider-web-signup.spec.ts`
- Modify: `e2e/smoke.spec.ts` — add `/provider/signup` (with a known-invalid token) to the public-route happy-path list so a regression fails CI.

- [ ] **Step 1: Spec**

```ts
import { test, expect } from '@playwright/test'

test('invalid token shows graceful error', async ({ page }) => {
  await page.goto(`${process.env.E2E_BASE_URL}/provider/signup?t=does-not-exist-1234567890ab`)
  await expect(page.getByText(/resume link unavailable/i)).toBeVisible()
})

test('valid token shows form and submits', async ({ page }) => {
  test.skip(!process.env.E2E_VALID_RESUME_TOKEN, 'requires E2E_VALID_RESUME_TOKEN seeded by setup')
  await page.goto(`${process.env.E2E_BASE_URL}/provider/signup?t=${process.env.E2E_VALID_RESUME_TOKEN}`)
  await expect(page.getByRole('heading', { name: /finish your provider signup/i })).toBeVisible()
  // Form fields depend on what's missing; assert the submit button is present and reachable.
  await expect(page.getByRole('button', { name: /submit application/i })).toBeVisible()
})
```

- [ ] **Step 2: Add `/provider/signup?t=invalid` to `e2e/smoke.spec.ts`** so it appears in CI's protected smoke list.

- [ ] **Step 3: Run + commit**

```bash
E2E_BASE_URL=http://localhost:3000 pnpm playwright test e2e/provider-web-signup.spec.ts e2e/smoke.spec.ts
git add e2e/provider-web-signup.spec.ts e2e/smoke.spec.ts
git commit -m "test(e2e): /provider/signup smoke + invalid-token graceful page"
```

---

### Task 19: Seed flags + CLAUDE.md route inventory

**Files:**
- Modify: `scripts/seed-flags.ts` (already done in Task 6)
- Modify: `CLAUDE.md` (root or `field-service/CLAUDE.md`? — append to `field-service/CLAUDE.md` if it owns the field-service route inventory; otherwise update both. Check first.)

- [ ] **Step 1: Run the flag seed locally to confirm idempotence**

```bash
pnpm tsx scripts/seed-flags.ts
```
Expected: 3 new rows present in `feature_flags` after first run; subsequent runs are no-ops.

- [ ] **Step 2: Update CLAUDE.md route inventory**

Append under the existing `/admin` and provider route listings:
```
- `/provider/signup` → `field-service/app/(provider)/provider/signup/page.tsx` (anonymous, token-gated)
- `/provider/signup/confirmation` → `field-service/app/(provider)/provider/signup/confirmation/page.tsx`
```

Also append to "What's already in place" → "Feature flags":
- `admin.applications.recovery_nudge_button`
- `whatsapp.registration.web_resume`
- `whatsapp.registration.template_nudge_out_of_window`

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: register /provider/signup routes + new recovery flags in CLAUDE.md"
```

---

## Rollout checklist (run after all PRs merge to main)

1. Apply the migration on production (`pnpm prisma migrate deploy`) — Prisma will run the additive `provider_resume_tokens` table only.
2. Seed flags on production (`pnpm tsx scripts/seed-flags.ts`).
3. Confirm Meta has approved `provider_registration_continue` v2 with the URL button parameter. If yes → flip `whatsapp.registration.template_nudge_out_of_window` to true.
4. Enable `admin.applications.recovery_nudge_button` for OWNER/ADMIN users via `enabledForUsers`.
5. Enable `whatsapp.registration.web_resume` globally.
6. Walk one real candidate through end-to-end: click button in `/admin/applications` → confirm the candidate's WhatsApp receives the message → tap the link → finish the form → confirm a `ProviderApplication` row appears with `status = PENDING`.
7. Watch the existing recovery cron at `/app/api/cron/provider-onboarding-recovery/route.ts` to make sure it does not also send a nudge to the same row inside the same 24h window (the `max_followups_24h_reached` guard should cover this; verify by inspecting `AuditLog`).
8. After a week of data: revisit the 6 candidates identified in the brainstorm (Victor Panavanhu, Tendai Malunga, Benjamin Skosana, Lodge Khoase, Andrew, Keith Leon van der Byl) — check how many resumed via WhatsApp reply vs. web link click. That ratio is the signal for whether to invest further in the web flow.

---

## Self-review notes

- **Spec coverage:** Sections 1–5 of the design are mapped (architecture → Tasks 1–19 collectively; data model → Task 1; token lifecycle → Tasks 1–2 + consumption in Task 14; admin button + dispatch → Tasks 6–8 + 16; web finish page → Tasks 9–14). Sections 6–10 (shared helper, flag plan, logging, error handling, testing) are covered by Tasks 3–4, 6, 5, error pages in Task 9 + token-rejection paths in Tasks 7/14, and Tasks 17–18 respectively.
- **Type consistency:** `submitProviderApplication(client, input, options)` shape is identical across Task 3 (definition), Task 4 (WhatsApp consumer), and Task 14 (web consumer). `issueProviderResumeToken` / `validateProviderResumeToken` / `consumeProviderResumeToken` shapes are stable across Tasks 2, 7, 9, 14.
- **No placeholders:** Each task has runnable test code + runnable implementation code + exact commit messages + exact run commands.
- **Known external dependency:** Meta template approval (Task 16 Step 2). Flagged in the plan; the button gracefully degrades to "disabled" for out-of-window rows until the flag is flipped.

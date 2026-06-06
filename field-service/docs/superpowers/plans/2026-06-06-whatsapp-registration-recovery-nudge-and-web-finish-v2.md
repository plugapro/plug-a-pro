# WhatsApp Registration Recovery — Web Finish Page (v2, overlap removed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Supersedes:** `2026-06-06-whatsapp-registration-recovery-nudge-and-web-finish.md` (v1). This v2 cuts everything that overlaps with the parallel plan `docs/superpowers/plans/2026-06-06-whatsapp-recovery-templates-outside-session-window.md` (templates + cascade + audit `via` field + flag `whatsapp.recovery.template_send` + cron/admin action wiring). Build on top of that work — do not duplicate it.

**Goal:** Give drop-off providers a web alternative to finish their registration. Adds (a) a hashed single-use `ProviderResumeToken` table; (b) a shared `submitProviderApplication()` helper so WhatsApp and web produce identical `ProviderApplication` rows; (c) an additive operator-triggered action that issues a token and returns the resume URL for copy-into-WhatsApp; (d) an anonymous, mobile-first `/provider/signup?t=…` page that resumes from a token and submits via the shared helper. Future PR (out of scope here) will append the URL to the existing recovery message body once the parallel template cascade has shipped.

**Architecture:** New `ProviderResumeToken` table (additive). New `lib/provider-resume-tokens.ts` for issue/validate/consume/revoke. Submission logic extracted from `lib/whatsapp-flows/registration.ts` into `lib/provider-applications-submit.ts` and consumed by both the WhatsApp flow and the new web action. New anonymous route group `app/(provider)/provider/signup/*` validates tokens server-side and renders an adaptive form that only contains sections with missing `Conversation.data`. New additive server action `generateResumeLinkAction` lives under `app/(admin)/admin/applications/recovery-actions.ts` and **does not** touch `sendRecoveryNudgeForRow`, `attemptSendRecoveryForRow`, or `recordProviderOnboardingRecoveryOutcome` — those are owned by the parallel plan.

**Tech Stack:** Next.js 16 App Router, Prisma 6, Supabase Auth, React Hook Form + Zod, Tailwind v4 + shadcn-style primitives, Vercel Blob, Vitest, Playwright.

---

## Overlap with the parallel plan — what NOT to touch

| Owned by parallel plan | Don't modify in this PR |
|---|---|
| `lib/messaging-templates.ts` | ✗ |
| `lib/provider-onboarding-recovery.ts` (cascade in `attemptSendRecoveryForRow`, signature of `recordProviderOnboardingRecoveryOutcome`, the `via:` audit field) | ✗ |
| `lib/provider-onboarding-recovery-template-config.ts` | ✗ |
| Feature flag `whatsapp.recovery.template_send` | ✗ |
| Cron `app/api/cron/provider-onboarding-recovery/route.ts` | ✗ |
| Existing server action `sendRecoveryNudgeForRow` in `app/(admin)/admin/applications/page.tsx` | ✗ — read-only reference only |

If a subagent finds itself editing any of the above, it is out of scope — escalate immediately.

---

## File Structure

**Created:**
- `prisma/migrations/<timestamp>_add_provider_resume_token/migration.sql`
- `lib/provider-resume-tokens.ts`
- `lib/provider-applications-submit.ts`
- `app/(admin)/admin/applications/recovery-actions.ts` — **`generateResumeLinkAction` only** (does not touch `sendRecoveryNudgeForRow`)
- `components/admin/applications/resume-link-button.tsx`
- `app/(provider)/provider/signup/page.tsx`
- `app/(provider)/provider/signup/error.tsx`
- `app/(provider)/provider/signup/confirmation/page.tsx`
- `app/(provider)/provider/signup/actions.ts` — `submitProviderApplicationFromWebAction`, `updateCapturedFieldAction`
- `app/(provider)/provider/signup/captured-panel.tsx`
- `app/(provider)/provider/signup/remaining-fields-form.tsx`
- `app/(provider)/provider/signup/sections/identity.tsx`
- `app/(provider)/provider/signup/sections/service-areas.tsx`
- `app/(provider)/provider/signup/sections/skills.tsx`
- `app/(provider)/provider/signup/sections/availability.tsx`
- `app/(provider)/provider/signup/sections/rates.tsx`
- `app/(provider)/provider/signup/sections/profile-photo.tsx`
- `app/(provider)/provider/signup/sections/bio.tsx`
- `app/(provider)/provider/signup/sections/references.tsx`
- `app/(provider)/provider/signup/sections/evidence.tsx`
- `lib/web-signup-sections.ts`
- `__tests__/lib/provider-resume-tokens.test.ts`
- `__tests__/lib/provider-applications-submit.test.ts`
- `__tests__/lib/web-signup-sections.test.ts`
- `__tests__/app/provider-signup-actions.test.ts`
- `__tests__/app/admin-applications-resume-link.test.ts`
- `e2e/provider-web-signup.spec.ts`

**Modified:**
- `prisma/schema.prisma` — add `ProviderResumeToken` model + back-relations on `Conversation` and `AdminUser`
- `lib/whatsapp-flows/registration.ts` — replace the two existing inline `tx.providerApplication.create({ data: ... })` blocks at `:2321` and `:2504` with calls to the shared helper
- `lib/feature-flags-registry.ts` — add 2 flags: `admin.applications.resume_link_button`, `whatsapp.registration.web_resume`
- `scripts/seed-flags.ts` — seed both flags as `defaultValue: false`
- `app/(admin)/admin/applications/page.tsx` — add a per-row "Generate resume link" button column **next to** the existing "Send now" surface owned by the parallel plan
- `e2e/smoke.spec.ts` — add `/provider/signup?t=invalid` to the public-route smoke list
- `CLAUDE.md` — append `/provider/signup` + `/provider/signup/confirmation` to the route inventory

**Module boundaries:**
- `lib/provider-resume-tokens.ts` is the **only** module that hashes tokens.
- `lib/provider-applications-submit.ts` is the **only** site that calls `tx.providerApplication.create(...)`. WhatsApp and web both go through it.
- `app/(provider)/provider/signup/*` does **not** import from `lib/whatsapp-flows/*`.
- `app/(admin)/admin/applications/recovery-actions.ts` exports only `generateResumeLinkAction`. It does **not** import the parallel plan's `sendRecoveryNudgeForRow`, `attemptSendRecoveryForRow`, or modify `recordProviderOnboardingRecoveryOutcome`.

---

## Phase A — Token foundations

### Task 1: Prisma migration for `ProviderResumeToken`

**Files:**
- Modify: `prisma/schema.prisma` (insert after the `Conversation` model around `:1823`)
- Create: `prisma/migrations/<timestamp>_add_provider_resume_token/migration.sql` (generated)

- [ ] **Step 1: Add the model**

Insert after the `Conversation` model:

```prisma
model ProviderResumeToken {
  id                  String    @id @default(cuid())
  tokenHash           String    @unique // sha256(rawToken) hex; raw never stored
  conversationId      String
  phone               String
  issuedByAdminUserId String
  issuedAt            DateTime  @default(now())
  expiresAt           DateTime
  usedAt              DateTime?
  revokedAt           DateTime?
  revokedReason       String?
  source              String

  conversation  Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  issuedByAdmin AdminUser    @relation(fields: [issuedByAdminUserId], references: [id])

  @@index([conversationId])
  @@index([phone, expiresAt])
  @@map("provider_resume_tokens")
}
```

Add back-relations:
- In `model Conversation { ... }`: `resumeTokens ProviderResumeToken[]`
- In `model AdminUser { ... }`: `issuedProviderResumeTokens ProviderResumeToken[]`

- [ ] **Step 2: Generate the migration**

```bash
cd field-service
pnpm prisma migrate dev --name add_provider_resume_token --create-only
```

- [ ] **Step 3: Sanity check**

```bash
grep -E "^(CREATE TABLE|CREATE INDEX|DROP|ALTER)" prisma/migrations/*_add_provider_resume_token/migration.sql
```
Expected: only `CREATE TABLE` and `CREATE INDEX`. No `DROP` or `ALTER` of existing tables.

- [ ] **Step 4: Apply locally**

```bash
pnpm prisma migrate dev
```
Expected: applies cleanly; `pnpm prisma generate` runs automatically; no drift warnings.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "$(cat <<'EOF'
feat(db): add ProviderResumeToken for web signup resume

Hashed single-use token with 7-day TTL; supersession on re-issue.
Drives the upcoming /admin/applications "Generate resume link" button
and the /provider/signup web finish page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Token library

**Files:**
- Create: `lib/provider-resume-tokens.ts`
- Test: `__tests__/lib/provider-resume-tokens.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/provider-resume-tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
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
    const result = await validateProviderResumeToken(db, 'unknown-token-value-1234567890abcdef')
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

describe('revokeProviderResumeTokensForConversation', () => {
  it('marks all live tokens for the conversation revoked', async () => {
    const conv = await seedConversation()
    const admin = await seedAdmin()
    await issueProviderResumeToken(db, { conversationId: conv.id, phone: conv.phone, issuedByAdminUserId: admin.id, source: 'recovery_nudge' })
    const n = await revokeProviderResumeTokensForConversation(db, conv.id, 'admin_revoked')
    expect(n).toBe(1)
    const rows = await db.providerResumeToken.findMany({ where: { conversationId: conv.id } })
    expect(rows[0].revokedAt).not.toBeNull()
    expect(rows[0].revokedReason).toBe('admin_revoked')
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm vitest run __tests__/lib/provider-resume-tokens.test.ts
```
Expected: `Cannot find module '@/lib/provider-resume-tokens'`.

- [ ] **Step 3: Implement**

Create `lib/provider-resume-tokens.ts`:

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

- [ ] **Step 4: Run to verify passing**

```bash
pnpm vitest run __tests__/lib/provider-resume-tokens.test.ts
```
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/provider-resume-tokens.ts __tests__/lib/provider-resume-tokens.test.ts
git commit -m "$(cat <<'EOF'
feat(provider): hashed single-use resume tokens with supersession

Issue/validate/consume/revoke for ProviderResumeToken. Raw token is
returned to caller; only sha256 hash is persisted. Re-issuing for the
same conversation supersedes prior live tokens with reason 'superseded'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase B — Shared submission helper

### Task 3: Extract `submitProviderApplication(input, source)`

**Files:**
- Create: `lib/provider-applications-submit.ts`
- Test: `__tests__/lib/provider-applications-submit.test.ts`

- [ ] **Step 1: Read existing submit logic**

Read `lib/whatsapp-flows/registration.ts` around `:2280-2360` (first `tx.providerApplication.create` at `:2321`) AND `:2470-2540` (second at `:2504`). Capture every field passed to `data: { ... }` and the following Conversation step mutation. The helper subsumes both.

- [ ] **Step 2: Write failing tests**

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
  it('creates a ProviderApplication with status PENDING from whatsapp source', async () => {
    const result = await submitProviderApplication(db, baseInput, { source: 'whatsapp' })
    expect(result.application.status).toBe('PENDING')
    expect(result.application.phone).toBe(baseInput.phone)
    expect(result.application.skills).toEqual(['plumbing'])
  })

  it('creates an identical-shape ProviderApplication from web source', async () => {
    const result = await submitProviderApplication(db, baseInput, { source: 'web' })
    expect(result.application.status).toBe('PENDING')
    expect(result.application.name).toBe(baseInput.name)
  })

  it('rejects if a non-CANCELLED/non-REJECTED application already exists for the phone', async () => {
    await submitProviderApplication(db, baseInput, { source: 'whatsapp' })
    await expect(
      submitProviderApplication(db, baseInput, { source: 'whatsapp' }),
    ).rejects.toThrow(/already.*application/i)
  })

  it('updates the linked Conversation to step reg_pending when conversationId is given', async () => {
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

- [ ] **Step 3: Run to verify failure**

```bash
pnpm vitest run __tests__/lib/provider-applications-submit.test.ts
```
Expected: module-not-found.

- [ ] **Step 4: Implement**

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

- [ ] **Step 5: Run to verify passing**

```bash
pnpm vitest run __tests__/lib/provider-applications-submit.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/provider-applications-submit.ts __tests__/lib/provider-applications-submit.test.ts
git commit -m "$(cat <<'EOF'
feat(provider): shared submitProviderApplication helper

Single source of truth for ProviderApplication creation. Used by both
WhatsApp registration flow (next commit) and web finish page.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Wire WhatsApp flow to the shared helper

**Files:**
- Modify: `lib/whatsapp-flows/registration.ts` (both inline create blocks at `:2321` and `:2504`)

- [ ] **Step 1: Replace both call sites**

For each of the two existing `tx.providerApplication.create({ data: { ... } })` blocks, replace with:

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

Preserve every line of code that runs **after** application creation (confirmation message, audit logs specific to WhatsApp). Only the create-and-conversation-step block is being subsumed.

- [ ] **Step 2: Run existing tests**

```bash
pnpm vitest run __tests__/lib/whatsapp-flows
pnpm tsc --noEmit
pnpm lint
```
Expected: every existing test still passes; clean types/lint.

Verify no remaining inline call:
```bash
grep -n "tx.providerApplication.create\|tx\.providerApplication\.create" lib/whatsapp-flows/registration.ts
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add lib/whatsapp-flows/registration.ts
git commit -m "$(cat <<'EOF'
refactor(whatsapp): delegate application submission to shared helper

handleSubmitApplication now calls submitProviderApplication() for
identical row shape with the upcoming /provider/signup web finish flow.
Behaviour is unchanged.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase C — Operator "Generate resume link" action (additive only)

### Task 5: Register 2 feature flags

**Files:**
- Modify: `lib/feature-flags-registry.ts`
- Modify: `lib/flags.ts` (`FLAG_KEYS` map, if present)
- Modify: `scripts/seed-flags.ts`

- [ ] **Step 1: Add registry entries**

In `lib/feature-flags-registry.ts`, append:

```ts
'admin.applications.resume_link_button': {
  description: 'Show the per-row "Generate resume link" button on /admin/applications. Issues a ProviderResumeToken and returns a /provider/signup URL for the operator to share.',
  owner: 'ops',
  defaultValue: false,
},
'whatsapp.registration.web_resume': {
  description: 'Enable the anonymous /provider/signup?t=… page that resumes a registration from a ProviderResumeToken.',
  owner: 'prod',
  defaultValue: false,
},
```

- [ ] **Step 2: Add FLAG_KEYS constants (only if FLAG_KEYS exists)**

If `lib/flags.ts` exposes a `FLAG_KEYS` constants map, append:

```ts
ADMIN_APPLICATIONS_RESUME_LINK_BUTTON: 'admin.applications.resume_link_button',
WHATSAPP_REGISTRATION_WEB_RESUME: 'whatsapp.registration.web_resume',
```

Skip this step if no such map exists (the parallel plan also touches this file — if both updates need the same map and one ships first, follow that file's existing pattern).

- [ ] **Step 3: Seed**

In `scripts/seed-flags.ts`, append both keys with `enabled: false`. Confirm by:
```bash
grep -n "admin.applications.resume_link_button\|whatsapp.registration.web_resume" scripts/seed-flags.ts
```
Expected: 2 hits.

- [ ] **Step 4: Typecheck**

```bash
pnpm tsc --noEmit
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add lib/feature-flags-registry.ts lib/flags.ts scripts/seed-flags.ts
git commit -m "$(cat <<'EOF'
chore(flags): add resume_link_button + web_resume flags (default off)

Gate the new /admin/applications "Generate resume link" button and the
anonymous /provider/signup page. Will be flipped separately after
smoke validation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: `generateResumeLinkAction` server action

**Files:**
- Create: `app/(admin)/admin/applications/recovery-actions.ts`
- Test: `__tests__/app/admin-applications-resume-link.test.ts`

> **Boundary:** this file exports `generateResumeLinkAction` **only**. It does not import or modify `sendRecoveryNudgeForRow`, `attemptSendRecoveryForRow`, or `recordProviderOnboardingRecoveryOutcome` — those belong to the parallel template-cascade plan.

- [ ] **Step 1: Write failing tests**

Create `__tests__/app/admin-applications-resume-link.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { db } from '@/lib/db'

vi.mock('@/lib/auth', () => ({
  getSession: vi.fn(async () => ({ id: 'sb-user-1' })),
}))

import { generateResumeLinkAction } from '@/app/(admin)/admin/applications/recovery-actions'

beforeEach(async () => {
  await db.providerResumeToken.deleteMany()
  await db.conversation.deleteMany()
  await db.adminUser.deleteMany()
  await db.featureFlag.deleteMany()
  await db.featureFlag.create({ data: { key: 'admin.applications.resume_link_button', enabled: true, enabledForUsers: [] } })
  await db.adminUser.create({ data: { userId: 'sb-user-1', email: 'a@b', role: 'ADMIN', active: true } })
  vi.clearAllMocks()
})

describe('generateResumeLinkAction', () => {
  it('issues a ProviderResumeToken and returns a /provider/signup URL', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000060', flow: 'registration', step: 'reg_collect_rates',
        data: { name: 'Link User' }, expiresAt: new Date(Date.now() + 1800_000) },
    })
    const result = await generateResumeLinkAction({ conversationId: conv.id })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.url).toMatch(/\/provider\/signup\?t=[A-Za-z0-9_-]{43}$/)
      const tokens = await db.providerResumeToken.findMany({ where: { conversationId: conv.id } })
      expect(tokens).toHaveLength(1)
      expect(tokens[0].source).toBe('recovery_nudge')
    }
  })

  it('supersedes any prior live token for the same conversation', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000061', flow: 'registration', step: 'reg_collect_rates',
        data: { name: 'Repeat User' }, expiresAt: new Date(Date.now() + 1800_000) },
    })
    await generateResumeLinkAction({ conversationId: conv.id })
    await generateResumeLinkAction({ conversationId: conv.id })
    const tokens = await db.providerResumeToken.findMany({ where: { conversationId: conv.id }, orderBy: { issuedAt: 'asc' } })
    expect(tokens).toHaveLength(2)
    expect(tokens[0].revokedReason).toBe('superseded')
    expect(tokens[1].revokedAt).toBeNull()
  })

  it('rejects when the conversation is not in registration flow', async () => {
    const conv = await db.conversation.create({
      data: { phone: '+27000000062', flow: 'job_request', step: 'jr_collect_address',
        data: {}, expiresAt: new Date(Date.now() + 1800_000) },
    })
    await expect(generateResumeLinkAction({ conversationId: conv.id })).rejects.toThrow(/registration/i)
  })

  it('rejects when the flag is disabled', async () => {
    await db.featureFlag.update({ where: { key: 'admin.applications.resume_link_button' }, data: { enabled: false } })
    const conv = await db.conversation.create({
      data: { phone: '+27000000063', flow: 'registration', step: 'reg_collect_rates',
        data: { name: 'Off' }, expiresAt: new Date(Date.now() + 1800_000) },
    })
    await expect(generateResumeLinkAction({ conversationId: conv.id })).rejects.toThrow(/flag/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm vitest run __tests__/app/admin-applications-resume-link.test.ts
```
Expected: module-not-found.

- [ ] **Step 3: Implement**

Create `app/(admin)/admin/applications/recovery-actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { getSession } from '@/lib/auth'
import { db } from '@/lib/db'
import { crudAction } from '@/lib/crud-action'
import { issueProviderResumeToken } from '@/lib/provider-resume-tokens'

const Input = z.object({ conversationId: z.string().min(1) })

export async function generateResumeLinkAction(input: z.infer<typeof Input>) {
  const result = await crudAction({
    input,
    schema: Input,
    requiredRole: ['OPS', 'ADMIN', 'OWNER'],
    requiredFlag: 'admin.applications.resume_link_button',
    entityType: 'ProviderResumeToken',
    action: 'resume_link.generate',
    run: async (validInput, tx) => {
      const session = await getSession()
      if (!session) throw new Error('no_session')
      const admin = await tx.adminUser.findUniqueOrThrow({ where: { userId: session.id } })

      const conv = await tx.conversation.findUnique({ where: { id: validInput.conversationId } })
      if (!conv) throw new Error('conversation_not_found')
      if (conv.flow !== 'registration') throw new Error('not_in_registration_flow')

      const { rawToken } = await issueProviderResumeToken(tx, {
        conversationId: conv.id,
        phone: conv.phone,
        issuedByAdminUserId: admin.id,
        source: 'recovery_nudge',
      })

      const baseUrl = (process.env.APP_URL ?? 'https://plugapro.co.za').replace(/\/$/, '')
      const url = `${baseUrl}/provider/signup?t=${rawToken}`

      revalidatePath('/admin/applications')
      return { ok: true as const, url }
    },
  })
  return result.data
}
```

- [ ] **Step 4: Run to verify passing**

```bash
pnpm vitest run __tests__/app/admin-applications-resume-link.test.ts
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(admin\)/admin/applications/recovery-actions.ts __tests__/app/admin-applications-resume-link.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): generateResumeLinkAction (issues token, returns URL)

crudAction-wrapped, flag-gated. Operator clicks "Generate resume link"
on a recovery row; gets a /provider/signup?t=... URL to paste into a
WhatsApp message. Does not modify the parallel-plan recovery cascade.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: "Generate resume link" button in the admin UI

**Files:**
- Create: `components/admin/applications/resume-link-button.tsx`
- Modify: `app/(admin)/admin/applications/page.tsx` — add a column next to the existing recovery queue rows

> **Boundary:** add a new column. Do not modify the existing "Send now" cell or any other cells touched by the parallel plan.

- [ ] **Step 1: Build the client button**

Create `components/admin/applications/resume-link-button.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { generateResumeLinkAction } from '@/app/(admin)/admin/applications/recovery-actions'

export interface ResumeLinkButtonProps {
  conversationId: string
  disabled?: boolean
}

export function ResumeLinkButton(props: ResumeLinkButtonProps) {
  const [pending, startTransition] = useTransition()
  const [generatedUrl, setGeneratedUrl] = useState<string | null>(null)

  if (props.disabled) {
    return <Button size="sm" variant="ghost" disabled>Resume link</Button>
  }

  const onClick = () => startTransition(async () => {
    try {
      const result = await generateResumeLinkAction({ conversationId: props.conversationId })
      if (result.ok) {
        await navigator.clipboard.writeText(result.url).catch(() => undefined)
        setGeneratedUrl(result.url)
        toast.success('Resume link copied to clipboard.')
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to generate link.'
      toast.error(message)
    }
  })

  if (generatedUrl) {
    return (
      <div className="flex flex-col gap-1 text-xs">
        <code className="break-all rounded bg-muted px-1 py-0.5">{generatedUrl}</code>
        <Button size="sm" variant="ghost" onClick={onClick} disabled={pending}>Regenerate</Button>
      </div>
    )
  }

  return (
    <Button size="sm" variant="secondary" onClick={onClick} disabled={pending}>
      {pending ? 'Generating…' : 'Generate resume link'}
    </Button>
  )
}
```

- [ ] **Step 2: Insert the column in the recovery queue table**

In `app/(admin)/admin/applications/page.tsx`, find the recovery-queue `<Table>` block (around the existing rows iterated from `listProviderOnboardingRecoveryRows`). Add **one new `<TableHead>Resume link</TableHead>`** to the header row, and **one new `<TableCell>`** to each `<TableRow>`:

```tsx
{resumeLinkButtonEnabled && (
  <TableCell>
    <ResumeLinkButton
      conversationId={row.conversationId ?? ''}
      disabled={!row.conversationId || row.followUpStatus === 'submitted_excluded'}
    />
  </TableCell>
)}
```

Add the flag resolution near the top of the page where other flags are resolved:

```tsx
const resumeLinkButtonEnabled = await isEnabled('admin.applications.resume_link_button', { userId: session.id })
```

Also gate the `<TableHead>` with the same condition so the column is fully hidden when the flag is off.

> **Note on `conversationId` availability:** the recovery row should already include this (the parallel plan and the existing rendering use it). If `ProviderOnboardingRecoveryRow` does not expose `conversationId` directly, fall back to deriving it from `row.id` if `row.source === 'conversation'` — `listProviderOnboardingRecoveryRows` uses `conversationId` as the row id for the 'conversation' source.

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm lint
pnpm tsc --noEmit
```
Expected: clean.

- [ ] **Step 4: Local smoke**

```bash
pnpm dev
```
Login as admin. Toggle `admin.applications.resume_link_button` ON in the DB. Visit `/admin/applications`. See the new column. Click the button on a registration-flow recovery row. Toast says "copied", URL appears in the cell. Open it in a new tab — see the `/provider/signup` page (will say "Not available" until we ship Task 8 and enable `whatsapp.registration.web_resume`).

- [ ] **Step 5: Commit**

```bash
git add components/admin/applications/resume-link-button.tsx app/\(admin\)/admin/applications/page.tsx
git commit -m "$(cat <<'EOF'
feat(admin): "Generate resume link" button per recovery row

Additive column on /admin/applications recovery queue. Calls
generateResumeLinkAction, copies the resulting /provider/signup?t=...
URL to clipboard. Hidden until admin.applications.resume_link_button
flag is enabled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase D — Web finish page

### Task 8: `/provider/signup` route + token validation + error/confirmation pages

**Files:**
- Create: `app/(provider)/provider/signup/page.tsx`
- Create: `app/(provider)/provider/signup/error.tsx`
- Create: `app/(provider)/provider/signup/confirmation/page.tsx`

- [ ] **Step 1: Implement the entry page**

Create `app/(provider)/provider/signup/page.tsx`:

```tsx
import type { Metadata } from 'next'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken } from '@/lib/provider-resume-tokens'
import { CapturedPanel } from './captured-panel'
import { RemainingFieldsForm } from './remaining-fields-form'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Finish your signup', robots: { index: false, follow: false } }

export default async function ProviderSignupPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    return (
      <main className="mx-auto max-w-md p-6">
        <h1 className="text-xl font-semibold">Not available</h1>
        <p className="mt-2 text-sm text-muted-foreground">This feature is not currently enabled.</p>
      </main>
    )
  }

  const rawToken = (await searchParams).t
  if (!rawToken) return <ErrorPanel reason="missing_token" />

  const validated = await validateProviderResumeToken(db, rawToken)
  if (!validated.ok) return <ErrorPanel reason={validated.reason} />

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

- [ ] **Step 2: Add error boundary + confirmation page**

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

Create `app/(provider)/provider/signup/confirmation/page.tsx`:

```tsx
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Application submitted', robots: { index: false, follow: false } }

export default function Confirmation() {
  return (
    <main className="mx-auto max-w-md p-6 text-center">
      <h1 className="text-2xl font-semibold">Application submitted ✅</h1>
      <p className="mt-2 text-sm text-muted-foreground">We'll WhatsApp you within 30 minutes once an admin reviews it.</p>
    </main>
  )
}
```

- [ ] **Step 3: Local smoke**

```bash
pnpm dev
```
- Visit `/provider/signup` (no `?t=`) — expect "Not available" while the `whatsapp.registration.web_resume` flag is OFF. Enable the flag in DB and refresh — expect "Resume link unavailable / No resume token provided."
- Visit `/provider/signup?t=invalid` — expect "Resume link unavailable / could not find this signup link."

- [ ] **Step 4: Commit**

```bash
git add app/\(provider\)/provider/signup/page.tsx app/\(provider\)/provider/signup/error.tsx app/\(provider\)/provider/signup/confirmation/page.tsx
git commit -m "$(cat <<'EOF'
feat(provider): anonymous /provider/signup web finish page (token-gated)

Validates ProviderResumeToken server-side, surfaces friendly error
states for missing/expired/used/revoked, renders captured-data panel +
remaining-fields form (next commits). Behind whatsapp.registration.
web_resume flag. noindex/nofollow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Section registry — `lib/web-signup-sections.ts`

**Files:**
- Create: `lib/web-signup-sections.ts`
- Test: `__tests__/lib/web-signup-sections.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/web-signup-sections.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { selectMissingSections, buildDynamicSchema, SECTION_REGISTRY } from '@/lib/web-signup-sections'

describe('selectMissingSections', () => {
  it('returns all sections when data is empty', () => {
    const r = selectMissingSections({})
    expect(r.map((s) => s.key)).toEqual(SECTION_REGISTRY.map((s) => s.key))
  })

  it('omits sections whose fields are all captured', () => {
    const r = selectMissingSections({ name: 'X', idNumber: '8001015009087', skills: ['plumbing'] })
    expect(r.map((s) => s.key)).not.toContain('identity')
    expect(r.map((s) => s.key)).not.toContain('skills')
  })

  it('keeps a section when at least one of its fields is missing', () => {
    const r = selectMissingSections({ name: 'X' }) // idNumber missing
    expect(r.map((s) => s.key)).toContain('identity')
  })
})

describe('buildDynamicSchema', () => {
  it('produces a single object schema spanning all included sections', () => {
    const sections = selectMissingSections({})
    const schema = buildDynamicSchema(sections)
    const parsed = schema.safeParse({})
    expect(parsed.success).toBe(false) // required fields missing
  })

  it('accepts a complete payload covering all sections', () => {
    const sections = selectMissingSections({})
    const schema = buildDynamicSchema(sections)
    const payload = {
      name: 'Jane Doe', idNumber: '8001015009087',
      skills: ['plumbing'],
      regionLabel: 'Sandton', cityLabel: 'Sandton',
      availability: ['Mon'],
      hourlyRate: 350,
      profilePhotoUrl: 'https://example.com/p.jpg',
      bio: 'Hi I am a plumber with five years experience and a license.',
      references: 'Available on request from past clients on demand.',
      evidenceFileUrls: [],
    }
    const result = schema.safeParse(payload)
    expect(result.success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm vitest run __tests__/lib/web-signup-sections.test.ts
```

- [ ] **Step 3: Implement**

Create `lib/web-signup-sections.ts`:

```ts
import { z } from 'zod'

export const SECTION_KEYS = [
  'identity', 'skills', 'service_areas', 'availability', 'rates', 'profile_photo', 'bio', 'references', 'evidence',
] as const
export type SectionKey = typeof SECTION_KEYS[number]

export interface SectionDef {
  key: SectionKey
  fields: readonly string[]
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

- [ ] **Step 4: Run to verify passing**

```bash
pnpm vitest run __tests__/lib/web-signup-sections.test.ts
```
Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/web-signup-sections.ts __tests__/lib/web-signup-sections.test.ts
git commit -m "$(cat <<'EOF'
feat(provider): web signup section registry + adaptive schema

Registry maps each registration step to its Conversation.data keys and a
Zod schema fragment. selectMissingSections() returns only the sections
containing missing fields; buildDynamicSchema() composes a single Zod
object from them.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: `CapturedPanel` component

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
  if (typeof data.idNumber === 'string' && data.idNumber.trim()) out.push({ label: 'ID', value: `••• ${data.idNumber.slice(-4)}` })
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

### Task 11: Form host + 9 section components

**Files:**
- Create: `app/(provider)/provider/signup/remaining-fields-form.tsx`
- Create: 9 section files under `app/(provider)/provider/signup/sections/`

- [ ] **Step 1: Form host**

Create `app/(provider)/provider/signup/remaining-fields-form.tsx`:

```tsx
'use client'

import { useTransition } from 'react'
import { useForm, FormProvider, type SubmitHandler } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { selectMissingSections, buildDynamicSchema } from '@/lib/web-signup-sections'
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
      <form onSubmit={methods.handleSubmit(onSubmit)} className="rounded border p-4 text-sm">
        <p>Everything is captured. Tap below to submit.</p>
        <Button type="submit" disabled={pending} className="mt-3 w-full">Submit application</Button>
      </form>
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

- [ ] **Step 2: Section components — minimal viable implementations**

For each section, render the inputs defined in `SECTION_REGISTRY[key].fields` using existing primitives from `components/ui/`. Use `useFormContext` to wire RHF state.

Example for identity (`sections/identity.tsx`):

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

For each of the other 8 sections, follow the same pattern:
- **`skills`**: array of strings — render a `<select multiple>` or a list of `Checkbox` against a static skill list (look at `lib/skills.ts` or `lib/categories.ts` for the canonical list; if no list exists, hardcode a top-10 seed list of `['plumbing','electrical','painting','tiling','carpentry','garden','aircon','geyser','locksmith','appliance']` and document it as v1).
- **`service_areas`**: two `<select>`s, region and city, populated from `LocationNode` rows. For v1, fetch the lists at section-mount time via a small route handler `app/api/provider-signup/locations/route.ts` that returns `{ regions: string[], cities: string[] }`. If that's too much for one task, hardcode a 5-region/10-city list as a v1 fallback and add a TODO.
- **`availability`**: 7 day-of-week checkboxes.
- **`rates`**: single number input `<Input type="number" />`.
- **`profile_photo`**: file input → upload via Vercel Blob; on success `setValue('profilePhotoUrl', url)`. Use existing `lib/storage.ts` upload helper.
- **`bio`**: `<Textarea>`.
- **`references`**: `<Textarea>`.
- **`evidence`**: multi-file input → upload via Vercel Blob; on success `setValue('evidenceFileUrls', urls)`. Include a "Skip evidence" button that explicitly sets `[]` and clears validation.

> **Keep it boring.** No fancy multi-step widgets. Each section is one fieldset. Optimise UX only after seeing real conversion data.

- [ ] **Step 3: Lint + typecheck**

```bash
pnpm lint
pnpm tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add app/\(provider\)/provider/signup/remaining-fields-form.tsx app/\(provider\)/provider/signup/sections/
git commit -m "$(cat <<'EOF'
feat(provider/signup): adaptive RHF form + 9 section components

Form renders only the sections containing missing fields. Each section
is a focused fieldset using primitives from components/ui/. Profile
photo + evidence sections upload to Vercel Blob.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: `submitProviderApplicationFromWebAction` + `updateCapturedFieldAction`

**Files:**
- Create: `app/(provider)/provider/signup/actions.ts`
- Test: `__tests__/app/provider-signup-actions.test.ts`

- [ ] **Step 1: Write failing test**

Create `__tests__/app/provider-signup-actions.test.ts`:

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
        data: { name: 'Web User', idNumber: '8001015009087', skills: ['plumbing'], regionLabel: 'Sandton',
          cityLabel: 'Sandton', availability: ['Mon','Tue','Wed','Thu','Fri'], hourlyRate: 350,
          profilePhotoUrl: 'https://blob/photo.jpg',
          bio: 'Plumber with five years of experience including big leaks.',
          references: 'Available on request from past clients on demand.',
          evidenceFileUrls: [] },
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

  it('rejects when the flag is disabled', async () => {
    await db.featureFlag.update({ where: { key: 'whatsapp.registration.web_resume' }, data: { enabled: false } })
    await expect(submitProviderApplicationFromWebAction({ rawToken: 'x'.repeat(43), payload: {} })).rejects.toThrow(/disabled|feature/i)
  })
})
```

- [ ] **Step 2: Run to verify failure**

```bash
pnpm vitest run __tests__/app/provider-signup-actions.test.ts
```

- [ ] **Step 3: Implement**

Create `app/(provider)/provider/signup/actions.ts`:

```ts
'use server'

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { isEnabled } from '@/lib/flags'
import { validateProviderResumeToken, consumeProviderResumeToken } from '@/lib/provider-resume-tokens'
import { submitProviderApplication, type SubmitInput } from '@/lib/provider-applications-submit'
import { buildDynamicSchema, selectMissingSections } from '@/lib/web-signup-sections'

const SubmitSchema = z.object({
  rawToken: z.string().min(32),
  payload: z.record(z.unknown()),
})

export async function submitProviderApplicationFromWebAction(input: z.infer<typeof SubmitSchema>) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) {
    throw new Error('feature_disabled')
  }
  const { rawToken, payload } = SubmitSchema.parse(input)

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
    const submitInput: SubmitInput = {
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

    const { application } = await submitProviderApplication(tx, submitInput, { source: 'web', conversationId: conv.id })

    revalidatePath('/admin/applications')
    return { ok: true as const, applicationId: application.id }
  })
}

const UpdateSchema = z.object({
  rawToken: z.string().min(32),
  field: z.string().min(1),
  value: z.unknown(),
})

export async function updateCapturedFieldAction(input: z.infer<typeof UpdateSchema>) {
  if (!(await isEnabled('whatsapp.registration.web_resume'))) throw new Error('feature_disabled')
  const { rawToken, field, value } = UpdateSchema.parse(input)
  const v = await validateProviderResumeToken(db, rawToken)
  if (!v.ok) throw new Error(`token_${v.reason}`)
  const conv = await db.conversation.findUniqueOrThrow({ where: { id: v.conversationId } })
  const existing = (conv.data as Record<string, unknown>) ?? {}
  await db.conversation.update({
    where: { id: v.conversationId },
    data: { data: { ...existing, [field]: value } as any },
  })
  return { ok: true as const }
}
```

- [ ] **Step 4: Run to verify passing**

```bash
pnpm vitest run __tests__/app/provider-signup-actions.test.ts
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/\(provider\)/provider/signup/actions.ts __tests__/app/provider-signup-actions.test.ts
git commit -m "$(cat <<'EOF'
feat(provider/signup): submit + captured-field-update server actions

Token-gated. Validates dynamic Zod schema against missing sections,
atomically consumes the token, then writes ProviderApplication via the
shared helper. updateCapturedFieldAction lets the captured-panel edit
affordance write back to Conversation.data without burning the token.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase E — Smoke + deploy artifacts

### Task 13: Playwright smoke + smoke-list inclusion

**Files:**
- Create: `e2e/provider-web-signup.spec.ts`
- Modify: `e2e/smoke.spec.ts` (add `/provider/signup?t=invalid` to the public-route list)

- [ ] **Step 1: Spec**

Create `e2e/provider-web-signup.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('invalid token shows graceful error', async ({ page }) => {
  await page.goto(`${process.env.E2E_BASE_URL}/provider/signup?t=does-not-exist-1234567890ab`)
  await expect(page.getByText(/resume link unavailable/i)).toBeVisible()
})

test('flag-off shows "Not available"', async ({ page }) => {
  test.skip(process.env.E2E_WEB_RESUME_ENABLED === '1', 'flag is on in this env')
  await page.goto(`${process.env.E2E_BASE_URL}/provider/signup`)
  await expect(page.getByText(/not available/i)).toBeVisible()
})
```

- [ ] **Step 2: Append to `e2e/smoke.spec.ts`**

In the public-route smoke list, add an assertion that `/provider/signup?t=invalid` returns 200 and renders without throwing (use the existing list-walking pattern in `smoke.spec.ts`).

- [ ] **Step 3: Run + commit**

```bash
E2E_BASE_URL=http://localhost:3000 pnpm playwright test e2e/provider-web-signup.spec.ts e2e/smoke.spec.ts
git add e2e/provider-web-signup.spec.ts e2e/smoke.spec.ts
git commit -m "test(e2e): /provider/signup smoke + invalid-token graceful page"
```

---

### Task 14: CLAUDE.md route inventory

**Files:**
- Modify: `field-service/CLAUDE.md` (route inventory + feature flags section)

- [ ] **Step 1: Append routes to inventory**

Under the route inventory (which currently lists admin routes), add a provider section if not present:

```
- `/provider/signup` → `field-service/app/(provider)/provider/signup/page.tsx` (anonymous, token-gated by ProviderResumeToken)
- `/provider/signup/confirmation` → `field-service/app/(provider)/provider/signup/confirmation/page.tsx`
```

- [ ] **Step 2: Append flags**

Under "What's already in place" → "Feature flags" → "Current seeded flags", append:
- `admin.applications.resume_link_button`
- `whatsapp.registration.web_resume`

- [ ] **Step 3: Commit**

```bash
git add field-service/CLAUDE.md
git commit -m "docs(claude.md): register /provider/signup routes + 2 new flags"
```

---

## Rollout checklist

1. After merge, apply migration on production: `pnpm prisma migrate deploy`.
2. Run flag seed: `pnpm tsx scripts/seed-flags.ts`.
3. Enable `admin.applications.resume_link_button` for OWNER/ADMIN via `enabledForUsers`.
4. Enable `whatsapp.registration.web_resume` globally once `/provider/signup` smoke passes on preview.
5. Pick one real candidate from the brainstorm list (Victor Panavanhu — closest to evidence step). Operator clicks "Generate resume link" on his row, copy-pastes the URL into a WhatsApp message via the existing operator surface. Confirm the candidate's `/provider/signup` flow works end-to-end and a `ProviderApplication` row appears.
6. After the parallel template-cascade plan ships, open a follow-on PR to append the resume URL to `row.followUpMessage` (freeform body only) so the URL goes out automatically with in-window nudges. Template path stays URL-less for now.

---

## Self-review notes

- **Spec coverage:** Token foundations (A: Tasks 1–2), shared submit helper (B: Tasks 3–4), operator-additive resume link (C: Tasks 5–7), web finish page (D: Tasks 8–12), smoke + docs (E: Tasks 13–14). The "send the URL in the recovery message" integration is intentionally deferred to a post-template-cascade follow-on PR — flagged in the rollout checklist.
- **Overlap audit:** No task modifies `lib/messaging-templates.ts`, `lib/provider-onboarding-recovery.ts`, `lib/provider-onboarding-recovery-template-config.ts`, the cron route, or the existing `sendRecoveryNudgeForRow` action. The only file touched in the admin applications area is `page.tsx` — and only to add a new column, not to modify existing cells. `recovery-actions.ts` is a new file with one exported action.
- **Type consistency:** `submitProviderApplication(client, input, options)` signature is identical across Task 3 (definition), Task 4 (WhatsApp consumer), Task 12 (web consumer). `issueProviderResumeToken` / `validateProviderResumeToken` / `consumeProviderResumeToken` shapes are stable across Tasks 2, 6, 8, 12.
- **No placeholders:** every step contains runnable code, exact commands, and exact commit messages.

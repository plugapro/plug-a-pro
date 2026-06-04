# WhatsApp Registration Friction Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut provider-registration drop-off on WhatsApp by fixing the five friction patterns observed in the 2026-06-04 Meta boost data (14 messaging conversations → only 3 applications, with concentrated drop-offs at the welcome menu, the name prompt, and the evidence upload step, plus a flow-conflict bug and dead-cold expired sessions).

**Architecture:** Five independent workstreams (A–E), each shippable behind its own feature flag. All changes live in `field-service/`: the WhatsApp webhook, the bot dispatcher (`lib/whatsapp-bot.ts`), the registration flow (`lib/whatsapp-flows/registration.ts`), the conversation-state persistence helper, the WhatsApp template registry, and a new pre-expiry cron route. No schema changes are required. No admin UI changes are required.

**Tech Stack:** Next.js App Router (Node runtime), TypeScript, Prisma + Postgres, Vitest, WhatsApp Cloud API, Vercel Crons, feature flags via `lib/flags.ts`.

---

## Background

On 2026-06-04 a Meta boost drove 1,162 ad views → 14 messaging conversations → 3 ProviderApplication rows over ~4 hours. Per-phone drop-off analysis (script: `field-service/scripts/ad-boost-dropoff.ts`) attributed the 14 stuck phones to:

| Bucket | Phones | Friction observed |
|---|---|---|
| `idle/welcome` (never picked a path) | 5 | Generic "Hi" → welcome menu shown → no further tap |
| `reg_collect_name` with empty session data | 4 | Tapped Register button, then dropped when asked for name |
| Mid-flow (`reg_collect_id`, `reg_collect_skills_more`, `reg_collect_city`) | 3 | Got past name, dropped at next interactive picker |
| `reg_collect_evidence` with 29 filled fields | 1 | Filled entire form; walked away at file-upload step |
| `reg_collect_name` with customer-flow keys in `data` | 1 | Flow conflict bug: customer `job_request` data carried over into registration session |

12 of 14 stuck conversations are already past the 30-minute `expiresAt` TTL with no pre-expiry warning sent.

## Spec → workstream mapping

| Friction item from spec | Workstream |
|---|---|
| 1. `reg_collect_name` empty drop-off | **A** — profile-name shortcut + privacy framing |
| 2. `idle/welcome` drop-off | **B** — deep-link routing for ad traffic |
| 3. `reg_collect_evidence` near-miss | **C** — prominent skip + post-submit upload-later nudge |
| 4. Flow conflict bug (6621) | **D** — flow-switch state isolation |
| 5. 30-min TTL killing re-engagement | **E** — pre-expiry "continue where you left off" warning |

Each workstream ships behind its own flag and can be flipped independently. House rules require this anyway.

## File Structure

**New files**

| Path | Responsibility |
|---|---|
| `field-service/lib/whatsapp-deeplinks.ts` | Token list + matcher used by the bot dispatcher to detect ad-driven first messages. Pure utility, no I/O. |
| `field-service/lib/whatsapp-conversation-state.ts` | `clearIncompatibleFlowData()` helper that strips foreign keys from `Conversation.data` when `flow` changes. Pure utility. |
| `field-service/app/api/cron/session-warning/route.ts` | New cron: fires every 5 min, sends a pre-expiry "continue" warning ~5 min before `expiresAt` for non-idle sessions. |
| `field-service/__tests__/lib/whatsapp-deeplinks.test.ts` | Vitest unit tests for token matcher. |
| `field-service/__tests__/lib/whatsapp-conversation-state.test.ts` | Vitest unit tests for the data-stripping helper. |
| `field-service/__tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts` | Vitest tests for the new `reg_collect_name` UX. |
| `field-service/__tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts` | Vitest tests for the reordered evidence buttons. |
| `field-service/__tests__/app/api/cron/session-warning.test.ts` | Vitest tests for the new cron route. |
| `field-service/docs/whatsapp-ad-deeplink-cta.md` | One-page op doc: which prefilled-message string to paste into the Meta boost CTA. |

**Modified files**

| Path | Change |
|---|---|
| `field-service/lib/feature-flags-registry.ts` | Add 5 new flag keys (one per workstream). |
| `field-service/scripts/seed-flags.ts` | Seed the 5 new flags as disabled. |
| `field-service/app/api/webhooks/whatsapp/route.ts` | Capture `value.contacts[0].profile.name` from WhatsApp Cloud API payload; pass into `processInboundMessage`. |
| `field-service/lib/whatsapp-bot.ts` | (1) Accept optional sender profile name on `processInboundMessage`. (2) Detect deep-link tokens before the existing `REGISTRATION_TRIGGERS` branch and route straight into `reg_start`. (3) Call `clearIncompatibleFlowData()` from `saveConversation` when flow changes. |
| `field-service/lib/whatsapp-flows/registration.ts` | (1) Replace the bare name prompt with a privacy-framed prompt + 2-button shortcut (`use_wa_name` / `enter_different_name`). (2) Reorder the evidence buttons so "Skip for now" is the first/primary button when no high-risk skills are selected. (3) Send a 24h "add a work photo" follow-up note after PENDING submission. |
| `field-service/lib/whatsapp-flows/types.ts` | Extend `FlowContext` with optional `senderProfileName?: string`. |
| `field-service/lib/messaging-templates.ts` | Add `provider_registration_continue` template definition (must also be created + approved in Meta Business Manager — see Task E.2). |
| `field-service/vercel.json` | Add new cron entry pointing at `/api/cron/session-warning`. |

---

## Pre-flight

### Task 0: Branch + clean state

**Files:**
- Modify: working tree state only

- [ ] **Step 1: Confirm current branch and uncommitted state**

Run: `git -C "$REPO" status --porcelain && git -C "$REPO" rev-parse --abbrev-ref HEAD`
Expected: prints `main` as the current branch and lists uncommitted files (notably the earlier marketing-site Nav/Footer/FAQ edits).

Set `REPO="/Users/shimane/Library/CloudStorage/Dropbox/Kgolaentle Holdings/Solutions/Projects/Plug A Pro"` for the rest of this plan.

- [ ] **Step 2: Decide what to do with pre-existing marketing edits**

If the marketing edits from earlier in this session (`marketing/components/shared/Nav.tsx`, `marketing/components/shared/Footer.tsx`, `marketing/app/(marketing)/faq/page.tsx`) have NOT been committed, commit them to `main` first so they ship on their own preview deploy and do not contaminate this branch's diff.

Run:
```bash
git -C "$REPO" add marketing/components/shared/Nav.tsx marketing/components/shared/Footer.tsx "marketing/app/(marketing)/faq/page.tsx"
git -C "$REPO" commit -m "feat(marketing): add Sign in link to Nav, Footer, FAQ pointing to app.plugapro.co.za"
```

Skip if those files are clean.

- [ ] **Step 3: Create the feature branch**

Run: `git -C "$REPO" checkout -b feat/whatsapp-registration-friction-fixes`
Expected: `Switched to a new branch 'feat/whatsapp-registration-friction-fixes'`.

- [ ] **Step 4: Confirm field-service tests run baseline-green**

Run: `cd "$REPO/field-service" && pnpm test --run 2>&1 | tail -20`
Expected: all tests pass. If anything is red on `main`, stop and investigate before continuing.

- [ ] **Step 5: Commit nothing yet**

No commit on this task — branch creation is enough.

---

## Workstream A — `reg_collect_name` profile-name shortcut

**Hypothesis:** 4 of 14 stuck phones tapped the "Register" interactive button and then evaporated when the bot replied `"👤 What is your *full name*?\n\n_(Type and send your name)_"`. WhatsApp already delivers the sender's profile name in the inbound payload (`value.contacts[0].profile.name`). Offering it as a one-tap shortcut with a privacy framing line should rescue the silent drop-offs.

### Task A.1: Register feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [ ] **Step 1: Add the flag definition**

Open `field-service/lib/feature-flags-registry.ts`. Locate the closing `} as const satisfies …` at the end of `FEATURE_FLAGS_REGISTRY` and insert the entry below before that closing brace, preserving the alphabetical-by-prefix grouping (search for an existing `'whatsapp.*'` group; if none exists, add a new commented section at the bottom of the registry):

```typescript
  // ─── WhatsApp registration friction fixes (2026-06-04) ─────────────────────
  'whatsapp.registration.name_profile_shortcut': {
    description: 'Offer the WhatsApp profile name as a one-tap default at the reg_collect_name step, plus a short privacy framing line.',
    owner: 'prod',
    defaultValue: false,
  },
```

- [ ] **Step 2: Run typecheck to confirm the literal is registered**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no new errors. The flag literal is now part of the `FeatureFlagKey` union.

- [ ] **Step 3: Commit**

```bash
git -C "$REPO" add field-service/lib/feature-flags-registry.ts
git -C "$REPO" commit -m "feat(flags): add whatsapp.registration.name_profile_shortcut"
```

### Task A.2: Capture sender profile name in the WhatsApp webhook

**Files:**
- Modify: `field-service/app/api/webhooks/whatsapp/route.ts`
- Modify: `field-service/lib/whatsapp-bot.ts` (signature only — full plumbing in A.3)

- [ ] **Step 1: Read the current webhook entry block**

Run: `cd "$REPO/field-service" && sed -n '60,120p' app/api/webhooks/whatsapp/route.ts`
Expected: you see the `for (const change of entry.changes ?? [])` loop with `const value = change.value` and the `for (const message of value.messages ?? [])` inner loop.

- [ ] **Step 2: Extract the contact-profile lookup**

Inside the `for (const change of entry.changes ?? [])` loop, immediately after `const value = change.value`, add:

```typescript
        // WhatsApp Cloud API delivers per-batch contacts alongside messages.
        // Build a lookup so the registration name step can offer a one-tap default.
        const contactsByPhone = new Map<string, string | undefined>()
        for (const contact of (value as { contacts?: Array<{ wa_id?: string; profile?: { name?: string } }> }).contacts ?? []) {
          if (contact.wa_id) {
            contactsByPhone.set(contact.wa_id, contact.profile?.name?.trim() || undefined)
          }
        }
```

- [ ] **Step 3: Pass the profile name into `processInboundMessage`**

Find the existing call to `processInboundMessage(message)` (search the route file for it; it's inside the `after(...)` callback). Change it to:

```typescript
                await processInboundMessage(message, {
                  senderProfileName: contactsByPhone.get(message.from),
                })
```

- [ ] **Step 4: Widen `processInboundMessage` signature in `lib/whatsapp-bot.ts`**

In `field-service/lib/whatsapp-bot.ts`, find `export async function processInboundMessage(message: …)` (it's the wrapper above `processInboundMessageUnlocked`). Add a second optional argument:

```typescript
export async function processInboundMessage(
  message: WhatsAppInboundMessage,
  options?: { senderProfileName?: string },
): Promise<void>
```

Pass `options` through to `processInboundMessageUnlocked` and store it on the local closure for later use. The wrapper's body should simply forward `options` to the unlocked function.

Update `processInboundMessageUnlocked` similarly to accept and surface the value into the local scope where `flow`/`step` are set. Do **not** consume it yet — that happens in A.3.

- [ ] **Step 5: Run the existing webhook tests**

Run: `cd "$REPO/field-service" && pnpm test --run app/api/webhooks/whatsapp 2>&1 | tail -10`
Expected: existing tests still pass; no test references the new parameter yet.

- [ ] **Step 6: Run typecheck**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git -C "$REPO" add field-service/app/api/webhooks/whatsapp/route.ts field-service/lib/whatsapp-bot.ts
git -C "$REPO" commit -m "feat(whatsapp): capture sender profile name from webhook payload"
```

### Task A.3: Plumb `senderProfileName` into `FlowContext`

**Files:**
- Modify: `field-service/lib/whatsapp-flows/types.ts`
- Modify: `field-service/lib/whatsapp-bot.ts`

- [ ] **Step 1: Extend `FlowContext`**

In `field-service/lib/whatsapp-flows/types.ts`, find the `FlowContext` interface/type and add:

```typescript
  /**
   * The sender's WhatsApp profile name, lifted from `value.contacts[0].profile.name`
   * on the inbound webhook payload. Used by the registration name step to offer
   * a one-tap default. May be undefined if WhatsApp did not include it.
   */
  senderProfileName?: string
```

- [ ] **Step 2: Populate it where `FlowContext` is built in `lib/whatsapp-bot.ts`**

Search `lib/whatsapp-bot.ts` for the place where the `ctx`/`FlowContext` object is constructed before being passed to flow handlers (look for `phone, step, reply, data` literal). Add `senderProfileName: options?.senderProfileName` to that object literal.

- [ ] **Step 3: Run typecheck**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-flows/types.ts field-service/lib/whatsapp-bot.ts
git -C "$REPO" commit -m "feat(whatsapp): plumb senderProfileName through FlowContext"
```

### Task A.4: Update the name prompt — privacy framing + profile-name shortcut

**Files:**
- Create: `field-service/__tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts`
- Modify: `field-service/lib/whatsapp-flows/registration.ts`

- [ ] **Step 1: Write the failing test for the new prompt**

Create `field-service/__tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { conversation: { findUnique: vi.fn().mockResolvedValue({ data: {} }) } },
}))

const sendText = vi.fn().mockResolvedValue(undefined)
const sendButtons = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText,
  sendButtons,
  sendList: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return { ...actual, isEnabled: vi.fn().mockResolvedValue(true) }
})

import { handleRegistrationFlow } from '@/lib/whatsapp-flows/registration'
import type { FlowContext } from '@/lib/whatsapp-flows/types'

function ctx(overrides: Partial<FlowContext> = {}): FlowContext {
  return {
    phone: '+27820000001',
    step: 'reg_collect_name',
    reply: { type: 'text', text: '', id: 'reg_start' },
    data: {},
    senderProfileName: 'Lebogang Mafoko',
    ...overrides,
  } as FlowContext
}

describe('reg_collect_name profile-name shortcut', () => {
  beforeEach(() => {
    sendText.mockClear()
    sendButtons.mockClear()
  })

  it('offers the WhatsApp profile name as a one-tap button when available', async () => {
    await handleRegistrationFlow(ctx())
    expect(sendButtons).toHaveBeenCalledTimes(1)
    const [phone, body, buttons] = sendButtons.mock.calls[0]
    expect(phone).toBe('+27820000001')
    expect(body).toMatch(/only use this/i) // privacy framing line
    expect(buttons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'name_use_wa', title: expect.stringContaining('Lebogang') }),
        expect.objectContaining({ id: 'name_enter_different', title: expect.stringMatching(/different/i) }),
      ]),
    )
  })

  it('falls back to the legacy text prompt when no profile name is available', async () => {
    await handleRegistrationFlow(ctx({ senderProfileName: undefined }))
    expect(sendText).toHaveBeenCalledWith('+27820000001', expect.stringMatching(/full name/i))
    expect(sendButtons).not.toHaveBeenCalled()
  })

  it('saves the chosen profile name and advances to verification when name_use_wa is tapped', async () => {
    const result = await handleRegistrationFlow(
      ctx({
        step: 'reg_collect_skills',
        reply: { type: 'interactive', text: '', id: 'name_use_wa' },
        senderProfileName: 'Lebogang Mafoko',
      }),
    )
    expect(result.nextStep).toBe('reg_collect_id')
    expect(result.nextData?.name).toBe('Lebogang Mafoko')
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts 2>&1 | tail -15`
Expected: all three tests fail because the handler still sends the old text prompt and does not recognise the new button IDs.

- [ ] **Step 3: Update the `reg_collect_name` prompt in `registration.ts`**

In `field-service/lib/whatsapp-flows/registration.ts`, locate the existing block at lines 548–551:

```typescript
  if (ctx.reply.id === 'reg_start' || ctx.step === 'reg_collect_name') {
    await sendText(ctx.phone, '👤 What is your *full name*?\n\n_(Type and send your name)_')
    return { nextStep: 'reg_collect_skills' }
  }
```

Replace it with the flagged branch below. Note: this handler lives inside `startRegistration()` (or wherever line 548 currently lives in your file — the surrounding function). The new code requires importing `isEnabled` at the top of the file if it's not already imported:

```typescript
  if (ctx.reply.id === 'reg_start' || ctx.step === 'reg_collect_name') {
    const profileNameEnabled = await isEnabled('whatsapp.registration.name_profile_shortcut')
    const profileName = ctx.senderProfileName?.trim()

    if (profileNameEnabled && profileName && profileName.length >= 2) {
      await sendButtons(
        ctx.phone,
        [
          "👤 Let's start with your name.",
          '',
          'We only use this to set up your provider profile — customers see your name once you accept a job.',
          '',
          `WhatsApp shows your name as *${profileName}*. Use that, or type a different one?`,
        ].join('\n'),
        [
          { id: 'name_use_wa',           title: `✅ Use "${profileName.split(' ')[0].slice(0, 18)}"` },
          { id: 'name_enter_different',  title: '✏️ Enter a different name' },
        ],
      )
      return { nextStep: 'reg_collect_skills' }
    }

    await sendText(
      ctx.phone,
      "👤 What is your *name*?\n\nWe only use this to set up your provider profile — customers see your name once you accept a job.\n\n_(Type and send your name)_",
    )
    return { nextStep: 'reg_collect_skills' }
  }
```

If `isEnabled` is not already imported in this file, add at the top:

```typescript
import { isEnabled } from '@/lib/flags'
```

- [ ] **Step 4: Handle the new button IDs in `handleCollectSkills`**

The handler that processes the reply at step `reg_collect_skills` is `handleCollectSkills` at line 556 (despite the name, it processes the user's reply at the name step — yes, the naming is misleading; do not rename in this PR). Modify it so that:
- `reply.id === 'name_use_wa'` adopts `ctx.senderProfileName` as the name.
- `reply.id === 'name_enter_different'` re-sends the legacy text prompt and stays on `reg_collect_skills`.

Replace the current body of `handleCollectSkills` (lines 556–571) with:

```typescript
async function handleCollectSkills(ctx: FlowContext): Promise<FlowResult> {
  // Profile-name shortcut: user tapped "Use <WA name>"
  if (ctx.reply.id === 'name_use_wa') {
    const name = ctx.senderProfileName?.trim()
    if (!name || name.length < 2) {
      await sendText(ctx.phone, 'Please type your full name (at least 2 characters).')
      return { nextStep: 'reg_collect_skills' }
    }
    if (ctx.data.verificationMethod || ctx.data.providerIdNumber || ctx.data.verificationDocAttachmentId) {
      await sendText(ctx.phone, buildSkillPromptText(`👤 Name updated to *${name}*.\n\n🔧 *What type of work do you do?*`))
      return { nextStep: 'reg_collect_skills_more', nextData: { name } }
    }
    await sendVerificationChoicePrompt(ctx.phone)
    return { nextStep: 'reg_collect_id', nextData: { name } }
  }

  // Profile-name shortcut: user tapped "Enter a different name" — re-prompt with the bare text question
  if (ctx.reply.id === 'name_enter_different') {
    await sendText(ctx.phone, '👤 Type your name and send it as a message.')
    return { nextStep: 'reg_collect_skills' }
  }

  // Legacy text path
  const name = ctx.reply.text
  if (!name || name.length < 2) {
    await sendText(ctx.phone, 'Please type your full name (at least 2 characters).')
    return { nextStep: 'reg_collect_skills' }
  }

  if (ctx.data.verificationMethod || ctx.data.providerIdNumber || ctx.data.verificationDocAttachmentId) {
    await sendText(ctx.phone, buildSkillPromptText(`👤 Name updated to *${name}*.\n\n🔧 *What type of work do you do?*`))
    return { nextStep: 'reg_collect_skills_more', nextData: { name } }
  }

  await sendVerificationChoicePrompt(ctx.phone)
  return { nextStep: 'reg_collect_id', nextData: { name } }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts 2>&1 | tail -15`
Expected: all three tests pass.

- [ ] **Step 6: Run the existing registration test suite**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration 2>&1 | tail -20`
Expected: existing tests still pass — the legacy text path is preserved.

- [ ] **Step 7: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-flows/registration.ts field-service/__tests__/lib/whatsapp-flows/registration-name-shortcut.test.ts
git -C "$REPO" commit -m "feat(whatsapp): name prompt shortcut using WA profile name behind flag"
```

---

## Workstream B — Deep-link routing for ad traffic

**Hypothesis:** 5 of 14 stuck phones sent a generic greeting (often a single "Hi") that arrived from the Meta boost CTA, hit the welcome menu, and stalled. The Meta CTA "Click to WhatsApp" supports a prefilled message string. If we set it to a deterministic token (e.g. `Register provider`) and the bot detects that token on the first inbound message, we can skip the welcome menu and jump straight to `reg_start`.

### Task B.1: Register feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [ ] **Step 1: Add the flag**

Inside the WhatsApp registration group added in Task A.1, append:

```typescript
  'whatsapp.registration.deeplink': {
    description: 'Detect ad-driven prefilled-message tokens and jump straight into reg_start, bypassing the welcome menu.',
    owner: 'prod',
    defaultValue: false,
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C "$REPO" add field-service/lib/feature-flags-registry.ts
git -C "$REPO" commit -m "feat(flags): add whatsapp.registration.deeplink"
```

### Task B.2: Add deep-link token matcher

**Files:**
- Create: `field-service/lib/whatsapp-deeplinks.ts`
- Create: `field-service/__tests__/lib/whatsapp-deeplinks.test.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/whatsapp-deeplinks.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { matchDeeplink, DEEPLINK_TOKENS } from '@/lib/whatsapp-deeplinks'

describe('matchDeeplink', () => {
  it('matches the canonical register-provider token, case-insensitive, trimmed', () => {
    expect(matchDeeplink('Register provider')).toBe('register_provider')
    expect(matchDeeplink('register provider')).toBe('register_provider')
    expect(matchDeeplink('  REGISTER PROVIDER  ')).toBe('register_provider')
  })

  it('matches when the token is followed by trailing content', () => {
    // Meta sometimes appends locale tokens or emoji; match should be prefix-tolerant.
    expect(matchDeeplink('Register provider 🛠️')).toBe('register_provider')
  })

  it('returns null for unrelated text', () => {
    expect(matchDeeplink('Hi')).toBeNull()
    expect(matchDeeplink('I want to book a plumber')).toBeNull()
    expect(matchDeeplink('')).toBeNull()
    expect(matchDeeplink(null)).toBeNull()
    expect(matchDeeplink(undefined)).toBeNull()
  })

  it('exports the canonical token list so the ops doc can stay in sync', () => {
    expect(DEEPLINK_TOKENS.register_provider).toBe('Register provider')
  })
})
```

- [ ] **Step 2: Run to confirm it fails**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-deeplinks.test.ts 2>&1 | tail -10`
Expected: fails with "Cannot find module '@/lib/whatsapp-deeplinks'".

- [ ] **Step 3: Create the module**

Create `field-service/lib/whatsapp-deeplinks.ts`:

```typescript
/**
 * Deep-link tokens used by Meta "Click to WhatsApp" CTAs to route ad-driven
 * traffic past the welcome menu.
 *
 * To ship a new ad campaign:
 *   1. Pick a token from DEEPLINK_TOKENS (or add a new entry).
 *   2. In Meta Ads Manager, set the WhatsApp message prefill to the *value*
 *      (e.g. "Register provider").
 *   3. Confirm the bot routes correctly in lib/whatsapp-bot.ts by checking
 *      that matchDeeplink(rawText) returns the expected key for incoming
 *      first messages from the ad.
 *
 * Matching is case-insensitive and prefix-tolerant: we accept exact text or
 * the token followed by trailing whitespace / emoji / locale suffix.
 */

export const DEEPLINK_TOKENS = {
  register_provider: 'Register provider',
} as const

export type DeeplinkKey = keyof typeof DEEPLINK_TOKENS

export function matchDeeplink(rawText: string | null | undefined): DeeplinkKey | null {
  if (!rawText) return null
  const normalized = rawText.trim().toLowerCase()
  if (!normalized) return null
  for (const [key, token] of Object.entries(DEEPLINK_TOKENS) as [DeeplinkKey, string][]) {
    const needle = token.toLowerCase()
    if (normalized === needle || normalized.startsWith(needle + ' ') || normalized.startsWith(needle + '\n')) {
      return key
    }
  }
  return null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-deeplinks.test.ts 2>&1 | tail -10`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-deeplinks.ts field-service/__tests__/lib/whatsapp-deeplinks.test.ts
git -C "$REPO" commit -m "feat(whatsapp): add deep-link token matcher for ad-driven traffic"
```

### Task B.3: Wire the matcher into the bot dispatcher

**Files:**
- Modify: `field-service/lib/whatsapp-bot.ts`

- [ ] **Step 1: Add the import**

In `field-service/lib/whatsapp-bot.ts` near the other `./whatsapp-flows/*` imports, add:

```typescript
import { matchDeeplink } from './whatsapp-deeplinks'
```

- [ ] **Step 2: Inject the deep-link branch BEFORE the existing trigger detection**

Locate line ~1159 where `const isReset = RESET_KEYWORDS.some(…)` begins. Immediately above that line, insert:

```typescript
    // Deep-link from a Meta ad CTA → jump straight into reg_start
    // (skips the welcome menu). Only fires when the conversation is idle
    // and the flag is on. Flag-gated, so this is a no-op until flipped.
    if (
      conversation.flow === 'idle' &&
      await isEnabled('whatsapp.registration.deeplink')
    ) {
      const deeplink = matchDeeplink(rawText)
      if (deeplink === 'register_provider') {
        console.info('[whatsapp-bot] deeplink matched', {
          phone: maskedPhone(phone),
          token: deeplink,
          messageId: message.id,
        })
        const result = await handleRegistrationFlow({
          phone,
          step: 'reg_collect_name',
          reply: { type: 'interactive', text: '', id: 'reg_start' },
          data: {},
          senderProfileName: options?.senderProfileName,
        })
        await saveConversation({
          phone,
          flow: 'registration',
          step: result.nextStep,
          data: result.nextData ?? {},
        })
        return
      }
    }
```

Note: `handleRegistrationFlow`, `saveConversation`, `maskedPhone`, and `isEnabled` should already be imported in this file from prior tasks / existing code.

- [ ] **Step 3: Add an integration-style test**

Append to `field-service/__tests__/lib/whatsapp-deeplinks.test.ts` (the existing test file from B.2):

```typescript
import { matchDeeplink } from '@/lib/whatsapp-deeplinks'

describe('matchDeeplink integration shape', () => {
  it('returns null for whitespace-only input — guard against the welcome menu being skipped on a stray space', () => {
    expect(matchDeeplink(' ')).toBeNull()
    expect(matchDeeplink('\n')).toBeNull()
  })
})
```

(A full bot-dispatcher integration test would require mocking the entire bot context, which is out of scope here. The unit-level matcher test plus a manual staging-WhatsApp smoke covers the change.)

- [ ] **Step 4: Run unit tests + typecheck**

Run:
```bash
cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-deeplinks.test.ts 2>&1 | tail -10
cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5
```
Expected: tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-bot.ts field-service/__tests__/lib/whatsapp-deeplinks.test.ts
git -C "$REPO" commit -m "feat(whatsapp): wire deep-link matcher into bot dispatcher behind flag"
```

### Task B.4: Document the Meta CTA prefilled message

**Files:**
- Create: `field-service/docs/whatsapp-ad-deeplink-cta.md`

- [ ] **Step 1: Write the op doc**

Create `field-service/docs/whatsapp-ad-deeplink-cta.md`:

```markdown
# WhatsApp Ad CTA — Deep-Link Prefilled Message

When boosting a Plug A Pro provider-acquisition post on Facebook/Instagram with
the "Send WhatsApp message" CTA, paste the prefilled-message string below.

The bot's deep-link matcher recognises this token, skips the generic welcome
menu, and routes the user directly into the registration flow.

## Token

```
Register provider
```

Casing and trailing emoji are tolerated. Do not change the wording without
updating `DEEPLINK_TOKENS` in `lib/whatsapp-deeplinks.ts`.

## How to verify it's working

1. Click your live boost or test ad → "Send Message" → WhatsApp opens with the
   prefilled text "Register provider".
2. Send the message.
3. The bot should reply with the registration name prompt (Workstream A copy),
   NOT the generic welcome menu.

If the bot replies with the welcome menu instead, check:
- `whatsapp.registration.deeplink` flag is enabled in production.
- The prefilled message contains the exact token "Register provider".
```

- [ ] **Step 2: Commit**

```bash
git -C "$REPO" add field-service/docs/whatsapp-ad-deeplink-cta.md
git -C "$REPO" commit -m "docs(whatsapp): how to set the Meta ad CTA prefilled message"
```

---

## Workstream C — Evidence step: prominent skip + post-submit upload-later

**Hypothesis:** The 1 near-miss (`…8239`, 29 fields filled, walked away at `reg_collect_evidence`) hit a 3-button choice — "Add proof note / Upload proof / Skip for now" — where "Skip" was visually third. WhatsApp's interactive button list shows all three at equal weight. Reordering "Skip" to position 1 in the non-high-risk path makes the friction-free path the obvious one. For high-risk skills we still surface the upload options first because regulatory review benefits from proof.

After submission, a 24-hour follow-up text invites them to add a work photo when they're back at a computer / on Wi-Fi.

### Task C.1: Register feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [ ] **Step 1: Add the flag**

```typescript
  'whatsapp.registration.evidence_skip_primary': {
    description: 'Show "Skip for now" as the primary (first) button on the evidence step for non-high-risk skills; send a 24h upload-later follow-up.',
    owner: 'prod',
    defaultValue: false,
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C "$REPO" add field-service/lib/feature-flags-registry.ts
git -C "$REPO" commit -m "feat(flags): add whatsapp.registration.evidence_skip_primary"
```

### Task C.2: Reorder evidence buttons for non-high-risk path

**Files:**
- Modify: `field-service/lib/whatsapp-flows/registration.ts`
- Create: `field-service/__tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  db: { conversation: { findUnique: vi.fn().mockResolvedValue({ data: {} }) } },
}))

const sendButtons = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/whatsapp-interactive', () => ({
  sendText: vi.fn().mockResolvedValue(undefined),
  sendButtons,
  sendList: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return { ...actual, isEnabled: vi.fn().mockResolvedValue(true) }
})

import { sendEvidencePrompt } from '@/lib/whatsapp-flows/registration'

describe('evidence prompt (non-high-risk path)', () => {
  beforeEach(() => sendButtons.mockClear())

  it('lists Skip for now as the first button', async () => {
    await sendEvidencePrompt('+27820000002', { skills: ['plumbing'] }, {})
    const [, , buttons] = sendButtons.mock.calls[0]
    expect(buttons[0].id).toBe('evidence_skip')
    expect(buttons[0].title).toMatch(/skip/i)
  })

  it('keeps Add proof note as a secondary option', async () => {
    await sendEvidencePrompt('+27820000002', { skills: ['plumbing'] }, {})
    const [, , buttons] = sendButtons.mock.calls[0]
    expect(buttons.find((b: { id: string }) => b.id === 'evidence_add')).toBeDefined()
  })
})
```

The test imports `sendEvidencePrompt` — which doesn't exist as an export today. The current implementation has the prompt inlined at lines 2181–2192 inside an unnamed function. The test calls for extracting that into an exported helper. That extraction is the test-driven refactor in Step 3.

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts 2>&1 | tail -10`
Expected: fails — `sendEvidencePrompt` is not exported.

- [ ] **Step 3: Extract `sendEvidencePrompt` and reorder buttons**

In `field-service/lib/whatsapp-flows/registration.ts`, lines 2181–2193, replace:

```typescript
  await sendButtons(
    ctx.phone,
    [
      '🧾 Would you like to add an optional work note?',
      '',
      'Examples: past jobs, references or types of repairs you have done. This stays provider-supplied unless Plug A Pro says a specific item was reviewed.',
    ].join('\n'),
    [
      { id: 'evidence_add', title: '✍🏽 Add proof note' },
      { id: 'evidence_skip', title: '⏭️ Skip for now' },
    ],
  )
  return { nextStep: 'reg_collect_evidence', nextData }
```

with:

```typescript
  await sendEvidencePrompt(ctx.phone, ctx.data, nextData)
  return { nextStep: 'reg_collect_evidence', nextData }
```

Then add this exported helper near the bottom of the file (or near the other prompt helpers; keep it adjacent to `sendVerificationChoicePrompt` for grep-ability):

```typescript
/**
 * Sends the evidence-step prompt. For non-high-risk skill sets, surfaces
 * "Skip for now" as the primary (first) button when the
 * whatsapp.registration.evidence_skip_primary flag is enabled.
 */
export async function sendEvidencePrompt(
  phone: string,
  data: ConversationData,
  _nextData: Partial<ConversationData>,
): Promise<void> {
  const skipPrimary = await isEnabled('whatsapp.registration.evidence_skip_primary')

  const buttons = skipPrimary
    ? [
        { id: 'evidence_skip', title: '⏭️ Skip for now' },
        { id: 'evidence_add',  title: '✍🏽 Add a work note' },
      ]
    : [
        { id: 'evidence_add',  title: '✍🏽 Add proof note' },
        { id: 'evidence_skip', title: '⏭️ Skip for now' },
      ]

  await sendButtons(
    phone,
    [
      '🧾 Optional: add a short work note or skip and continue.',
      '',
      'Most providers skip this step and add photos later. Notes here help our review team but are not required.',
    ].join('\n'),
    buttons,
  )
}
```

Note: `ConversationData` should already be imported in this file (look near `FlowContext`). If not, add it.

- [ ] **Step 4: Run the test to verify pass**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts 2>&1 | tail -10`
Expected: both tests pass.

- [ ] **Step 5: Run the full registration test suite**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-flows/registration 2>&1 | tail -20`
Expected: existing tests still pass — the flag is off in test env unless explicitly mocked.

- [ ] **Step 6: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-flows/registration.ts field-service/__tests__/lib/whatsapp-flows/registration-evidence-skip.test.ts
git -C "$REPO" commit -m "feat(whatsapp): make Skip primary on evidence step (non-high-risk) behind flag"
```

### Task C.3: 24h follow-up "add a work photo" template

The proper post-submit nudge is a WhatsApp template message because the 24h freeform session window is closed by then. **This task only adds the registry entry and the send helper** — the template itself must be created and approved in Meta Business Manager (Task E.2 instructions apply: roughly 24–72h turnaround).

Defer the production-grade send (i.e. calling the helper from somewhere after PENDING submission) to a follow-up PR once the template is APPROVED. This keeps the current PR shippable and removes a blocking dependency.

**Files:**
- Modify: `field-service/lib/messaging-templates.ts`

- [ ] **Step 1: Add the template registry entry**

In `field-service/lib/messaging-templates.ts`, inside `export const TEMPLATES = { … }`, add:

```typescript
  provider_evidence_followup: {
    name: 'provider_evidence_followup',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent 24h after PENDING ProviderApplication submission, inviting the provider to add a work photo. UTILITY because it relates to the in-progress application.',
    // {{1}} provider first name
    example:
      'Hi {{1}}, want to strengthen your Plug A Pro profile? Tap below to add one work photo. Skip is fine — we already have your application.',
  },
```

- [ ] **Step 2: Typecheck**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C "$REPO" add field-service/lib/messaging-templates.ts
git -C "$REPO" commit -m "feat(whatsapp): register provider_evidence_followup template (pending Meta approval)"
```

- [ ] **Step 4: File a TODO for the send wiring**

Open the project board and create a follow-up issue titled "Wire provider_evidence_followup template into post-submit cron" with description: "Once Meta approves provider_evidence_followup, add a daily cron at `app/api/cron/evidence-followup/route.ts` that selects PENDING ProviderApplication rows submitted exactly 24h ago and sends the template via `sendTemplate({ to, template: 'provider_evidence_followup', components: [...] })`."

(No code in this step — just a tracking issue.)

---

## Workstream D — Flow-switch state isolation

**Hypothesis:** Phone `…6621` started a customer `job_request` flow, then switched to `registration`, and the `Conversation.data` JSON kept `category`, `addressLine1`, `addressStreet`, `isFirstBooking`, `selectedCategory`, `addrProvinceKey`, `addrProvinceLabel`. This polluted the registration session. Root cause: the central persistence function `saveConversation` at `lib/whatsapp-bot.ts:2353` writes `data` verbatim, and the main dispatcher at `lib/whatsapp-bot.ts:2297` merges old data into new data unconditionally (`{ ...data, ...(result.nextData ?? {}) }`).

Fix: when `flow` changes between save calls, strip keys that are not in the target flow's whitelist.

### Task D.1: Register feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [ ] **Step 1: Add the flag**

```typescript
  'whatsapp.flow_switch_data_clear': {
    description: 'On Conversation.flow change, strip data keys not whitelisted for the target flow. Prevents customer-flow keys polluting registration sessions.',
    owner: 'eng',
    defaultValue: false,
  },
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "$REPO/field-service" && pnpm exec tsc --noEmit
git -C "$REPO" add field-service/lib/feature-flags-registry.ts
git -C "$REPO" commit -m "feat(flags): add whatsapp.flow_switch_data_clear"
```

### Task D.2: Build `clearIncompatibleFlowData`

**Files:**
- Create: `field-service/lib/whatsapp-conversation-state.ts`
- Create: `field-service/__tests__/lib/whatsapp-conversation-state.test.ts`

- [ ] **Step 1: Write the failing test**

Create `field-service/__tests__/lib/whatsapp-conversation-state.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { clearIncompatibleFlowData } from '@/lib/whatsapp-conversation-state'
import type { FlowName } from '@/lib/whatsapp-flows/types'

describe('clearIncompatibleFlowData', () => {
  it('preserves data when flow does not change', () => {
    const out = clearIncompatibleFlowData('registration', 'registration', {
      name: 'Lebo', skills: ['plumbing'], category: 'plumbing',
    })
    expect(out).toEqual({ name: 'Lebo', skills: ['plumbing'], category: 'plumbing' })
  })

  it('strips customer-flow keys when switching from job_request to registration', () => {
    const out = clearIncompatibleFlowData('job_request', 'registration', {
      category: 'plumbing',
      addressLine1: '12 Long St',
      addressStreet: 'Long St',
      isFirstBooking: true,
      selectedCategory: 'plumbing',
      addrProvinceKey: 'gauteng',
      addrProvinceLabel: 'Gauteng',
      customerName: 'Lebo',
      name: 'Lebo',
    })
    expect(out).toEqual({ name: 'Lebo' })
  })

  it('strips registration-flow keys when switching to job_request', () => {
    const out = clearIncompatibleFlowData('registration', 'job_request', {
      name: 'Lebo',
      skills: ['plumbing'],
      verificationMethod: 'id_number',
      providerIdNumber: '0000000000000',
      category: 'plumbing',
    })
    expect(out).toEqual({ category: 'plumbing' })
  })

  it('returns an empty object when target flow has no whitelist intersection', () => {
    const out = clearIncompatibleFlowData('registration', 'idle' as FlowName, {
      name: 'Lebo', skills: ['plumbing'],
    })
    // idle whitelist allows continuation keys only
    expect(out).toEqual({})
  })

  it('is a no-op when input is empty', () => {
    expect(clearIncompatibleFlowData('idle', 'registration', {})).toEqual({})
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-conversation-state.test.ts 2>&1 | tail -10`
Expected: fails with module-not-found.

- [ ] **Step 3: Create the module**

Create `field-service/lib/whatsapp-conversation-state.ts`:

```typescript
import type { FlowName, ConversationData } from './whatsapp-flows/types'

/**
 * Per-flow data key whitelist. Keys not listed for the target flow are stripped
 * when transitioning. Conservative: when in doubt, add the key to the relevant
 * whitelist rather than relying on the strip.
 *
 * Keep this in sync with what each flow handler actually reads from ctx.data.
 */
const FLOW_DATA_WHITELIST: Record<FlowName, ReadonlyArray<string>> = {
  idle: [
    // Continuation hints used by the welcome handler to recognise a returning user
    // mid-task. Keep small.
    'customerName',
  ],
  registration: [
    'name', 'skills', 'serviceAreas', 'province', 'provinceKey', 'regionId', 'regionLabel',
    'selectedRegionLabels', 'selectedRegionStatus', 'selectedSuburbLabels', 'locationNodeIds',
    'city', 'cityId', 'suburbPage', 'suburbOptions',
    'verificationMethod', 'providerIdNumber', 'verificationDocAttachmentId',
    'experience', 'availability',
    'callOutFee', 'hourlyRate', 'rateNegotiable', 'hourlyRateSkipped',
    'providerBio', 'providerBioSkipped',
    'profilePhotoSkipped',
    'reference1Name', 'reference1Mobile', 'reference2Name', 'reference2Mobile',
    'preferredLanguage', 'alternateMobileE164',
    'highRiskServiceLabels',
    'evidenceFileUrls', 'evidenceMediaIds',
    'certificationProofIntent', 'certificationProofAttachmentIds', 'certificationProofMediaIds',
    'providerEmail',
  ],
  job_request: [
    'category', 'selectedCategory',
    'addressLine1', 'addressStreet', 'addrProvinceKey', 'addrProvinceLabel', 'addrPage',
    'isFirstBooking',
    'customerName',
  ],
  status: ['customerName'],
  help: [],
  reschedule: ['bookingId', 'customerName'],
  cancel: ['bookingId', 'customerName'],
  provider_journey: ['providerId', 'pj_pause_until'],
  provider_job: ['jobId'],
}

export function clearIncompatibleFlowData(
  fromFlow: FlowName,
  toFlow: FlowName,
  data: ConversationData,
): ConversationData {
  if (fromFlow === toFlow) return data
  const allowed = new Set(FLOW_DATA_WHITELIST[toFlow] ?? [])
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    if (allowed.has(key)) out[key] = value
  }
  return out as ConversationData
}
```

If the `FlowName` union in `lib/whatsapp-flows/types.ts` includes additional names not listed above, add them. The TypeScript compiler will tell you which ones are missing (the `Record<FlowName, …>` makes the mapping exhaustive).

- [ ] **Step 4: Run the test**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp-conversation-state.test.ts 2>&1 | tail -10`
Expected: all five tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-conversation-state.ts field-service/__tests__/lib/whatsapp-conversation-state.test.ts
git -C "$REPO" commit -m "feat(whatsapp): add clearIncompatibleFlowData helper for flow-switch state isolation"
```

### Task D.3: Wire the helper into `saveConversation`

**Files:**
- Modify: `field-service/lib/whatsapp-bot.ts`

- [ ] **Step 1: Add the import**

Near the top of `lib/whatsapp-bot.ts`, with the other internal imports:

```typescript
import { clearIncompatibleFlowData } from './whatsapp-conversation-state'
```

- [ ] **Step 2: Modify `saveConversation` to strip on flow change**

`saveConversation` is at line 2353. Change its `update` clause so it strips incompatible keys when the flow is changing. Replace the body of `saveConversation` (lines 2353–2379) with:

```typescript
async function saveConversation(params: {
  phone: string
  flow: FlowName
  step: FlowStep
  data: ConversationData
}): Promise<void> {
  const cohort = createTestCohortContext(params.phone)
  const stripEnabled = await isEnabled('whatsapp.flow_switch_data_clear')

  // Load the existing flow so we can decide whether this is a transition.
  // upsert below covers the "no row exists" path.
  let existingFlow: FlowName | null = null
  if (stripEnabled) {
    const existing = await db.conversation.findUnique({
      where: { phone: params.phone },
      select: { flow: true },
    })
    existingFlow = (existing?.flow as FlowName | undefined) ?? null
  }

  const dataToWrite = stripEnabled && existingFlow && existingFlow !== params.flow
    ? clearIncompatibleFlowData(existingFlow, params.flow, params.data)
    : params.data

  await db.conversation.upsert({
    where: { phone: params.phone },
    create: {
      phone: params.phone,
      flow: params.flow,
      step: params.step,
      data: dataToWrite as Prisma.InputJsonValue,
      isTestSession: cohort.isTestUser,
      cohortName: cohort.cohortName,
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
    update: {
      flow: params.flow,
      step: params.step,
      data: dataToWrite as Prisma.InputJsonValue,
      ...(cohort.isTestUser ? { isTestSession: true, cohortName: cohort.cohortName } : {}),
      expiresAt: new Date(Date.now() + CONVERSATION_TTL_MS),
    },
  })
}
```

- [ ] **Step 3: Verify by reading the merge site at line 2297**

The dispatcher at line ~2297 does `{ ...data, ...(result.nextData ?? {}) }`. With the new `saveConversation` enforcement, the strip happens *just before write*. No change required at the merge site.

- [ ] **Step 4: Typecheck + existing tests**

Run:
```bash
cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -5
cd "$REPO/field-service" && pnpm test --run __tests__/lib/whatsapp 2>&1 | tail -20
```
Expected: no type errors; existing tests pass. Flag is off in test env, so behaviour is unchanged unless mocked.

- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add field-service/lib/whatsapp-bot.ts
git -C "$REPO" commit -m "feat(whatsapp): strip incompatible Conversation.data on flow change (flagged)"
```

---

## Workstream E — Pre-expiry "continue where you left off" warning

**Hypothesis:** 12 of 14 stuck sessions are past `expiresAt`. The existing `app/api/cron/session-timeout/route.ts` fires every 20 min (per `vercel.json`) and sends an *after-expiry* freeform message that, on real boost-day data, never arrived in time to rescue mid-flow drops. A *pre-expiry* warning at ~5 minutes before TTL, when the freeform 24h session is still open, is much more rescuable.

### Task E.1: Register feature flag

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`

- [ ] **Step 1: Add the flag**

```typescript
  'whatsapp.session_prewarning': {
    description: 'Send a pre-expiry "continue where you left off" message ~5 min before Conversation.expiresAt for mid-flow sessions.',
    owner: 'prod',
    defaultValue: false,
  },
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "$REPO/field-service" && pnpm exec tsc --noEmit
git -C "$REPO" add field-service/lib/feature-flags-registry.ts
git -C "$REPO" commit -m "feat(flags): add whatsapp.session_prewarning"
```

### Task E.2: Submit the WhatsApp template to Meta (manual)

**This task is not code — it's an ops step.** Templates take 24–72h to be approved. Submit on day 1 of plan execution so it's likely approved by the time E.4–E.5 are merged.

- [ ] **Step 1: Submit `provider_registration_continue` template in Meta Business Manager**

Submit a new template with these properties:

- **Name:** `provider_registration_continue`
- **Category:** UTILITY
- **Language:** `en_ZA`
- **Body:** `Hi {{1}}, you're almost done with your Plug A Pro provider application. Your progress is saved — tap below to pick up where you left off before the session times out.`
- **Buttons:** one quick-reply, label `▶️ Continue application`, payload `reg_start`

- [ ] **Step 2: Capture the submission timestamp**

Record the submission time in the project board. The cron in E.4 fails closed (no send) if the template is not approved at deploy time.

### Task E.3: Add the template registry entry

**Files:**
- Modify: `field-service/lib/messaging-templates.ts`

- [ ] **Step 1: Register the template**

Add to `field-service/lib/messaging-templates.ts` inside `TEMPLATES`:

```typescript
  provider_registration_continue: {
    name: 'provider_registration_continue',
    language: 'en_ZA',
    category: 'UTILITY',
    description: 'Sent ~5 min before Conversation.expiresAt to rescue mid-flow registration sessions. The quick-reply button payload "reg_start" triggers the existing registration resume path.',
    // {{1}} provider first name (fall back to "there" if unknown)
    example:
      "Hi {{1}}, you're almost done with your Plug A Pro provider application. Your progress is saved — tap below to pick up where you left off before the session times out.",
  },
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd "$REPO/field-service" && pnpm exec tsc --noEmit
git -C "$REPO" add field-service/lib/messaging-templates.ts
git -C "$REPO" commit -m "feat(whatsapp): register provider_registration_continue template"
```

### Task E.4: Add the pre-expiry cron route

**Files:**
- Create: `field-service/app/api/cron/session-warning/route.ts`
- Create: `field-service/__tests__/app/api/cron/session-warning.test.ts`

- [ ] **Step 1: Write the failing route test**

Create `field-service/__tests__/app/api/cron/session-warning.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findManyMock = vi.fn()
const updateManyMock = vi.fn().mockResolvedValue({ count: 1 })

vi.mock('@/lib/db', () => ({
  db: {
    conversation: {
      findMany: findManyMock,
      updateMany: updateManyMock,
    },
    customer: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}))

const sendTemplateMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/whatsapp', () => ({
  sendTemplate: sendTemplateMock,
}))

vi.mock('@/lib/flags', async () => {
  const actual = await vi.importActual<typeof import('@/lib/flags')>('@/lib/flags')
  return { ...actual, isEnabled: vi.fn().mockResolvedValue(true) }
})

process.env.CRON_SECRET = 'test-secret'

import { GET } from '@/app/api/cron/session-warning/route'

describe('GET /api/cron/session-warning', () => {
  beforeEach(() => {
    findManyMock.mockReset()
    updateManyMock.mockClear()
    sendTemplateMock.mockClear()
  })

  it('rejects unauthenticated requests', async () => {
    const req = new Request('http://x/api/cron/session-warning')
    const res = await GET(req)
    expect(res.status).toBe(401)
  })

  it('sends a template to one mid-flow session about to expire', async () => {
    findManyMock.mockResolvedValueOnce([
      {
        id: 'c1',
        phone: '+27820000003',
        flow: 'registration',
        step: 'reg_collect_skills',
        data: { name: 'Lebo' },
      },
    ])

    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(sendTemplateMock).toHaveBeenCalledTimes(1)
    expect(sendTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: '+27820000003',
        template: 'provider_registration_continue',
      }),
    )
  })

  it('skips sessions where timeoutNotifiedAt is already set', async () => {
    // simulate atomic claim losing race
    updateManyMock.mockResolvedValueOnce({ count: 0 })
    findManyMock.mockResolvedValueOnce([
      { id: 'c2', phone: '+27820000004', flow: 'registration', step: 'reg_collect_name', data: {} },
    ])
    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    await GET(req)
    expect(sendTemplateMock).not.toHaveBeenCalled()
  })

  it('does nothing when the flag is disabled', async () => {
    const { isEnabled } = await import('@/lib/flags')
    ;(isEnabled as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false)
    const req = new Request('http://x/api/cron/session-warning', {
      headers: { authorization: 'Bearer test-secret' },
    })
    const res = await GET(req)
    expect(res.status).toBe(200)
    expect(findManyMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to confirm fail**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/app/api/cron/session-warning.test.ts 2>&1 | tail -15`
Expected: fails with route module not found.

- [ ] **Step 3: Create the route**

Create `field-service/app/api/cron/session-warning/route.ts`:

```typescript
// ─── Cron: WhatsApp pre-expiry registration warning ──────────────────────────
// Schedule: */5 5-20 * * * (every 5 min, 07:00-22:00 SAST)
//
// For every mid-flow registration session within 6 min of expiry, send a
// "continue" WhatsApp template message before the freeform window slams shut.
// Reuses Conversation.timeoutNotifiedAt as the atomic-claim sentinel so we
// never double-warn a session that the post-expiry cron will also touch.

import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { sendTemplate } from '@/lib/whatsapp'
import { isEnabled } from '@/lib/flags'
import { maskPhone } from '@/lib/support-diagnostics'

const WARN_LEAD_MS = 6 * 60 * 1000 // warn when expiresAt is within the next 6 minutes

const FLOWS_TO_WARN = ['registration'] as const

export async function GET(request: Request): Promise<Response> {
  const authHeader = request.headers.get('authorization')
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!(await isEnabled('whatsapp.session_prewarning'))) {
    return NextResponse.json({ skipped: 'flag_disabled' })
  }

  const reqId = crypto.randomUUID().slice(0, 8)
  const now = new Date()
  const LOCK_SENTINEL = new Date(0)
  const upperBound = new Date(now.getTime() + WARN_LEAD_MS)

  // Sessions that are still ACTIVE (expiresAt in the future) but expiring soon,
  // and have not yet been notified.
  const candidates = await db.conversation.findMany({
    where: {
      flow: { in: [...FLOWS_TO_WARN] },
      expiresAt: { gt: now, lt: upperBound },
      timeoutNotifiedAt: null,
    },
    select: { id: true, phone: true, flow: true, step: true, data: true },
  })

  let sent = 0
  let skipped = 0
  let errors = 0

  for (const conv of candidates) {
    try {
      // Atomic claim: only one cron invocation wins per session.
      const claimed = await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: null },
        data: { timeoutNotifiedAt: LOCK_SENTINEL },
      })
      if (claimed.count === 0) {
        skipped++
        continue
      }

      const firstName = resolveFirstName(conv.data)

      await sendTemplate({
        to: conv.phone,
        template: 'provider_registration_continue',
        components: [
          {
            type: 'body',
            parameters: [{ type: 'text', text: firstName }],
          },
        ],
      })

      await db.conversation.updateMany({
        where: { id: conv.id, timeoutNotifiedAt: LOCK_SENTINEL },
        data: { timeoutNotifiedAt: now },
      })

      sent++
      console.log(`[cron/session-warning:${reqId}] sent phone=${maskPhone(conv.phone)} flow=${conv.flow} step=${conv.step}`)
    } catch (err) {
      errors++
      console.error(`[cron/session-warning:${reqId}] error phone=${maskPhone(conv.phone)}:`, err)
    }
  }

  return NextResponse.json({ found: candidates.length, sent, skipped, errors })
}

function resolveFirstName(data: unknown): string {
  const d = data as Record<string, unknown> | null
  const name = (d?.name as string | undefined) ?? (d?.customerName as string | undefined)
  if (name && typeof name === 'string' && name.trim().length > 0) {
    return name.trim().split(' ')[0]
  }
  return 'there'
}
```

- [ ] **Step 4: Run the route test**

Run: `cd "$REPO/field-service" && pnpm test --run __tests__/app/api/cron/session-warning.test.ts 2>&1 | tail -15`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git -C "$REPO" add field-service/app/api/cron/session-warning/route.ts field-service/__tests__/app/api/cron/session-warning.test.ts
git -C "$REPO" commit -m "feat(whatsapp): add pre-expiry session-warning cron behind flag"
```

### Task E.5: Register the cron in `vercel.json`

**Files:**
- Modify: `field-service/vercel.json`

- [ ] **Step 1: Add the cron entry**

Open `field-service/vercel.json`. Inside the `crons` array, add (preserve the existing entries and trailing comma):

```json
    {
      "path": "/api/cron/session-warning",
      "schedule": "*/5 5-20 * * *"
    },
```

- [ ] **Step 2: Validate JSON**

Run: `cd "$REPO/field-service" && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git -C "$REPO" add field-service/vercel.json
git -C "$REPO" commit -m "chore(vercel): register session-warning cron every 5 min during business hours"
```

---

## Final integration

### Task F.1: Seed the 5 flags

**Files:**
- Modify: `field-service/scripts/seed-flags.ts`

- [ ] **Step 1: Open the seed script and locate the flag list**

The script iterates a known list of flags and calls `setFlag` on each. Find that list. If the file currently hardcodes flag keys, add the five new keys with `enabled: false`. If it iterates `FEATURE_FLAGS_REGISTRY` automatically, no change is needed.

Run: `cd "$REPO/field-service" && grep -n "setFlag\|FEATURE_FLAGS_REGISTRY" scripts/seed-flags.ts | head`

If the script iterates the registry, skip to Step 3.

- [ ] **Step 2: If hardcoded, append the new keys**

Add to the seed list:

```typescript
  'whatsapp.registration.name_profile_shortcut',
  'whatsapp.registration.deeplink',
  'whatsapp.registration.evidence_skip_primary',
  'whatsapp.flow_switch_data_clear',
  'whatsapp.session_prewarning',
```

- [ ] **Step 3: Run the seed against the dev DB**

Run: `cd "$REPO/field-service" && pnpm tsx scripts/seed-flags.ts 2>&1 | tail -10`
Expected: all five flags created (enabled=false) without error.

- [ ] **Step 4: Commit**

```bash
git -C "$REPO" add field-service/scripts/seed-flags.ts
git -C "$REPO" commit -m "chore(flags): seed five whatsapp registration friction flags as disabled"
```

### Task F.2: Pre-PR verification

**Files:** none — runs only.

- [ ] **Step 1: Full test suite**

Run: `cd "$REPO/field-service" && pnpm test --run 2>&1 | tail -20`
Expected: all tests pass.

- [ ] **Step 2: Lint**

Run: `cd "$REPO/field-service" && pnpm lint 2>&1 | tail -20`
Expected: no new errors. Pre-existing warnings allowed.

- [ ] **Step 3: Type check**

Run: `cd "$REPO/field-service" && pnpm exec tsc --noEmit 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 4: Build (smoke only)**

Run: `cd "$REPO/field-service" && pnpm build 2>&1 | tail -30`
Expected: build succeeds. Vercel cron schedule should appear in the build output if Vercel detection is wired in dev.

### Task F.3: Open the PR

**Files:** GitHub PR description only.

- [ ] **Step 1: Push the branch**

Run: `git -C "$REPO" push -u origin feat/whatsapp-registration-friction-fixes`
Expected: branch pushed.

- [ ] **Step 2: Create the PR**

Run:
```bash
gh pr create --title "feat(whatsapp): reduce provider registration drop-off — 5 flagged workstreams" --body "$(cat <<'EOF'
## Summary

Five flagged fixes for the WhatsApp provider-registration funnel, motivated by the 2026-06-04 Meta boost drop-off analysis (3 applications from 14 conversations). Each workstream ships behind its own flag and can be flipped independently.

| Workstream | Flag | Friction it targets |
|---|---|---|
| A — Name prompt shortcut | `whatsapp.registration.name_profile_shortcut` | 4 phones dropping at the bare name prompt |
| B — Deep-link routing | `whatsapp.registration.deeplink` | 5 phones stuck at idle/welcome after an ad-CTA tap |
| C — Evidence skip primary | `whatsapp.registration.evidence_skip_primary` | 1 near-miss at the file-upload step |
| D — Flow-switch data isolation | `whatsapp.flow_switch_data_clear` | The 6621 bug — customer flow keys polluted a registration session |
| E — Pre-expiry warning | `whatsapp.session_prewarning` | 12 of 14 stuck sessions expired before rescue |

Workstream E depends on the `provider_registration_continue` Meta template approval. The code is shipped; the cron exits fast when the flag is off until the template is approved.

## Test plan

- [ ] All Vitest suites green (`pnpm test --run`)
- [ ] Typecheck green (`pnpm exec tsc --noEmit`)
- [ ] Lint green (`pnpm lint`)
- [ ] Manual: enable `whatsapp.registration.name_profile_shortcut` in staging; trigger registration; verify the two-button prompt with the WA profile name appears
- [ ] Manual: enable `whatsapp.registration.deeplink` in staging; send the literal text "Register provider" from a fresh number; verify the bot jumps straight to the registration name prompt instead of showing the welcome menu
- [ ] Manual: enable `whatsapp.registration.evidence_skip_primary`; reach the evidence step with no high-risk skills; verify "Skip for now" is the first button
- [ ] Manual: enable `whatsapp.flow_switch_data_clear`; switch from job_request to registration mid-session; verify Conversation.data does not retain category/addressLine1 keys
- [ ] Manual: enable `whatsapp.session_prewarning` once Meta template is APPROVED; verify the warning fires for a session within 6 min of expiry
EOF
)"
```

### Task F.4: Staged flag flip (post-merge)

Document the rollout sequence in the PR or a follow-up issue. Order:

1. **Day 0 (merge day):** Deploy with all 5 flags OFF. Verify no behaviour change in prod logs.
2. **Day 1:** Enable `whatsapp.flow_switch_data_clear` (lowest risk; behaviour is strictly more correct). Watch error rates for 24h.
3. **Day 2:** Enable `whatsapp.registration.name_profile_shortcut`. Monitor `reg_collect_name → reg_collect_id` conversion in DB (compare to baseline taken from the 2026-06-04 boost).
4. **Day 3:** Enable `whatsapp.registration.evidence_skip_primary`. Watch `reg_collect_evidence → reg_pending` conversion.
5. **Day 4:** Update the Meta ad creative to include the prefilled message `Register provider`, then enable `whatsapp.registration.deeplink`.
6. **Day 5+ (gated on Meta template approval):** Enable `whatsapp.session_prewarning` once `provider_registration_continue` is APPROVED in Meta Business Manager.

---

## Out of scope

These items were considered and explicitly deferred:

- **"Upload later" post-submit flow.** The user can already type a media upload after submission and the bot can attach it, but there is no first-class bot intent for "I want to add a photo to my pending application." That needs design work and a new flow state machine.
- **Renaming `handleCollectSkills` to `handleCollectName`.** The function's name is misleading (it processes the name reply) but the rename touches many internal references and the existing test surface; out of scope for this PR.
- **Smoke test coverage in `e2e/smoke.spec.ts`.** The smoke suite tests admin and customer routes via HTTP. WhatsApp flows are not currently smoke-tested, and adding a smoke is a separate workstream involving Meta sandbox testing.
- **`InboundWhatsAppMessage.phone` normalisation.** The schema stores inbound phones without the `+` prefix while `Conversation.phone` and `ProviderApplication.phone` use E.164 with `+`. This discrepancy required the script fix in `ad-boost-dropoff.ts` but does not need to be normalised at the source for this PR.

## Self-review notes

- All five spec items map to a workstream above.
- Each new code path is feature-flagged per house rules.
- Each task includes failing-test → implement → pass → commit cycles where code is changed; pure ops tasks (E.2, F.4) are flagged as ops-only.
- Existing prompt copy and button IDs (`reg_start`, `evidence_skip`, etc.) are preserved as fallback paths so flags-off behaviour matches today.
- No schema migrations.
- No admin UI changes.
- All file paths are absolute or anchored at `$REPO`.

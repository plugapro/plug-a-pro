# Marketplace Onboarding Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Plug A Pro application-ready for VodaPay + FNB nav» and able to run the customer booking journey inside VodaPay's mini-program WebView (login + cashier) behind flags that default OFF.

**Architecture:** Marketing site gains the compliance pages VodaPay's checklist requires. The field-service app gains a `vodapay` channel (cookie-based runtime mode entered at `/vodapay`), a federated-login endpoint that exchanges a VodaPay auth code for a normal Supabase session, and a VodaPay cashier PSP selected per-channel. Everything is additive; two new flags gate all behavior.

**Tech Stack:** Next.js 16 App Router, Prisma/Postgres (Supabase), Supabase Auth admin API, Vitest, Playwright, node:crypto RSA-SHA256. VodaPay side: hylid-bridge JSAPI (`my.getAuthCode`, `my.tradePay`), Alipay-style open API (`/v2/authorizations/applyToken`, `/v2/customers/user/inquiryUserInfo`, `/v2/payments/pay`).

**Spec:** `docs/superpowers/specs/2026-09-07-marketplace-onboarding-readiness-design.md`

## Global Constraints

- Additive migrations only; no drops or renames (house rule 2).
- Every admin mutation goes through `crudAction()` — this plan adds none.
- New flags MUST be registered in `field-service/lib/feature-flags-registry.ts` before use; both new flags default `false`: `channel.vodapay.v1`, `payments.vodapay.v1`.
- No `as any` without a TODO (house rule 7).
- Worktree: create `worktrees/marketplace-readiness` off `origin/main` (superpowers:using-git-worktrees); all tasks run there. Marketing tasks touch `marketing/`, app tasks touch `field-service/`.
- Commit format: conventional commits; end body with the session attribution trailer currently in effect.
- Unit tests: `cd field-service && npx vitest run <path>`. Full suite must stay green: `npx vitest run`.
- Never echo secrets; env vars set with `printf '%s' 'VALUE' | vercel env add NAME production`.
- `WorkflowEvent.eventType` is a Prisma enum — this plan adds NO new event types, only new `source` string values.
- PII guard: never put phone/email/name into `recordWorkflowEvent` metadata.

---

### Task 1: W0 application pack (docs only)

**Files:**
- Create: `docs/ops/marketplace-onboarding/identity-pack.md`
- Create: `docs/ops/marketplace-onboarding/vodapay-application.md`
- Create: `docs/ops/marketplace-onboarding/fnb-nav-listing.md`
- Create: `docs/ops/marketplace-onboarding/capitec-pay.md`

**Interfaces:**
- Consumes: research doc `docs/strategy/2026-09-07-super-app-listing-research.md` (§2 requirements, §7 open questions).
- Produces: the four onboarding documents; later tasks do not depend on them.

- [ ] **Step 1: Write `identity-pack.md`**

Content (verbatim structure; fill known values, mark owner-supplied ones):

```markdown
# Plug A Pro — business identity pack (marketplace applications)

| Item | Value | Source |
|---|---|---|
| Legal entity | Kgolaentle Solutions (Pty) Ltd | marketing/lib/metadata.ts |
| Trading name | Plug A Pro | footer |
| CIPC registration | 2014/077326/07 | footer |
| VAT number | ⚠️ OWNER INPUT REQUIRED | — |
| Registered address | ⚠️ OWNER INPUT REQUIRED | — |
| Physical/ops address | ⚠️ OWNER INPUT REQUIRED | — |
| Legal representative | ⚠️ OWNER INPUT REQUIRED | — |
| Support phone (WhatsApp) | +27 69 355 2447 | marketing/lib/whatsapp.ts |
| Support email | support@plugapro.co.za | terms §29 |
| Privacy email | privacy@plugapro.co.za | privacy policy |
| Website | https://plugapro.co.za | — |
| App (Entrance URL candidate) | https://app.plugapro.co.za/vodapay | Task 9 |
| Proposed MCC | 1799 (special trade contractors); alt 7349 — Vodacom to confirm | research §7.1 Q3 |
| Settlement bank account | ⚠️ OWNER INPUT REQUIRED (reference only — never store the number here) | — |

Screenshots to attach: customer home, booking step 1 (address), quote view, paid booking.
```

- [ ] **Step 2: Write `vodapay-application.md`**

Sections: (1) partner-form answers (business name Kgolaentle Solutions (Pty) Ltd t/a Plug A Pro; nature of business "Home services"; product offering "On-demand vetted home-service bookings (plumbing, electrical, handyman) in Johannesburg West"; app URL `https://app.plugapro.co.za/vodapay`; website `https://plugapro.co.za`); (2) the 11 open questions copied verbatim from research doc §7.1; (3) sandbox tester roster table (name, email, Apple ID/Gmail, device — ⚠️ OWNER INPUT); (4) QA mapping table:

```markdown
| VodaPay QA item | Plug A Pro test |
|---|---|
| Auth positive/negative | /vodapay login happy path + declined-consent fallback to inline OTP |
| Full sunny-day journey | address → describe → confirm → quote accept → tradePay → paid state |
| All tenders (card, SOV, coupons) | pay one booking with each tender in sandbox wallet |
| After-sales communication | booking confirmation + review link visible in /bookings |
| MSISDN validation | phone from inquiryUserInfo matches session customer |
| No crashes / error handling | kill network mid-checkout → retry screen; expired quote → clear message |
```

- [ ] **Step 3: Write `fnb-nav-listing.md` and `capitec-pay.md`**

`fnb-nav-listing.md`: prerequisite (⚠️ confirm FNB business account exists or decide to open one); profile copy block (name, blurb ≤300 chars, services list = plumbing/electrical/handyman, area "Johannesburg West / Roodepoort", logo path `marketing/public/logo.png`); first-message script ("Hi! To check we cover you, what suburb are you in?" → in-fence: link to book; out-of-fence: waitlist promise); open questions (commission on in-app payments, aggregator/subcontracting policy, Peach/Pay@ links allowed in chat, partner API). Contact: marketplace@fnb.co.za / 087 730 5790.

`capitec-pay.md`: steps — log in to Peach dashboard → Payment Methods → enable Capitec Pay (1.50% + R1.50 per txn per peachpayments.com/capitec-pay-merchant-list) → confirm it appears on a test checkout → R1 live verification → note in OpenBrain. No code change (checkout renders whatever methods Peach enables).

- [ ] **Step 4: Commit**

```bash
git add docs/ops/marketplace-onboarding/
git commit -m "docs(ops): marketplace onboarding pack — identity, VodaPay application, FNB listing, Capitec Pay"
```

---

### Task 2: `/refund-policy` standalone page (marketing)

**Files:**
- Create: `marketing/app/(marketing)/refund-policy/page.tsx`
- Modify: `marketing/app/(marketing)/terms/page.tsx` (§27, ~line 367)
- Modify: `marketing/next.config.ts` (redirects block, ~lines 56-61)

**Interfaces:**
- Consumes: existing §27 "Refunds and Cancellations" JSX in the terms page (`id="refunds"`).
- Produces: route `/refund-policy` (200, self-contained). `/terms#refunds` keeps a short summary + link.

- [ ] **Step 1: Read the current §27 content**

Run: `sed -n '360,470p' marketing/app/(marketing)/terms/page.tsx` — copy the full §27 JSX (headings, lists) for reuse.

- [ ] **Step 2: Create the page**

```tsx
// marketing/app/(marketing)/refund-policy/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Refunds & Cancellations | Plug A Pro',
  description:
    'How refunds, cancellations and rescheduling work for Plug A Pro bookings.',
}

export default function RefundPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 prose">
      <h1>Refunds &amp; Cancellations</h1>
      <p>
        This policy explains when you can cancel a booking, when fees apply and
        how refunds are processed. It forms part of our{' '}
        <a href="/terms">Terms of Service</a>.
      </p>
      {/* PASTE the full §27 content from terms/page.tsx here, promoting its
          sub-headings one level (h3 → h2). Do not reword any commercial term. */}
      <h2>Contact</h2>
      <p>
        Questions about a refund: <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a>{' '}
        or WhatsApp <a href="https://wa.me/27693552447">+27 69 355 2447</a>.
      </p>
    </main>
  )
}
```

- [ ] **Step 3: Slim §27 in terms and remove the redirect**

In `terms/page.tsx`, replace the §27 body (keep the `<section id="refunds">` wrapper and heading) with:

```tsx
<p>
  Our full refunds and cancellations policy is published at{' '}
  <a href="/refund-policy">plugapro.co.za/refund-policy</a> and forms part of
  these terms.
</p>
```

In `marketing/next.config.ts`, delete only the `/refund-policy` → `/terms#refunds` redirect entry. Keep the `/provider-terms` redirect.

- [ ] **Step 4: Verify build and routes**

Run: `cd marketing && npx next build 2>&1 | tail -5`
Expected: build succeeds; route list includes `/refund-policy`.

- [ ] **Step 5: Commit**

```bash
git add marketing/app/\(marketing\)/refund-policy marketing/app/\(marketing\)/terms/page.tsx marketing/next.config.ts
git commit -m "feat(marketing): standalone /refund-policy page (VodaPay merchant checklist)"
```

---

### Task 3: `/service-policy` fulfilment page (marketing)

**Files:**
- Create: `marketing/app/(marketing)/service-policy/page.tsx`

**Interfaces:**
- Produces: route `/service-policy` describing service delivery. Referenced by Task 4 footer and by the VodaPay application (Task 1).

- [ ] **Step 1: Create the page**

```tsx
// marketing/app/(marketing)/service-policy/page.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'How Service Delivery Works | Plug A Pro',
  description:
    'Service area, response times, arrival windows, rescheduling and completion for Plug A Pro bookings.',
}

export default function ServicePolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12 prose">
      <h1>How Service Delivery Works</h1>

      <h2>Where we operate</h2>
      <p>
        Plug A Pro currently serves <strong>Johannesburg West / Roodepoort</strong>.
        If your address is outside this area, we add you to our waitlist and
        notify you when we launch near you. See <a href="/areas">service areas</a>.
      </p>

      <h2>Requesting a service</h2>
      <p>
        You describe the job and your address; we match you with a vetted
        provider. Matching normally completes within business hours the same
        day. If no provider is available we tell you rather than leave you
        waiting.
      </p>

      <h2>Quotes and acceptance</h2>
      <p>
        Providers quote before work starts. A quote shows labour, materials and
        validity. Work begins only after you accept.
      </p>

      <h2>Arrival windows</h2>
      <p>
        Bookings are scheduled into an agreed arrival window. If a provider is
        running late you are notified; repeated lateness affects the
        provider&apos;s standing on the platform.
      </p>

      <h2>Rescheduling and cancellation</h2>
      <p>
        You can reschedule or cancel before the provider is en route. Fees, when
        they apply, are set out in the{' '}
        <a href="/refund-policy">Refunds &amp; Cancellations policy</a>.
      </p>

      <h2>Completion and disputes</h2>
      <p>
        A job is complete when the agreed scope is done and you confirm it. If
        something is wrong, raise it within the dispute window described in the{' '}
        <a href="/terms">Terms of Service</a> and we will step in.
      </p>

      <h2>Contact</h2>
      <p>
        <a href="mailto:support@plugapro.co.za">support@plugapro.co.za</a> ·
        WhatsApp <a href="https://wa.me/27693552447">+27 69 355 2447</a>
      </p>
    </main>
  )
}
```

Cross-check every claim above against `terms/page.tsx` scheduling/cancellation/dispute sections before committing; where terms state a specific window (e.g. dispute days), use the terms' number verbatim — do not invent one. If terms are silent on a number, keep the sentence qualitative as written.

- [ ] **Step 2: Verify build**

Run: `cd marketing && npx next build 2>&1 | tail -3` — succeeds, route present.

- [ ] **Step 3: Commit**

```bash
git add marketing/app/\(marketing\)/service-policy
git commit -m "feat(marketing): /service-policy fulfilment page (VodaPay merchant checklist)"
```

---

### Task 4: Visible support contact + footer identity (marketing)

**Files:**
- Modify: `marketing/app/(marketing)/contact/page.tsx`
- Modify: `marketing/components/shared/Footer.tsx` (~lines 45-60)
- Modify: `marketing/lib/metadata.ts`

**Interfaces:**
- Consumes: `siteMetadata`-style constants in `marketing/lib/metadata.ts` (legal name line 6, reg line 7).
- Produces: `metadata.ts` exports `vatNumber: string | null` and `registeredAddress: string | null` (env-driven); footer and contact render them when set.

- [ ] **Step 1: Add env-driven identity fields**

In `marketing/lib/metadata.ts`, next to the existing legal constants:

```ts
export const vatNumber = process.env.NEXT_PUBLIC_VAT_NUMBER?.trim() || null
export const registeredAddress = process.env.NEXT_PUBLIC_REGISTERED_ADDRESS?.trim() || null
export const supportEmail = 'support@plugapro.co.za'
export const supportPhoneDisplay = '+27 69 355 2447'
```

- [ ] **Step 2: Render contact details as text on `/contact`**

In `contact/page.tsx`, above the existing form, add:

```tsx
<div className="mb-8 space-y-1 text-sm">
  <p>Email: <a className="underline" href="mailto:support@plugapro.co.za">support@plugapro.co.za</a></p>
  <p>Phone / WhatsApp: <a className="underline" href="tel:+27693552447">+27 69 355 2447</a></p>
</div>
```

- [ ] **Step 3: Footer identity line**

In `Footer.tsx`, after the existing `© … Reg 2014/077326/07` line, add:

```tsx
{vatNumber ? <span> · VAT {vatNumber}</span> : null}
{registeredAddress ? <p className="mt-1">{registeredAddress}</p> : null}
```

(import `vatNumber, registeredAddress` from `@/lib/metadata`). Renders nothing until the env vars are set — owner supplies values, then set with printf via `vercel env add`.

- [ ] **Step 4: Verify build, commit**

```bash
cd marketing && npx next build 2>&1 | tail -3
git add marketing/lib/metadata.ts marketing/app/\(marketing\)/contact/page.tsx marketing/components/shared/Footer.tsx
git commit -m "feat(marketing): visible support contact + env-driven VAT/address in footer"
```

---

### Task 5: In-app legal viewer stops iframing (field-service)

**Files:**
- Modify: `field-service/components/client/legal-screens.tsx` (iframe at ~line 70, `LEGAL_PAGES` at lines 3-12)

**Interfaces:**
- Consumes: `LEGAL_PAGES` slug list.
- Produces: each legal page renders an external-link card (marketing's `X-Frame-Options: DENY` already blocks the iframe today).

- [ ] **Step 1: Replace the iframe**

Read the file first (`sed -n '1,90p' field-service/components/client/legal-screens.tsx`). Replace the `<iframe …>` block with:

```tsx
<a
  href={`https://plugapro.co.za/${page.slug}`}
  target="_blank"
  rel="noopener noreferrer"
  className="block rounded-lg border p-4"
>
  <span className="font-medium">{page.title}</span>
  <span className="mt-1 block text-sm text-muted-foreground">
    Opens on plugapro.co.za
  </span>
</a>
```

Also update `LEGAL_PAGES`: point the `refund-policy` entry at the new standalone slug (unchanged string — the page now exists, Task 2) and confirm `provider-terms` links to `/terms#provider-terms` (`slug: 'terms#provider-terms'`).

- [ ] **Step 2: Verify + commit**

Run: `cd field-service && npx vitest run 2>&1 | tail -3` (no test touches this component; suite stays green) and `npx next build` if quick. Then:

```bash
git add field-service/components/client/legal-screens.tsx
git commit -m "fix(client): legal viewer links out instead of iframing (marketing frame headers block iframes)"
```

---

### Task 6: Register the two flags

**Files:**
- Modify: `field-service/lib/feature-flags-registry.ts`
- Modify: `field-service/scripts/feature-flag-groups.ts`

**Interfaces:**
- Produces: registry keys `'channel.vodapay.v1'` and `'payments.vodapay.v1'` (both `defaultValue: false`, `owner: 'eng'`), and group `vodapay` resolvable by `scripts/seed-flags.ts --group=vodapay`. All later tasks read these exact key strings via `isEnabled()`.

- [ ] **Step 1: Add registry entries**

Append inside `FEATURE_FLAGS_REGISTRY` (match the existing object shape exactly):

```ts
'channel.vodapay.v1': {
  description:
    'VodaPay mini-program runtime: /vodapay entry route, channel cookie, VodaPay-mode UI (WhatsApp CTAs hidden), and VodaPay federated login. OFF = /vodapay 404s and nothing changes for web/WhatsApp customers.',
  owner: 'eng',
  defaultValue: false,
},
'payments.vodapay.v1': {
  description:
    'Route bookings whose request source is vodapay to the VodaPay cashier PSP (forced checkout mode) and process its webhook. OFF = global PSP_PROVIDER behaviour unchanged.',
  owner: 'eng',
  defaultValue: false,
},
```

- [ ] **Step 2: Add the seed group**

In `scripts/feature-flag-groups.ts`, add:

```ts
export const VODAPAY_FLAGS = ['channel.vodapay.v1', 'payments.vodapay.v1'] as const
```

and register `vodapay: VODAPAY_FLAGS` in `FEATURE_FLAG_GROUPS`.

- [ ] **Step 3: Verify types + seed dry run, commit**

Run: `cd field-service && npx tsc --noEmit 2>&1 | tail -3` and `npx tsx scripts/seed-flags.ts --group=vodapay` (no `--enable`; creates rows disabled — requires DB env; if unavailable locally, typecheck suffices and note it).

```bash
git add field-service/lib/feature-flags-registry.ts field-service/scripts/feature-flag-groups.ts
git commit -m "feat(flags): register channel.vodapay.v1 + payments.vodapay.v1 (default OFF)"
```

---

### Task 7: WebView unblock — CSP, proxy UA, robots

**Files:**
- Modify: `field-service/next.config.ts` (headers, lines 24-56)
- Modify: `field-service/lib/admin-desktop-policy.ts` (`isDesktopBrowserUserAgent`, line 68)
- Modify: `field-service/proxy.ts` (PUBLIC_PATHS ~line 16-90; interstitial exemptions ~lines 373-383)
- Modify: `field-service/app/robots.ts`
- Test: `field-service/__tests__/lib/admin-desktop-policy.vodapay.test.ts`

**Interfaces:**
- Consumes: `isDesktopBrowserUserAgent(ua)` (existing export).
- Produces: mini-program UAs are never classified desktop; `/vodapay` is public and interstitial-exempt; CSP admits `https://cdn.marmot-cloud.com` (script) and env-listed VodaPay hosts (connect); robots allows `/vodapay`.

- [ ] **Step 1: Write the failing UA test**

```ts
// __tests__/lib/admin-desktop-policy.vodapay.test.ts
import { describe, expect, it } from 'vitest'
import { isDesktopBrowserUserAgent } from '@/lib/admin-desktop-policy'

const VODAPAY_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; SM-A525F) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/117.0.0.0 Mobile Safari/537.36 AlipayClient/10.3.0 MiniProgram'
const VODAPAY_DESKTOPISH =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 AlipayClient/10.3.0 MiniProgram'

describe('mini-program user agents', () => {
  it('android mini-program UA is not desktop', () => {
    expect(isDesktopBrowserUserAgent(VODAPAY_ANDROID)).toBe(false)
  })
  it('MiniProgram marker fails open even on a desktop-looking UA', () => {
    expect(isDesktopBrowserUserAgent(VODAPAY_DESKTOPISH)).toBe(false)
  })
  it('plain desktop stays desktop', () => {
    expect(
      isDesktopBrowserUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0'),
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify the second case fails**

Run: `cd field-service && npx vitest run __tests__/lib/admin-desktop-policy.vodapay.test.ts`
Expected: FAIL on the `VODAPAY_DESKTOPISH` case (X11 currently classifies desktop).

- [ ] **Step 3: Implement**

In `isDesktopBrowserUserAgent`, immediately after the bot fail-open line (`if (/bot|crawl|…/.test(ua)) return false`), add:

```ts
// Super-app WebViews (VodaPay = Ant/Alipay runtime). Fail open like bots:
// blocking the host app's WebView would kill the mini-program channel.
if (/miniprogram|alipayclient|vodapay/.test(ua)) return false
```

- [ ] **Step 4: Run test — PASS.** `npx vitest run __tests__/lib/admin-desktop-policy.vodapay.test.ts`

- [ ] **Step 5: CSP**

In `next.config.ts` headers, change two directives:

```ts
"script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net https://www.googletagmanager.com https://cdn.marmot-cloud.com",
`connect-src 'self' https://*.supabase.co wss://*.supabase.co https://graph.facebook.com https://www.facebook.com https://www.google-analytics.com https://region1.google-analytics.com${vodapayConnectHosts}`,
```

with, above the `headers()` function:

```ts
// Space-separated extra connect-src hosts for the VodaPay open-API gateway
// (sandbox vs prod differ). Example: "https://open-sea.vodapay.vodacom.co.za".
const vodapayConnectHosts = (process.env.VODAPAY_CSP_HOSTS ?? '')
  .split(/\s+/)
  .filter((h) => /^https:\/\/[a-z0-9.-]+$/i.test(h))
  .map((h) => ` ${h}`)
  .join('')
```

Note: the template literal requires the array entry to switch from `"…"` to a backtick string; keep every other directive byte-identical (`frame-ancestors 'none'` stays).

- [ ] **Step 6: proxy + robots**

`proxy.ts`: add `'/vodapay'` to `PUBLIC_PATHS`, and add `pathname.startsWith('/vodapay')` to the interstitial-exempt conditions (read lines 370-390 first and mirror the existing `/status` exemption style). `app/robots.ts`: change rules to:

```ts
rules: [
  { userAgent: '*', allow: '/vodapay', disallow: '/' },
],
```

- [ ] **Step 7: Full check + commit**

Run: `npx vitest run 2>&1 | tail -3` and `npx tsc --noEmit 2>&1 | tail -3`.

```bash
git add next.config.ts lib/admin-desktop-policy.ts proxy.ts app/robots.ts __tests__/lib/admin-desktop-policy.vodapay.test.ts
git commit -m "feat(channel): unblock VodaPay WebView — CSP bridge/gateway hosts, mini-program UA fail-open, /vodapay public"
```

---

### Task 8: Channel cookie + resolver

**Files:**
- Create: `field-service/lib/channel.ts`
- Create: `field-service/app/api/channel/route.ts`
- Test: `field-service/__tests__/lib/channel.test.ts`

**Interfaces:**
- Produces: `getRequestChannel(): Promise<'vodapay' | 'web'>` (server, reads `pap_channel` cookie via `next/headers`); `parseChannelCookie(value: string | undefined): 'vodapay' | 'web'` (pure, for tests); `POST /api/channel` body `{ channel: 'vodapay' }` sets the cookie (30 d, HttpOnly, Lax, Secure in prod) — flag-gated by `channel.vodapay.v1`. Tasks 9-11 and 16 consume `getRequestChannel`/`parseChannelCookie`.

- [ ] **Step 1: Failing test for the pure parser**

```ts
// __tests__/lib/channel.test.ts
import { describe, expect, it } from 'vitest'
import { parseChannelCookie } from '@/lib/channel'

describe('parseChannelCookie', () => {
  it('vodapay value → vodapay', () => expect(parseChannelCookie('vodapay')).toBe('vodapay'))
  it('missing → web', () => expect(parseChannelCookie(undefined)).toBe('web'))
  it('garbage → web', () => expect(parseChannelCookie('evil')).toBe('web'))
})
```

Run: `npx vitest run __tests__/lib/channel.test.ts` — FAIL (module not found).

- [ ] **Step 2: Implement `lib/channel.ts`**

```ts
import 'server-only'
import { cookies } from 'next/headers'

export const CHANNEL_COOKIE = 'pap_channel'
export type RequestChannel = 'vodapay' | 'web'

export function parseChannelCookie(value: string | undefined): RequestChannel {
  return value === 'vodapay' ? 'vodapay' : 'web'
}

export async function getRequestChannel(): Promise<RequestChannel> {
  const jar = await cookies()
  return parseChannelCookie(jar.get(CHANNEL_COOKIE)?.value)
}
```

Note: `import 'server-only'` breaks Vitest if the test imports the module directly — follow the existing repo pattern for testing server-only modules (grep `server-only` in `vitest.config.ts` / existing tests for the alias/mock used, e.g. how `lib/payments.ts` internals are tested). If the repo mocks it, mirror that; if not, put the pure parser in `lib/channel-shared.ts` (no server-only import) and re-export from `lib/channel.ts`, and point the test at `channel-shared`.

- [ ] **Step 3: Run test — PASS.**

- [ ] **Step 4: The route**

```ts
// app/api/channel/route.ts
import { NextResponse } from 'next/server'
import { isEnabled } from '@/lib/flags'
import { CHANNEL_COOKIE } from '@/lib/channel'

export async function POST(request: Request) {
  if (!(await isEnabled('channel.vodapay.v1'))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }
  const body = (await request.json().catch(() => null)) as { channel?: unknown } | null
  if (body?.channel !== 'vodapay') {
    return NextResponse.json({ error: 'invalid_channel' }, { status: 400 })
  }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(CHANNEL_COOKIE, 'vodapay', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}
```

Add `'/api/channel'` to `PUBLIC_PATHS` in `proxy.ts`.

- [ ] **Step 5: Suite + commit**

```bash
npx vitest run 2>&1 | tail -3
git add lib/channel.ts app/api/channel/route.ts proxy.ts __tests__/lib/channel.test.ts
git commit -m "feat(channel): pap_channel cookie, resolver, POST /api/channel (flag-gated)"
```

---

### Task 9: `/vodapay` entry route + bridge bootstrap + VodaPay-mode UI

**Files:**
- Create: `field-service/app/(customer)/vodapay/page.tsx`
- Create: `field-service/components/customer/VodapayBootstrap.tsx`
- Create: `field-service/lib/vodapay/bridge.ts` (client-safe helpers + `my` typings)
- Modify: `field-service/app/(customer)/page.tsx` (~line 63; pass channel down, hide WhatsApp CTAs)
- Test: `field-service/__tests__/lib/vodapay-bridge.test.ts`

**Interfaces:**
- Consumes: `parseChannelCookie`/`getRequestChannel` (Task 8), flag `channel.vodapay.v1`.
- Produces: `detectMiniProgram(ua: string, my: unknown): boolean` and `interface MiniProgramBridge { getAuthCode(...): void; tradePay(...): void; getLocation(...): void; getEnv(...): void }` in `lib/vodapay/bridge.ts` (client-safe, no server-only import); global `Window['my']` typing. Customer home accepts `channel` and suppresses WhatsApp CTAs when `'vodapay'`. Task 15 uses `getAuthCode`, Task 18 uses `tradePay`.

- [ ] **Step 1: Failing detection test**

```ts
// __tests__/lib/vodapay-bridge.test.ts
import { describe, expect, it } from 'vitest'
import { detectMiniProgram } from '@/lib/vodapay/bridge'

describe('detectMiniProgram', () => {
  it('UA marker wins', () => {
    expect(detectMiniProgram('Mozilla/5.0 … MiniProgram', undefined)).toBe(true)
  })
  it('bridge object wins without UA marker', () => {
    expect(detectMiniProgram('Mozilla/5.0 Chrome', { getAuthCode: () => {} })).toBe(true)
  })
  it('plain browser is false', () => {
    expect(detectMiniProgram('Mozilla/5.0 Chrome', undefined)).toBe(false)
  })
})
```

Run — FAIL (module not found).

- [ ] **Step 2: Implement `lib/vodapay/bridge.ts`**

```ts
// Client-safe. No server-only import.
export interface BridgeCallback<T> {
  success?: (res: T) => void
  fail?: (err: { error?: number; errorMessage?: string }) => void
  complete?: () => void
}

export interface MiniProgramBridge {
  getAuthCode(opts: { scopes: string[] } & BridgeCallback<{ authCode: string }>): void
  tradePay(opts: { paymentUrl: string } & BridgeCallback<{ resultCode: string }>): void
  getLocation(opts: BridgeCallback<{ latitude: string; longitude: string }>): void
  getEnv(opts: BridgeCallback<{ language: string }>): void
}

declare global {
  interface Window {
    my?: MiniProgramBridge
  }
}

export function detectMiniProgram(ua: string, my: unknown): boolean {
  if (/MiniProgram/i.test(ua)) return true
  return Boolean(my && typeof (my as MiniProgramBridge).getAuthCode === 'function')
}

export const HYLID_BRIDGE_SRC = 'https://cdn.marmot-cloud.com/npm/hylid-bridge/2.10.0/index.js'
```

- [ ] **Step 3: Run test — PASS.**

- [ ] **Step 4: Entry page + bootstrap**

```tsx
// app/(customer)/vodapay/page.tsx  (Server Component)
import { notFound } from 'next/navigation'
import { isEnabled } from '@/lib/flags'
import { VodapayBootstrap } from '@/components/customer/VodapayBootstrap'

export const dynamic = 'force-dynamic'

export default async function VodapayEntryPage() {
  if (!(await isEnabled('channel.vodapay.v1'))) notFound()
  return <VodapayBootstrap />
}
```

```tsx
// components/customer/VodapayBootstrap.tsx
'use client'
import Script from 'next/script'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { detectMiniProgram, HYLID_BRIDGE_SRC } from '@/lib/vodapay/bridge'

export function VodapayBootstrap() {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!ready) return
    const inMiniProgram = detectMiniProgram(navigator.userAgent, window.my)
    void fetch('/api/channel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'vodapay' }),
    })
      .catch(() => undefined)
      .finally(() => {
        // Enter the normal home; VodaPay mode is carried by the cookie.
        router.replace(inMiniProgram ? '/' : '/?src=vodapay-preview')
      })
  }, [ready, router])

  return (
    <>
      <Script src={HYLID_BRIDGE_SRC} strategy="afterInteractive" onReady={() => setReady(true)} onError={() => setReady(true)} />
      <main className="flex min-h-screen items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Opening Plug A Pro…</p>
      </main>
    </>
  )
}
```

- [ ] **Step 5: Hide WhatsApp CTAs in VodaPay mode**

Read `app/(customer)/page.tsx` (lines 1-140) to find where WhatsApp CTAs render. Add at the top of the component:

```ts
const channel = await getRequestChannel()
```

(import from `@/lib/channel`) and wrap each WhatsApp CTA with `{channel !== 'vodapay' && (…)}`. Grep the customer tree for other always-on WhatsApp affordances (`grep -rn "wa.me\|WhatsApp" app/\(customer\) components/customer --include='*.tsx' -l`) and gate the ones on the home + booking flow surfaces only (do not touch provider or admin surfaces).

- [ ] **Step 6: Suite, typecheck, commit**

```bash
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
git add app/\(customer\)/vodapay components/customer/VodapayBootstrap.tsx lib/vodapay/bridge.ts app/\(customer\)/page.tsx __tests__/lib/vodapay-bridge.test.ts
git commit -m "feat(channel): /vodapay entrance route, hylid bootstrap, VodaPay-mode CTA gating"
```

---

### Task 10: Attribution — widen source unions to `vodapay`

**Files:**
- Modify: `field-service/lib/job-requests/create-job-request.ts` (ternaries at lines 503 and 623)
- Modify: `field-service/lib/customer-address-book.ts` (source unions at lines 128 and 242)
- Modify: `field-service/lib/service-area-guard.ts` (`source: 'whatsapp' | 'pwa'` at line 117)
- Modify: `field-service/app/api/customer/bookings/route.ts` (pass source + waitlist source)
- Test: `field-service/__tests__/lib/request-source.test.ts`

**Interfaces:**
- Consumes: `getRequestChannel()` (Task 8).
- Produces: `normalizeRequestSource(source: string | undefined): 'whatsapp' | 'pwa' | 'vodapay' | 'merged'` exported from `lib/job-requests/create-job-request.ts` and used at both former ternary sites (WorkflowEvent site maps `merged → 'system'` as today); `addToServiceAreaWaitlist` accepts `source: 'whatsapp' | 'pwa' | 'vodapay'`. Task 16's resolver reads `JobRequest.source === 'vodapay'`.

- [ ] **Step 1: Failing test**

```ts
// __tests__/lib/request-source.test.ts
import { describe, expect, it } from 'vitest'
import { normalizeRequestSource } from '@/lib/job-requests/create-job-request'

describe('normalizeRequestSource', () => {
  it.each([
    ['whatsapp', 'whatsapp'],
    ['pwa', 'pwa'],
    ['vodapay', 'vodapay'],
    [undefined, 'merged'],
    ['unknown', 'merged'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeRequestSource(input as string | undefined)).toBe(expected)
  })
})
```

Run — FAIL (`normalizeRequestSource` not exported).

- [ ] **Step 2: Implement**

In `create-job-request.ts`, add near the top:

```ts
export function normalizeRequestSource(
  source: string | undefined,
): 'whatsapp' | 'pwa' | 'vodapay' | 'merged' {
  if (source === 'whatsapp' || source === 'pwa' || source === 'vodapay') return source
  return 'merged'
}
```

Replace line 503's ternary with `source: normalizeRequestSource(params.source),` and line 623's with:

```ts
source: (() => { const s = normalizeRequestSource(params.source); return s === 'merged' ? 'system' : s })(),
```

In `customer-address-book.ts` widen both union annotations to `'whatsapp' | 'pwa' | 'vodapay' | 'merged'` (read lines 120-250 first; the values flow from the caller, so only the type widens). In `service-area-guard.ts:117` widen to `'whatsapp' | 'pwa' | 'vodapay'`.

- [ ] **Step 3: Run test — PASS; full suite green.**

- [ ] **Step 4: Bookings route passes the channel**

In `app/api/customer/bookings/route.ts`: read the top of the handler; where the create call currently passes `source: 'pwa'` (grep `source:` in the file), change to:

```ts
const channel = await getRequestChannel()
// …
source: channel === 'vodapay' ? 'vodapay' : 'pwa',
```

and at the two waitlist call sites (lines ~254-291) pass `source: channel === 'vodapay' ? 'vodapay' : 'pwa'`.

- [ ] **Step 5: Check the funnel consumer**

Run: `grep -n "source" field-service/lib/admin/funnel-aggregate.ts | head`. If it filters on an allowlist of sources, add `'vodapay'`; if it groups by the raw string, no change. State which in the commit body.

- [ ] **Step 6: Commit**

```bash
npx vitest run 2>&1 | tail -3
git add lib/job-requests/create-job-request.ts lib/customer-address-book.ts lib/service-area-guard.ts app/api/customer/bookings/route.ts lib/admin/funnel-aggregate.ts __tests__/lib/request-source.test.ts
git commit -m "feat(attribution): vodapay request source end-to-end (request, events, waitlist, address book)"
```

---

### Task 11: `CustomerExternalIdentity` model (additive migration)

**Files:**
- Modify: `field-service/prisma/schema.prisma` (new model + `Customer.externalIdentities` relation)
- Create: `field-service/prisma/migrations/<timestamp>_customer_external_identity/migration.sql` (via prisma)

**Interfaces:**
- Produces: Prisma model `CustomerExternalIdentity` exactly as in spec §W4 (fields `id, customerId, provider, externalId, tokenCipher?, createdAt, updatedAt`; `@@unique([provider, externalId])`; `@@index([customerId])`) plus back-relation `externalIdentities CustomerExternalIdentity[]` on `Customer`. Task 14 reads/writes it as `db.customerExternalIdentity`.

- [ ] **Step 1: Add the model**

Append to `schema.prisma` (map names follow the schema's existing convention — check whether models use `@@map`; mirror it):

```prisma
model CustomerExternalIdentity {
  id          String   @id @default(cuid())
  customerId  String
  provider    String
  externalId  String
  tokenCipher String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  customer    Customer @relation(fields: [customerId], references: [id])

  @@unique([provider, externalId])
  @@index([customerId])
}
```

and on `Customer`: `externalIdentities CustomerExternalIdentity[]`.

- [ ] **Step 2: Generate the migration (dev DB) + client**

Run: `cd field-service && npx prisma migrate dev --name customer_external_identity` (local/dev DATABASE_URL; if unavailable, `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script` to author SQL and create the folder manually, then `npx prisma generate`). Verify the SQL is pure `CREATE TABLE` + indexes — no drops.

- [ ] **Step 3: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | tail -3
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(schema): CustomerExternalIdentity (additive) for marketplace federated login"
```

---

### Task 12: RSA-SHA256 signing helpers

**Files:**
- Create: `field-service/lib/vodapay/signing.ts`
- Test: `field-service/__tests__/lib/vodapay-signing.test.ts`

**Interfaces:**
- Produces:
  - `buildSignaturePayload(p: { method: string; path: string; clientId: string; requestTime: string; body: string }): string` → `` `${method} ${path}\n${clientId}.${requestTime}.${body}` ``
  - `signRequest(payload: string, privateKeyPem: string): string` (base64 RSA-SHA256)
  - `verifySignature(payload: string, signatureB64: string, publicKeyPem: string): boolean`
  - `parseSignatureHeader(header: string | null): { algorithm: string; signature: string } | null` — parses `algorithm=RSA256,keyVersion=1,signature=<urlencoded-b64>`.
  Tasks 13 and 17 consume all four.

- [ ] **Step 1: Failing tests (round-trip with a generated key pair)**

```ts
// __tests__/lib/vodapay-signing.test.ts
import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  buildSignaturePayload, parseSignatureHeader, signRequest, verifySignature,
} from '@/lib/vodapay/signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const priv = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const pub = publicKey.export({ type: 'spki', format: 'pem' }) as string

describe('vodapay signing', () => {
  const payload = buildSignaturePayload({
    method: 'POST', path: '/v2/payments/pay', clientId: 'C1',
    requestTime: '2026-09-07T12:00:00+02:00', body: '{"a":1}',
  })
  it('payload shape', () => {
    expect(payload).toBe('POST /v2/payments/pay\nC1.2026-09-07T12:00:00+02:00.{"a":1}')
  })
  it('sign/verify round-trip', () => {
    const sig = signRequest(payload, priv)
    expect(verifySignature(payload, sig, pub)).toBe(true)
  })
  it('tamper fails', () => {
    const sig = signRequest(payload, priv)
    expect(verifySignature(payload + 'x', sig, pub)).toBe(false)
  })
  it('parses signature header', () => {
    const sig = signRequest(payload, priv)
    const header = `algorithm=RSA256,keyVersion=1,signature=${encodeURIComponent(sig)}`
    expect(parseSignatureHeader(header)).toEqual({ algorithm: 'RSA256', signature: sig })
  })
  it('bad header → null', () => {
    expect(parseSignatureHeader('nope')).toBeNull()
    expect(parseSignatureHeader(null)).toBeNull()
  })
})
```

Run — FAIL (module not found).

- [ ] **Step 2: Implement**

```ts
// lib/vodapay/signing.ts — pure node:crypto; no server-only import (safe: no secrets held)
import { createSign, createVerify } from 'node:crypto'

export function buildSignaturePayload(p: {
  method: string; path: string; clientId: string; requestTime: string; body: string
}): string {
  return `${p.method} ${p.path}\n${p.clientId}.${p.requestTime}.${p.body}`
}

export function signRequest(payload: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(payload, 'utf8')
  return signer.sign(privateKeyPem, 'base64')
}

export function verifySignature(payload: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(payload, 'utf8')
    return verifier.verify(publicKeyPem, signatureB64, 'base64')
  } catch {
    return false
  }
}

export function parseSignatureHeader(
  header: string | null,
): { algorithm: string; signature: string } | null {
  if (!header) return null
  const parts = new Map(
    header.split(',').map((kv) => {
      const i = kv.indexOf('=')
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as const
    }),
  )
  const algorithm = parts.get('algorithm')
  const signature = parts.get('signature')
  if (!algorithm || !signature) return null
  return { algorithm, signature: decodeURIComponent(signature) }
}
```

- [ ] **Step 3: Run — all PASS. Commit.**

```bash
git add lib/vodapay/signing.ts __tests__/lib/vodapay-signing.test.ts
git commit -m "feat(vodapay): RSA-SHA256 request signing + notify verification helpers"
```

---

### Task 13: VodaPay open-API client

**Files:**
- Create: `field-service/lib/vodapay/client.ts`
- Test: `field-service/__tests__/lib/vodapay-client.test.ts`

**Interfaces:**
- Consumes: Task 12 helpers.
- Produces (all throw `VodapayApiError` on non-SUCCESS resultStatus):
  - `getVodapayConfig(): { clientId: string; merchantId: string; apiBase: string; privateKey: string; platformPublicKey: string }` (throws listing missing env names)
  - `applyToken(authCode: string): Promise<{ accessToken: string; refreshToken?: string; customerId: string; expiresAt?: string }>`
  - `inquiryUserInfo(accessToken: string): Promise<{ userId: string; userName?: { fullName?: string }; mobileNumber?: string }>` (extracts first `MOBILE_PHONE` from `contactInfos`)
  - `payCashier(p: { paymentRequestId: string; amountCents: number; notifyUrl: string; redirectUrl: string; orderDescription: string; expiryIso: string }): Promise<{ paymentId: string; redirectUrl: string }>`
  - `refundPayment(p: { paymentId: string; refundRequestId: string; amountCents: number }): Promise<{ refundId: string }>` — marked VERIFY-IN-SANDBOX
  - `inquiryPayment(paymentId: string): Promise<{ status: 'SUCCESS' | 'FAIL' | 'PROCESSING'; amountCents?: number }>`
  Tasks 14 and 17 consume these. `fetch` is injectable for tests: every function accepts an optional trailing `deps?: { fetchImpl?: typeof fetch; now?: () => Date }`.

- [ ] **Step 1: Failing tests (mock fetch)**

```ts
// __tests__/lib/vodapay-client.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applyToken, payCashier, VodapayApiError } from '@/lib/vodapay/client'

const ENV = {
  VODAPAY_CLIENT_ID: 'C1', VODAPAY_MERCHANT_ID: 'M1',
  VODAPAY_API_BASE: 'https://sandbox.example',
  VODAPAY_PRIVATE_KEY: TEST_PRIV, VODAPAY_PLATFORM_PUBLIC_KEY: TEST_PUB,
}
beforeEach(() => { Object.assign(process.env, ENV) })

function okFetch(result: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(result), { status: 200 }))
}

describe('applyToken', () => {
  it('returns token + customerId on SUCCESS', async () => {
    const fetchImpl = okFetch({
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
      accessToken: 'tok', customerId: 'u1',
    })
    const out = await applyToken('code1', { fetchImpl })
    expect(out).toMatchObject({ accessToken: 'tok', customerId: 'u1' })
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(String(url)).toBe('https://sandbox.example/v2/authorizations/applyToken')
    expect((init!.headers as Record<string, string>)['Client-Id']).toBe('C1')
    expect((init!.headers as Record<string, string>)['Signature']).toMatch(/^algorithm=RSA256/)
  })
  it('throws VodapayApiError on failure resultStatus', async () => {
    const fetchImpl = okFetch({ result: { resultCode: 'AUTH_FAIL', resultStatus: 'F' } })
    await expect(applyToken('bad', { fetchImpl })).rejects.toBeInstanceOf(VodapayApiError)
  })
})

describe('payCashier', () => {
  it('extracts redirect url', async () => {
    const fetchImpl = okFetch({
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
      paymentId: 'P9', redirectActionForm: { redirectUrl: 'https://pay/checkout' },
    })
    const out = await payCashier({
      paymentRequestId: 'pr1', amountCents: 15000,
      notifyUrl: 'https://app/n', redirectUrl: 'https://app/r',
      orderDescription: 'Job', expiryIso: '2026-09-07T13:00:00Z',
    }, { fetchImpl })
    expect(out).toEqual({ paymentId: 'P9', redirectUrl: 'https://pay/checkout' })
    const body = JSON.parse(String(fetchImpl.mock.calls[0]![1]!.body))
    expect(body.paymentAmount).toEqual({ currency: 'ZAR', value: '15000' })
    expect(body.productCode).toBe('CASHIER_PAYMENT')
  })
})
```

`TEST_PRIV`/`TEST_PUB`: generate at module top exactly as in Task 12's test. Run — FAIL.

- [ ] **Step 2: Implement `lib/vodapay/client.ts`**

```ts
import 'server-only'
import { buildSignaturePayload, signRequest } from './signing'

export class VodapayApiError extends Error {
  constructor(public resultCode: string, message?: string) {
    super(message ?? `VodaPay API error: ${resultCode}`)
  }
}

type Deps = { fetchImpl?: typeof fetch; now?: () => Date }

export function getVodapayConfig() {
  const names = ['VODAPAY_CLIENT_ID', 'VODAPAY_MERCHANT_ID', 'VODAPAY_API_BASE',
    'VODAPAY_PRIVATE_KEY', 'VODAPAY_PLATFORM_PUBLIC_KEY'] as const
  const missing = names.filter((n) => !process.env[n]?.trim())
  if (missing.length) throw new Error(`VodaPay env missing: ${missing.join(', ')}`)
  return {
    clientId: process.env.VODAPAY_CLIENT_ID!.trim(),
    merchantId: process.env.VODAPAY_MERCHANT_ID!.trim(),
    apiBase: process.env.VODAPAY_API_BASE!.trim().replace(/\/$/, ''),
    privateKey: process.env.VODAPAY_PRIVATE_KEY!,
    platformPublicKey: process.env.VODAPAY_PLATFORM_PUBLIC_KEY!,
  }
}

async function call<T extends { result?: { resultCode?: string; resultStatus?: string } }>(
  path: string, body: Record<string, unknown>, deps?: Deps,
): Promise<T> {
  const cfg = getVodapayConfig()
  const fetchImpl = deps?.fetchImpl ?? fetch
  const requestTime = (deps?.now?.() ?? new Date()).toISOString()
  const json = JSON.stringify(body)
  const signature = signRequest(
    buildSignaturePayload({ method: 'POST', path, clientId: cfg.clientId, requestTime, body: json }),
    cfg.privateKey,
  )
  const res = await fetchImpl(`${cfg.apiBase}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Client-Id': cfg.clientId,
      'Request-Time': requestTime,
      Signature: `algorithm=RSA256, keyVersion=1, signature=${encodeURIComponent(signature)}`,
    },
    body: json,
  })
  const data = (await res.json()) as T
  if (data.result?.resultStatus !== 'S') {
    throw new VodapayApiError(data.result?.resultCode ?? `HTTP_${res.status}`)
  }
  return data
}

export async function applyToken(authCode: string, deps?: Deps) {
  const data = await call<{ accessToken: string; refreshToken?: string;
    customerId: string; accessTokenExpiryTime?: string; result: { resultStatus: string } }>(
    '/v2/authorizations/applyToken',
    { grantType: 'AUTHORIZATION_CODE', authCode }, deps)
  return { accessToken: data.accessToken, refreshToken: data.refreshToken,
    customerId: data.customerId, expiresAt: data.accessTokenExpiryTime }
}

export async function inquiryUserInfo(accessToken: string, deps?: Deps) {
  const data = await call<{ userInfo?: { userId: string; userName?: { fullName?: string };
    contactInfos?: Array<{ contactType: string; contactNo: string }> };
    result: { resultStatus: string } }>(
    '/v2/customers/user/inquiryUserInfo', { accessToken }, deps)
  const mobile = data.userInfo?.contactInfos?.find((c) => c.contactType === 'MOBILE_PHONE')?.contactNo
  return { userId: data.userInfo?.userId ?? '', userName: data.userInfo?.userName, mobileNumber: mobile }
}

export async function payCashier(p: { paymentRequestId: string; amountCents: number;
  notifyUrl: string; redirectUrl: string; orderDescription: string; expiryIso: string }, deps?: Deps) {
  const cfg = getVodapayConfig()
  const data = await call<{ paymentId: string; redirectActionForm?: { redirectUrl: string };
    result: { resultStatus: string } }>(
    '/v2/payments/pay',
    {
      productCode: 'CASHIER_PAYMENT',
      paymentRequestId: p.paymentRequestId,
      paymentAmount: { currency: 'ZAR', value: String(p.amountCents) },
      paymentNotifyUrl: p.notifyUrl,
      paymentRedirectUrl: p.redirectUrl,
      paymentExpiryTime: p.expiryIso,
      order: { orderDescription: p.orderDescription, referenceOrderId: p.paymentRequestId },
      merchantId: cfg.merchantId,
    }, deps)
  return { paymentId: data.paymentId, redirectUrl: data.redirectActionForm?.redirectUrl ?? '' }
}

// VERIFY-IN-SANDBOX: refund/inquiry shapes follow the Alipay+ spec; VodaPay's
// mini-program refund API is not publicly documented (research doc §7.1 Q5).
export async function refundPayment(p: { paymentId: string; refundRequestId: string;
  amountCents: number }, deps?: Deps) {
  const data = await call<{ refundId: string; result: { resultStatus: string } }>(
    '/v2/payments/refund',
    { paymentId: p.paymentId, refundRequestId: p.refundRequestId,
      refundAmount: { currency: 'ZAR', value: String(p.amountCents) } }, deps)
  return { refundId: data.refundId }
}

export async function inquiryPayment(paymentId: string, deps?: Deps) {
  const data = await call<{ paymentStatus?: string; paymentAmount?: { value?: string };
    result: { resultStatus: string } }>(
    '/v2/payments/inquiryPayment', { paymentId }, deps)
  const status = data.paymentStatus === 'SUCCESS' ? 'SUCCESS'
    : data.paymentStatus === 'FAIL' ? 'FAIL' : 'PROCESSING'
  return { status, amountCents: data.paymentAmount?.value ? Number(data.paymentAmount.value) : undefined } as
    { status: 'SUCCESS' | 'FAIL' | 'PROCESSING'; amountCents?: number }
}
```

If `server-only` blocks the test (see Task 8 note), apply the same repo-standard mock.

- [ ] **Step 3: Run — PASS. Full suite green. Commit.**

```bash
git add lib/vodapay/client.ts __tests__/lib/vodapay-client.test.ts
git commit -m "feat(vodapay): signed open-API client (applyToken, userInfo, pay, refund, inquiry)"
```

---

### Task 14: Identity link + Supabase session mint + `POST /api/auth/vodapay`

**Files:**
- Create: `field-service/lib/vodapay/identity.ts`
- Create: `field-service/app/api/auth/vodapay/route.ts`
- Modify: `field-service/proxy.ts` (PUBLIC_PATHS: add `'/api/auth/vodapay'`)
- Test: `field-service/__tests__/lib/vodapay-identity.test.ts`

**Interfaces:**
- Consumes: Task 13 `applyToken`/`inquiryUserInfo`; Task 11 `db.customerExternalIdentity`; existing `lib/auth-session-cookie.ts` cookie writer; Supabase admin pattern from `lib/provider-approval-auth-user.ts:78`; phone normalisation util (grep `normalizePhone\|toE164` in `lib/` and reuse the existing one).
- Produces:
  - `resolveVodapayCustomer(deps, input: { externalId: string; phone: string; fullName?: string }): Promise<{ customerId: string; created: boolean }>` — lookup by `(provider:'VODAPAY', externalId)` → by phone → create; links identity row. `deps` = `{ db }` (injected for tests, default real client).
  - `POST /api/auth/vodapay` body `{ authCode: string }` → `{ ok: true }` with `sb-access-token` cookie set, or `401/404/429`.
  Task 15's client hook calls this route.

- [ ] **Step 1: Failing tests for the resolver (mock db)**

```ts
// __tests__/lib/vodapay-identity.test.ts
import { describe, expect, it, vi } from 'vitest'
import { resolveVodapayCustomer } from '@/lib/vodapay/identity'

function mockDb(overrides: Record<string, unknown> = {}) {
  return {
    customerExternalIdentity: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async (args: { data: unknown }) => args.data),
    },
    customer: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: 'cust_new' })),
    },
    ...overrides,
  } as never
}

describe('resolveVodapayCustomer', () => {
  it('existing identity short-circuits', async () => {
    const db = mockDb({
      customerExternalIdentity: {
        findUnique: vi.fn(async () => ({ customerId: 'cust_1' })),
        create: vi.fn(),
      },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u1', phone: '+27821234567' })
    expect(out).toEqual({ customerId: 'cust_1', created: false })
  })
  it('phone match links identity', async () => {
    const db = mockDb({
      customer: { findFirst: vi.fn(async () => ({ id: 'cust_p' })), create: vi.fn() },
    })
    const out = await resolveVodapayCustomer({ db }, { externalId: 'u2', phone: '+27821234567' })
    expect(out).toEqual({ customerId: 'cust_p', created: false })
    expect((db as never as { customerExternalIdentity: { create: ReturnType<typeof vi.fn> } })
      .customerExternalIdentity.create).toHaveBeenCalled()
  })
  it('no match creates customer + identity', async () => {
    const db = mockDb()
    const out = await resolveVodapayCustomer(
      { db }, { externalId: 'u3', phone: '+27829999999', fullName: 'Thabo M' })
    expect(out.created).toBe(true)
  })
})
```

Run — FAIL.

- [ ] **Step 2: Implement `lib/vodapay/identity.ts`**

```ts
import 'server-only'
import { db as realDb } from '@/lib/db'

type Db = typeof realDb

export async function resolveVodapayCustomer(
  deps: { db?: Db },
  input: { externalId: string; phone: string; fullName?: string },
): Promise<{ customerId: string; created: boolean }> {
  const db = deps.db ?? realDb
  const existing = await db.customerExternalIdentity.findUnique({
    where: { provider_externalId: { provider: 'VODAPAY', externalId: input.externalId } },
    select: { customerId: true },
  })
  if (existing) return { customerId: existing.customerId, created: false }

  const byPhone = await db.customer.findFirst({
    where: { phone: input.phone }, select: { id: true },
  })
  if (byPhone) {
    await db.customerExternalIdentity.create({
      data: { customerId: byPhone.id, provider: 'VODAPAY', externalId: input.externalId },
    })
    return { customerId: byPhone.id, created: false }
  }

  const created = await db.customer.create({
    data: { phone: input.phone, name: input.fullName ?? null, channel: 'PWA' },
    select: { id: true },
  })
  await db.customerExternalIdentity.create({
    data: { customerId: created.id, provider: 'VODAPAY', externalId: input.externalId },
  })
  return { customerId: created.id, created: true }
}
```

Before writing, check `Customer.create` required fields in schema (e.g. `active` defaults) and the exact composite-unique accessor name Prisma generates (`provider_externalId`). Adjust to reality.

- [ ] **Step 3: Run resolver tests — PASS.**

- [ ] **Step 4: The route (session mint)**

```ts
// app/api/auth/vodapay/route.ts
import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isEnabled } from '@/lib/flags'
import { applyToken, inquiryUserInfo, VodapayApiError } from '@/lib/vodapay/client'
import { resolveVodapayCustomer } from '@/lib/vodapay/identity'
import { db } from '@/lib/db'

export async function POST(request: Request) {
  if (!(await isEnabled('channel.vodapay.v1'))) {
    return NextResponse.json({ error: 'not_available' }, { status: 404 })
  }
  const body = (await request.json().catch(() => null)) as { authCode?: unknown } | null
  if (typeof body?.authCode !== 'string' || !body.authCode) {
    return NextResponse.json({ error: 'auth_code_required' }, { status: 400 })
  }
  try {
    const token = await applyToken(body.authCode)
    const info = await inquiryUserInfo(token.accessToken)
    if (!info.mobileNumber) {
      return NextResponse.json({ error: 'phone_unavailable' }, { status: 401 })
    }
    const phone = normalizeToE164(info.mobileNumber) // reuse the repo's existing phone util
    const { customerId } = await resolveVodapayCustomer({}, {
      externalId: token.customerId, phone, fullName: info.userName?.fullName,
    })

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
    // Ensure a Supabase auth user for this phone (mirrors provider-approval-auth-user.ts)
    let userId: string
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      phone, phone_confirm: true,
    })
    if (createErr) {
      // Already exists → look it up; any other error is fatal.
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 })
      // NOTE: listUsers cannot filter by phone in supabase-js v2.106 —
      // implement lookup via admin.auth.admin.getUserById after storing the id,
      // or the repo's existing lookup helper if one exists (grep getUserByPhone).
      // If no helper exists, query the auth schema is NOT allowed; instead rely
      // on createUser's error carrying the existing user, per the pattern in
      // provider-approval-auth-user.ts — read that file and copy its resolution.
      userId = resolveExistingUserId(createErr, list) // implement per the pattern found
    } else {
      userId = created.user.id
    }

    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink', email: undefined as never, // phone user: use type 'magiclink' only if repo pattern supports it;
    })
    // ALTERNATIVE (preferred if generateLink requires email): createSession via
    // admin.auth.admin.createSession({ user_id: userId }) — available in
    // supabase-js >= 2.100 as admin API; verify against node_modules types and
    // use whichever exists. The deliverable is a valid access token for userId.
    const accessToken = extractAccessToken(link, linkErr) // per chosen path

    // Link Customer.userId if not already linked (existing helper)
    await db.customer.update({ where: { id: customerId }, data: { userId } })
      .catch(() => undefined) // ignore if another userId already linked; do not overwrite

    const res = NextResponse.json({ ok: true })
    setSessionCookie(res, accessToken) // reuse lib/auth-session-cookie.ts writer
    return res
  } catch (err) {
    if (err instanceof VodapayApiError) {
      return NextResponse.json({ error: 'vodapay_auth_failed' }, { status: 401 })
    }
    console.error('[vodapay auth]', err)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }
}
```

**Implementation note (mandatory):** the session-mint block above intentionally shows two candidate paths. Before coding, read `node_modules/@supabase/supabase-js` admin types and `lib/provider-approval-auth-user.ts` end-to-end, pick the ONE path the installed SDK supports (`admin.createSession` if present; else `generateLink({ type: 'magiclink' })` + `verifyOtp({ token_hash, type: 'magiclink' })` on the anon client server-side), delete the other, and delete both placeholder helpers (`resolveExistingUserId`, `extractAccessToken`) in favour of the real code. Reuse the exact cookie-writing call `app/api/auth/session/route.ts:127` uses rather than re-implementing `setSessionCookie`. Add the same per-IP rate limit the OTP endpoints use (grep `rateLimit` under `app/api/auth/`).

- [ ] **Step 5: Manual route test**

With flags off: `curl -s -X POST localhost:3000/api/auth/vodapay -d '{}'` → 404. (Real auth path is sandbox-only — covered by the e2e stub in Task 18 and sandbox QA.)

- [ ] **Step 6: Suite, typecheck, commit**

```bash
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
git add lib/vodapay/identity.ts app/api/auth/vodapay/route.ts proxy.ts __tests__/lib/vodapay-identity.test.ts
git commit -m "feat(vodapay): federated login — identity link + supabase session mint via /api/auth/vodapay"
```

---

### Task 15: Client login hook + auth-gate branch

**Files:**
- Create: `field-service/components/customer/useVodapayLogin.ts`
- Modify: `field-service/components/customer/bookingSubmitAuthGate.ts` (`nextActionForAuthFailure`, line 8)
- Modify: `field-service/components/customer/BookingFlow.tsx` (wiring at ~lines 636-660)
- Test: `field-service/__tests__/components/bookingSubmitAuthGate.test.ts` (extend the existing test file if present — `ls __tests__ | grep -i authgate` first)

**Interfaces:**
- Consumes: `window.my.getAuthCode` typing (Task 9), `POST /api/auth/vodapay` (Task 14), existing gate return type `'open_dialog' | 'redirect' | 'none'`.
- Produces: gate returns new variant `'open_vodapay'`; `useVodapayLogin(): { login: () => Promise<boolean> }` (true = session cookie set). BookingFlow: on `'open_vodapay'` call `login()`; on success retry submit; on failure fall through to `'open_dialog'` behaviour.

- [ ] **Step 1: Failing gate test**

Read the existing gate + its test first. Add:

```ts
it('vodapay channel with bridge → open_vodapay', () => {
  expect(nextActionForAuthFailure({ status: 401, inlineOtpEnabled: true, vodapayAvailable: true }))
    .toBe('open_vodapay')
})
it('vodapay unavailable falls back to dialog', () => {
  expect(nextActionForAuthFailure({ status: 401, inlineOtpEnabled: true, vodapayAvailable: false }))
    .toBe('open_dialog')
})
```

Adapt the argument shape to the real signature (read it — line 8); if it takes positional args, extend accordingly. Run — FAIL.

- [ ] **Step 2: Implement the gate branch**

Add `vodapayAvailable?: boolean` to the input; before the existing inline-OTP branch:

```ts
if (vodapayAvailable) return 'open_vodapay'
```

Widen the return union with `'open_vodapay'`.

- [ ] **Step 3: Gate test PASS.**

- [ ] **Step 4: The hook**

```ts
// components/customer/useVodapayLogin.ts
'use client'
import { useCallback } from 'react'
import { detectMiniProgram } from '@/lib/vodapay/bridge'

export function useVodapayLogin() {
  const available =
    typeof window !== 'undefined' && detectMiniProgram(navigator.userAgent, window.my)

  const login = useCallback(async (): Promise<boolean> => {
    if (!available || !window.my) return false
    const authCode = await new Promise<string | null>((resolve) => {
      window.my!.getAuthCode({
        scopes: ['auth_user'],
        success: (res) => resolve(res.authCode ?? null),
        fail: () => resolve(null),
      })
    })
    if (!authCode) return false
    const res = await fetch('/api/auth/vodapay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ authCode }),
    }).catch(() => null)
    return Boolean(res?.ok)
  }, [available])

  return { available, login }
}
```

- [ ] **Step 5: Wire into BookingFlow**

Read `BookingFlow.tsx:600-700`. Where the current code switches on `nextActionForAuthFailure(...)`: pass `vodapayAvailable: vodapay.available`, and handle:

```ts
if (action === 'open_vodapay') {
  const ok = await vodapay.login()
  if (ok) { void retrySubmit(); return }
  // fall back to the inline OTP dialog path
  openOtpDialog()
  return
}
```

using the file's actual retry/dialog function names (read them; do not invent — the retry is whatever the `'open_dialog'` success path calls after OTP verify).

- [ ] **Step 6: Suite + typecheck + commit**

```bash
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
git add components/customer/useVodapayLogin.ts components/customer/bookingSubmitAuthGate.ts components/customer/BookingFlow.tsx __tests__
git commit -m "feat(vodapay): bridge login at booking submit with inline-OTP fallback"
```

---

### Task 16: Cashier PSP provider + per-channel resolver + webhook guards extraction

**Files:**
- Create: `field-service/lib/payments/providers/vodapay.ts`
- Create: `field-service/lib/payments/webhook-guards.ts` (extracted from `app/api/webhooks/payments/route.ts`)
- Modify: `field-service/lib/payments.ts` (`getProvider` ~line 284, `createCheckout` ~line 300, `initializeBookingPayment` ~line 327)
- Modify: `field-service/app/api/webhooks/payments/route.ts` (consume the extracted guards; behaviour identical)
- Test: `field-service/__tests__/lib/payments-vodapay-provider.test.ts`, `field-service/__tests__/lib/psp-resolver.test.ts`

**Interfaces:**
- Consumes: Task 12 `verifySignature`/`parseSignatureHeader`/`buildSignaturePayload`; Task 13 `payCashier`/`refundPayment`; existing `PspProvider` interface (`lib/payments.ts:70`), `CheckoutParams`/`CheckoutSession`/`PaymentEvent`/`RefundResult` types.
- Produces:
  - `class VodapayCashierProvider implements PspProvider` (exported from the new file).
  - `resolvePspProviderNameFor(input: { jobRequestSource?: string | null; vodapayFlagOn: boolean }): string` exported from `lib/payments.ts` — `'vodapay'` iff source is `'vodapay'` and flag on; else the existing `resolvePspProviderName()` result. Pure and unit-testable.
  - `getProvider(name?: string)` gains an optional explicit name param (default: current behaviour) and a `'vodapay'` case.
  - `initializeBookingPayment` looks up the booking's `JobRequest.source` (via the booking→match→jobRequest relation it already queries for the pilot gate), awaits `isEnabled('payments.vodapay.v1')`, and when the resolver says `'vodapay'` forces checkout mode and passes the explicit provider name into `createCheckout`.
  - `webhook-guards.ts` exports the amount-match and idempotency helpers with the exact logic currently inline in the generic route (extract verbatim; both routes share them). Task 17 consumes them.

- [ ] **Step 1: Failing resolver test**

```ts
// __tests__/lib/psp-resolver.test.ts
import { describe, expect, it } from 'vitest'
import { resolvePspProviderNameFor } from '@/lib/payments'

describe('resolvePspProviderNameFor', () => {
  it('vodapay source + flag on → vodapay', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'vodapay', vodapayFlagOn: true }))
      .toBe('vodapay')
  })
  it('vodapay source + flag off → global default (peach)', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'vodapay', vodapayFlagOn: false }))
      .toBe('peach')
  })
  it('pwa source ignores the flag', () => {
    expect(resolvePspProviderNameFor({ jobRequestSource: 'pwa', vodapayFlagOn: true }))
      .toBe('peach')
  })
})
```

(`lib/payments.ts` is `server-only` — apply the repo's established mock, same as earlier tasks.) Run — FAIL.

- [ ] **Step 2: Failing provider tests**

```ts
// __tests__/lib/payments-vodapay-provider.test.ts
import { generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { VodapayCashierProvider } from '@/lib/payments/providers/vodapay'
import { buildSignaturePayload, signRequest } from '@/lib/vodapay/signing'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const PRIV = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string
const PUB = publicKey.export({ type: 'spki', format: 'pem' }) as string

beforeEach(() => {
  process.env.VODAPAY_PLATFORM_PUBLIC_KEY = PUB
  process.env.VODAPAY_CLIENT_ID = 'C1'
})

describe('VodapayCashierProvider', () => {
  it('parseWebhookEvent maps SUCCESS notify', () => {
    const body = JSON.stringify({
      paymentId: 'P1', paymentRequestId: 'pay_row_1',
      paymentAmount: { currency: 'ZAR', value: '15000' },
      paymentTime: '2026-09-07T12:00:00Z',
      result: { resultCode: 'SUCCESS', resultStatus: 'S' },
    })
    const evt = new VodapayCashierProvider().parseWebhookEvent(body)
    expect(evt).toMatchObject({ type: 'payment.succeeded', paymentId: 'pay_row_1', amount: 15000, currency: 'ZAR' })
  })
  it('verifyWebhook accepts a platform-signed body and rejects tampering', () => {
    const body = '{"paymentId":"P1"}'
    const payload = buildSignaturePayload({
      method: 'POST', path: '/api/webhooks/vodapay', clientId: 'C1',
      requestTime: 'T1', body,
    })
    const sig = signRequest(payload, PRIV)
    const header = `algorithm=RSA256,signature=${encodeURIComponent(sig)}`
    const p = new VodapayCashierProvider()
    expect(p.verifyWebhook(body, `${header}|T1`)).toBe(true)
    expect(p.verifyWebhook(body + 'x', `${header}|T1`)).toBe(false)
  })
})
```

Note the `signature|requestTime` packing: `PspProvider.verifyWebhook(rawBody, signature)` has only two params, so the route (Task 17) concatenates `signatureHeader + '|' + requestTimeHeader`. Document this in both files. Adapt `PaymentEvent` field names to the real type (read `lib/payments.ts:40-65` for the exact `PaymentEvent` shape and mirror it — the `type/paymentId/amount/currency/raw` fields shown here must match reality). Run — FAIL.

- [ ] **Step 3: Implement the provider**

```ts
// lib/payments/providers/vodapay.ts
import 'server-only'
import { payCashier, refundPayment } from '@/lib/vodapay/client'
import { buildSignaturePayload, parseSignatureHeader, verifySignature } from '@/lib/vodapay/signing'
import type { CheckoutParams, CheckoutSession, PaymentEvent, PspProvider, RefundResult } from '@/lib/payments'

const NOTIFY_PATH = '/api/webhooks/vodapay'

export class VodapayCashierProvider implements PspProvider {
  async createCheckout(params: CheckoutParams): Promise<CheckoutSession> {
    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'https://app.plugapro.co.za'
    const expiry = new Date(Date.now() + 30 * 60_000).toISOString()
    const out = await payCashier({
      paymentRequestId: params.bookingId, // stable id → webhook correlation
      amountCents: params.amount,
      notifyUrl: `${base}${NOTIFY_PATH}`,
      redirectUrl: `${base}/bookings/${params.bookingId}?paid=1`,
      orderDescription: params.description ?? 'Plug A Pro booking',
      expiryIso: expiry,
    })
    return { id: out.paymentId, url: out.redirectUrl }
  }

  // signature param is packed as `<Signature header>|<Request-Time header>` by the route.
  verifyWebhook(rawBody: string, signature: string): boolean {
    const sep = signature.lastIndexOf('|')
    if (sep < 0) return false
    const parsed = parseSignatureHeader(signature.slice(0, sep))
    const requestTime = signature.slice(sep + 1)
    const publicKey = process.env.VODAPAY_PLATFORM_PUBLIC_KEY
    const clientId = process.env.VODAPAY_CLIENT_ID
    if (!parsed || !publicKey || !clientId || !requestTime) return false
    const payload = buildSignaturePayload({
      method: 'POST', path: NOTIFY_PATH, clientId, requestTime, body: rawBody,
    })
    return verifySignature(payload, parsed.signature, publicKey)
  }

  parseWebhookEvent(rawBody: string): PaymentEvent {
    const n = JSON.parse(rawBody) as {
      paymentId?: string; paymentRequestId?: string; paymentTime?: string
      paymentAmount?: { currency?: string; value?: string }
      result?: { resultStatus?: string }
    }
    const succeeded = n.result?.resultStatus === 'S'
    return {
      type: succeeded ? 'payment.succeeded' : 'payment.failed',
      paymentId: n.paymentRequestId ?? '',
      amount: n.paymentAmount?.value ? Number(n.paymentAmount.value) : 0,
      currency: n.paymentAmount?.currency ?? 'ZAR',
      raw: n,
    } as PaymentEvent // align fields with the real PaymentEvent type, then drop the cast
  }

  async createRefund(pspReference: string, amountCents: number): Promise<RefundResult> {
    // VERIFY-IN-SANDBOX (spec §8)
    const out = await refundPayment({
      paymentId: pspReference,
      refundRequestId: `rf_${pspReference}_${Date.now()}`,
      amountCents,
    })
    return { success: true, refundReference: out.refundId }
  }
}
```

Export the needed types from `lib/payments.ts` if they aren't already (`PspProvider` is currently non-exported — export it plus `CheckoutParams`, `CheckoutSession`, `PaymentEvent`).

- [ ] **Step 4: Resolver + wiring in `lib/payments.ts`**

```ts
export function resolvePspProviderNameFor(input: {
  jobRequestSource?: string | null
  vodapayFlagOn: boolean
}): string {
  if (input.jobRequestSource === 'vodapay' && input.vodapayFlagOn) return 'vodapay'
  return resolvePspProviderName()
}
```

`getProvider(name?: string)`: `const provider = name ?? resolvePspProviderName()`; add `case 'vodapay': return new VodapayCashierProvider()`. `createCheckout(params, providerName?)`: use `providerName ?? resolvePspProviderName()` for both the provider and the persisted `pspProvider`. In `initializeBookingPayment`: the pilot-gate query already fetches the booking's relations — extend its `select` to include `match.jobRequest.source`, then:

```ts
const vodapayFlagOn = await isEnabled('payments.vodapay.v1')
const pspName = resolvePspProviderNameFor({ jobRequestSource, vodapayFlagOn })
const collectionMode = pspName === 'vodapay' ? 'checkout' : getPaymentCollectionMode()
```

and pass `pspName` through to `createCheckout` when in checkout mode. Read the whole function first; keep the bypass path byte-identical for non-vodapay.

- [ ] **Step 5: Extract webhook guards**

Move the amount-verification and idempotency logic from `app/api/webhooks/payments/route.ts` (lines ~44-60) into `lib/payments/webhook-guards.ts` as exported functions with the same behaviour; update the generic route to import them. Run the existing payments/webhook tests (`ls __tests__ | grep -i payment`) — all green, zero behaviour change.

- [ ] **Step 6: All tests + typecheck + commit**

```bash
npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
git add lib/payments.ts lib/payments/providers/vodapay.ts lib/payments/webhook-guards.ts app/api/webhooks/payments/route.ts __tests__
git commit -m "feat(payments): VodaPay cashier PSP + per-channel resolver (flag-gated), shared webhook guards"
```

---

### Task 17: VodaPay webhook route

**Files:**
- Create: `field-service/app/api/webhooks/vodapay/route.ts`
- Modify: `field-service/proxy.ts` (PUBLIC_PATHS: `'/api/webhooks/vodapay'`)
- Test: `field-service/__tests__/api/webhooks-vodapay.test.ts` (route handler invoked directly, mocked db)

**Interfaces:**
- Consumes: `VodapayCashierProvider` (Task 16), webhook guards (Task 16), `db.payment`.
- Produces: `POST /api/webhooks/vodapay` — verify (fail-closed 401), parse, guard, update Payment by `paymentRequestId` (= `bookingId` per Task 16), ack `{"result":{"resultCode":"SUCCESS","resultStatus":"S"}}` with 200. Processes regardless of flag state (in-flight payments must land after a flag-off).

- [ ] **Step 1: Failing test**

```ts
// __tests__/api/webhooks-vodapay.test.ts
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/payments/providers/vodapay', () => ({
  VodapayCashierProvider: class {
    verifyWebhook = vi.fn(() => true)
    parseWebhookEvent = vi.fn(() => ({
      type: 'payment.succeeded', paymentId: 'bk1', amount: 15000, currency: 'ZAR', raw: {},
    }))
  },
}))
vi.mock('@/lib/db', () => ({
  db: {
    payment: {
      findUnique: vi.fn(async () => ({ id: 'pay1', bookingId: 'bk1', status: 'PENDING', amount: 150 })),
      update: vi.fn(async () => ({})),
    },
  },
}))

import { POST } from '@/app/api/webhooks/vodapay/route'

describe('POST /api/webhooks/vodapay', () => {
  it('acks SUCCESS and marks payment paid', async () => {
    const req = new Request('https://app/api/webhooks/vodapay', {
      method: 'POST',
      headers: { Signature: 'algorithm=RSA256,signature=x', 'Request-Time': 'T1' },
      body: '{"paymentRequestId":"bk1"}',
    })
    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { resultCode: 'SUCCESS', resultStatus: 'S' } })
  })
})
```

Add a second case: verify mock returns false → 401, db.update never called. Run — FAIL (route missing).

- [ ] **Step 2: Implement**

```ts
// app/api/webhooks/vodapay/route.ts
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { VodapayCashierProvider } from '@/lib/payments/providers/vodapay'
// import the extracted guards and apply them exactly as the generic route does

const ACK = { result: { resultCode: 'SUCCESS', resultStatus: 'S' } }

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('signature') ?? ''
  const requestTime = request.headers.get('request-time') ?? ''
  const provider = new VodapayCashierProvider()

  if (!provider.verifyWebhook(rawBody, `${signature}|${requestTime}`)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 })
  }
  const event = provider.parseWebhookEvent(rawBody)
  const payment = await db.payment.findUnique({ where: { bookingId: event.paymentId } })
  if (!payment) return NextResponse.json(ACK) // unknown ref: ack to stop retries, log it
  // idempotency + amount guards (shared helpers from Task 16) — mirror the
  // generic route's behaviour exactly, including its logging.
  if (event.type === 'payment.succeeded' && payment.status !== 'PAID') {
    await db.payment.update({
      where: { id: payment.id },
      data: { status: 'PAID', paidAt: new Date(), pspReference: String((event.raw as { paymentId?: string }).paymentId ?? '') },
    })
  }
  if (event.type === 'payment.failed' && payment.status === 'PENDING') {
    await db.payment.update({ where: { id: payment.id }, data: { status: 'FAILED' } })
  }
  return NextResponse.json(ACK)
}
```

Check the real `Payment.status` enum values first (grep `enum PaymentStatus` in schema) and use them verbatim; same for whether the generic route emits a WorkflowEvent on paid (mirror it if so).

- [ ] **Step 3: Tests PASS; suite green; commit.**

```bash
git add app/api/webhooks/vodapay proxy.ts __tests__/api/webhooks-vodapay.test.ts
git commit -m "feat(payments): VodaPay notify webhook (fail-closed signature, shared guards)"
```

---

### Task 18: `tradePay` checkout UI + smoke e2e

**Files:**
- Modify: `field-service/components/customer/BookingFlow.tsx` (or the payment CTA component — grep `checkoutUrl` under `components/` and `app/(customer)` to find where the customer is sent to pay; modify THAT component)
- Create: `field-service/e2e/vodapay.spec.ts`
- Modify: `field-service/e2e/smoke.spec.ts` only if the suite registry requires listing (read its structure first)

**Interfaces:**
- Consumes: `window.my.tradePay` (Task 9 typing), `pap_channel` cookie behaviour, `/vodapay` route (Task 9), existing payment status endpoint (grep `payments/` under `app/api` for the customer-facing status route; if none exists, poll the booking page's server data via `router.refresh()` instead — decide from what exists).
- Produces: in VodaPay mode the pay CTA calls `tradePay({ paymentUrl })` and on `resultCode === '9000'` refreshes until paid (60 s cap); elsewhere unchanged. E2E spec drives the whole channel with a stubbed bridge.

- [ ] **Step 1: Pay CTA change**

In the located pay component, replace the plain `window.location.href = checkoutUrl` (or `<a href>`) branch with:

```ts
import { detectMiniProgram } from '@/lib/vodapay/bridge'

function openCheckout(checkoutUrl: string, onSettled: () => void) {
  if (typeof window !== 'undefined' && detectMiniProgram(navigator.userAgent, window.my) && window.my) {
    window.my.tradePay({
      paymentUrl: checkoutUrl,
      success: (res) => { if (res.resultCode === '9000') onSettled() },
      fail: () => onSettled(), // webhook remains source of truth; refresh shows state
    })
    return
  }
  window.location.href = checkoutUrl
}
```

`onSettled` = start polling/refresh loop (max 60 s, 3 s interval) until the booking's payment status is PAID or the cap hits, then render the paid/failed state the page already has.

- [ ] **Step 2: E2E with stubbed bridge**

```ts
// e2e/vodapay.spec.ts
import { expect, test } from '@playwright/test'

// Requires flags channel.vodapay.v1 (+ payments.vodapay.v1 for the pay leg)
// enabled in the target env. Skip when the entry 404s (flags off).
test('vodapay entry sets channel and hides WhatsApp CTAs', async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { my: unknown }).my = {
      getAuthCode: (o: { success: (r: { authCode: string }) => void }) =>
        o.success({ authCode: 'stub-auth-code' }),
      tradePay: (o: { success: (r: { resultCode: string }) => void }) =>
        o.success({ resultCode: '9000' }),
      getLocation: (o: { fail: () => void }) => o.fail(),
      getEnv: (o: { success: (r: { language: string }) => void }) =>
        o.success({ language: 'en' }),
    }
  })
  const res = await page.goto('/vodapay')
  test.skip(res?.status() === 404, 'channel.vodapay.v1 disabled in this env')
  await page.waitForURL('**/')
  const cookies = await page.context().cookies()
  expect(cookies.find((c) => c.name === 'pap_channel')?.value).toBe('vodapay')
  await expect(page.locator('a[href*="wa.me"]')).toHaveCount(0)
})
```

Follow `e2e/smoke.spec.ts`'s conventions (baseURL, auth helpers) exactly; extend rather than fork if it has shared fixtures.

- [ ] **Step 3: Run what's runnable, commit**

`npx vitest run 2>&1 | tail -3`; `npx playwright test e2e/vodapay.spec.ts` against a local dev server with the flag enabled if feasible, else rely on the skip guard and note it.

```bash
git add components/ e2e/vodapay.spec.ts
git commit -m "feat(vodapay): tradePay checkout path + channel smoke e2e (stubbed bridge)"
```

---

### Task 19: Env + rollout runbook, PR assembly

**Files:**
- Create: `docs/runbooks/vodapay-rollout.md`
- Modify: `field-service/.env.example` (if the repo has one — `ls field-service/.env*`; else document env in the runbook only)

**Interfaces:**
- Consumes: everything above.
- Produces: the runbook; the PRs.

- [ ] **Step 1: Runbook**

```markdown
# VodaPay channel rollout

## Env (per environment; set via `printf '%s' 'VAL' | vercel env add NAME <env>` — NEVER echo)
VODAPAY_CLIENT_ID, VODAPAY_MERCHANT_ID, VODAPAY_MINI_PROGRAM_APP_ID,
VODAPAY_API_BASE (sandbox vs prod host), VODAPAY_PRIVATE_KEY (PKCS8 PEM, ours),
VODAPAY_PLATFORM_PUBLIC_KEY (SPKI PEM, theirs), VODAPAY_TOKEN_KEY (32B base64, AES-GCM),
VODAPAY_CSP_HOSTS (space-separated https origins for connect-src),
NEXT_PUBLIC_VAT_NUMBER, NEXT_PUBLIC_REGISTERED_ADDRESS (marketing project).

Key generation: `openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out vodapay.pem`
then `openssl pkey -in vodapay.pem -pubout` — upload the PUBLIC key in the VodaPay
console; the private key goes only into Vercel env.

## Order of operations
1. Merge PRs; prod behaviour unchanged (flags OFF, env unset).
2. Workspace approved → set sandbox env vars → run migration deploy (`prisma migrate deploy` is CI-standard).
3. Enable `channel.vodapay.v1` (DB flag) → sandbox device test: entry, login, address, waitlist copy.
4. Enable `payments.vodapay.v1` → sandbox cashier end-to-end incl. webhook + refund (VERIFY-IN-SANDBOX items in lib/vodapay/client.ts).
5. VodaPay QA submission (Tue/Thu) using docs/ops/marketplace-onboarding/vodapay-application.md checklist.
6. Prod env vars → flags stay OFF until VodaPay Final Release; flip channel first, payments second.

## Kill switch
Flip both flags OFF. In-flight payments still settle: /api/webhooks/vodapay processes regardless of flags.

## Watch after flip
- WorkflowEvents source=vodapay in the admin funnel report
- ServiceAreaWaitlist source=vodapay (out-of-fence marketplace demand)
- Payment rows pspProvider=vodapay stuck PENDING > 10 min
```

- [ ] **Step 2: Assemble PRs**

Per the spec's sequencing, from the worktree branch(es), open:
1. PR A: Tasks 1-5 (docs + marketing + legal viewer) — no app-behaviour risk.
2. PR B: Tasks 6-10 (flags, WebView unblock, channel, attribution).
3. PR C: Task 11 (migration) + Tasks 12-15 (login).
4. PR D: Tasks 16-18 (payments) + Task 19 runbook.

Each PR body: what/why, flag state (OFF), test evidence (vitest counts), the smoke note, and the standard generated-with footer. Do not merge — hand the PR URLs to the owner (merges need live approval per repo policy).

- [ ] **Step 3: Final full-suite run + commit**

```bash
cd field-service && npx vitest run 2>&1 | tail -3 && npx tsc --noEmit 2>&1 | tail -3
git add docs/runbooks/vodapay-rollout.md field-service/.env.example
git commit -m "docs(runbook): VodaPay rollout — env, key generation, flag order, kill switch"
```

---

## Self-review notes (author)

- Spec coverage: W0→Task 1; W1→Tasks 2-5; W2→Task 7; W3→Tasks 8-10; W4→Tasks 11, 14-15; W5→Tasks 12-13, 16-18; testing→each task + Task 18; rollout/flags→Tasks 6, 19. No spec section unmapped.
- Known deliberate open points (flagged in-task, not placeholders): the Supabase session-mint path (Task 14 forces reading the installed SDK and the existing provider-approval pattern before choosing `createSession` vs `generateLink`); `PaymentEvent` exact field names (Task 16 requires reading the real type); refund API shape (VERIFY-IN-SANDBOX per spec §8).
- Type consistency: `detectMiniProgram(ua, my)` (Tasks 9/15/18), `normalizeRequestSource` (Task 10), `resolvePspProviderNameFor({ jobRequestSource, vodapayFlagOn })` (Task 16), `verifyWebhook(rawBody, 'sig|requestTime')` packing (Tasks 16/17) — names match across tasks.

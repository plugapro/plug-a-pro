# Plug A Pro Vercel + DNS — Read-Only Audit

**Date:** 20 April 2026  
**Signed in as:** `Lebogang / lebogang@kgolaentle.com`  
**Account:** `lebogangs-projects-6ffadd97` (personal Pro account — runbook's `team_AuQBnvSyZpJYcMRWjbXkM7p5` team ID appears to be stale; the real projects live on this personal account)  
**Scope:** Runbook tasks T1–T9 from `vercel-dns-setup-agent-prompt.md`, read-only.

---

## Bottom line

The runbook is **mostly already executed**. Of 9 tasks, 6 are complete, 1 is partial, 2 have gaps that need action. No browser writes were performed during this audit.

| Task | Status | Action needed |
|---|---|---|
| T1 — field-service project settings | ✅ Done | None |
| T2 — marketing project settings | ✅ Done | None |
| T3 — field-service env vars | ⚠ Partial (26/27) | Add `PAYMENT_COLLECTION_MODE` |
| T4 — marketing env vars | ✅ Done (3/3 by key) | Verify per-env targets |
| T5 — `app.plugapro.co.za` domain | ✅ Done | None |
| T6 — apex + www domains | ✅ Done (but see gap below) | Set www → apex redirect |
| T7 — DNS records at registrar | ✅ Done (implicitly) | None — all four custom domains show Valid |
| T8 — disable preview indexing | ❌ Not done | Repo change required (outside browser) |
| T9 — live verification | ✅ Domains resolve | Fix www → apex redirect |

---

## Detail by task

### T1 — `plug-a-pro` (field-service) project settings ✅

Read directly from Build & Deployment settings form:

- Root Directory: **`field-service`** ✓
- Node.js Version: **`24.x`** ✓
- Build Command: **empty** (inherits `next build`) ✓
- Framework Preset: Next.js
- Project ID: `prj_xHSXSrkueFjJezsgi8xkR3EpGGya` — matches the runbook exactly.

No changes needed.

### T2 — `plug-a-pro-marketing` project settings ✅

- Root Directory: **`marketing`** ✓
- Build Command: **empty** ✓
- Framework: Next.js, Node 24.x

No changes needed.

### T3 — field-service environment variables ⚠ Partial

**26 of 27 runbook-required keys are present.** Visible keys captured by scrolling the env-vars list (without revealing any values):

**Present (matches runbook):**
`BUSINESS_SLUG`, `MULTI_TENANT_MODE`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `DIRECT_URL`, `BLOB_READ_WRITE_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_WABA_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `PSP_PROVIDER`, `PAYFAST_MERCHANT_ID`, `PAYFAST_MERCHANT_KEY`, `PAYFAST_PASSPHRASE`, `PAYFAST_SANDBOX`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_APP_URL`, `AUTH_SECRET`, `ADMIN_WHATSAPP_NUMBER`, `CRON_SECRET`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.

**Missing (1):**
- **`PAYMENT_COLLECTION_MODE`** — runbook wants two entries: `checkout` on Production, `bypass` on Preview + Development. Neither is set. Without this, payment behaviour will fall back to whatever the code defaults to — likely an error or unexpected state.

**Extra keys present (not in runbook, likely fine):**
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` — non-`NEXT_PUBLIC_` duplicates. Likely legacy. Can probably be removed once confirmed nothing reads them.
- `SUPPORT_WHATSAPP_NUMBER`
- `STATIC_OTP_ALLOWED_COUNTRIES`, `STATIC_OTP_ALLOWED_PHONE_PREFIXES`, `STATIC_OTP_ALLOW_IN_PRODUCTION`, `STATIC_OTP_ENABLED`, `STATIC_OTP_REQUIRE_E164`, `STATIC_OTP_SESSION_SECRET` — OTP test harness; intentional.

**Caveats I could not verify without revealing secrets:**
- **Per-environment targets on each key** (e.g. whether `NEXT_PUBLIC_APP_URL` is Production-only as the runbook specifies). Requires clicking into each row. Flag specific keys if you want me to open them.
- **Actual values.** Did not click any "Show" button; values remain masked. You should eyeball `NEXT_PUBLIC_APP_URL` = `https://app.plugapro.co.za` and `VAPID_SUBJECT` = `mailto:hello@plugapro.co.za` yourself.

### T4 — marketing environment variables ✅

All 3 runbook keys present:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_SITE_URL`

Same caveats as T3 — can't verify per-env targets from the list view. The runbook wants `NEXT_PUBLIC_SITE_URL=https://plugapro.co.za` on Production; please confirm by opening the row.

### T5 — `app.plugapro.co.za` on field-service ✅

On `/plug-a-pro/settings/domains`:
- `admin.plugapro.co.za` — ✓ Valid Configuration, Production
- **`app.plugapro.co.za`** — ✓ Valid Configuration, Production
- `plug-a-pro.vercel.app` — ✓ Valid Configuration, Production (default)

No add needed.

### T6 — apex + www on marketing ✅

On `/plug-a-pro-marketing/settings/domains`:
- `plugapro.co.za` — ✓ Valid Configuration, Production
- `www.plugapro.co.za` — ✓ Valid Configuration, Production
- `plug-a-pro-marketing.vercel.app` — ✓ Valid Configuration, Production (default)

**Gap:** `www` is configured as a **standalone domain**, not as a redirect to the apex. See T9 for the live confirmation.

### T7 — DNS records at registrar ✅ (implicit)

I did not visit the registrar. But because all four custom domains (`plugapro.co.za`, `www.plugapro.co.za`, `app.plugapro.co.za`, `admin.plugapro.co.za`) show **Valid Configuration** in Vercel, the DNS records must be correctly in place — Vercel's validator checks them continuously and the Valid state is revoked within minutes if the records disappear.

If you want a specific screenshot of the current DNS at the registrar anyway, tell me which registrar (the runbook didn't name it) and I'll walk you through the page.

### T8 — Disable preview indexing ❌ Not done

**Empirical check:** a HEAD request to `https://plug-a-pro-marketing.vercel.app/` returns `200` with **no `X-Robots-Tag` header** set. So search engines can and will index the preview domain.

**I couldn't find a UI toggle** for this on Vercel:
- Checked `/settings/deployment-protection` — only auth/access protection toggles live here.
- Checked `/settings/advanced` — only Directory Listing and Skew Protection.

The runbook's description ("Disable indexing on Preview Deployments") looks like it predates Vercel's current layout. On the current Vercel platform, the correct way to do this is one of:

1. **Add a `headers` rule to `vercel.json`** in the `plug-a-pro-marketing` repo under the `marketing/` directory, adding `X-Robots-Tag: noindex` conditionally for non-production hosts.
2. **Middleware** that reads `request.headers.get('host')` and adds the `X-Robots-Tag: noindex` response header when host ≠ `plugapro.co.za`.
3. **A `<meta name="robots" content="noindex">`** in the layout when `process.env.VERCEL_ENV !== 'production'`.

Option 2 is the cleanest. This is a **source code PR**, not a Vercel UI change, so it's out of scope for my browser session.

### T9 — live verification ✅ with 1 gap

| URL | Status | Served by | Notes |
|---|---|---|---|
| `https://plugapro.co.za/` | 200 ✓ | Marketing | Title "Plug A Pro", landing page renders |
| `https://www.plugapro.co.za/` | 200 | Marketing | **Does NOT redirect to apex** (runbook gap) |
| `https://app.plugapro.co.za/` | 200 ✓ | Customer PWA | "Request local home services" — mobile PWA interstitial |
| `https://admin.plugapro.co.za/` | 200 ✓ | Admin ops | Verified working in earlier session |

All four have valid TLS.

---

## What needs action (priority order)

**1. Add `PAYMENT_COLLECTION_MODE` env var.** Two entries on `plug-a-pro`:
   - Key: `PAYMENT_COLLECTION_MODE`, Value: `checkout`, Environments: Production only
   - Key: `PAYMENT_COLLECTION_MODE`, Value: `bypass`, Environments: Preview + Development

   You paste both; I'll confirm each row lands correctly. Low risk.

**2. Fix `www.plugapro.co.za` → `plugapro.co.za` redirect.** In `/plug-a-pro-marketing/settings/domains`, click **Edit** next to `www.plugapro.co.za`, choose the "Redirect to plugapro.co.za" option, save. I can guide you click-by-click; you do the actual save since it changes production behaviour.

**3. Make preview deployments noindex.** Repo change, not Vercel UI. Ask me to draft the middleware / `vercel.json` snippet if helpful. Low urgency unless the preview URL has already been indexed — if so, also add it to Google Search Console for removal.

**4. Verify per-environment targets on critical env vars.** Specifically:
   - `NEXT_PUBLIC_APP_URL` should be Production only (= `https://app.plugapro.co.za`)
   - `PAYFAST_SANDBOX` should be `false` on Production, `true` on Preview + Development
   - `NEXT_PUBLIC_SITE_URL` (marketing) should be Production only (= `https://plugapro.co.za`)
   
   I can open each row for you to eyeball — just say which to check.

**5. Clean up legacy duplicates (optional, low priority).** `SUPABASE_URL` and `SUPABASE_ANON_KEY` are likely duplicates of the `NEXT_PUBLIC_*` versions. Confirm nothing reads them, then delete.

---

## Out of scope — unchanged from runbook

- `quote_ready` WhatsApp template — awaiting Meta review.
- Analytics property separation — operator action outside Vercel.
- `VERCEL_OIDC_TOKEN` — auto-provisioned once AI Gateway is enabled.
- `BLOB_READ_WRITE_TOKEN` — already present in env vars; if it needs rotation, that's a separate Vercel Blob connection flow.

---

## Pinned note about team ID

The runbook's `team_AuQBnvSyZpJYcMRWjbXkM7p5` doesn't match this account. The actual projects live on `lebogangs-projects-6ffadd97` (personal Pro). Either:

- The team was dissolved / projects were moved to personal, or
- The runbook was written against a different environment and never updated.

Update the runbook to use `lebogangs-projects-6ffadd97` or whatever team exists now, so future ops runs don't fail the prerequisite check.

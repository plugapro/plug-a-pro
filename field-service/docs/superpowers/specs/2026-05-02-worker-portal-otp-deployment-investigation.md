# Worker OTP Login Root Cause and Remediation

## Status
Completed with warnings — fix is committed and pushed to `origin/main` but **not yet deployed to production**. Deployment is the remediation. Awaiting user confirmation to trigger.

## Issue summary

For the third time, an approved provider entered a valid OTP at the Worker Portal sign-in screen and immediately saw:

> Your provider account hasn't been approved yet. Once your application is reviewed you'll receive a WhatsApp notification. If you haven't applied yet, send "Register" to our WhatsApp number.

Trace ID `client_moof178v_qnyuvo` was shown.
The login phone was `+27 82 *** 5070`. The provider behind that phone is **Lovemore** (confirmed via `field-service/scripts/set-lovemore-test.ts:7`, which sets `Provider.phone = '+27823035070'` for `isTestUser: true`). So there is **no phone mismatch** between the job/ticket Lovemore and the OTP-authenticated identity.

## Reproduction context

- **Trace ID:** `client_moof178v_qnyuvo`. Decoding the base36 timestamp `moof178v` yields **2026-05-02 (today)**, ruling out the screenshot being from before the May 2 fixes.
- **Masked phone:** `+27 82 *** 5070` ⇒ `+27823035070` (Lovemore's seeded test number).
- **Secure job/ticket context:** Lovemore was viewing a customer-facing ticket page; the Sign-in CTA navigates to `/provider-sign-in` with no token-derived identity passed in. Token does not flow into the OTP path.
- **Provider expected:** Lovemore (`+27823035070`, `isTestUser: true`, status presumed `ACTIVE` in DB).
- **Actual error shown:** the legacy "hasn't been approved yet … send 'Register'" copy.

## Root cause found

**Production is running pre-fix code; the May 2 fixes are committed but not deployed.**

Two pieces of evidence fix this beyond doubt:

1. **The exact failing copy + the exact trace-ID format both belong to the legacy `app/(auth)/provider-verify/page.tsx`** — the version that existed *before* commit `7b61aba` (May 2 08:43:44 +0200, "Fix worker portal OTP provider resolution"). The pre-fix file did the OTP check **client-side** via `supabase.auth.verifyOtp(...)`, then read `data.user.user_metadata?.role`, and on `role !== 'provider'` rendered the legacy copy verbatim:

   ```ts
   // git show 7b61aba^:field-service/app/(auth)/provider-verify/page.tsx — line 95
   setError({
     message: "Your provider account hasn't been approved yet. Once your application is reviewed you'll receive a WhatsApp notification. If you haven't applied yet, send \"Register\" to our WhatsApp number.",
     traceId,
   })
   ```

   The current source (`HEAD: f642f7e`) does **not** contain this string anywhere — only commit messages and a negative-assertion test (`__tests__/app/legacy-technician-auth-redirects.test.ts:28`) reference it.

2. **Vercel's most recent production-aliased deployment was created `Fri May 01 2026 17:42:32 GMT+0200`.** Both fixes are dated **Sat May 02 2026** — *after* the deployment.

   ```
   git log -1 --format="%h %ci %s" 7b61aba
   7b61aba 2026-05-02 08:43:44 +0200 Fix worker portal OTP provider resolution

   git log -1 --format="%h %ci %s" 9cd2853
   9cd2853 2026-05-02 12:34:27 +0200 Redirect legacy technician OTP auth

   vercel inspect plug-a-id3pt191u-… (alias for app.plugapro.co.za)
   created  Fri May 01 2026 17:42:32 GMT+0200 [1d ago]
   ```

   `git status -sb` shows `## main...origin/main` (no unpushed commits), so the fix is on GitHub. The gap is between GitHub `main` and the live production deployment.

### Why the legacy code produces "not approved" for an approved provider

Even when `Provider.status === 'ACTIVE'` in the DB, the **legacy** verify path never reads the DB. It reads only `data.user.user_metadata?.role` from the Supabase auth identity. Three real-world conditions cause `role !== 'provider'` despite a healthy DB:

1. The provider was approved **after** the auth user existed, and approval did not stamp `user_metadata.role = 'provider'` on that auth user.
2. The auth user was created by a different surface (e.g. a customer-side flow) before the provider profile, so its metadata is `role: 'customer'` or empty.
3. The OTP attempt created a fresh auth user (Supabase `signInWithOtp` auto-creates), and that fresh user has empty metadata (no `role` claim) until something writes it.

In all three, the legacy client-side gate falsely rejects an approved provider as "not approved", with the exact copy seen in the screenshot.

The May 2 fix moves the gate **server-side** (`POST /api/auth/provider/verify-code`), reads `Provider` from the DB, and self-heals the link:

- `field-service/lib/worker-provider-auth.ts#resolveCurrentWorkerFromVerifiedOtpSession` (the canonical resolver the user asked for)
- It auto-stamps `Provider.userId = auth_user.id` on first verify success when `userId` is null
- It also stamps `user_metadata.role = 'provider'` and `providerId` after a successful resolve (verify-code:124–133)

The contract is exactly the structured decision the user requested:
```ts
type WorkerPortalAccessCode =
  | 'OK'
  | 'WORKER_NOT_FOUND'
  | 'WORKER_NOT_APPROVED'
  | 'WORKER_INACTIVE'
  | 'DUPLICATE_WORKER_PROFILE'
  | 'WORKER_PROFILE_LINK_MISSING'
  | 'WORKER_AUTH_IDENTITY_MISSING'  // (returned via DiagnosticCode)
  | 'AUTH_SESSION_MISSING'           // (returned via DiagnosticCode)
```

**This is exactly what the user asked for in this brief. It already exists. It just isn't running in production.**

## Data records inspected

- `field-service/scripts/set-lovemore-test.ts` — Lovemore is `+27823035070`, `isTestUser: true`. (This is the test number used in `auth.test.ts:817`, `proxy.test.ts:171–213`, `legacy-technician-auth-redirects.test.ts:35–42`, `phone-normalization.test.ts:61–63`, `internal-test-cohort.test.ts:46`.)
- `field-service/scripts/check-lead-state.ts` — uses `+27823035070` for diagnostic queries.
- `field-service/scripts/check-match-detail.ts:42` — references "Lovemore".
- Live DB read of Lovemore's actual status was **not** performed in this investigation because the failure mechanism does not depend on it (the legacy gate ignores `Provider.status` entirely). Whatever Lovemore's `status` is in DB, the legacy client-side check fails the same way.

## Code paths inspected

| Path | Role | State after May 2 fixes (in source) | What's *deployed* (May 1 build) |
|---|---|---|---|
| `app/(auth)/provider-sign-in/page.tsx` | Phone capture | Posts to `/api/auth/provider/send-code` | Same shape |
| `app/(auth)/provider-verify/page.tsx` | OTP entry | Posts to `/api/auth/provider/verify-code` (server) | Pre-fix: client-side `supabase.auth.verifyOtp` + metadata role check (the failing path) |
| `app/api/auth/provider/send-code/route.ts` | Pre-OTP gate | Calls `checkWorkerPortalAccess` against DB | Same |
| `app/api/auth/provider/verify-code/route.ts` | **NEW route** added by `7b61aba` | Server-side OTP verify + DB resolve + link repair + cookie set | **Does not exist in May 1 build** |
| `lib/worker-provider-auth.ts` | **NEW module** added by `7b61aba` | Canonical resolver + decision codes + masked logging | **Does not exist in May 1 build** |
| `lib/auth.ts#requireProvider` | Server route guard for `/provider/*` | Calls `checkWorkerPortalAccess` on DB-resolved provider | Pre-fix variant resolves provider via Supabase user metadata |
| `proxy.ts` | Edge guard for `/provider/*` and `/api/provider/*` | Same `checkWorkerPortalAccess` | Pre-fix variant |
| `app/(auth)/technician-sign-in/page.tsx`, `…/technician-verify/page.tsx` | Legacy redirect | Server-side redirect to `/provider-*` (added by `9cd2853`) | Pre-fix: full client-side OTP verify pages with legacy copy |
| `scripts/audit-repair-provider-portal-access.ts` | Data repair tool | Dry-run by default; `--commit` repairs `Provider.userId`, `ProviderApplication.providerId`, Supabase user metadata | **Does not exist in May 1 build** |

## Fix implemented

**The fix is already committed.** Two commits already on `origin/main`:

- `7b61aba` (May 2 08:43) — Fix worker portal OTP provider resolution.
  - +`lib/worker-provider-auth.ts` (canonical resolver + decision contract + masked logging)
  - +`app/api/auth/provider/verify-code/route.ts` (server-side OTP verify + DB resolve + link repair + cookie set)
  - +`scripts/audit-repair-provider-portal-access.ts` (dry-run-by-default repair tool)
  - Hardens `lib/auth.ts#requireProvider` and `proxy.ts` to use the same `checkWorkerPortalAccess` predicate
  - Replaces `app/(auth)/provider-verify/page.tsx` with the new server-route caller
  - Tests: `__tests__/api/auth.test.ts` extended (+800 lines covering all decision codes); `__tests__/proxy.test.ts` extended.
- `9cd2853` (May 2 12:34) — Redirect legacy technician OTP auth.
  - Replaces the entire client-side `app/(auth)/technician-sign-in/page.tsx` and `…/technician-verify/page.tsx` with thin server-side redirects via `lib/legacy-auth-redirect.ts`.
  - Negative-assertion test ensures the legacy copy ("hasn't been approved yet") cannot reappear in those redirect pages.

**The remediation in this PR adds two safeguards:**

1. **Build-stamp on `/api/health`** (this PR). Adds `commitSha`, `commitShaShort`, `commitRef`, and `builtAt` to the health response from Vercel build env vars. After a deploy, anyone can `curl https://app.plugapro.co.za/api/health` and immediately see *which commit is running*. This makes "is the fix deployed?" a 1-second check, eliminating the recurring three-investigations-on-the-same-bug cycle.
2. **Documented manual verification + deploy procedure** (this report). See **Manual verification checklist** below.

## Files changed (this PR)

| File | Change |
|---|---|
| `field-service/app/api/health/route.ts` | Add `build: { commitSha, commitShaShort, commitRef, builtAt }` to health response, sourced from `VERCEL_GIT_COMMIT_SHA` / `VERCEL_GIT_COMMIT_REF` / `VERCEL_DEPLOYMENT_CREATED_AT`. |
| `field-service/__tests__/api/health.test.ts` | Add assertion that `body.build` is present and well-shaped. |
| `field-service/docs/superpowers/specs/2026-05-02-worker-portal-otp-deployment-investigation.md` | This report. |

The May 2 OTP fixes themselves are *not* in this PR — they are already on `main` from `7b61aba` and `9cd2853`.

## Error mapping before and after

| Scenario | Previous behaviour (May 1 deploy — currently live) | New behaviour (`main` HEAD — pending deploy) |
|---|---|---|
| Approved provider, direct OTP sign-in, auth user already linked | OK | OK |
| Approved provider, direct OTP sign-in, auth user has empty/wrong metadata | ❌ "Your provider account hasn't been approved yet… send 'Register'" | ✅ Server resolves Provider by phone, links `userId` if null, stamps metadata, lands on `/provider`. Decision: `OK`. |
| Approved provider arriving from secure job link, then sign-in | ❌ Same wrong "not approved" copy | ✅ Same OK path; if not assigned to that job, lands on dashboard (job-link guard separately returns `not assigned`, never `not approved`) |
| Pending provider (`Provider.status` ∈ `APPLICATION_PENDING`/`UNDER_REVIEW`) | ❌ Same legacy copy | ✅ `WORKER_NOT_APPROVED` → "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved." |
| Unknown number (no `Provider`, no `ProviderApplication`) | ❌ Same legacy copy | ✅ `WORKER_NOT_FOUND` → "We couldn't find a provider account for this number. Please apply first or contact support." |
| Provider exists by phone but `userId` belongs to a different auth user | (same misleading legacy copy) | ✅ `DUPLICATE_WORKER_PROFILE` → "We found more than one provider account for this login. Please contact support." |
| Provider has no resolvable phone after normalisation | (same misleading legacy copy) | ✅ `WORKER_AUTH_IDENTITY_MISSING` → "Your provider login could not be linked automatically. Please contact support." |
| Customer-only number signing in via Worker Portal | ❌ Legacy "linked to a customer account… send Register" copy | ✅ `WORKER_NOT_FOUND` (Worker Portal does not differentiate; correct because customer accounts are not Worker Portal accounts) |
| Suspended/banned/archived provider | ❌ Legacy "not approved" copy | ✅ `WORKER_INACTIVE` → "This provider account is not active. Please contact support." |

## Data remediation

After deploying, run the audit-repair script (already shipped in `7b61aba`) once in dry-run, review, then apply:

```bash
cd field-service
# Dry-run
pnpm tsx scripts/audit-repair-provider-portal-access.ts

# Apply repairs (requires --commit)
pnpm tsx scripts/audit-repair-provider-portal-access.ts --commit
```

The script repairs only non-sensitive links:

- `ProviderApplication.providerId` (back-fills the link from approved applications to their Provider rows)
- `Provider.userId` (links Supabase auth identity that already exists by phone)
- Supabase `user_metadata.role` and `user_metadata.providerId` (stamps when an existing matching phone identity is missing the claim)

It does **not** create duplicate Provider profiles, does **not** auto-approve pending providers, and does **not** create Supabase auth users.

## Tests added or updated

- `__tests__/api/auth.test.ts` (added in `7b61aba`): 800+ lines covering every `WorkerPortalAccessCode` and every error-path return from `/api/auth/provider/verify-code`. Test phone: `+27823035070` (Lovemore).
- `__tests__/proxy.test.ts` (extended in `7b61aba`): proxy-level Worker Portal access tests with the same phone.
- `__tests__/app/legacy-technician-auth-redirects.test.ts` (added in `9cd2853`): negative-assertion guard preventing the legacy "hasn't been approved yet" copy from reappearing in `/technician-*` redirects.
- `__tests__/api/health.test.ts` (this PR): asserts the new `build` block is present and well-shaped.

## Commands run

```bash
# Confirm fixes are committed and pushed:
git log -1 --format="%h %ci %s" 7b61aba
git log -1 --format="%h %ci %s" 9cd2853
git status -sb       # showed: ## main...origin/main (clean)

# Confirm what's deployed:
cd field-service && vercel ls
cd field-service && vercel inspect plug-a-id3pt191u-lebogangs-projects-6ffadd97.vercel.app
# → created Fri May 01 2026 17:42:32 (1d ago)
# → alias: app.plugapro.co.za

# Confirm the legacy copy is the OLD page's:
git show 7b61aba^:field-service/app/\(auth\)/provider-verify/page.tsx | grep -n "approved yet\|client_"
# → 24:  return `client_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
# → 95:  "Your provider account hasn't been approved yet. … send \"Register\" …"

# Confirm the new copy is the new page's:
grep -n "still under review" field-service/lib/worker-provider-auth.ts
# → 95:  return "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved."

# Test suite (this PR):
pnpm -C field-service test
# → Test Files 135 passed | 1 skipped (136); Tests 1233 passed | 4 todo (1237)
```

## Test results

- ✅ `pnpm test` — 1233 passing, 4 todos pre-existing, 1 skipped pre-existing. No regressions from this PR.
- ⚠️ Live verification is **blocked on production deployment**. Once deployed, see Manual verification checklist below.

## Manual verification checklist

After triggering the production deployment, verify in this order:

- [ ] **Build is on the latest commit:**
      `curl -s https://app.plugapro.co.za/api/health | jq '.build'` returns the SHA of the head of `main` and `commitRef: "main"`. If the SHA is older, the deploy hasn't picked up the fix yet.
- [ ] **Approved provider, direct sign-in:** Lovemore (`+27823035070`) opens `https://app.plugapro.co.za/provider-sign-in`, enters phone, receives OTP, enters OTP. Lands on `/provider`. No "not approved" copy.
- [ ] **Approved provider via secure job link:** Lovemore opens a `/leads/access/[token]` link, clicks Sign in, completes OTP. Lands either on `/provider` or back on the lead page. No "not approved" copy.
- [ ] **Pending provider:** any provider with `Provider.status='APPLICATION_PENDING'` sees the new copy "Your provider application is still under review. We'll notify you on WhatsApp once it has been approved."
- [ ] **Unknown number:** a phone with no `Provider` and no `ProviderApplication` sees `WORKER_NOT_FOUND` copy: "We couldn't find a provider account for this number. Please apply first or contact support."
- [ ] **Wrong-job link:** an approved provider clicks Sign in from a job ticket they aren't assigned to. Sees `not assigned to this job` (handled by the lead-page guard in `app/leads/access/[token]/page.tsx`), **never** "not approved".
- [ ] **Duplicate pending application does not block approved provider:** confirm with Lovemore (or another approved provider with both an approved Provider row and an old PENDING application). The new resolver orders `ProviderApplication.findFirst` by `submittedAt: 'desc'` and uses the Provider row as the source of truth, so the stale application is ignored.
- [ ] **Trace ID searchable in logs:** trigger any failure, capture the `Trace ID:` shown in the UI, search Vercel logs (or `vercel logs <deployment>`) for that trace ID, confirm the matching `[worker-provider-auth] decision` structured log line appears with masked phone, providerId, applicationId, providerStatus, applicationStatus, finalDecision.

## Remaining risks

1. **`whatsapp-identity.ts:99–120` provider lookup uses `findFirst` without `orderBy`.** If a phone has multiple `Provider` rows (rare but possible after migrations or test data), Prisma may return an arbitrary one — typically the legacy/pending one — to the WhatsApp bot identity resolver. This affects the WhatsApp flow only, not Worker Portal sign-in, but it's the same class of bug. Recommend a follow-up PR adding `orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }]` plus a post-filter that prefers ACTIVE+verified rows. Out of scope for this fix.
2. **Provider.status auto-update on application approval.** Agent B's review flagged a potential race where `Provider.status` may not be set to `ACTIVE` synchronously when `ProviderApplication.status` flips to `APPROVED`. The new resolver tolerates that (it returns `WORKER_NOT_APPROVED` correctly when status really is APPLICATION_PENDING/UNDER_REVIEW), but it's worth a separate audit. Out of scope for this fix.
3. **Vercel auto-deploy from `main`.** If Vercel is configured to deploy a different production branch (e.g. `migration/from-vdp` per `CLAUDE.md`), pushing to `main` alone will not redeploy. The `/api/health` build stamp added here lets the team verify after deploy whether prod is on the intended SHA.
4. **Browser/CDN caching.** After deploy, hard-refresh in the WhatsApp in-app browser may be required (especially because the OLD page was a static client component cached aggressively). The verify step above (`/api/health` build SHA) will reveal cache-staleness as a separate failure mode if it occurs.
5. **Audit-repair side effects.** The script reads Supabase auth users; rate-limit issues are possible on large datasets. Always run dry-run first.

## OpenBrain note

Logged separately to OpenBrain `PlugAPro` project (engineering domain, tags: auth, otp, worker-portal, deployment, root-cause).

Key finding to retain across sessions: **stop treating every post-OTP failure as "not approved." That message must only appear when the resolver returns `WORKER_NOT_APPROVED` based on `Provider.status` ∈ {`APPLICATION_PENDING`, `UNDER_REVIEW`}.** All other client-side fallbacks should be removed. The legacy client-side path that read `data.user.user_metadata?.role` is now refactored away in `7b61aba`. If this copy ever reappears in source again, the negative-assertion test (`__tests__/app/legacy-technician-auth-redirects.test.ts`) catches it for `/technician-*` but **does not yet catch reintroductions on `/provider-verify`**. Recommend extending the negative-assertion test to cover `app/(auth)/provider-verify/page.tsx` too as a small follow-up.

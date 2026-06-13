# Provider sign-out left a live session — stale "Hi Lovemore" on customer home (2026-06-13)

## Context

Reported from iPhone Safari: signed in as provider "Lovemore", opened the provider
profile, tapped **Sign out**, landed on the provider sign-in page (looked logged
out), then navigated to the main dashboard (`/`) and still saw
**"Hi Lovemore - what needs fixing?"** with customer-style content. The app did
not consistently know whether the browser was logged in / out / provider /
customer.

## Root cause

The customer home (`app/(customer)/page.tsx`) is a **server component**
(`force-dynamic`). Its greeting is gated entirely on the server session:
`isLoggedOut = !session`, where `session = await getSession()`.
`getSession()` (`lib/auth.ts`) reads the **HttpOnly `sb-access-token` cookie** and
resolves the provider via `db.provider.findFirst({ userId | phone })`. So
"Hi Lovemore" persisting proves the **server session was never cleared**.

There were **three** sign-out components that had drifted:

| Component | Used by | Clears client Supabase | Clears HttpOnly cookie (`DELETE /api/auth/session`) |
|---|---|---|---|
| `components/technician/SignOutButton.tsx` | **provider profile page** | yes | **NO** ← bug |
| `components/provider/ProviderSignOutButton.tsx` | provider home | yes | yes |
| `components/customer/SignOutButton.tsx` | customer profile | yes | yes + broadcast event |

The provider **profile** page (`app/(provider)/provider/profile/page.tsx:10`) renders
the `technician/SignOutButton`, the **only** variant that called
`supabase.auth.signOut()` (clears client localStorage only) without
`DELETE /api/auth/session`. JavaScript cannot clear an HttpOnly cookie, so the
server kept resolving the provider session → customer home server-rendered the
provider greeting.

Secondary gap: the technician/provider buttons never dispatched
`pap:auth-session-changed`, which `components/shared/bottom-nav.tsx` listens to
(plus `visibilitychange`/`focus`) to re-probe `/api/auth/session`. So the nav
account item could also lag after those sign-outs.

### Ruled out (validated, not guessed)
- **Stale localStorage name / cached profile greeting** — no. Greeting is
  server-rendered from `getSession()`; no client name cache exists.
- **Service worker / PWA cache** — no service worker in the repo.
- **Dashboard greeting not auth-safe** — it already is; it only renders for a
  valid session. The defect was purely the un-cleared session.
- **Admin sign-out** — separate server action (`app/(admin)/layout.tsx:77`) that
  clears the cookie directly; not affected.

## Fix applied (smallest safe + de-drift)

1. New single source of truth: `lib/auth-client-signout.ts` → `signOutClient()`:
   revoke Supabase session → `DELETE /api/auth/session` (clears the cookie) →
   dispatch `pap:auth-session-changed`. Each step best-effort so one failure
   can't block the others.
2. All three buttons now call `signOutClient()` then redirect to their own
   sign-in route. This fixes the provider-profile path and makes the three
   implementations impossible to drift apart again.

No auth rewrite, no new deps, no schema change. The dashboard greeting code was
left unchanged because it was already correct.

## Tests added

- `__tests__/lib/auth-client-signout.test.ts` — proves `signOutClient()` calls
  `DELETE /api/auth/session` (the previously-missing step), dispatches the
  broadcast, and is resilient when Supabase sign-out or the DELETE rejects.
- `__tests__/app/customer/home-greeting-auth.test.tsx` — proves the home shows
  neutral "Skilled help near you." with **no** name when `getSession()` is null
  (post sign-out), and greets "Hi Lovemore" only while a provider session still
  resolves server-side.

## Validation

- `pnpm exec eslint` on changed files — 0 errors.
- `pnpm exec tsc --noEmit` — 0 errors.
- `pnpm vitest run` — **4330 passed, 1 skipped, 0 failed** (incl. 5 new).
- Not done: live browser repro on app.plugapro.co.za (needs a seeded approved
  provider + OTP sign-in). Proven instead by the static trace + the two tests
  above, which together cover the full chain: sign-out → cookie cleared →
  `getSession()` null → no personalised greeting.

## Remaining risks / follow-ups

- Multi-tab: a *second* already-open tab on `/` is server-rendered and won't
  re-render on the broadcast (bottom-nav re-probes, but the page body keeps its
  SSR greeting until navigation/refresh). Acceptable for MVP; a follow-up could
  have `AutoRefresh`/home subscribe to `pap:auth-session-changed`.
- iOS Safari bfcache: back-nav after sign-out could momentarily show a cached
  protected page before the cleared cookie forces a re-fetch. Not part of the
  reported repro; consider `Cache-Control: no-store` on protected provider pages
  if it surfaces.

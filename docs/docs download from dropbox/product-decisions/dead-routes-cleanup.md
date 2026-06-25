# Product Decision: Dead Routes Cleanup

**Date:** 2026-04-08
**Author:** Engineering (release-readiness pass)
**Status:** Decision recorded — cleanup deferred to post-launch (P3-O)

---

## Background

A route audit was conducted during the 2026-04-08 release-readiness pass. Three categories of dead or duplicate routes were found. This document records each finding and the disposition decision.

---

## Finding 1 — `/admin/dispatch` redirect page

**File:** `field-service/app/(admin)/admin/dispatch/page.tsx`

**Content:**
```ts
redirect('/admin/matches')
```

**Finding:** This page does nothing except redirect to `/admin/matches`. It was the original dispatch route before the admin moderation surface was renamed. The redirect has been in place since the marketplace model rename.

**Decision:** Remove after launch. There are no internal links to `/admin/dispatch` in the codebase (confirmed via grep). The redirect is harmless but adds a confusing file that implies a live feature.

**Action:** Delete the file in a post-launch cleanup PR. Add a 301 rewrite in `vercel.json` (`/admin/dispatch → /admin/matches`) as a safety net for any bookmarked URLs.

**Release gate:** Does not block go-live. Listed as P3-O cleanup.

---

## Finding 2 — Legacy technician auth routes

**Files:**
- `field-service/app/(auth)/technician-sign-in/page.tsx`
- `field-service/app/(auth)/technician-verify/page.tsx`

**Finding:** These routes exist from when the provider auth flow used a separate "technician" entry path. Since the marketplace rename, the active sign-in routes are `/provider-sign-in` and `/provider-verify`. The legacy routes are kept in place by `proxy.ts` for backward-compat:

```ts
// proxy.ts — technician-sign-in rewrite to provider-sign-in
```

**Decision:** Keep both files until the proxy rewrite has been live for at least 30 days and no traffic arrives at the legacy paths (check Vercel logs). After confirmation, remove the pages and the proxy rewrite entry simultaneously.

**Release gate:** Does not block go-live. Monitor post-launch.

---

## Finding 3 — Parallel `(technician)` and `(provider)` route groups

**Files:**
- `field-service/app/(technician)/` — 5 pages: `page.tsx`, `quotes/[matchId]/page.tsx`, `jobs/[id]/page.tsx`, `profile/page.tsx`, `earnings/page.tsx`
- `field-service/app/(provider)/` — 5 matching pages at `/provider/*` paths

**Finding:** Both route groups exist and serve the same user role (service provider). The `(technician)` group serves URLs under `/technician/*`; the `(provider)` group serves `/provider/*`. Both layouts show "Provider App" in the header. Both call `requireProvider()` for auth.

The WhatsApp bot and notification flows currently link to `/technician` (the older path). The `(provider)` group was added during the marketplace model migration but the WhatsApp links were not all updated.

**Current state:**
- WhatsApp CTA links → `/technician` (active, used by real providers)
- Admin "view job" links → mix of `/provider` and `/technician`
- Both route groups are fully functional

**Decision:** This is tracked as P3-O ("Collapse duplicate provider/technician surfaces") in the release readiness tracker. The `(technician)` URLs are what live providers have bookmarked and what the WhatsApp bot sends. Do not rename or redirect until after launch, when the full scope of the change can be tested.

**Post-launch plan:**
1. Audit all WhatsApp templates and bot messages for `/technician` links.
2. Update all links to `/provider/*`.
3. Add `proxy.ts` rewrites: `/technician → /provider`, `/technician/:path* → /provider/:path*`.
4. Keep rewrites live for 30 days.
5. Delete the `(technician)` route group.

**Release gate:** Does not block go-live. P3-O post-launch work.

---

## Summary

| Route / Group | Action | When |
|---|---|---|
| `/admin/dispatch` redirect | Delete + add 301 rewrite | Post-launch cleanup |
| `/technician-sign-in`, `/technician-verify` | Monitor traffic, remove when zero | 30+ days post-launch |
| `(technician)` route group | Migrate links → `/provider`, then delete | P3-O post-launch |

No dead route blocks go-live. P2-J is closed.

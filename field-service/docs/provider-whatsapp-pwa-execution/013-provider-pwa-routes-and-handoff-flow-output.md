# Execution Output — 13-provider-pwa-routes-and-handoff-flow.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/13-provider-pwa-routes-and-handoff-flow.md

## Objective
Implement or align provider PWA routes and WhatsApp handoff so the PWA is optional but useful. All three secure token entry-point routes must exist, the handoff map must be state-aware (old links resolve to current state), missing blueprint alias routes must be added, and job-scoped events must deep-link to the specific job handover page rather than the generic jobs list.

## Current-state findings

### Existing secure token routes (all present)
- `app/provider/handoff/[token]/page.tsx` — primary handoff entry, resolves event + token via `resolveProviderLeadAccessToken` then calls `resolveProviderPwaHandoffPath`
- `app/provider/lead/[token]/page.tsx` — thin alias re-exporting the handoff page
- `app/provider/job/[token]/page.tsx` — thin alias re-exporting the handoff page

### Existing handoff library
- `lib/provider-pwa-handoff.ts` — `PROVIDER_PWA_HANDOFF_MAP` + `resolveProviderPwaHandoffPath`; all 12 blueprint events were mapped but `confirm_arrival`, `complete_job`, and `job_accepted` all resolved to the generic `/provider/jobs` list regardless of whether a jobId was known

### Existing PWA routes (all present under `app/(provider)/provider/`)
- `/provider` (dashboard), `/provider/application`, `/provider/credits`, `/provider/credits/history`
- `/provider/jobs`, `/provider/jobs/[id]`, `/provider/leads`, `/provider/leads/[leadId]`
- `/provider/opportunities` (redirect → `/provider/leads`)
- `/provider/profile`, `/provider/profile/services`, `/provider/profile/areas`, `/provider/profile/availability`, `/provider/profile/rates`
- `/provider/availability`, `/provider/earnings`, `/provider/quotes/[matchId]`

### Job sub-routes (all present under `app/provider/jobs/[jobId]/`)
- `arrival/` — redirects to `handover`
- `handover/` — full token-verified job detail + state UI
- `quick-update/` — redirects to `handover`

### Gaps identified
1. `resolveProviderPwaHandoffPath` had no `jobId` parameter — job-scoped events always fell through to the generic `/provider/jobs` list
2. `/provider/apply` alias missing
3. `/provider/dashboard` alias missing
4. `/provider/opportunities/[leadInviteId]` deep-link missing
5. `/provider/jobs/[jobId]/execute` alias missing
6. `/provider/jobs/[jobId]/complete` alias missing
7. Test coverage for state-aware job routing was absent

## Implementation completed

### 1. `lib/provider-pwa-handoff.ts` — state-aware job routing
- Added optional `jobId` parameter to `resolveProviderPwaHandoffPath`
- Introduced `JOB_SCOPED_EVENTS` set (`job_accepted`, `confirm_arrival`, `complete_job`)
- For job-scoped events the resolver now: prefers explicit `jobId`, falls back to `lead.jobRequestId`, builds `/provider/jobs/:id/handover` (with `?token=` when a token is present), and only falls through to the generic map entry when neither is available
- Existing lead-token priority logic (ACCEPTED/SENT/VIEWED/DECLINED/EXPIRED branches) is unchanged

### 2. `app/(provider)/provider/apply/page.tsx` — new alias
- Permanent redirect to `/provider/application`

### 3. `app/(provider)/provider/dashboard/page.tsx` — new alias
- Permanent redirect to `/provider`

### 4. `app/(provider)/provider/opportunities/[leadInviteId]/page.tsx` — new deep-link
- Async server component reading `params.leadInviteId`; redirects to `/provider/leads/:leadInviteId`

### 5. `app/provider/jobs/[jobId]/execute/page.tsx` — new alias
- Mirrors `arrival/` and `quick-update/` patterns; preserves `?token=` and redirects to `handover`

### 6. `app/provider/jobs/[jobId]/complete/page.tsx` — new alias
- Same pattern as `execute/`; redirects to `handover` preserving token

### 7. `__tests__/lib/provider-pwa-handoff.test.ts` — extended test suite
- 10 new test cases covering: jobId-only routing, token + jobId, fallback when no jobId/lead, lead.jobRequestId derivation, explicit jobId beats lead.jobRequestId, opportunity token takes priority over jobId

## Files changed
| File | Change summary |
|---|---|
| `lib/provider-pwa-handoff.ts` | Added `jobId` param + `JOB_SCOPED_EVENTS` set; state-aware job handover routing |
| `app/(provider)/provider/apply/page.tsx` | New — redirect alias to `/provider/application` |
| `app/(provider)/provider/dashboard/page.tsx` | New — redirect alias to `/provider` |
| `app/(provider)/provider/opportunities/[leadInviteId]/page.tsx` | New — redirect alias to `/provider/leads/:id` |
| `app/provider/jobs/[jobId]/execute/page.tsx` | New — redirect alias to `handover` (preserves token) |
| `app/provider/jobs/[jobId]/complete/page.tsx` | New — redirect alias to `handover` (preserves token) |
| `__tests__/lib/provider-pwa-handoff.test.ts` | 10 new test cases for state-aware job routing |

## WhatsApp flow changes
None — no WhatsApp message templates, copy, or outbound link format was changed. The handoff resolver is an internal routing concern only.

## PWA route/screen changes

### New alias routes added
| Blueprint route | Resolves to |
|---|---|
| `/provider/apply` | `/provider/application` |
| `/provider/dashboard` | `/provider` |
| `/provider/opportunities/:leadInviteId` | `/provider/leads/:leadInviteId` |
| `/provider/jobs/:jobId/execute` | `/provider/jobs/:jobId/handover` (token preserved) |
| `/provider/jobs/:jobId/complete` | `/provider/jobs/:jobId/handover` (token preserved) |

### Updated handoff map behaviour
| WhatsApp event | Before | After |
|---|---|---|
| `job_accepted` (with jobId) | `/provider/jobs` | `/provider/jobs/:jobId/handover` |
| `confirm_arrival` (with jobId) | `/provider/jobs` | `/provider/jobs/:jobId/handover?token=...` |
| `complete_job` (with jobId) | `/provider/jobs` | `/provider/jobs/:jobId/handover?token=...` |
| All three events (no jobId, no lead) | `/provider/jobs` | `/provider/jobs` (unchanged) |

## API/server changes
None — no API routes were added or modified.

## Credit impact
None

## Security/privacy impact
- No token formats changed
- All new alias routes are simple redirects — no auth bypass is possible; the destination pages (`/provider/application`, `/provider`, `/provider/leads/:id`, `handover`) each enforce their own auth guards
- `resolveProviderPwaHandoffPath` does not expose job identifiers outside of what the caller already holds; jobId is caller-supplied, not derived from the token

## Tests added or updated
- `__tests__/lib/provider-pwa-handoff.test.ts` — 10 new cases added to existing 8-case suite (18 cases total)
- All 1673 tests pass, 0 failures

## Commands run
```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -50
```

## Test results
161 test files passed (1 skipped), 1673 tests passed, 4 todo, 0 failures. Duration: 10.90s.

## Manual verification checklist
- [ ] Provider PWA routes resolve correctly
- [ ] Old links show current state
- [ ] PWA does not create separate state
- [ ] Tests pass

## Risks and follow-ups
- `app/provider/jobs/[jobId]/execute` and `app/provider/jobs/[jobId]/complete` sit in the secure (non-`(provider)`) segment, matching the pattern established by `arrival`, `handover`, and `quick-update`. The destination `handover` page performs full token verification, so the alias adds no auth surface.
- Step 14 (security/token/access rules) should audit whether WhatsApp callers of `confirm_arrival` and `complete_job` events supply the `jobId` parameter consistently; if not, the fallback to `/provider/jobs` is safe but less targeted.
- `/provider/opportunities` (list) already redirects to `/provider/leads`; the new `/provider/opportunities/[leadInviteId]` detail redirect is consistent with that pattern.

## OpenBrain note
Step 13 of the Provider WhatsApp + PWA blueprint completed. Six new route files added (five aliases, one deep-link), `lib/provider-pwa-handoff.ts` extended with state-aware job routing via a new `jobId` parameter and `JOB_SCOPED_EVENTS` set, and 10 new test cases added. All 1673 tests pass.

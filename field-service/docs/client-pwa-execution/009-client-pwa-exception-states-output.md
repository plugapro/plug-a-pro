# CLIENT-09 — Client PWA Exception and Recovery States

## Status
PASS

## Exception state coverage

| State | Authenticated page (`/requests/[id]`) | Token page (`/requests/access/[token]`) | Copy correct |
|---|---|---|---|
| CANCELLED (request) | Yes — added in this step | Yes — `destination.screen === 'cancelled'` block | Yes |
| EXPIRED (no providers found) | Yes — added in this step | Yes — `destination.screen === 'expired'` block | Yes |
| MATCHING timeout | Yes — `?selection=matching-timeout` banner added | Pre-existing `matching_progress` screen + support link | Yes |
| PROVIDER_CONFIRMATION_PENDING | Yes — `selectedShortlistItem` confirmation banner | Yes — `provider_confirmation` screen block | Yes |
| Provider declined (reverts to SHORTLIST_READY) | Yes — `?selection=provider-declined` banner added; shortlist still rendered | Yes — shortlist re-renders naturally; `selection=provider-confirming` reset flow | Yes |
| Job CANCELLED / FAILED | Resolves to `cancelled` screen via state resolver | Same via `resolveClientPwaScreenForJobStatus` | Yes |
| Link expired | Token page guard (accessLevel=expired → expired screen) | Recovery page `reason=expired` | Yes |
| Link invalid | Token page guard (accessLevel=invalid → `TICKET_INVALID` card with traceId) | Recovery page `reason=invalid` | Yes |
| Unauthorized access | Not applicable (authenticated page redirects to `/sign-in`) | Recovery page `reason=unauthorized` — added in this step | Yes |

## Recovery page

Covers expired: yes
Covers invalid: yes
Covers unauthorized: yes — added `unauthorized` reason with "We could not verify access" copy
Has CTA to start new request: yes — primary button "Start a new request" on all three paths
Has CTA to sign in: yes — secondary "Sign in to your account" button added for all three paths

## No sensitive data leaked in error states

Confirmed: yes

- Token page error card shows only `code` (TICKET_EXPIRED / TICKET_INVALID) and a `traceId` — no DB ids, stack traces, or internal reason strings are rendered to the browser.
- `dest.reason` is a short machine-readable slug (`token_expired_or_revoked`, `token_not_found`, etc.) — no Prisma errors or stack frames.
- Test `expired destination does not expose internal error details` asserts this explicitly.

## Gaps closed

1. **Authenticated page (`/requests/[id]`) missing CANCELLED banner** — added card with "Request cancelled / You can start a new request anytime" copy and Start new request CTA.
2. **Authenticated page missing EXPIRED banner** — added warning card with "We could not find enough suitable providers yet" copy and Ask for help + Start new request CTAs.
3. **Authenticated page missing `?selection=provider-declined` banner** — added destructive card "The selected provider could not confirm this job / choose another provider from your shortlist".
4. **Authenticated page missing `?selection=matching-timeout` banner** — added warning card "We're still waiting for provider responses / keep waiting, adjust, or ask for help".
5. **Authenticated page missing `searchParams` support** — function signature updated to accept `searchParams?: Promise<{ selection?: string }>`.
6. **Recovery page missing `unauthorized` reason** — added third `REASONS` entry with "We could not verify access" heading and copy directing to WhatsApp or sign-in.
7. **Recovery page sign-in CTA absent** — added secondary "Sign in to your account" button for all three reason paths.

## Tests

16 tests, all passing. Key scenarios:

- EXPIRED → `expired` screen, `request_expired` reason
- CANCELLED → `cancelled` screen, `request_cancelled` reason
- Job CANCELLED + FAILED → `cancelled` screen, `job_cancelled_or_failed` reason
- PROVIDER_CONFIRMATION_PENDING → `provider_confirmation` screen
- `cancelled`, `expired`, `invalid_link` screens have no allowed actions
- Expired token → `accessLevel=expired`, route contains `reason=expired`
- Expired destination `reason` field contains no stack traces or Prisma internals
- Invalid token → `accessLevel=invalid`, `screen=invalid_link`, route `/requests/access/recovery?reason=invalid`
- Missing request by ID → `invalid_link` destination
- Recovery route variants: expired → `reason=expired`, invalid → `reason=invalid`
- `QualifiedLeadInviteState` module loads cleanly (type includes `provider_declined_after_selection`)
- PROVIDER_CONFIRMATION_PENDING via `requestId` resolver → `provider_confirmation` screen, `trusted_reference` access

## Files changed

- `field-service/app/(customer)/requests/[id]/page.tsx` — added `searchParams` prop; added CANCELLED, EXPIRED, provider-declined, and matching-timeout exception banners
- `field-service/app/requests/access/recovery/page.tsx` — added `unauthorized` reason copy; added sign-in secondary CTA button
- `field-service/__tests__/app/customer/exception-recovery-states.test.ts` — new test file, 16 tests

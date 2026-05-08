# CLIENT-10 — Client PWA Security, Privacy, and Token Rules

## Status
PASS

---

## Token security

| Check | Result |
|---|---|
| Scoped to jobRequestId | yes — `resolveJobRequestAccessToken` queries `where: { customerAccessToken: token }` which is a unique index on `JobRequest`; the returned object includes `id` (the jobRequestId) and is the only record that can match |
| Has expiry check | yes — `customerAccessTokenExpiresAt <= now` checked in both `resolveJobRequestAccessScope` and `resolveJobRequestAccessToken` |
| Ownership verified | yes — token lookup is by the token value itself; the returned `jobRequest.customer` identity is used by the calling page for ownership checks |
| Trace ID on denial | yes (FIXED) — both `resolveJobRequestAccessScope` and `resolveJobRequestAccessToken` now generate and return a `traceId` (via `createTraceId('jra')` / `createTraceId('jrt')`) on every denial path, and `console.warn` logs include it |
| TTL deviation | Previously 90d vs 72h blueprint. **Resolved in final remediation**: issuance window is now 72h in `lib/job-request-access.ts`; existing tokens keep persisted expiries until rotated. |

---

## Protected customer fields

| Context | Result |
|---|---|
| Provider-facing queries (pre-acceptance) | OK — `resolveProviderLeadAccessToken` returns `customer: null` and address stripped to suburb/city only before `hasAcceptedUnlock` |
| Provider-facing queries (post-acceptance) | OK — second DB query fetches `customer: { id, name, phone }` and full address only when `lead.status === 'ACCEPTED' && lead.unlock.providerId === lead.providerId` |
| Customer shortlist provider select | OK — `getCustomerShortlistForRequest` uses an explicit `provider: { select: { ... } }` that includes only public trust-signal fields |
| No protected customer fields in provider preview | OK |

---

## Protected provider fields

| Context | Result |
|---|---|
| Customer-facing provider profile page (`/providers/[id]`) | OK — explicit `select` with only `id, name, bio, experience, skills, serviceAreas, evidenceNote, portfolioUrls, verified` |
| Customer shortlist provider entries | OK — `getCustomerShortlistForRequest` provider select: no `phone`, `kycStatus`, `suspendedReason`, `adminNotes`, `strikes`, `email`, `idNumber`, or `privateAddress` |
| Matched provider in request/booking pages | OK — `clientPwaRequestSelect` provider select: same restricted fields |
| Admin-only fields in provider token resolution | OK — `resolveProviderLeadAccessToken` DB select does not project `kycStatus`, `strikes`, `payoutVerifiedAt`, `suspendedReason`, `archiveReason`, `internalFlags` |

---

## Attachment authorization

| Check | Result |
|---|---|
| Customer can access own photos | yes — `GET /api/attachments/[id]` checks `customerViaJob` and `customerViaRequest` ownership via session |
| Provider blocked from non-preview attachments pre-acceptance | yes — `leadTokenAllowsAttachment` enforces `safeForPreview !== false` when `leadTokenIsAccepted === false` |
| Unauthorized access gets trace ID | yes — all denial paths return `{ error, traceId }` and set `X-Trace-Id` header |
| Token-based access enforces `safeForPreview` | yes — `tokenAllowsAttachment` requires `safeForPreview !== false` for `JobRequest`-level attachments |

---

## Sensitive data in logs

| Check | Result |
|---|---|
| Customer phone in logs | OK — `resolveProviderLeadAccessToken` logs use `maskPhone()` for denied paths |
| Provider phone in logs | OK — `maskPhone()` used consistently |
| Token values in logs | OK — no token values logged, only `leadId`, `providerId`, `jobRequestId`, and trace IDs |
| Any sensitive fields logged | no (OK) |

---

## Gaps closed

1. **`resolveJobRequestAccessScope` — no trace ID on denial** (FIXED): Added `createTraceId('jra')` and returned `traceId` in all result shapes; denial paths now `console.warn` with trace ID.

2. **`resolveJobRequestAccessToken` — no trace ID on denial** (FIXED): Added `createTraceId('jrt')`, returned `traceId` in all result shapes, `console.warn` on denial.

3. **`resolveJobRequestAccessToken` — `include` leaked all scalar fields** (FIXED): Changed from `include: { ... }` to an explicit `select: { ... }` at the root level. The select includes only the fields callers need (`id, customerId, category, title, description, status, expiresAt, createdAt, updatedAt, selectedLeadInviteId, customerAccessTokenExpiresAt, customerAccessTokenRevokedAt, customer, address, attachments, leads, match`). `customerAccessToken`, `selectedProviderId`, `latestDispatchDecisionId`, and all other internal scalars are no longer returned.

4. **`resolveJobRequestAccessToken` — token value returned in result** (FIXED): `customerAccessToken` is not in the select above. Defensive destructuring in the return path additionally strips `customerAccessToken`, `customerAccessTokenExpiresAt`, and `customerAccessTokenRevokedAt` from the returned object before handing it to callers.

5. **`clientPwaRequestInclude` — `include` leaked all scalar fields** (FIXED): Renamed to `clientPwaRequestSelect`, changed `Prisma.validator<Prisma.JobRequestInclude>()` to `Prisma.validator<Prisma.JobRequestSelect>()`, and updated the corresponding `ClientPwaDestinationRequest` type and all `findUnique` calls to use `select:` instead of `include:`. Sensitive scalars (`customerAccessToken`, `selectedProviderId`, `latestDispatchDecisionId`, `customerAccessTokenExpiresAt`, `customerAccessTokenRevokedAt`) no longer appear in the resolved destination.

6. **`bookings/[id]/page.tsx` — `customer: true` over-fetched all Customer fields** (FIXED): Three queries used `customer: true` (full include). Changed all three to `customer: { select: { id: true } }` since only the `id` field is used for ownership comparison. This prevents `isBlocked`, `blockedReason`, `suspendedReason`, `internalFlags`, `marketingOptIn`, etc. from being fetched into server memory.

7. **`job-request-access.test.ts` — test expected `include` key** (FIXED): Updated test to use `select` to match the changed implementation.

8. **`client-pwa-destination.test.ts` — test accessed `include.match.include.provider.select`** (FIXED): Updated path to `select.match.include.provider.select`.

---

## Tests

**27 tests** in `field-service/__tests__/lib/client-pwa-security-token-rules.test.ts`

Key scenarios:
- `resolveJobRequestAccessScope` returns `active` / `expired` / `invalid` with `traceId` in all paths
- `resolveJobRequestAccessToken` strips `customerAccessTokenExpiresAt`, `customerAccessTokenRevokedAt`, and `customerAccessToken` (defensive) from returned payload
- DB lookup is keyed on `customerAccessToken` (scoping)
- Provider shortlist select omits protected fields
- Provider preview: `customer: null` before acceptance, phone + street unlocked after acceptance
- `resolveProviderLeadAttachmentScope`: `isAccepted=false` for SENT, `isAccepted=true` for ACCEPTED with matching unlock, `isAccepted=false` when unlock belongs to a different provider
- Admin-only fields (`kycStatus`, `strikes`, `payoutVerifiedAt`, `suspendedReason`, `archiveReason`, `internalFlags`) absent from all token payloads

Full test run: **1999 passed, 0 failing**, 1 pre-existing skip (unrelated).

---

## Files changed

- `field-service/lib/job-request-access.ts` — added `createTraceId` import; trace IDs on all denial paths; `include` → explicit `select`; defensive strip of token columns from returned payload
- `field-service/lib/client-pwa-destination.ts` — `clientPwaRequestInclude` → `clientPwaRequestSelect`; type updated from `JobRequestInclude` to `JobRequestSelect`; `findUnique` changed to `select:`
- `field-service/app/(customer)/bookings/[id]/page.tsx` — 3× `customer: true` → `customer: { select: { id: true } }`
- `field-service/__tests__/lib/client-pwa-security-token-rules.test.ts` — new, 27 tests
- `field-service/__tests__/lib/job-request-access.test.ts` — `include` → `select` in assertion
- `field-service/__tests__/lib/client-pwa-destination.test.ts` — provider select path assertion updated

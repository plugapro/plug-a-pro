# CODEX-15 — Security and Privacy Audit

## Status
DONE_WITH_CONCERNS (two gaps closed, one structural concern noted)

---

## Protected field exposure scan

| Field | In lead preview query? | Notes |
|-------|----------------------|-------|
| customer mobile | no (OK) | `resolveProviderLeadAccessToken` selects only suburb/city in preview path; second DB fetch for `customer.phone` only runs when `hasAcceptedUnlock === true` |
| customer email | no (OK) | Customer email is never selected in any provider-facing query path |
| exact street address | no (OK) | Preview address select: `{ suburb, city, province, region }` only; street/addressLine1/addressLine2 are in the accepted-only second fetch |
| house number | no (OK) | No `houseNumber` field in schema; street is gated as above |
| unit number | no (OK) | `unitNumber` is in the accepted-only second fetch in both `provider-lead-access.ts` and `provider-lead-detail.ts` |
| complex access details | no (OK) | `complexName` and `accessNotes` are in the accepted-only second fetch |
| GPS coordinates | no (OK) | `lastKnownLat`/`lastKnownLng` are provider-side fields used only within the matching engine internally and never appear in any provider-facing API response |
| access notes | no (OK) | `accessNotes` is in the accepted-only second fetch |
| private notes / description | partial (OK) | `previewNotes()` truncates descriptions to 180 chars in preview; full description only after acceptance |

**`getSafeProviderOpportunityPreview`** (`provider-opportunity-responses.ts:40`) explicitly excludes customer, phone, email, street, unit, complex, access notes, and GPS fields. A comment in that function documents the intent.

---

## Token security

| Check | Status |
|-------|--------|
| Phone hash verification: present | present — `hashProviderPhone` is checked when `providerPhoneHash` is embedded in the token payload |
| Scope check (provider matches token) | present — `lead.providerId !== verified.payload.providerId` returns `invalid` |
| Expired token guard | present — `payload.exp <= Math.floor(Date.now() / 1000)` returns `expired` |
| Trace ID on denial | present — `traceId` is generated at entry and returned in every early-return path |
| Cancelled match guard | present — CANCELLED match status returns `invalid` after acceptance (supersedes the token) |
| Inactive provider guard | present — `!lead.provider.active || lead.provider.status !== 'ACTIVE'` returns `invalid` |

Token signing uses HMAC-SHA256 (`createHmac`) with a server-side secret. Comparison uses `timingSafeEqual` to prevent timing attacks.

---

## Attachment authorization

| Check | Status |
|-------|--------|
| Unauthorized access blocked | yes — unauthenticated requests with no valid token return 401 |
| safeForPreview enforced for ticket tokens | yes — `tokenAllowsAttachment` checks `attachment?.safeForPreview !== false` for request-level attachments |
| safeForPreview enforced for lead tokens | yes (FIXED, see Gaps Closed) — `leadTokenAllowsAttachment` now checks `safeForPreview` unless `isAccepted === true` or it is a job attachment |
| Trace ID on denial | yes — all denial responses include `traceId` in body and `X-Trace-Id` header |
| Job attachments exempt from safeForPreview | yes — `isJobAttachment` flag bypasses the `safeForPreview` check for both ticket and lead tokens |

---

## Non-selected provider guard

| Scenario | Result |
|----------|--------|
| Can non-selected provider access full details using their own token | no (OK) — `hasAcceptedUnlock` requires `lead.status === 'ACCEPTED' && lead.unlock?.providerId === lead.providerId`; a SENT/VIEWED lead is never `isUnlocked` |
| Can a provider whose unlock belongs to a different provider access PII | no (OK) — the `providerId` check on the `unlock` row blocks this case in both `provider-lead-access.ts` and `provider-lead-detail.ts` |
| Can a provider whose token is for their own lead read another provider's unlock | no (OK) — tokens are scoped to a single `(leadId, providerId)` pair |

---

## Admin role checks

| Check | Status |
|-------|--------|
| Admin routes require admin session | yes — `requireAdmin()` is called in `app/(admin)/layout.tsx` which wraps all admin routes; individual pages and cron APIs also call it separately |
| Admin API routes require admin session | yes — `requireAdminApi()` called in admin API handlers; `requireAdmin()` in admin locations API |
| crudAction() gate | yes — all admin mutations in `customers/actions.ts`, `providers/actions.ts`, `team/actions.ts`, and `locations/actions.ts` go through `crudAction()` which resolves `AdminUser.role` from DB |

---

## Sensitive data in logs

| Finding | Severity |
|---------|----------|
| `registration.ts` lines 736, 746, 787, 802 logged raw `ctx.phone` (WhatsApp E.164 number) at `console.info`/`console.error` level | BUG (FIXED) |
| `provider-lead-access.ts` warn logs use `maskPhone()` for phone values | OK |
| `worker-provider-auth.ts` uses `maskPhone()` for phone repair logs | OK |
| `whatsapp-flows/job-request.ts` street-address logs use `maskedPhone(ctx.phone)` in `logContext` and never log the street value directly | OK |
| `selected-provider-acceptance.ts` error log does not include customer phone | OK |

---

## Gaps closed

1. **`safeForPreview` not enforced for lead tokens** (CODEX-15-G1)
   - Before: `leadTokenAllowsAttachment` in `app/api/attachments/[id]/route.ts` allowed any active lead token to fetch any attachment for the job request regardless of `safeForPreview`.
   - Fix: `resolveProviderLeadAttachmentScope` now returns `isAccepted: boolean`. The attachment route uses this to apply `safeForPreview !== false` for non-accepted lead tokens, matching the same logic applied to ticket tokens.
   - Files: `field-service/lib/provider-lead-access.ts`, `field-service/app/api/attachments/[id]/route.ts`

2. **Raw provider phone number logged at info/error level in registration flow** (CODEX-15-G2)
   - Before: `console.info` / `console.error` in `whatsapp-flows/registration.ts` at `handleVerifyUploadDoc` and `handleVerifyUploadSelfie` logged `phone: ctx.phone` (full E.164 number).
   - Fix: Replaced with `phone: maskPhoneForLog(ctx.phone)` using the existing local masking function.
   - File: `field-service/lib/whatsapp-flows/registration.ts`

---

## Structural concern (not a gap, but noted)

**`resolveJobRequestAccessToken` includes full `address: true`** in the `clientPwaRequestInclude` Prisma selector (`client-pwa-destination.ts` and `job-request-access.ts`). This means the client PWA destination resolver returns full address including street, unitNumber, and accessNotes to any code path that calls it. The customer-facing PWA is intentionally allowed to see their own address, so this is correct design — but it means callers must never forward this payload to provider-side code. No current code path does this, but the boundary should remain explicit.

---

## Tests

**1820 passing, 0 failing** across 167 test files.

New tests added:

| Suite | Scenarios added |
|-------|----------------|
| `__tests__/lib/provider-access-security.test.ts` | 4 — `resolveProviderLeadAttachmentScope` returns correct `isAccepted` flag for SENT/ACCEPTED/wrong-unlock/expired |
| `__tests__/api/attachments-authz.test.ts` | 4 — lead token `safeForPreview` enforcement: blocks non-accepted on private, allows accepted on private, allows non-accepted on safe, allows job attachment |

Total new scenarios: 8.

---

## Files changed

- `field-service/lib/provider-lead-access.ts` — `resolveProviderLeadAttachmentScope` now returns `isAccepted: boolean`
- `field-service/app/api/attachments/[id]/route.ts` — `leadTokenAllowsAttachment` enforces `safeForPreview` for non-accepted lead tokens
- `field-service/lib/whatsapp-flows/registration.ts` — masked provider phone in 4 log lines
- `field-service/__tests__/lib/provider-access-security.test.ts` — 4 new test cases for `resolveProviderLeadAttachmentScope`
- `field-service/__tests__/api/attachments-authz.test.ts` — 4 new test cases for lead token `safeForPreview` enforcement

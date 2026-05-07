# Execution Output — 14-provider-security-token-and-access-rules.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/14-provider-security-token-and-access-rules.md

## Objective
Audit and harden provider WhatsApp and PWA access control across all nine security rules: sender phone binding, token scoping, per-provider opportunity isolation, safe customer-field preview, post-acceptance unlock gate, non-selected provider exclusion, expired/superseded token revocation, image authorization, and admin-only field exclusion.

## Current-state findings

### What was already correct
- **WhatsApp sender → provider mapping** (`lib/whatsapp-identity.ts`): `resolveWhatsAppIdentity` maps the inbound `message.from` phone to a Provider DB record using `findMany` + phone-variant lookup. Logs trace IDs. The webhook route verifies Meta HMAC signature before passing messages to the bot. WhatsApp bot blocks cross-role actions (provider blocked from customer journey, customer blocked from provider journey).
- **Token HMAC integrity** (`lib/provider-lead-access.ts`): Tokens are HMAC-SHA256 signed with `PROVIDER_LEAD_ACCESS_SECRET`. Timing-safe comparison guards against timing attacks. Tampered tokens are rejected.
- **Token expiry**: Both `verifyProviderLeadAccessToken` and `verifyCustomerProviderHandoverToken` check `payload.exp <= now`.
- **Provider ID binding in token**: `resolveProviderLeadAccessToken` checks `lead.providerId !== verified.payload.providerId`.
- **jobRequestId cross-check**: Token's optional `jobRequestId` is checked against the DB lead.
- **Cancelled match revocation**: Token is invalidated when `lead.jobRequest.match?.status === 'CANCELLED'`.
- **Safe preview** (`lib/provider-lead-detail.ts`, `previewNotes`): Descriptions truncated at 180 chars; full text withheld before acceptance.
- **Customer PII gate**: Before acceptance, the address query returns only suburb/city/province/region; street, unit, complex, GPS excluded. Customer phone/email only added on second DB query when `hasAcceptedUnlock` is true.
- **Unlock ownership check**: `hasAcceptedUnlock` requires `lead.unlock?.providerId === lead.providerId`, preventing a different provider's unlock from granting PII to the token holder.
- **Attachment authorization** (`app/api/attachments/[id]/route.ts`): Three access paths enforced server-side — admin session, provider/customer session (DB ownership check), or valid lead token scoped to same job request. Expired lead tokens return 401.
- **Admin-only fields**: The DB queries in `resolveProviderLeadAccessToken` do not select `strikes`, `kycStatus`, `payoutVerifiedAt`, `suspendedReason`, `archiveReason`, or `internalFlags`.
- **Image authorization**: Attachment route requires session, ticket token scoped to job, or lead token scoped to job. Unauthenticated unscoped requests return 401.
- **Provider PWA opportunity route** (`app/api/provider/opportunities/[leadId]/route.ts`): Resolves provider via `userId` from session, then passes `providerId` to `getSafeProviderOpportunityPreview` — cross-provider access not possible.

### Gaps found and fixed
1. **CRITICAL — Phone hash not verified** (`lib/provider-lead-access.ts:302`): The `providerPhoneHash` field embedded in the token payload was never checked against the provider's stored phone during `resolveProviderLeadAccessToken`. A token issued for provider A's phone could have been replayed from a different number without rejection. Fixed by adding hash verification: when `verified.payload.providerPhoneHash` is set, it is compared via `hashProviderPhone(lead.provider.phone)` before granting access.

2. **MEDIUM — No assertSenderPhone option**: There was no way for the WhatsApp bot to pass the inbound `message.from` phone for verification during token resolution. Fixed by adding an `assertSenderPhone` option to `resolveProviderLeadAccessToken` that computes and compares hash of the stored provider phone against the inbound sender.

3. **LOW — No trace IDs in denied access log entries**: `resolveProviderLeadAccessToken` produced no trace IDs, making denied-access events untrackable. Fixed by generating a `traceId` at the start of each resolution call, including it in all `console.warn` denial logs, and returning it on all response paths (including active/invalid/expired).

4. **LOW — Attachment denied responses missing traceId in body**: The attachment route returned `{ error }` without a `traceId` field and no `X-Trace-Id` header for lead-token and anonymous denials. Fixed to include both.

## Implementation completed

1. Added `maskPhone` import to `lib/provider-lead-access.ts`
2. Added `opts.assertSenderPhone` parameter to `resolveProviderLeadAccessToken`
3. Added `traceId` generation at the top of `resolveProviderLeadAccessToken`
4. Added phone hash verification block: checks `verified.payload.providerPhoneHash` against `hashProviderPhone(lead.provider.phone)`
5. Added `assertSenderPhone` block: compares hash of inbound sender against hash of DB provider phone
6. Added `console.warn` with `traceId` on every denial path (scope mismatch, phone hash mismatch, sender mismatch, cancelled match)
7. Propagated `traceId` through all return values including `resolveProviderLeadAttachmentScope`
8. Updated attachment route denied responses to include `traceId` in body and `X-Trace-Id` response header
9. Added 10 new tests to `__tests__/lib/provider-lead-access.test.ts` (phone hash binding suite)
10. Created `__tests__/lib/provider-access-security.test.ts` with 11 tests covering all nine security rules

## Files changed
| File | Change summary |
|---|---|
| `lib/provider-lead-access.ts` | Added `maskPhone` import; added `opts.assertSenderPhone`; added `traceId` on all code paths; added phone hash verification and sender phone assertion blocks; added `console.warn` with traceId on every denial |
| `app/api/attachments/[id]/route.ts` | Added `traceId` and `X-Trace-Id` header to all denied responses (lead token, ticket token, unauthenticated, forbidden) |
| `__tests__/lib/provider-lead-access.test.ts` | Added 10 tests: phone hash mismatch, phone hash match, no-hash token, wrong assertSenderPhone, correct assertSenderPhone, traceId on success, cross-provider token, wrong jobRequestId |
| `__tests__/lib/provider-access-security.test.ts` | New file: 11 tests covering all 9 security rules — token scope, PII gating pre/post acceptance, non-selected provider, admin field exclusion, expiry, superseded token |

## WhatsApp flow changes
None. The WhatsApp bot already uses `message.from` to resolve sender identity via `resolveWhatsAppUserContext`. The new `assertSenderPhone` opt-in is available for any future WhatsApp command handler that passes a token + sender phone together.

## PWA route/screen changes
None. PWA routes use session-authenticated provider ID from DB — no change needed.

## API/server changes
- `lib/provider-lead-access.ts`: `resolveProviderLeadAccessToken` signature extended with optional `opts` parameter (backward compatible).
- `app/api/attachments/[id]/route.ts`: Denied responses now include `traceId` field and `X-Trace-Id` header.

## Credit impact
None

## Security/privacy impact

**CRITICAL enforcement points:**

| Rule | Enforcement Location | File:Line |
|------|---------------------|-----------|
| WhatsApp sender → provider | `resolveWhatsAppIdentity` phone-variant DB lookup | `lib/whatsapp-identity.ts:81` |
| Meta webhook HMAC verification | `verifyMetaSignature` called before any bot logic | `app/api/webhooks/whatsapp/route.ts:41` |
| Token HMAC integrity | `timingSafeEqual` signature check | `lib/provider-lead-access.ts:134` |
| Token expiry | `payload.exp <= Math.floor(Date.now() / 1000)` | `lib/provider-lead-access.ts:144` |
| Provider ID binding | `lead.providerId !== verified.payload.providerId` | `lib/provider-lead-access.ts:303` |
| **Phone hash binding (NEW)** | `hashProviderPhone(lead.provider.phone) !== expectedHash` | `lib/provider-lead-access.ts:322` |
| **Sender phone assertion (NEW)** | `hashProviderPhone(opts.assertSenderPhone) !== storedHash` | `lib/provider-lead-access.ts:333` |
| jobRequestId cross-check | Token jobRequestId vs DB `lead.jobRequestId` | `lib/provider-lead-access.ts:305` |
| Cancelled match revocation | `lead.jobRequest.match?.status === 'CANCELLED'` | `lib/provider-lead-access.ts:350` |
| Customer PII gate (pre-acceptance) | Preview query excludes street/unit/complex/GPS; `customer: null` | `lib/provider-lead-access.ts:252–326` |
| Customer PII unlock | `hasAcceptedUnlock = lead.status === 'ACCEPTED' && lead.unlock?.providerId === lead.providerId` | `lib/provider-lead-access.ts:364` |
| Non-selected provider blocked | Unlock ownership check prevents other providers' PII access | `lib/provider-lead-access.ts:364` |
| Image access authorization | Session + lead-token + ticket-token all server-side checked | `app/api/attachments/[id]/route.ts:124–192` |
| Provider-only job visibility | Attachment route resolves Provider by `userId`, not session ID | `app/api/attachments/[id]/route.ts:131` |
| Admin-only field exclusion | DB `select` in `resolveProviderLeadAccessToken` omits all admin fields | `lib/provider-lead-access.ts:252–299` |
| Trace ID on all denials | `console.warn` with traceId + response body `traceId` field | `lib/provider-lead-access.ts:310–355` |

**No sensitive fields logged** — phone numbers are masked via `maskPhone` before any `console.warn`/`console.info` call.

## Tests added or updated

**`__tests__/lib/provider-lead-access.test.ts`** — 10 new tests in suite `provider lead access — phone hash and sender verification`:
- rejects token whose providerPhoneHash does not match stored provider phone
- accepts token when providerPhoneHash matches stored provider phone
- accepts token with no providerPhoneHash without phone validation
- rejects when assertSenderPhone does not match stored provider phone
- accepts when assertSenderPhone matches stored provider phone
- returns a traceId on successful resolution
- cannot use provider-1 token to access provider-2 lead
- cannot use provider-1 token for a different job request

**`__tests__/lib/provider-access-security.test.ts`** — 11 new tests:
- Cross-provider token scope: rejects wrong providerId, phone hash mismatch, wrong assertSenderPhone
- Scope upgrade prevention: lead-response token cannot claim job-execution scopes; job token cannot claim accept/decline
- Customer PII gating: safe preview hides phone, private notes, GPS; accepted provider gets full details
- Non-selected provider: unlock by provider-1 does not grant PII to provider-2 with own token
- Admin fields absent: strikes, kycStatus, payoutVerifiedAt, suspendedReason absent from token resolution
- Expiry: expired token returns status=expired; superseded (cancelled match) returns status=invalid with traceId

## Commands run
```bash
cd "field-service" && pnpm test -- --run 2>&1 | tail -30
```

## Test results
162 test files passed, 1 skipped (163 total). 1692 tests passing, 4 todo. 0 failures.

## Manual verification checklist
- [x] Wrong provider cannot access another provider's lead/job (token providerId check + tests)
- [x] Safe preview hides protected fields (description truncation + customer: null + no street/unit)
- [x] Accepted provider can access full details (hasAcceptedUnlock gate + tests)
- [x] Unauthorized image access blocked (attachment route authz + attachments-authz.test.ts)
- [x] Tests pass (1692/1692 passing)

## Risks and follow-ups

1. **`assertSenderPhone` is opt-in**: Callers must explicitly pass `opts.assertSenderPhone` when the sender phone is available (e.g. WhatsApp bot handling a tokenized action). The next natural integration point is `handleProviderJourneyFlow` and `executeProviderJobCommand` when processing token-bearing WhatsApp replies — these currently rely on `resolveWhatsAppUserContext` → provider identity rather than token verification, so they don't yet call `resolveProviderLeadAccessToken` at all. Recommend enforcing `assertSenderPhone` in any future handler that processes a WhatsApp message containing a `leadToken`.

2. **Handover token phone binding**: `lib/customer-provider-handover-access.ts` stores `providerId` in the handover token but no phone hash. If a handover token were intercepted, it could be replayed by any party with network access to the URL. This is mitigated by the HMAC signature and the match ownership checks, but adding `providerPhoneHash` to the handover token is a recommended follow-up.

3. **`db.provider.findFirst` in `findSingleActiveJobForProviderPhone`** (`lib/provider-whatsapp-job-commands.ts:222`): uses exact-phone lookup without variant fallback. If a provider has a legacy non-E.164 stored phone, commands sent from the correct number could return `no_provider`. The auto-repair logic in `findProviderForOtpLogin` addresses this at login time; job-command path relies on phone being clean. Low risk post-repair.

## OpenBrain note
Security audit Step 14 complete. Critical fix: phone hash in provider lead access tokens was stored but never verified. Added hash verification + sender phone assertion + trace IDs. 21 new tests added (10 + 11). 1692 tests passing.

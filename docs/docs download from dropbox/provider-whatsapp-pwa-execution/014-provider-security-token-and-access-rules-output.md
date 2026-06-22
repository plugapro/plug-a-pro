# Execution Output — 14-provider-security-token-and-access-rules.md

## Status

Completed

## Blueprint file executed

`Plug A Pro/plugapro_provider_whatsapp_pwa_blueprint/14-provider-security-token-and-access-rules.md`

## Objective

Audit and harden provider WhatsApp/PWA access controls for provider ownership, token scope, safe previews, image authorization, and full-detail unlock.

## Current-state findings

The core access model was already strong:

- WhatsApp direct job commands resolve provider identity from the sender phone.
- Signed provider lead tokens include provider, lead, job request, scopes, expiry, and optional provider phone hash.
- Provider lead detail service blocks wrong-provider access.
- Accepted-job tokens are scoped separately from lead response tokens.
- Attachment proxy authorizes by provider ownership, customer ownership, ticket token, or provider lead token.
- Selected-provider acceptance enforces selected provider and selected lead before credit deduction and full detail release.

Two hardening gaps were found:

- Signed lead preview attachments were not explicitly filtered to `safeForPreview`.
- Full-detail unlock checked accepted status and unlock existence, but did not explicitly require the unlock row to belong to the same provider.

## Implementation completed

- Added `safeForPreview: true` filtering to signed provider lead preview attachments.
- Changed accepted full-detail unlock condition to require `lead.unlock.providerId === lead.providerId`.
- Added trace-ID response metadata for denied signed contact-customer handoff attempts.
- Added regression tests for:
  - Safe-preview attachment filtering.
  - Wrong-provider unlock not revealing full customer details.
  - Contact-customer denial trace ID.
  - Attachment authorization.
  - Provider phone/job command ownership.

## Files changed

| File | Change summary |
|---|---|
| `field-service/lib/provider-lead-access.ts` | Safe-preview attachment filter and provider-owned unlock condition |
| `field-service/app/api/provider/leads/[leadId]/contact-customer/route.ts` | Denied access now returns/logs trace ID without sensitive data |
| `field-service/__tests__/lib/provider-lead-access.test.ts` | Added safe-preview and wrong-provider unlock tests |
| `field-service/__tests__/api/provider-contact-customer.test.ts` | Added denied contact handoff trace-ID test |
| `docs/provider-whatsapp-pwa-execution/014-provider-security-token-and-access-rules-output.md` | Step 14 required execution output |
| `docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md` | Updated execution index |

## WhatsApp flow changes

No user-facing WhatsApp behavior changed. Access controls behind WhatsApp links and direct commands were hardened.

## PWA route/screen changes

No new PWA route was added. Existing signed PWA screens now receive stricter preview/unlock data from the server.

## API/server changes

- Provider lead token resolution now only includes preview-safe attachments before acceptance.
- Accepted full-detail data is released only when the accepted lead unlock belongs to the same provider.
- Contact-customer API denial responses now include `traceId` and `X-Trace-Id`.

## Credit impact

No credit behavior changed.

## Security/privacy impact

- Wrong provider cannot use another provider's unlock to reveal customer details.
- Provider previews exclude attachments flagged unsafe for preview.
- Denied access paths include trace IDs without logging customer phone, address, access notes, GPS coordinates, or private notes.
- Existing image proxy authorization remains in force.

## Tests added or updated

- Provider lead access safe-preview test update.
- Wrong-provider unlock test.
- Contact-customer denial trace test.

## Commands run

```bash
npm test -- --run __tests__/lib/provider-lead-access.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/api/attachments-authz.test.ts __tests__/api/provider-contact-customer.test.ts __tests__/lib/provider-whatsapp-job-commands.test.ts
npx tsc --noEmit
npm run lint
```

## Test results

| Command | Result |
|---|---|
| `npm test -- --run __tests__/lib/provider-lead-access.test.ts __tests__/lib/provider-lead-detail.test.ts __tests__/api/attachments-authz.test.ts __tests__/api/provider-contact-customer.test.ts __tests__/lib/provider-whatsapp-job-commands.test.ts` | Passed; 5 files, 55 tests |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with 3 pre-existing unrelated warnings |

## Manual verification checklist

- [x] Wrong provider cannot access another provider's lead/job.
- [x] Safe preview hides protected customer fields.
- [x] Accepted provider can access full details.
- [x] Non-owned unlock does not reveal full details.
- [x] Unauthorized image access is blocked.
- [x] Secure token scopes remain enforced.
- [x] Denied contact handoff includes trace ID.

## Risks and follow-ups

- Token revocation remains status-based and expiry-based. If product needs immediate explicit token revocation independent of lead/job status, add a token denylist keyed by `jti`.

## OpenBrain note

Provider security/access rules hardened. Signed previews now respect safe-preview attachment flags, full-detail unlock requires provider-owned unlock, denied contact handoffs carry trace IDs, and existing image/token/provider ownership tests pass.

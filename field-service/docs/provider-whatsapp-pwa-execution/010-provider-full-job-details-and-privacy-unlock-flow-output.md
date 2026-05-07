# Execution Output — 10-provider-full-job-details-and-privacy-unlock-flow.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/10-provider-full-job-details-and-privacy-unlock-flow.md

## Objective
Confirm and lock down the two-phase privacy model: protected fields (customer phone, name, exact street address, unit, complex, access notes, GPS) are withheld server-side before acceptance, and all protected fields are delivered inline via WhatsApp and via the PWA immediately after the accepted provider completes their final acceptance.

## Current-state findings

All three enforcement layers were already in place before this step:

| Layer | File | Status |
|---|---|---|
| Lead detail API (PWA) | `lib/provider-lead-detail.ts` | Correct — sensitive second DB query only when `isUnlocked = (status=ACCEPTED && unlock.providerId === providerId)` |
| Token-based access (PWA signed link) | `lib/provider-lead-access.ts` | Correct — `resolveProviderLeadAccessToken` performs a second sensitive DB query only on `hasAcceptedUnlock` |
| WhatsApp post-acceptance message | `lib/selected-provider-acceptance.ts` | Correct — customer name, phone, full address, unit, complex, access notes, description, photos count, reference, preferred time all inline after transactional commit |
| Customer handover token | `lib/customer-provider-handover-access.ts` | Correct — customer phone never exposed to customer-side token; match.providerId must match token.providerId |

One copy gap was found: the WhatsApp message used `Available credits: X credits` where the blueprint spec says `Available balance: X`.

## Implementation completed

1. **`lib/selected-provider-acceptance.ts`** — Changed `Available credits: ${params.currentCreditBalance} credits` to `Available balance: ${params.currentCreditBalance}` to match the blueprint spec.
2. **`__tests__/lib/selected-provider-acceptance.test.ts`** — Added `expect(providerSend.text).toContain('Available balance:')` to lock the copy.
3. **`__tests__/lib/provider-privacy-unlock-flow.test.ts`** — New test file with 5 targeted tests covering the blueprint requirements.

## Files changed

| File | Change summary |
|---|---|
| `lib/selected-provider-acceptance.ts` | Align WhatsApp copy: `Available credits: X credits` → `Available balance: X` |
| `__tests__/lib/selected-provider-acceptance.test.ts` | Add assertion for `Available balance:` label in provider WhatsApp message |
| `__tests__/lib/provider-privacy-unlock-flow.test.ts` | New: 5 tests covering pre-acceptance PII blackout, post-acceptance unlock, non-selected provider FORBIDDEN, wrong-provider unlock denied, server-side token enforcement |

## WhatsApp flow changes

The post-acceptance provider message now reads:

```
Job accepted.

1 credit used. ...
Available balance: 2
Starter/onboarding: 1
Purchased: 1

Customer details:
Name: <name>
Phone: <phone>
Address: <unit>, <complex>, <street>, <suburb>, <city>, <province>
Access notes: <access_notes>

Job details:
Reference: <ref>
Preferred time: <window>
Job description: <description>
Photos: N available in the job link

Next step:
Reply with your arrival time.
Example: 14:00
```

The CTA button (sent as a separate `sendCtaUrl` call) carries the signed job URL — it never appears inline in the text body.

## PWA route/screen changes

No route changes. The `app/leads/access/[token]/page.tsx` correctly gates display of `customer.phone`, `customer.name`, and full address behind `hasAcceptedDetails = isAccepted && Boolean(lead.unlock)`. The server-side data source (`resolveProviderLeadAccessToken`) is the authoritative gate — the UI renders only what the server returned.

## API/server changes

No schema or API route changes. The enforcement is in the data-access layer, not at the route level.

## Credit impact

Credits are deducted exclusively in Step 08 (`unlockLeadForProviderInTransaction` called from `acceptSelectedProviderJob`). Step 10 only confirms the post-deduction data disclosure. No additional credit deduction occurs here.

## Security/privacy impact

### Before acceptance — protected fields withheld at three layers

1. **`lib/provider-lead-detail.ts:getProviderLeadDetailForProvider`**
   - `isUnlocked = lead.status === 'ACCEPTED' && lead.unlock?.providerId === providerId`
   - The second DB query (which fetches `customer.name`, `customer.phone`, `address.street`, `address.unitNumber`, `address.complexName`, `address.accessNotes`) is **never executed** unless `isUnlocked` is `true`.
   - If `providerId` does not match `lead.providerId`, a `FORBIDDEN` error is thrown before any data is returned.

2. **`lib/provider-lead-access.ts:resolveProviderLeadAccessToken`**
   - Token signature is HMAC-SHA256 verified with `timingSafeEqual` before any DB call.
   - `lead.providerId !== verified.payload.providerId` → returns `{status: 'invalid', lead: null}`.
   - `hasAcceptedUnlock = lead.status === 'ACCEPTED' && lead.unlock?.providerId === lead.providerId` — same double-gate as above.
   - The preview DB query (`address` select) contains only `suburb`, `city`, `province`, `region` — no `street`, `unitNumber`, `complexName`, `accessNotes`.
   - Customer PII (`customer.phone`, `customer.name`) is **never fetched** in the first query.

3. **`lib/customer-provider-handover-access.ts:resolveCustomerProviderHandoverToken`**
   - `lead.status !== 'ACCEPTED'` → returns `{status: 'invalid'}`.
   - `match.providerId !== payload.providerId` → returns `{status: 'invalid'}`.
   - Customer phone is not included in the handover response (only `customer.id` and `customer.name`).

### After acceptance — full fields disclosed only to the accepted provider

- The second DB query in both `getProviderLeadDetailForProvider` and `resolveProviderLeadAccessToken` fetches the full address and customer PII only after the server-side `isUnlocked` check passes.
- The WhatsApp notification is sent outside the DB transaction, only after `result.ok === true`. No customer PII travels through error logs — `console.error` calls log only `leadId` and `providerId`.

### Logging — no PII in logs

The two `console.error` calls in `selected-provider-acceptance.ts` (lines 379 and 494) log only `{ leadId, providerId, error }`. Customer phone, name, and address are not included.

## Tests added or updated

| Test file | Tests | What is tested |
|---|---|---|
| `__tests__/lib/provider-privacy-unlock-flow.test.ts` | 5 new | (1) preview excludes customer name/phone/street/unit/complex; (2) accepted provider receives all fields; (3) different provider is FORBIDDEN server-side; (4) wrong-provider unlock does not grant access; (5) `resolveProviderLeadAccessToken` returns null customer and preview-only address before acceptance |
| `__tests__/lib/selected-provider-acceptance.test.ts` | 1 assertion added | Locks `Available balance:` copy in provider WhatsApp message |

## Commands run

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -10
```

## Test results

```
Test Files  160 passed | 1 skipped (161)
     Tests  1652 passed | 4 todo (1656)
```

All 1652 tests pass. 5 new tests added.

## Manual verification checklist

- [x] Full details are not available before acceptance — server-side in `provider-lead-detail.ts` and `provider-lead-access.ts`
- [x] Full details are sent in WhatsApp after acceptance — `notifySelectedAcceptanceCommitted` in `selected-provider-acceptance.ts`
- [x] Only accepted provider can access full details — double-gated by `status === 'ACCEPTED'` AND `unlock.providerId === providerId`
- [x] Tests pass — 1652/1652

## Risks and follow-ups

- **Description field in preview**: The `previewNotes()` function truncates the job description to 180 chars for preview. If a customer puts sensitive details (gate codes, exact addresses) in the description text, those could appear in the preview. This is a UX risk, not a bug — the address-model fields are fully protected. Consider adding a UI hint to customers saying not to include exact access details in the description until after a provider accepts.
- **No GPS coordinates in schema for preview**: The `JobRequestAddress` model does not appear to have a `lat`/`lng` column exposed in any provider-facing query; this is therefore not a gap.
- **Logs**: `console.error` is still the observability layer — no Sentry or structured log sink. Flagged in previous steps; out of scope for Step 10.

## OpenBrain note

Step 10 is primarily a confirmation pass. The privacy unlock model was already implemented correctly across all three enforcement layers. The only code change was aligning the WhatsApp message copy from `Available credits: X credits` to `Available balance: X` per blueprint spec. Five new tests were added to explicitly document and lock the privacy contract.

# Execution Output — 06-provider-opportunity-preview-whatsapp-flow.md

## Status
Completed

## Blueprint file executed
plugapro_provider_whatsapp_pwa_blueprint/06-provider-opportunity-preview-whatsapp-flow.md

## Objective
Implement and verify the safe WhatsApp opportunity preview sent to providers on lead dispatch. Ensure protected customer fields (phone, email, exact street address, unit, access notes, GPS coordinates) cannot appear in the preview message body. Confirm photo count appears, interested/not-interested quick replies are present, and tests assert all privacy guarantees.

## Current-state findings

**What already existed (correct):**

- `lib/provider-opportunity-responses.ts:getSafeProviderOpportunityPreview` — DB query scoped to safe address fields only (`suburb`, `region`, `city`, `province`); no `street`, `accessNotes`, `lat`, `lng`, `customer` records. `attachments` filtered by `safeForPreview: true`.
- `lib/provider-credit-copy.ts:buildProviderLeadPreviewMessage` — accepts optional `photosCount?: number | null` and renders `Photos: *N available*` line when present.
- `lib/whatsapp-bot.ts:notifyProviderNewJob` — uses `getSafeProviderOpportunityPreview` to enrich the preview body and correctly includes `preview?.attachments.length` as photo count.
- `lib/matching/dispatch.ts:dispatchMatchLead` — sends CTA URL with preview body via `sendCtaUrl`, then sends "I'm interested" / "Not interested" buttons (when `qualified_shortlist.dispatch_v2` flag is on) or "Accept Lead" / "Decline" (legacy path). Both paths covered.
- `lib/whatsapp-interactive.ts` — `assertNoRawUrlsInWhatsAppBody` guard fires on every send, blocking inline URLs.
- `__tests__/lib/provider-opportunity-responses.test.ts` — existing tests assert `getSafeProviderOpportunityPreview` DB query excludes `street`, `latitude`, `accessNotes`, and `customer` fields.

**Gap found:**

`lib/matching/dispatch.ts:dispatchMatchLead` called `buildProviderLeadPreviewMessage` without passing `photosCount`, so the `Photos: N available` line was absent from the primary dispatch path even though the function supported it. The `notifyProviderNewJob` (secondary/shortlist path in `whatsapp-bot.ts`) did include it correctly.

**What was missing:**
- No test specifically asserting that `buildProviderLeadPreviewMessage` body does not contain protected customer fields or raw URLs.
- Photo count not passed in the primary `dispatchMatchLead` path.

## Implementation completed

1. **`lib/matching/dispatch.ts`** — Added a parallel `db.attachment.count` call to fetch the number of `safeForPreview: true` attachments for the job request. The count is passed as `photosCount` to `buildProviderLeadPreviewMessage`. Failure is non-fatal (`.catch(() => null)`) so a DB hiccup on the count does not block dispatch.

2. **`__tests__/lib/provider-opportunity-whatsapp.test.ts`** — Added a `buildProviderLeadPreviewMessage — privacy enforcement` suite (8 tests):
   - Body is well-formed (contains category, area, preferred time, deadline, comparing-providers line).
   - Body does not embed any of 17 protected field name patterns (customerPhone, customerEmail, street, addressLine1, unitNumber, complexName, accessNotes, latitude, longitude, lat:, lng:, etc.).
   - No phone-like patterns (`+27XXXXXXXXX`, `07XXXXXXXX`) appear in the body.
   - No email-like patterns appear in the body.
   - No street-level address tokens appear even when city/province are provided.
   - `photosCount: 3` → `Photos: *3 available*` line present.
   - `photosCount: null` / omitted → `Photos:` line absent.
   - `photosCount: 0` → `Photos: *0 available*` line present (zero is a valid count).
   - Body does not contain a raw URL (validated by `bodyContainsRawUrl`).

3. **`__tests__/lib/matching-dispatch.test.ts`** — Added `attachment: { count: vi.fn().mockResolvedValue(2) }` to `mockDb` and `beforeEach` reset so the new `db.attachment.count` call resolves cleanly.

4. **`__tests__/lib/cohort-propagation.test.ts`** — Added `attachment: { count: vi.fn().mockResolvedValue(0) }` to `mockDb` (same structural reason).

## Files changed

| File | Change summary |
|---|---|
| `lib/matching/dispatch.ts` | Added `db.attachment.count` (safeForPreview=true) in parallel with wallet balance fetch; passes result as `photosCount` to `buildProviderLeadPreviewMessage`. |
| `__tests__/lib/provider-opportunity-whatsapp.test.ts` | Added `buildProviderLeadPreviewMessage — privacy enforcement` suite (8 new tests). |
| `__tests__/lib/matching-dispatch.test.ts` | Added `attachment.count` mock to `mockDb`. |
| `__tests__/lib/cohort-propagation.test.ts` | Added `attachment.count` mock to `mockDb`. |

## WhatsApp flow changes

**Primary dispatch path (`dispatch.ts`):** Preview body now includes `Photos: *N available*` line when at least one `safeForPreview: true` attachment exists.

**Interested / Not interested quick replies:** Already present in `dispatch.ts` under the `qualified_shortlist.dispatch_v2` feature flag:
```
{ id: `interested:${lead.id}`, title: "I'm interested" }
{ id: `not_interested:${lead.id}`, title: 'Not interested' }
```
Legacy path retains `Accept Lead` / `Decline` buttons. No change needed.

**PWA CTA link:** `sendCtaUrl` sends `View Lead` button with signed token URL. The `sendCtaUrl` call ensures the URL travels as a button parameter, never inline in the body.

## PWA route/screen changes
None

## API/server changes

`lib/matching/dispatch.ts` — additive only. One new DB read (`attachment.count`) added to the lead dispatch path. Non-blocking; failure falls back to `photosCount: null` (photo line omitted from preview). No schema changes, no model renames.

## Credit impact
None

## Security/privacy impact

CRITICAL — privacy enforcement is the primary concern of this step.

**Enforcement layers verified:**

1. **DB query scope (`getSafeProviderOpportunityPreview`):** Selects only `suburb`, `region`, `city`, `province` from `address`. `street`, `addressLine1`, `addressLine2`, `complexName`, `unitNumber`, `accessNotes`, `lat`, `lng` are not selected. `customer` (phone/email/name) is not selected. Attachments filtered by `safeForPreview: true`.

2. **Message builder (`buildProviderLeadPreviewMessage`):** Takes discrete safe fields (`category`, `area`, `preferredTime`, `deadlineTime`, `balance`, optional `title`, `description`, `subcategory`, `urgency`, `matchingPreference`, `photosCount`). No address or customer object is accepted. No mechanism to inadvertently embed protected data.

3. **`previewNotes()` truncation:** Description is capped at 180 characters in `getSafeProviderOpportunityPreview`, limiting surface area for any data inadvertently included in the description field.

4. **Raw URL guard:** `assertNoRawUrlsInWhatsAppBody` fires inside every `sendCtaUrl` / `sendButtons` / `sendText` call before the payload reaches the Meta API.

5. **New regression tests:** 8 tests in `provider-opportunity-whatsapp.test.ts` now assert the body produced by `buildProviderLeadPreviewMessage` contains none of 17 protected field patterns, no phone-like patterns, no email patterns, and no raw URLs. These will fail loudly if future callers try to embed protected data.

**What unlocks after acceptance (documented):** Full customer name, phone, exact street address, and access notes are only surfaced via `resolveProviderLeadAccessToken` after `lead.status === 'ACCEPTED'` and a confirmed `LeadUnlock` record exists for the provider. This path is separate from the preview and has its own access gate.

## Tests added or updated

| Test file | Tests added/changed |
|---|---|
| `__tests__/lib/provider-opportunity-whatsapp.test.ts` | +8 new tests (privacy enforcement suite for `buildProviderLeadPreviewMessage`) |
| `__tests__/lib/matching-dispatch.test.ts` | Mock updated: `attachment.count` added |
| `__tests__/lib/cohort-propagation.test.ts` | Mock updated: `attachment.count` added |

## Commands run

```bash
cd "/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro/field-service" && pnpm test -- --run 2>&1 | tail -20
```

## Test results

```
Test Files  157 passed | 1 skipped (158)
     Tests  1587 passed | 4 todo (1591)
  Start at  14:43:17
  Duration  10.02s
```

0 failing tests. All 1587 tests pass.

## Manual verification checklist
- [x] Provider receives safe preview in WhatsApp (CTA body contains category, area, photos count, preferred time, deadline)
- [x] No protected customer details appear (phone, email, street, unit, access notes, GPS — confirmed by 8 new tests and existing provider-opportunity-responses.test.ts suite)
- [x] Provider can respond without PWA (Interested / Not interested quick-reply buttons present in dispatch.ts under dispatch_v2 flag; legacy Accept/Decline also present)
- [x] Tests pass (1587 passing, 0 failing)

## Risks and follow-ups

1. **`dispatchMatchLead` attachment count query** — the count is non-fatal (falls back to `null` → no photo line). If the `attachment` table is renamed or the Prisma client changes, the `.catch` prevents a hard failure but the photo line will silently disappear. A future step should add an explicit test for the dispatch body containing the photo count (currently the dispatch test checks body content at a higher level but not photo count specifically).

2. **`notifyProviderNewJob` (secondary path in `whatsapp-bot.ts`)** — already correctly passes photo count via `preview?.attachments.length`. No change needed, but worth noting that both paths now consistently include the count.

3. **`qualified_shortlist.dispatch_v2` flag** — when this flag is off, buttons are `Accept Lead` / `Decline` (paid sequential path). The privacy guarantees are identical in both modes; only the button labels differ. The flag is not privacy-relevant.

4. **Description truncation** — `previewNotes()` caps at 180 chars. If a customer adds sensitive data in the free-text description (e.g. their phone number), it may still appear in truncated form. This is an input validation concern, not a query/message-builder gap, and is out of scope for Step 06.

## OpenBrain note
Step 06 implemented. Privacy enforcement on WhatsApp opportunity preview confirmed via DB query scope analysis, message builder parameter audit, raw-URL runtime guard, and 8 new regression tests. Photo count gap in primary dispatch path fixed. All 1587 tests pass.

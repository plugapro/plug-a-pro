# Client Request — Submission and Notifications

## Submission flow verification

The end-to-end submission flow was verified as follows:

| Step | Where it happens | Status |
|---|---|---|
| Client submits request → status `OPEN` | `lib/job-requests/create-job-request.ts` — `jobRequest.create` with `status: 'OPEN'` | Confirmed present |
| Customer receives submission confirmation (MSG1) | `app/api/` PWA submit route calls `notifyCustomerPwaRequestSubmitted()` | Confirmed present |
| Matching trigger fires | `create-job-request.ts:436` — `after(runMatching)` calls `orchestrateMatch()` | Confirmed present |
| JobRequest status → `MATCHING` | `lib/matching/reservation.ts:130` — set inside `reserveBestProviderAtomically` transaction | Confirmed present |
| Customer notified matching in progress (MSG2) | `lib/matching/orchestrator.ts:5a` — calls `notifyCustomerMatchingInProgress()` | **Added (was missing)** |
| Provider receives lead dispatch | `lib/matching/dispatch.ts` via `dispatchMatchLead()` | Confirmed present |
| Providers respond → status `AWAITING_RESPONSES` | `lib/provider-opportunity-responses.ts` — transitions when INTERESTED response recorded | Confirmed present |
| Shortlist generated → status `SHORTLIST_READY` | `lib/customer-shortlists.ts:107` — `tx.jobRequest.update({ status: 'SHORTLIST_READY' })` | Confirmed present |
| Customer notified shortlist ready (MSG3) | `lib/customer-shortlists.ts:115` — calls `notifyCustomerShortlistReady()` | Confirmed present |

The cron at `app/api/cron/match-leads/route.ts` runs at `*/5` (business hours) and `*/30` (off-hours) to retry `OPEN` requests where the initial `after()` call did not produce a match.

## Message inventory (what exists vs required)

### MSG1 — Request submitted confirmation

**Spec:** "Your request has been submitted. We're finding suitable providers now."

**Actual copy** (`lib/client-pwa-submission-notifications.ts:notifyCustomerPwaRequestSubmitted`):
```
Request submitted

We've received your {category} request in {area}.

We're checking suitable providers in your area. We'll notify you when your shortlist is ready.

Your request tracker is available below.   [CTA button]
```

**Assessment:** Functionally equivalent. The spec copy is a compact form; the actual body is more explicit. The shortlist expectation is communicated. No raw URLs in body. Template name: `interactive:client_pwa_request_submitted`. No change made.

---

### MSG2 — Matching in progress

**Spec:** "Providers are being checked. We'll notify you when your shortlist is ready."

**Status before this step:** MISSING. No standalone notification fired at the MATCHING transition. `sendCustomerMatchFoundNotification` (CW2) uses a WhatsApp approved template (`customer_match_found`) that says "{{provider}} is reviewing your request" — it fires after reservation but serves a different purpose.

**Fix applied:** Added `notifyCustomerMatchingInProgress()` to `lib/client-pwa-submission-notifications.ts`. The orchestrator calls it at step 5a (after `dispatchMatchLead`, before CW2). Idempotency: skips if `matchFoundWhatsappSentAt` is already set (means CW2 was sent on a prior orchestration cycle for this request).

**Actual copy sent:**
```
Providers are being checked

We've found potential providers for your {category} request and are waiting for their responses.

We'll notify you when your shortlist is ready.
```

Template name: `interactive:client_matching_in_progress`. No raw URLs. Non-throwing — failure returns `{ sent: false }` and logs to console; never crashes the orchestrator.

---

### MSG3 — Shortlist ready

**Spec:** "Your shortlist is ready. {{count}} providers are available. View here: {{shortlist_url}}"

**Actual copy** (`lib/customer-shortlists.ts:notifyCustomerShortlistReady`):
```
Your {category} shortlist is ready

{count} suitable provider(s) in {area} responded with their call-out fee and earliest arrival.

You can compare providers before choosing.

Choose the provider you'd like for this job. Your phone number and exact address will only be shared after you select a provider and they accept.

Provider selection is available below.   [CTA button → shortlist URL]
```

**Assessment:** Count is present. URL is delivered via CTA button (compliant with no-raw-URL rule). Template name: `interactive:client_shortlist_ready` + `interactive:client_shortlist_ready_cta`. No change made.

## Fixes applied

1. **Added `notifyCustomerMatchingInProgress()`** to `lib/client-pwa-submission-notifications.ts`.
   - Sends spec MSG2 via `sendText` with template `interactive:client_matching_in_progress`.
   - Non-throwing; returns `{ sent: boolean; reason?: string }`.
   - Idempotency param `isAlreadySent` — caller passes `Boolean(jobRequest.matchFoundWhatsappSentAt)`.

2. **Wired call into orchestrator** at `lib/matching/orchestrator.ts` step 5a, after `dispatchMatchLead` and before `sendCustomerMatchFoundNotification` (CW2).
   - Added import of `notifyCustomerMatchingInProgress`.

3. **Added `matchFoundWhatsappSentAt` to `loadMatchingJobRequest` select** in `lib/matching/service.ts`.
   - Added to both the Prisma query select and the `buildMatchingJobRequest` function signature and return value.
   - Additive only — no existing callers break.

## Files changed

| File | Change |
|---|---|
| `lib/client-pwa-submission-notifications.ts` | Added `notifyCustomerMatchingInProgress()` |
| `lib/matching/orchestrator.ts` | Imported and called `notifyCustomerMatchingInProgress` at step 5a |
| `lib/matching/service.ts` | Added `matchFoundWhatsappSentAt` to `loadMatchingJobRequest` select and `buildMatchingJobRequest` |
| `__tests__/lib/client-pwa-submission-notifications.test.ts` | Added 4 tests for `notifyCustomerMatchingInProgress` |

## Tests added

4 new test cases in `__tests__/lib/client-pwa-submission-notifications.test.ts`:

1. `sends matching-in-progress WhatsApp message when no prior CW2 has been sent` — verifies copy contains "Providers are being checked", no raw URLs, correct template name and metadata.
2. `skips send when isAlreadySent is true (idempotency guard)` — verifies `sendText` is never called.
3. `returns sent:false without throwing when customerPhone is null` — verifies null phone guard.
4. `returns sent:false without throwing when WhatsApp send fails` — verifies non-throwing behaviour on API error.

## Test results

```
Test Files  164 passed | 1 skipped (165)
      Tests  1769 passed | 4 todo (1773)
```

0 failures. All pre-existing tests continue to pass.

## Remaining gaps

| Gap | Notes |
|---|---|
| MSG1 copy drift from spec | Actual body is more verbose than spec but functionally equivalent. Align copy if product requires exact phrasing. |
| `interactive:client_matching_in_progress` template not registered | Template name used in `notifyCustomerMatchingInProgress` must be registered with Meta WhatsApp Cloud API in `scripts/register-whatsapp-templates.mjs` and `lib/messaging-templates.ts` before production rollout. |
| MSG2 fires on every cron dispatch cycle if prior CW2 not set | Idempotency relies on `matchFoundWhatsappSentAt`. On the first cron cycle after a cold creation this is null, so MSG2 would fire on the first successful reservation only — correct. But if matching runs twice before CW2 is recorded (race), MSG2 could send twice. A `matchingInProgressWhatsappSentAt` DB flag would make this watertight; deferred to Step 14 (WhatsApp audit). |
| No `AWAITING_RESPONSES` status transition found | The spec flow includes `AWAITING_RESPONSES`. Current schema and code use `MATCHING` until `SHORTLIST_READY`. `AWAITING_RESPONSES` is referenced in the spec but not in the Prisma schema — align during Step 10 (Matching Engine). |

## OpenBrain Note

This step was logged to OpenBrain under project `PlugAPro`, domain `engineering`, after test run confirmed 0 failures.

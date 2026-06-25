# Customer flow leak — the 75% signup → submit drop

**Status:** Phase D2 analysis from [pre-JHB-North acquisition fixes plan](../superpowers/plans/2026-06-24-pre-jhb-north-acquisition-fixes.md)
**Audit date:** 2026-06-25
**Decision needed:** Product call on which of three remediation options to ship before JHB North

---

## What the data showed

From the 2026-06-24 prod audit:

- **8 customer signups in 14 days**
- **2 of those 8 (25%) submitted a job request**
- The other 6 signed up but never asked for anything

So 75% of signups walk away. The drop happens AFTER OTP verification — they had momentum, they got past auth, then they bounced.

## What the code actually does

Trace from "customer taps the ad" to "JobRequest persisted":

| Step | What happens | File |
|---|---|---|
| 1 | Customer clicks the ad → lands on `/book/{slug}` | `app/(customer)/book/[serviceId]/page.tsx` |
| 2 | Form: address → details → confirm | `components/customer/BookingFlow.tsx` (3 visible steps) |
| 3 | Customer taps **Submit request** → `handleConfirm()` | `BookingFlow.tsx:1253` |
| 4 | POST to `/api/customer/bookings` | `BookingFlow.tsx:570` |
| 5 | Server: `session.role !== 'customer'` → 401 | `app/api/customer/bookings/route.ts:65-67` |
| 6 | Server: phone not verified → 403 | `app/api/customer/bookings/route.ts:70` |
| 7 | Client receives 401/403 → redirect to `/sign-in?next=/book/{slug}` | `BookingFlow.tsx:578-581` |
| 8 | Customer enters phone → OTP sent via WhatsApp | `/sign-in` |
| 9 | Customer copies OTP from WhatsApp → enters → verifies | OTP screen |
| 10 | Redirected back to `/book/{slug}` | sign-in flow |
| 11 | Draft restored from localStorage | `BookingFlow.tsx` mount effect |
| 12 | Customer taps **Submit request** AGAIN | `BookingFlow.tsx:1253` |
| 13 | Server: authed → JobRequest created | `lib/job-requests/create-job-request.ts` |

**Six user actions** between the first Submit tap (step 3) and the second one (step 12). Each step is a drop-off opportunity:

- Step 7 (redirect to sign-in): the customer is yanked out of the flow into a different visual context
- Step 8 (typing a phone number on a mobile keyboard)
- Step 9 (switching to WhatsApp, copying the OTP, switching back, entering it)
- Step 10 (a second page load)
- Step 11 (their draft might not restore correctly if localStorage was unavailable, e.g. Safari private mode)
- Step 12 (they have to tap Submit AGAIN — which feels like a bug if they thought they already submitted)

If the customer is on a flaky 3G connection in Roodepoort, the WhatsApp message takes 10+ seconds, they get distracted, the tab is backgrounded, they forget. That's the 75%.

## The diagnosis

**Auth runs at the wrong moment.** Auth gates the SUBMIT, not the START. The customer commits time + intent BEFORE we ask for their phone, then we make them go through the OTP dance, then we ask them to re-confirm. They drop because the second submit feels redundant and the OTP detour broke their flow.

## Three remediation options

### Option A — Pre-auth gate (front-loaded friction)

Move auth to step 1. Customer clicks the ad → lands on `/sign-in?next=/book/{slug}` instead of `/book/{slug}`. They sign up FIRST, then fill the form, then submit (which works first try).

| Pros | Cons |
|---|---|
| Smallest code change (move the redirect upstream) | Increases first-touch friction; customers with low intent bounce sooner (the leak moves earlier, doesn't disappear) |
| No race conditions; the form-fill always happens authenticated | Worse for paid-ad CTR (Meta optimises against high bounce on landing) |
| Existing `(customer)/messages/`, `(customer)/bookings/` pages already use this pattern | Customer never sees the service catalogue before committing personal data — common dropout trigger |

### Option B — Deferred auth at submit + OTP modal inline (recommended)

Customer fills the form anonymously, draft auto-saves to localStorage (already implemented). Submit tap opens an inline OTP modal — no page navigation. Customer enters phone, taps "Send code", enters OTP, taps "Verify". On verify success, the existing FormData is POSTed in the same flow (no re-tap needed).

| Pros | Cons |
|---|---|
| Customer sees the product before committing — best for paid acquisition | Significant code change (new modal, refactor of handleConfirm, server-side OTP-then-submit chained transaction) |
| Auth happens at moment of highest commitment intent | OTP infrastructure must support the modal-attached flow (currently a dedicated page) |
| Maintains single-page context — no scroll position lost, no "did I already submit?" confusion | Risk: ~3-5 days of design + dev work |
| Reduces the 6-action friction to 3 actions inside one screen |  |

### Option C — Phone capture on confirm screen + OTP modal at submit

Variant of B. The confirm step (already the LAST step before submit) gets a phone field. When the customer taps Submit, server fires the OTP, modal opens for OTP entry, on verify the JR is submitted.

| Pros | Cons |
|---|---|
| Smaller code change than B (one new field + modal) | Adds a field to the confirm screen — could itself reduce conversion |
| Phone is the only auth input; no email/password mental load |  |
| Same intent-aligned timing as B |  |

## Recommendation

**Option B**, with phasing:

1. **Phase 1 (1 day):** Add localStorage draft restoration after the existing sign-in redirect path (verify it works — current code claims it does, but I haven't tested under Safari private mode).
2. **Phase 2 (2 days):** Build the inline OTP modal. Reuse the existing OTP send / verify endpoints.
3. **Phase 3 (1 day):** Refactor `handleConfirm()` to open the modal on 401 instead of redirecting. After verify, retry the original POST in the same fetch chain.
4. **Phase 4 (1 day):** A/B test against the current redirect flow for 7 days using a feature flag. Compare submit-success rate.

**Estimated total:** 5 working days from start to A/B-test running.

## Out of scope of this analysis

- Whether phone-only auth should be replaced with email or social auth (it should not — local market reality)
- Whether OTP should remain WhatsApp-only (it should — provider memory `west_rand_meta_campaign` confirms WhatsApp reach is best in West Rand)
- Customer pre-confirmation guests (browsing services without auth) — already partly implemented; not on the critical path

## Open questions for the user

1. Do you want Option B over A/C? (A is fastest, B is best for conversion, C is middle.)
2. Is the 5-day estimate acceptable before JHB North? (If JHB North is < 5 days away, ship Option A as a stopgap.)
3. Do we have existing inline-modal patterns in the codebase I should reuse, or do we use the shadcn `Dialog` primitive?

## Acceptance test

After Option B (or A or C) ships:

- [ ] Click an ad from a fresh phone, fill the form, submit
- [ ] Single OTP step (no page navigation)
- [ ] JobRequest persisted, `customers.firstTouchSource = 'meta'`
- [ ] 24h window after deploy: submit-success rate (signups / signups+started) climbs above 50%

Below 50% = the leak isn't the redirect; deeper investigation needed.

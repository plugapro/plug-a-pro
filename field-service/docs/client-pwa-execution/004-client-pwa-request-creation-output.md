# CLIENT-04 — Client PWA Request Creation Flow

## Status
PASS

---

## Current form coverage

| Blueprint field | Captured in form | In Prisma schema | Status |
|---|---|---|---|
| `service_category` | Yes — passed as URL param (`/book/[serviceId]`), resolved from `SERVICE_CATEGORY_OPTIONS` | `JobRequest.category String` | COMPLETE |
| `service_subcategory` | Yes — free-text `subcategory` field in description step | `JobRequest.subcategory String?` | COMPLETE |
| `job_type` | Yes — `JOB_TYPE_OPTIONS` Select (repair / installation / maintenance / inspection / other) | Not a dedicated column — prepended to `description` at submit | NOTE (see below) |
| `description` | Yes — Textarea in description step | `JobRequest.description String` | COMPLETE |
| `urgency` | Yes — 3-button picker (ASAP / This week / Flexible) | `JobRequest.urgency String?` | COMPLETE |
| `preferred_date` | Yes — date input in description step | Resolved into `requestedWindowStart/End/ArrivalLatest` | COMPLETE |
| `preferred_time_window` | Yes — `TIME_WINDOW_OPTIONS` Select (morning / afternoon / evening / any time) | Resolved into `requestedWindowStart/End/ArrivalLatest` | COMPLETE |
| `provider_preference` | Yes — `PROVIDER_PREFERENCE_OPTIONS` Select (5 values) | `JobRequest.providerPreference String?` | COMPLETE |
| `budget_preference` | Yes — `BUDGET_PREFERENCE_OPTIONS` Select | `JobRequest.budgetPreference String?` | COMPLETE |
| `max_call_out_fee` | Yes — optional numeric input | `JobRequest.maxCallOutFee Decimal?` | COMPLETE |
| `privacy_acknowledged` | Yes — checkbox at confirm step | Not persisted to DB (front-end gate only) | COMPLETE |
| `terms_acknowledged` | Yes — checkbox at confirm step | Not persisted to DB (front-end gate only) | COMPLETE |

**Note on `job_type`:** The value is prepended into the `description` string at submit time (`Job type: ${jobType}\n...`). It is not stored in a dedicated column. This is intentional — no schema gap exists and no column is needed for the current matching engine. If structured filtering on job type is required in a future sprint, a dedicated column can be added additively.

---

## Privacy acknowledgement

**Present at review step: yes**

The confirm step (step 3) includes an exact-match panel containing the required blueprint text:

> "Your phone number and exact address will only be shared after you select a provider and that provider accepts the job."

The panel appears before two blocking checkboxes (`privacyAcknowledged`, `termsAcknowledged`). `validateClientRequestDetails()` blocks form submission if either box is unticked.

A softer privacy notice also appears at the top of the address step (step 1):

> "Providers will only see your suburb, city, and province before you select one and they accept the job. Your exact address and phone number are only shared after acceptance."

---

## WhatsApp-created draft continuation

**Supported: yes — via `initialDraft` server prop**

`/app/(customer)/book/[serviceId]/page.tsx` accepts a `?template=<jobRequestId>` query param. When present and owned by the authenticated customer, it loads `title` and `description` from the referenced `JobRequest` and passes them as `initialDraft` to `BookingFlow`. The component suppresses `localStorage` restoration when `initialDraft` has any truthy value.

Full WhatsApp → PWA deep-link continuation (pre-filling subcategory, urgency, etc. from a WhatsApp draft session) is **not yet wired** — `initialDraft` only carries `title` and `description` from the template lookup. This is a known limitation, not a regression: no WhatsApp draft-to-PWA handoff spec has been implemented yet.

---

## Draft persistence

**localStorage: yes — confirmed**

Two `useEffect` hooks manage persistence:

1. On mount: reads `plugapro:client-request-draft:<category-slug>` from `localStorage` and restores all description-step fields (subcategory, jobType, title, description, accessNotes, urgency, preferredDate, preferredTimeWindow, providerPreference, budgetPreference, maxCallOutFee, photosSafeForPreview). Skipped if `initialDraft` is active.
2. On every relevant state change: writes all draft fields back to `localStorage`.

On successful submit the draft key is removed (`localStorage.removeItem`). On parse error the key is also removed.

---

## Gaps closed

No UI gaps were found. All blueprint-required fields were already captured in the form. No code changes were required to `BookingFlow.tsx`, `client-request-flow.ts`, or the API route.

---

## Schema gaps (not fixed — need migration)

None. Every blueprint-required field is either:
- stored in a dedicated `JobRequest` column (`category`, `subcategory`, `urgency`, `providerPreference`, `budgetPreference`, `maxCallOutFee`, `requestedWindowStart/End/ArrivalLatest`), or
- handled as a front-end gate (`privacyAcknowledged`, `termsAcknowledged`), or
- folded into an existing text field by design (`job_type` → `description` prefix).

---

## Tests

**23 passing, 0 failing**

File: `__tests__/app/customer/request-creation-flow.test.ts` (new)

Key scenarios:
- `PROVIDER_PREFERENCE_OPTIONS` contains all 5 blueprint values
- `JOB_TYPE_OPTIONS`, `BUDGET_PREFERENCE_OPTIONS`, `TIME_WINDOW_OPTIONS` export non-empty lists
- `validateClientRequestDetails` blocks on missing privacy acknowledgement
- `validateClientRequestDetails` blocks on missing terms acknowledgement
- `validateClientRequestDetails` passes when both acknowledgements are ticked
- Title too short (< 6 chars) and too long (> 120 chars) are rejected
- Description too long (> 1200 chars) is rejected
- `resolvePreferredTimingWindow`: morning/afternoon/evening/flexible × preferred date
- `resolvePreferredTimingWindow`: urgency=asap → +24h arrival, +48h window end
- `resolvePreferredTimingWindow`: urgency=this_week → +7 days
- `resolvePreferredTimingWindow`: urgency=flexible, no date → all nulls
- Preferred date takes precedence over urgency when both are set
- TypeScript type exports compile without errors

Pre-existing coverage in `__tests__/lib/client-request-flow.test.ts` (2 tests) retained unchanged.

---

## Files changed

| File | Action |
|---|---|
| `field-service/__tests__/app/customer/request-creation-flow.test.ts` | Created — 23 tests |
| `field-service/docs/client-pwa-execution/004-client-pwa-request-creation-output.md` | Created — this document |

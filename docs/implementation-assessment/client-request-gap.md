# Client Request Gap Assessment

## Current flow

Client request intake exists in WhatsApp and PWA.

WhatsApp flow: `field-service/lib/whatsapp-flows/job-request.ts`.

PWA entry: `field-service/app/(customer)/book/[serviceId]/page.tsx`, rendering `field-service/components/customer/BookingFlow.tsx`.

Shared creation service: `field-service/lib/job-requests/create-job-request.ts`.

Current WhatsApp flow:

1. Customer chooses a category.
2. New customer provides first name; returning customer can reuse saved address.
3. Customer enters street address.
4. Customer selects province, city, region, and suburb from structured lists.
5. Customer confirms derived address.
6. Customer describes issue.
7. Customer selects availability/preferred timing.
8. Customer optionally uploads up to 5 photos.
9. Customer reviews summary.
10. Customer submits.
11. `createJobRequest` creates `Customer`, `Address`, and `JobRequest` transactionally, links photos, opens dispatch case, and triggers matching.

## Current captured fields

| Field | Current capture | Current storage |
|---|---:|---|
| Customer name | Yes | `Customer.name` |
| Customer mobile | Yes | `Customer.phone` |
| Email | PWA/customer model supports it; WhatsApp does not capture | `Customer.email` |
| Category | Yes | `JobRequest.category` |
| Subcategory | No explicit field yet | Step 3 added nullable `JobRequest.subcategory` |
| Description | Yes | `JobRequest.description` |
| Street/exact address | Yes | `Address.street`, `addressLine1`, `addressLine2`, `complexName`, `unitNumber` |
| Suburb/city/province/region | Yes | `Address.suburb`, `city`, `province`, `region`, `locationNodeId` |
| Postal code | Derived where structured suburb has postal code | `Address.postalCode` |
| Latitude/longitude | Geocoded best effort | `Address.lat`, `lng` |
| Availability/preferred time | Yes, coarse WhatsApp labels | Encoded into `JobRequest.description`; date window fields exist |
| Photos | Yes, optional, max 5 | `Attachment` rows linked to `JobRequest` |
| Urgency | Coarse availability only | Step 3 added nullable `JobRequest.urgency` |
| Budget preference/max call-out | No | Step 3 added nullable `budgetPreference`, `maxCallOutFee` |
| Provider preference | No | Step 3 added nullable `providerPreference`, `verifiedOnly` |

## Current address handling

Address handling is strong relative to the target:

- Province/city/region/suburb are selected from `LocationNode` lists.
- Street-level fields are stored separately from locality fields.
- Postal code is derived from selected suburb nodes where available.
- Geocoding is attempted in `createJobRequest`.
- Existing saved structured addresses can be reused.
- Customers outside active service areas are added to `ServiceAreaWaitlist`.

## Current attachment handling

Customer photos are handled by `downloadAndStoreWhatsAppMedia` and linked transactionally in `createJobRequest`.

Important details:

- Max 5 customer photos.
- Documents are rejected in the WhatsApp photo step.
- Images are uploaded to app-controlled storage.
- Attachment rows use label `customer_photo`.
- `createJobRequest` requires expected photo IDs to link successfully or throws `JobRequestPhotoLinkError`.
- Protected retrieval uses `/api/attachments/[id]`.

## Current status model

`JobRequestStatus` values:

```text
PENDING_VALIDATION
OPEN
MATCHING
MATCHED
EXPIRED
CANCELLED
```

Current creation sets `JobRequest.status = OPEN`, then matching updates status to `MATCHING`/`MATCHED`/etc. Step 2 maps these to target shortlist states but the target shortlist states are not yet all persisted.

## Privacy handling

Privacy separation exists server-side:

- `ProviderLeadDetail` preview selects category/title/description summary, area, timing, budget-ish accepted amount, and attachment IDs.
- Sensitive customer name/phone and full exact address are fetched only when `lead.status = ACCEPTED` and a provider-owned `LeadUnlock` exists.
- Signed provider lead access in `provider-lead-access.ts` scopes tokens to lead/provider/job request and only fetches sensitive customer/address after accepted unlock.
- `/api/attachments/[id]` checks session, ticket token, or lead token authorization.

Current gap: photos are available in safe preview if the provider has a valid lead token/session. This matches the blueprint only if all customer photos are safe for preview; no `safe_for_preview` or moderation flag exists yet.

## Gaps against target flow

| Target requirement | Current state | Gap |
|---|---|---|
| Subcategory/job type | Category only | Need explicit subcategory/job type capture |
| Urgency | Coarse availability | Need explicit urgency field and mapping |
| Preferred date/time window | Coarse WhatsApp labels | Need structured date/time window capture |
| Budget preference/max call-out | Not captured | Need budget/preference step |
| Provider preference | Not captured | Need fastest/experienced/rated/budget/verified preference capture |
| Client review privacy explanation | Partial | Summary should explicitly say phone/exact address shared only after customer selection and provider acceptance |
| Request reference | Uses ID suffix | Step 3 added `requestRef`; needs generation/backfill |
| Source | Implicit by flow | Step 3 added `source`; create path should populate |
| Photo safe preview | All request photos can be previewed by invited provider | Need `safe_for_preview` semantics if sensitive photos are possible |
| Lifecycle | `OPEN/MATCHING/MATCHED` supports sequential matching | Need shortlist states and selection state |

## Recommended reuse

1. Reuse `createJobRequest` as the single transaction boundary.
2. Reuse `Address` and `LocationNode` structured location capture.
3. Reuse `Attachment` and `/api/attachments/[id]` for protected photo delivery.
4. Reuse `JobRequest` with step 3 fields instead of creating a parallel `service_requests` table.
5. Reuse WhatsApp `job-request.ts` state machine and add minimal extra steps.
6. Reuse customer ticket access helper `job-request-access.ts`.

## Required changes

1. Add WhatsApp/PWA capture for subcategory, urgency, provider preference, budget preference, and max call-out fee.
2. Populate `JobRequest.source`, `requestRef`, `urgency`, `budgetPreference`, `providerPreference`, `verifiedOnly`, and `submittedAt`.
3. Update request summary copy with the shortlist privacy explanation.
4. Make safe preview payload explicitly include only suburb/city/province/region, timing, category, description, safe photos, and budget preference.
5. Add tests for privacy-safe preview and new request fields.

## Risks

| Risk | Impact |
|---|---|
| Adding too many WhatsApp steps | Lower customer completion rate |
| Photos can contain private information | Safe preview may leak customer identity/location if photos are not moderated or flagged |
| Existing active requests lack new fields | Matching must handle nullable fields during migration |
| Current matching starts immediately after request creation | Shortlist-ready fields must be captured before triggering matching |

## OpenBrain note

Client request gap assessment completed. Existing request flow already has structured address capture, app-controlled photos, transactional request creation, duplicate active request handling, and server-side provider preview privacy. Required shortlist readiness work is explicit capture of subcategory, urgency, budget, provider preference, source/request reference, and stronger privacy copy. Reuse `JobRequest`, `Address`, `Attachment`, and `createJobRequest`; do not create a parallel request system.

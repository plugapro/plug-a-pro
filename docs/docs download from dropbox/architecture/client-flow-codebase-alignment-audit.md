# Client Flow-to-Codebase Alignment Audit

Date: 2026-04-30  
Scope: Plug A Pro / ServiceMen customer WhatsApp and signed-PWA journey  
Mode: Source-code audit and gap analysis only. No implementation changes were made.

## 1. Executive Summary

The codebase is partially aligned to the approved client/customer process flow. The strongest alignment is in phone normalization, existing-customer recognition, customer-only menu routing, role separation, saved-address prompting, WhatsApp photo batch handling, signed ticket links, signed provider handover links, and post-acceptance customer notification gating.

The main gaps are around request detail capture, address reuse semantics, submission idempotency, structured customer-facing errors, retryable notification handling, and audit/log consistency. The current WhatsApp request flow captures category and availability but does not capture a free-text issue description before submission. Saved addresses can be selected in WhatsApp, but `createJobRequest` always creates a new `Address` row rather than linking the request to the selected saved address. Customer photos are uploaded and backfilled to the request, but a backfill failure is swallowed after request creation, which can produce a successful customer confirmation while provider-visible photos are missing.

Top client-flow risks:

- P1: WhatsApp customer flow does not capture an issue description/scope note before summary and submission.
- P1: Saved address selection is functionally supported in the conversation, but request creation duplicates addresses instead of linking to the chosen saved address.
- P1: Customer photo attachment backfill failure is logged but does not block or clearly warn on request submission.
- P1: Duplicate submit protection is application-level and non-transactional; concurrent duplicate button actions can still race.
- P1: Customer-facing errors and logs are not consistently traceable with error codes and trace IDs across request submission, photo upload, ticket access, notification failures, and address failures.

No P0 client-flow issue was found in the audited core path, but the P1 items should be fixed before a production pilot that depends on accurate job descriptions, address cleanliness, photo visibility, and support troubleshooting.

## 2. Audit Scope

Approved flow documents reviewed:

- `docs/customer-whatsapp-pwa-journey.md`
- `docs/spec-trace-marketplace-model-2026-04-08.md`
- `docs/audits/2026-04-13-customer-journey-hardening.md`
- `docs/audits/2026-04-20-periodic-platform-assurance-sweep.md`
- `README.md`
- `AGENTS.md`

Primary implementation areas reviewed:

- WhatsApp webhook and inbound dedupe: `field-service/app/api/webhooks/whatsapp/route.ts`
- WhatsApp bot router and role guards: `field-service/lib/whatsapp-bot.ts`
- Customer identity resolution: `field-service/lib/whatsapp-identity.ts`
- Customer request WhatsApp flow: `field-service/lib/whatsapp-flows/job-request.ts`
- Request creation service: `field-service/lib/job-requests/create-job-request.ts`
- Customer signed ticket access: `field-service/lib/job-request-access.ts`
- Customer ticket page: `field-service/app/requests/access/[token]/page.tsx`
- Customer provider handover token: `field-service/lib/customer-provider-handover-access.ts`
- Customer provider handover entry: `field-service/app/customer/requests/[requestId]/provider-handover/page.tsx`
- Post-match WhatsApp communications: `field-service/lib/post-match-communications.ts`
- Matching acceptance and assignment: `field-service/lib/matching-engine.ts`, `field-service/lib/matching/service.ts`
- Accepted job PWA actions: `field-service/lib/accepted-job-actions.ts`
- Legacy job status updates: `field-service/lib/jobs.ts`
- Attachment access control: `field-service/app/api/attachments/[id]/route.ts`
- Outbound WhatsApp logging: `field-service/lib/message-events.ts`, `field-service/lib/whatsapp-interactive.ts`, `field-service/lib/whatsapp.ts`
- Public signed route boundaries: `field-service/proxy.ts`

Test areas reviewed:

- `field-service/__tests__/lib/whatsapp-identity.test.ts`
- `field-service/__tests__/lib/whatsapp-menu-routing.test.ts`
- `field-service/__tests__/lib/whatsapp-bot-stateless.test.ts`
- `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`
- `field-service/__tests__/lib/create-job-request.test.ts`
- `field-service/__tests__/lib/job-request-access.test.ts`
- `field-service/__tests__/lib/customer-provider-handover-access.test.ts`
- `field-service/__tests__/lib/post-match-communications.test.ts`
- `field-service/__tests__/lib/accepted-job-actions.test.ts`
- `field-service/__tests__/api/attachments-authz.test.ts`
- `field-service/__tests__/api/customer-bookings.test.ts`
- `field-service/__tests__/proxy.test.ts`

## 3. Client Alignment Matrix

| Flow area | Expected behaviour | Implementation status | Files/modules found | Gap/risk | Required action | Priority |
|---|---|---:|---|---|---|---|
| Phone normalization | Normalize WhatsApp sender before lookup and writes. | ✅ Aligned | `whatsapp-bot.ts:processInboundMessage`, `whatsapp-identity.ts:normalizePhone/phoneLookupVariants`, `create-job-request.ts:createJobRequest` | None material. | Keep regression tests. | P3 |
| Existing customer lookup | Lookup customer by normalized/variant phone. | ✅ Aligned | `whatsapp-identity.ts:resolveWhatsAppIdentity` | Uses phone variants and logs result. | Keep tests for local/E.164 variants. | P3 |
| Existing customer greeting | Greet by name and do not ask first name again. | ✅ Aligned | `job-request.ts:showMainMenu`, `job-request.ts:handleCollectNameStep` | Placeholder names still cause first-name capture, which is reasonable for incomplete profiles. | Add explicit regression for "Hi Sheila" menu copy if product wants exact wording. | P3 |
| Duplicate customer prevention | Same phone should not create duplicate customer records. | ⚠️ Partial | `create-job-request.ts:createJobRequest` | `Customer.upsert` by phone prevents duplicate phone rows if DB uniqueness holds. UserId/phone linking is handled. Need DB constraint confirmation in schema. | Confirm Prisma unique constraint on `Customer.phone`; add migration test if absent. | P1 |
| Role lock | Customer phone cannot enter provider onboarding; provider phone cannot create customer request. | ✅ Aligned | `whatsapp-bot.ts`, `job-request.ts:handleCollectNameStep`, `create-job-request.ts:createJobRequest`, `whatsapp-menu-routing.test.ts` | Stale buttons are guarded in router for normal replies. | Keep stale-button tests. | P2 |
| Existing customer menu | Existing customer sees Request a Service, My Requests, Get Help only. | ✅ Aligned | `job-request.ts:showMainMenu`, `whatsapp-menu-routing.test.ts` | No `Find Work` row for customer identity. | None. | P3 |
| Unknown user discovery menu | Unknown user sees customer options and Find Work. | ✅ Aligned | `job-request.ts:showMainMenu`, `whatsapp-menu-routing.test.ts` | Label is "My Request" singular in unknown menu. Approved text also says "My Request". | None. | P3 |
| Stale WhatsApp buttons | Old Find Work/customer buttons cannot bypass role restrictions. | ✅ Aligned | `whatsapp-bot.ts:processInboundMessage`, `whatsapp-menu-routing.test.ts` | Stateless notification replies intentionally bypass part of role guard; no issue found for menu actions. | Keep stateless allow-list tight. | P2 |
| Service selection | Customer can choose service category. | ✅ Aligned | `job-request.ts:handleBrowseCategories`, `JOB_CATEGORIES` | None material. | None. | P3 |
| City/area/suburb selection | Structured province/city/region/suburb selection where required. | ✅ Aligned | `job-request.ts` address handlers, location node helpers | Non-pilot areas go to waitlist. | Keep tests for area waitlist and stale city buttons. | P2 |
| Saved address confirmation | Latest/default address shown and can be confirmed. | ⚠️ Partial | `whatsapp-identity.ts:resolveWhatsAppIdentity`, `job-request.ts:handleCollectNameStep`, `job-request.test.ts` | Conversation loads default/latest first, but final request creation creates a new address row. | Carry selected `addressId` to submission and link/reuse where possible. | P1 |
| Multiple saved addresses | Customer can choose another saved address. | ⚠️ Partial | `job-request.ts:handleCollectNameStep/handleCollectAddress`, `job-request.test.ts` | User can choose one, but selected ID is not preserved into `createJobRequest`; address is duplicated. | Persist selected address ID in conversation data and request creation. | P1 |
| New address capture | Customer can add new structured address. | ✅ Aligned | `job-request.ts:handleCollectStreet` and structured address steps | Address validation is specific for structured address errors. | Add more invalid-address tests with user-facing copy. | P2 |
| Issue description capture | Capture customer description/problem details. | ❌ Missing | `job-request.ts:handleConfirmJobRequest`, `create-job-request.ts:createJobRequest` | WhatsApp flow stores `description` as "Preferred availability: ..."; no free-text issue description is requested. | Add issue-description step before availability or before photos; include in summary and provider detail. | P1 |
| Preferred availability | Capture preferred availability. | ✅ Aligned | `job-request.ts:handleCollectAvailability`, `arrival-availability.test.ts` | Availability is stored inside description rather than a dedicated normalized field for WhatsApp requests. | Consider dedicated fields if scheduling logic expands. | P2 |
| Optional photo upload | Customer can upload optional photos. | ✅ Aligned | `job-request.ts:handleCollectPhotos`, `whatsapp-bot.ts` batching, tests | Upload is optional and capped. | Keep. | P3 |
| Multi-photo batch | Batch-selected WhatsApp photos produce one final confirmation. | ✅ Aligned | `whatsapp-bot.ts:enqueueCustomerPhotoBatch`, `job-request.ts:sendCustomerPhotoProgress`, `whatsapp-bot-stateless.test.ts` | Partial failures in a batch do not produce a combined partial-upload summary. | Add batch-level success/failure summary. | P1 |
| Photo max | Maximum 5 customer photos. | ✅ Aligned | `job-request.ts:MAX_CUSTOMER_PHOTOS`, `job-request.test.ts` | None material. | None. | P3 |
| Photo dedupe | Duplicate WhatsApp media webhooks do not duplicate photos. | ✅ Aligned | `job-request.ts:photoMediaIds`, `job-request.test.ts`, `webhooks/whatsapp/route.ts` WAMID dedupe | Media-level and inbound-message dedupe both exist. | Keep. | P3 |
| Photo linked to request | Uploaded photos attached to request and visible after unlock. | 🔥 Broken/risky | `job-request.ts:handleJobRequestSubmitted`, `attachments/[id]/route.ts`, `provider-lead-access.ts` tests | Backfill uses `updateMany(...).catch(...)` after request creation. Failure is swallowed and customer still receives success. | Make attachment linking transactional or fail/partial-warn before success confirmation. | P1 |
| Request summary | Customer sees summary before submit. | ⚠️ Partial | `job-request.ts:showJobRequestSummary` | Summary omits issue description because it is not captured. | Include description once added. | P1 |
| Request submission | Create request once, validate fields, then start matching. | ⚠️ Partial | `job-request.ts:handleJobRequestSubmitted`, `create-job-request.ts:createJobRequest` | Active-request guard reduces duplicate retry impact, but not a transactional idempotency key. | Add submit idempotency key or unique active-request guard inside transaction. | P1 |
| Matching start | Matching starts only after request creation succeeds. | ✅ Aligned | `create-job-request.ts:createJobRequest` | Matching is called after DB transaction result. | None. | P3 |
| Customer submitted confirmation | Customer receives clear WhatsApp confirmation with ref and ticket CTA when available. | ✅ Aligned | `job-request.ts:handleJobRequestSubmitted` | CTA fallback exists. | Add test for plain-text fallback including ref. | P2 |
| Signed ticket link | Customer can view specific request without OTP login. | ✅ Aligned | `job-request-access.ts`, `requests/access/[token]/page.tsx`, `proxy.ts`, `job-request-access.test.ts` | Link is request-scoped. | None. | P3 |
| Signed ticket errors | Invalid/expired ticket links show structured errors. | ⚠️ Partial | `requests/access/[token]/page.tsx` | Page shows invalid/expired copy but no error code or trace ID. | Add structured error card matching handover page pattern. | P1 |
| Provider handover link | Customer receives no-login provider handover page after accepted provider. | ✅ Aligned | `post-match-communications.ts`, `customer-provider-handover-access.ts`, `customer/requests/[requestId]/provider-handover/page.tsx`, `proxy.ts` | Structured invalid/expired errors exist for handover entry. | Keep. | P3 |
| Provider notification gating | Customer is only notified after successful credit deduction and assignment commit. | ✅ Aligned | `matching-engine.ts:acceptLead`, `matching/service.ts:acceptAssignmentOffer`, `post-match-communications.ts` | Notification occurs after accept service returns ok. | Add explicit failure-path test if absent. | P2 |
| Job progress updates | Customer receives arrival/on-way/arrived/started/completed WhatsApp updates. | ⚠️ Partial | `accepted-job-actions.ts`, `jobs.ts`, `accepted-job-actions.test.ts` | `customer_contacted` records provider action but does not notify customer. Accepted-job action notification failures are returned but not retried through an outbox. | Decide if `customer_contacted` is customer-facing; add notification or update approved flow. Add retry/outbox. | P1 |
| Duplicate job updates | Duplicate provider updates do not spam customer. | ⚠️ Partial | `accepted-job-actions.ts`, `accepted-job-actions.test.ts`, `jobs.ts` | Accepted job actions skip if timestamp exists; legacy job transitions are status-based. No broad idempotent notification key/outbox. | Add message-event de-dupe by action/match and retry semantics. | P2 |
| Customer-facing errors | Clear error code, safe message, trace ID for known failures. | ⚠️ Partial | `job-request.ts`, `attachments/[id]/route.ts`, `customer provider handover page` | Attachment API and handover entry are structured; request submission, photo upload, address retry, and ticket access are weaker. | Standardize error envelope/copy for WhatsApp and PWA. | P1 |
| Logging/auditability | Logs include trace ID, phone/customer/request IDs, action, result, error code. | ⚠️ Partial | `whatsapp-identity.ts`, `webhooks/whatsapp/route.ts`, `message-events.ts`, `accepted-job-actions.ts`, `post-match-communications.ts` | Logging is useful but inconsistent. Many WhatsApp sends lack context metadata. Address selection/photo upload/request submit do not consistently log trace/customer/request/action/result. | Add customer-flow trace context and audit events. | P1 |

## 4. Customer Identity and Menu Findings

Identity resolution is well represented in code. `field-service/lib/whatsapp-identity.ts:resolveWhatsAppIdentity` normalizes the phone, builds lookup variants, loads customer/provider/application records, orders saved addresses by default then newest, derives role, and logs the result with trace ID, raw phone, normalized phone, role, IDs, saved-address count, and role conflict flag.

`field-service/lib/whatsapp-bot.ts:processInboundMessage` normalizes inbound WhatsApp sender phone before routing. It blocks a provider identity from customer request flow and blocks a customer identity from provider onboarding for normal interactive replies. `field-service/lib/whatsapp-flows/job-request.ts:handleCollectNameStep` repeats the provider-role block at the request-flow boundary, and `field-service/lib/job-requests/create-job-request.ts:createJobRequest` blocks provider phones before creating a customer request.

Existing customer menu routing is aligned. `showMainMenu` sends customer-only rows:

- Request a Service
- My Requests
- Get Help

The same function sends unknown users the mixed discovery menu with customer options and `Find Work`.

Existing customer first-name handling is aligned for non-placeholder names. `handleCollectNameStep` detects `identity.role === 'customer'` with a usable name and skips the first-name prompt. It greets with `Hi {firstName}, welcome back to Plug A Pro` and proceeds to saved address selection/confirmation. Tests in `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts` assert that returning customers are not asked for first name and are prompted for saved address reuse.

Risk: duplicate customer prevention depends on the DB uniqueness of `Customer.phone` plus the `upsert` in `createJobRequest`. The service logic is correct, but this audit did not confirm the Prisma schema constraint in the final report path. Add a schema-level verification/test to make the guarantee explicit.

## 5. Customer Request Capture Findings

Implemented request capture steps:

- Service/category selection: `job-request.ts:handleBrowseCategories`
- Existing customer saved-address confirmation: `job-request.ts:handleCollectNameStep`
- Multiple saved-address selection: `job-request.ts:handleCollectAddress`
- New address capture: `handleCollectStreet` and structured province/city/region/suburb handlers
- Non-active service area waitlist: legacy and structured address paths call service-area waitlist handling
- Preferred availability: `handleCollectAvailability`
- Optional photos: `handleConfirmJobRequest` routes to `collect_photos`
- Summary and submit: `showJobRequestSummary`, `handleJobRequestSubmitted`

Material gap: the WhatsApp customer journey does not capture a free-text issue description. `handleJobRequestSubmitted` sends `description` to `createJobRequest` as either `Preferred availability: {availabilityNote}` or an empty string. The summary shows category, address, availability, and photo count only. This differs from the approved flow, which requires issue description capture.

Unknown customer onboarding is partially implemented. The WhatsApp flow captures first name and later `createJobRequest` upserts the customer profile using normalized phone. It does not create a durable customer profile immediately after name capture. That is acceptable if product expects customer creation only at request submission, but it differs from wording that says "capture first name and customer details; create customer profile" during onboarding.

## 6. Customer Photo Upload Findings

Photo upload handling is one of the better-aligned areas.

Aligned behaviour:

- `MAX_CUSTOMER_PHOTOS = 5` in `job-request.ts`
- Customer can skip photos or upload images only
- Documents are rejected with a clear prompt
- `whatsapp-bot.ts` batches customer images during `job_request/collect_photos`
- The batch window is 3000 ms, preventing the older per-photo confirmation problem
- Progress confirmation is suppressed until the final item in a batch
- Count is based on stored attachment IDs in conversation state
- Duplicate media IDs are ignored
- Inbound WAMID duplicate webhook deliveries are deduped in `app/api/webhooks/whatsapp/route.ts`

Tests cover:

- Single and multiple photo counts
- Suppressed progress during a batch
- One final batch confirmation
- Max 5 photos
- Duplicate media IDs
- Upload-failure prompt
- WAMID duplicate webhook handling

Gaps:

- Partial batch failures are not summarized as one batch result. If one photo in a multi-photo batch fails, the failing item sends a generic upload error and the final successful item can still send a success count. The customer does not get a single clear partial-upload message such as "2 of 3 photos uploaded".
- Photo backfill is risky. During submission, `handleJobRequestSubmitted` calls `db.attachment.updateMany(...).catch(...)`. If this fails, the request remains created and the customer receives a success confirmation. Providers may then unlock a lead without seeing photos the customer believes were attached.
- Orphaned customer photos are acknowledged by a TODO comment, but the cleanup sweep is not implemented in the audited path.

## 7. Customer Signed-Link Findings

Customer ticket link:

- `field-service/lib/job-request-access.ts` creates and resolves a request-scoped access token.
- `field-service/app/requests/access/[token]/page.tsx` resolves the token and renders the request without requiring OTP login.
- `field-service/proxy.ts` allows `/requests/access` as a public signed route.
- The ticket page uses `/api/attachments/{id}?token=...` so request photos are fetched through an authorization proxy rather than exposed as raw blob URLs.
- `field-service/app/api/attachments/[id]/route.ts` allows unauthenticated attachment access only when the ticket token matches the attachment's job request.

Gap: invalid/expired ticket links show plain invalid/expired copy, but they do not show a structured error code or trace ID. This is weaker than the provider handover entry page and the approved customer error-handling expectations.

Customer provider handover link:

- `field-service/lib/customer-provider-handover-access.ts` signs a provider-handover URL scoped to lead, provider, and job request.
- Resolution requires the lead to be accepted and the job request/match/provider to still line up.
- The handover payload includes provider name and phone after acceptance.
- `field-service/app/customer/requests/[requestId]/provider-handover/page.tsx` renders structured invalid/expired errors with an error code and trace ID, then redirects valid links to the no-login handover view.

## 8. Customer Notification Findings

Request submitted confirmation:

- `handleJobRequestSubmitted` sends a clear WhatsApp confirmation with category, request ref, matching status, and ticket CTA when available.
- It falls back from CTA URL to buttons, then to plain text.

Provider acceptance notification:

- `field-service/lib/post-match-communications.ts:notifyPostMatchAcceptance` sends the customer a named provider acceptance message and provider contact number.
- It includes a signed customer provider handover URL when available.
- `hasSentPostMatchMessage` prevents duplicate accepted-provider handover notifications for the same lead.
- `field-service/lib/matching-engine.ts:acceptLead` only calls post-match communications when `acceptAssignmentOffer` succeeds.
- `field-service/lib/matching/service.ts:acceptAssignmentOffer` performs provider eligibility/assignment/credit unlock inside a transaction. This means customer notification happens after the credit/assignment commit, as required.

Job progress updates:

- `field-service/lib/accepted-job-actions.ts:saveAcceptedLeadArrival` notifies the customer when the provider confirms arrival time.
- `markAcceptedLeadAction` notifies for `on_the_way`, `arrived`, `started`, and `completed`.
- Duplicate arrival saves are detected and do not resend.
- Duplicate action timestamps return `{ duplicate: true }` and do not resend.

Gap: `customer_contacted` is recorded as a provider action but does not send a WhatsApp update to the customer. The approved flow says the customer receives updates when the provider marks customer contacted. Either the code must send that notification, or the approved flow should be corrected if this event is intentionally provider-only.

Gap: notification failure handling is inconsistent. Arrival notification failures return `CUSTOMER_NOTIFICATION_FAILED` and audit-log the failure, but there is no durable retry/outbox. Other update notifications can throw from `notifyCustomer` after the DB timestamp has already been updated, with no evident retry guarantee.

## 9. Customer Error Handling Review

Stronger areas:

- WhatsApp webhook rejects invalid Meta signatures with a request ID in logs.
- Attachment API returns structured JSON errors for missing records, storage path problems, signed URL failures, and missing blob files, including `code`, `attachmentId`, and `traceId`.
- Customer provider handover entry renders structured invalid/expired errors with error code and trace ID.
- Arrival planning validation returns specific reasons such as `ARRIVAL_OUTSIDE_CUSTOMER_AVAILABILITY`, `ARRIVAL_END_BEFORE_START`, and `CUSTOMER_NOTIFICATION_FAILED`.

Weaker areas:

- Request submission failure sends: "Something went wrong submitting your request. Please try again or contact us directly." It does not include a stable error code or trace ID.
- `PILOT_DEBUG_ERRORS=true` appends a truncated technical error to the customer WhatsApp message. That helps triage but should be tightly controlled because it can expose internal implementation details.
- Photo upload failure sends a clear generic message but no error code, trace ID, media ID, or batch summary.
- Invalid saved-address selection has clear copy but no trace ID/error code.
- Expired/invalid ticket link has clear copy but no error code/trace ID.
- Provider assignment/notification failures are logged/audited in some places but are not consistently retryable or customer-traceable.

Known customer failure points and status:

| Failure point | Current behaviour | Gap |
|---|---|---|
| Invalid address | Re-prompts for address in structured flow. | No trace ID/error code in WhatsApp copy. |
| Unavailable service area | Adds to waitlist and sends clear expansion message. | Limited audit detail visible from reviewed flow. |
| Photo upload failure | Generic retry/skip message. | No batch partial summary, trace ID, or error code. |
| Request submission failure | Generic failure message. | No code/trace; debug suffix can expose internals if enabled. |
| Expired signed ticket | Plain PWA copy. | No code/trace. |
| Invalid signed ticket | Plain PWA copy. | No code/trace. |
| Expired/invalid provider handover | Structured PWA error card. | Aligned. |
| Provider assignment failure | Customer notification is not sent if accept/assignment fails. | Good gating, but operational retry visibility should be improved. |
| Notification failure | Some failures logged/audited. | No durable outbox/retry across the customer flow. |

## 10. Customer Logging and Troubleshooting Review

Existing useful logging/audit:

- Inbound WhatsApp message persistence and WAMID dedupe in `app/api/webhooks/whatsapp/route.ts`
- Identity resolution console log in `whatsapp-identity.ts`
- Role-conflict route blocks in `whatsapp-bot.ts`
- Customer photo batch start/refresh/flush logs in `whatsapp-bot.ts`
- Customer photo confirmation logs in `job-request.ts`
- Outbound WhatsApp `MessageEvent` records in `message-events.ts`
- Post-match handover audit/logs in `post-match-communications.ts`
- Arrival/action audit logs in `accepted-job-actions.ts`
- Legacy job status events and audit logs in `jobs.ts`
- Attachment access logs with trace IDs in `attachments/[id]/route.ts`

Logging gaps:

- No single customer-flow trace ID is carried from inbound WhatsApp message through identity, address selection, photo upload, request creation, matching, and notifications.
- Many WhatsApp sends call `sendText/sendButtons/sendList/sendCtaUrl` without `OutboundInteractiveContext`, so not every outbound message becomes a `MessageEvent` with template/metadata.
- Address selection and saved-address choice are not consistently audit-logged with customer ID, request ID, normalized phone, action, and result.
- Request creation has strong transactional behaviour but limited customer-flow audit events around `customer_created`, `address_selected`, `request_created`, and `matching_started`.
- Photo upload logs do not consistently include customer ID/request ID because request ID does not exist until submit.
- Ticket access invalid/expired events are not logged with trace IDs in the PWA page.
- Notification failures are not consistently retryable.

Current screenshots plus ad hoc logs are probably enough for a developer to inspect common issues, but not enough for operations to reliably trace a failed customer journey end-to-end without database spelunking.

## 11. Customer Test Coverage Review

Existing coverage is meaningful for the recent flow fixes:

- Identity resolution: `whatsapp-identity.test.ts`
- Customer-only and unknown mixed menu routing: `whatsapp-menu-routing.test.ts`
- Stale Find Work blocking for customers: `whatsapp-menu-routing.test.ts`
- Returning customer saved-address prompts: `whatsapp-flows/job-request.test.ts`
- Customer photo upload, max, dedupe, and upload failure: `whatsapp-flows/job-request.test.ts`
- Customer multi-photo batch suppression: `whatsapp-bot-stateless.test.ts`
- Request creation phone/customer upsert: `create-job-request.test.ts`
- Ticket token creation/rotation: `job-request-access.test.ts`
- Provider handover token validity/reassignment cancellation: `customer-provider-handover-access.test.ts`
- Post-match customer/provider communication: `post-match-communications.test.ts`
- Signed attachment access via ticket token: `attachments-authz.test.ts`
- Accepted job arrival/on-way notifications and duplicate arrival protection: `accepted-job-actions.test.ts`
- Public signed route boundaries: `proxy.test.ts`

Missing or insufficient tests:

Unit tests:

- WhatsApp issue-description capture and inclusion in summary/create request.
- Saved-address selected ID is linked/reused and does not create duplicate address rows.
- Request submission idempotency under duplicate/concurrent confirm actions.
- Photo backfill failure does not silently produce a misleading success state.
- Partial multi-photo batch failure produces one clear partial-upload message.
- Ticket invalid/expired page renders error code and trace ID.
- `customer_contacted` either sends a customer notification or is explicitly provider-only.

Integration tests:

- Full known-customer WhatsApp flow with saved address, issue description, availability, photos, submit, ticket CTA, and matching start.
- Unknown customer WhatsApp flow from discovery menu through customer profile creation and request submit.
- Provider acceptance path proves customer notification only after credit deduction and assignment commit.
- Provider unlock path proves customer photos are visible after unlock.

WhatsApp webhook tests:

- Duplicate submit button WAMID and duplicate interactive retry across webhook retries.
- Stale address/photo/submit buttons cannot mutate a completed or role-conflicted conversation.
- Multi-photo batch with one failed media download.

Signed-link tests:

- Ticket page invalid/expired structured error card.
- Ticket link cannot expose another customer's request, provider details, or attachments.
- Provider handover page includes contact details only after accepted lead.

End-to-end tests:

- WhatsApp `Hi` for existing customer -> customer-only menu -> saved address -> request submit -> signed ticket -> provider accept -> signed provider handover -> job progress updates.
- Unknown user -> Request a Service -> first-name capture -> customer creation -> request submit.
- Existing customer stale `Find Work` reply -> role-lock message -> customer menu.

## 12. Client Remediation Backlog

### P1: Add WhatsApp Issue Description Capture

Problem: Approved flow requires issue description capture, but WhatsApp request creation stores only preferred availability in `description`.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/job-requests/create-job-request.ts`
- `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`
- Provider lead preview/detail components that display `jobRequest.description`

Expected fix: Add a `collect_issue_description` step after address or before availability. Store description separately from availability where possible, include it in summary, ticket page, lead preview, and provider detail.

Acceptance criteria:

- Customer is prompted for a short description/problem note.
- Summary shows the description.
- Created `JobRequest.description` includes the customer problem details.
- Availability remains available to arrival validation.

Suggested tests: Unit flow test for new step, full WhatsApp request test, provider lead preview/detail test.

### P1: Reuse Selected Saved Address Instead of Duplicating It

Problem: Existing customers can choose saved addresses, but `createJobRequest` always creates a new `Address` row.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/job-requests/create-job-request.ts`
- Prisma `Address`/`JobRequest` schema if needed
- `field-service/__tests__/lib/create-job-request.test.ts`
- `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`

Expected fix: Preserve selected `addressId` in conversation data. Let `createJobRequest` link the request to that address when it belongs to the customer and is structured/valid. Create a new address only for new address capture.

Acceptance criteria:

- `addr_same` and `addr_saved_*` result in `JobRequest.addressId` equal to the selected existing address.
- New address capture still creates one new address.
- Address rows are not duplicated unnecessarily.

Suggested tests: Existing customer single saved address, multiple saved address selection, new address creation, unauthorized address ID rejection.

### P1: Make Customer Photo Linking Submission-Safe

Problem: Photo attachments are linked after request creation and failures are swallowed.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/job-requests/create-job-request.ts`
- `field-service/app/api/attachments/[id]/route.ts`
- `field-service/__tests__/lib/whatsapp-flows/job-request.test.ts`

Expected fix: Move photo linking into the request creation transaction or fail/partial-warn before sending success. Count linked attachments after update and use that count in customer confirmation/support logs.

Acceptance criteria:

- If photos were uploaded, all valid photos are linked before success confirmation.
- If any attachment cannot be linked, customer receives clear partial-upload copy.
- Provider lead/token photo access can see linked photos after unlock.

Suggested tests: Successful multi-photo backfill, partial backfill, failed backfill, provider post-unlock photo access.

### P1: Add Transactional Submit Idempotency

Problem: Active-request guard prevents many retries but does not guarantee no duplicate request under concurrent submit actions.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/job-requests/create-job-request.ts`
- Prisma schema/migration for idempotency key or active request uniqueness if chosen
- `field-service/__tests__/lib/create-job-request.test.ts`

Expected fix: Generate a conversation/request idempotency key before summary and persist it with request creation. Replaying the same submit returns the existing request.

Acceptance criteria:

- Double-tap or duplicate webhook submit returns same `jobRequestId`.
- Matching starts once.
- Customer receives at most one submitted confirmation per request.

Suggested tests: Concurrent `confirm_yes` calls, duplicate WAMID, duplicate interactive reply after confirmation failure.

### P1: Standardize Customer Error Codes and Trace IDs

Problem: Customer-facing errors are inconsistent across WhatsApp and PWA.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/app/requests/access/[token]/page.tsx`
- `field-service/app/customer/requests/[requestId]/provider-handover/page.tsx`
- `field-service/app/api/attachments/[id]/route.ts`
- `field-service/lib/support-diagnostics.ts`

Expected fix: Define a small customer-flow error catalog and render safe messages with `errorCode` and `traceId` for known failures.

Acceptance criteria:

- Request submission, invalid address, photo upload, expired ticket, invalid ticket, expired handover, invalid handover, and notification failures expose safe error codes and trace IDs.
- Backend logs include the same trace ID.
- No secrets/internal stack traces are sent to customers.

Suggested tests: PWA invalid/expired ticket snapshots, WhatsApp request failure tests, photo failure tests.

### P1: Decide and Implement Customer-Contacted Notification

Problem: Approved flow expects customer notification when provider marks customer contacted. Code records the action but does not notify the customer.

Files/modules likely involved:

- `field-service/lib/accepted-job-actions.ts`
- `field-service/__tests__/lib/accepted-job-actions.test.ts`
- PWA signed job page actions

Expected fix: Either send a customer WhatsApp update for `customer_contacted` or formally revise the approved flow to classify it as provider-only/internal.

Acceptance criteria:

- Approved flow and implementation agree.
- If customer-facing, repeated action does not send duplicate notifications.

Suggested tests: `customer_contacted` sends once; duplicate does not resend.

### P2: Add Durable Notification Retry/Outbox

Problem: Some notification failures are logged or returned, but customer communications are not consistently retryable.

Files/modules likely involved:

- `field-service/lib/whatsapp-interactive.ts`
- `field-service/lib/message-events.ts`
- `field-service/lib/post-match-communications.ts`
- `field-service/lib/accepted-job-actions.ts`
- Notification cron/worker area

Expected fix: Use a durable outbound message/outbox state for critical customer messages.

Acceptance criteria:

- Critical customer messages are persisted before send attempt.
- Failures are retryable and visible to support/admin.
- Duplicate retry does not send duplicate customer messages.

Suggested tests: failed WhatsApp send -> retry -> sent, duplicate retry suppressed.

### P2: Add Customer Flow Audit Events

Problem: Logs are useful but not consistently queryable end-to-end.

Files/modules likely involved:

- `field-service/lib/whatsapp-bot.ts`
- `field-service/lib/whatsapp-identity.ts`
- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/job-requests/create-job-request.ts`
- `field-service/lib/message-events.ts`

Expected fix: Carry a customer-flow trace ID and record audit events for identity resolution, customer creation, address selection, photo upload, request creation, submit confirmation, signed ticket access, provider handover, and job updates.

Acceptance criteria:

- Support can search one trace/request/customer and see the complete journey.
- Logs include normalized phone, customer ID, request ID when available, action, result, and error code.

Suggested tests: audit event creation for key flow steps.

### P2: Strengthen Unknown Customer Profile Timing

Problem: Unknown customer profile is created at request submission, not immediately after first-name capture.

Files/modules likely involved:

- `field-service/lib/whatsapp-flows/job-request.ts`
- `field-service/lib/customer-provider-actions.ts` or customer service layer

Expected fix: Decide whether profile creation should occur at first-name capture or stay at submit. If staying at submit, update approved flow wording.

Acceptance criteria:

- Product and code agree on when a customer row is created.
- Abandoned onboarding behaviour is explicit.

Suggested tests: abandoned unknown-customer flow does or does not create profile per decision.

## 13. Open Questions

- Should WhatsApp request flow capture a free-text issue description as mandatory, optional, or only for selected service categories?
- Should preferred availability remain embedded in `JobRequest.description`, or should WhatsApp populate dedicated scheduling fields?
- Should selected saved addresses be immutable snapshots on the request, or should `JobRequest.addressId` point to the reusable customer address row?
- Is `customer_contacted` intended to notify the customer, or is it only an operational provider checklist event?
- What is the product expectation when some photos in a WhatsApp batch fail to upload?
- Should a customer profile be created as soon as an unknown user provides their name, or only after request submission?
- What messages are considered critical enough to require durable notification retry before pilot?
- Should expired ticket links offer WhatsApp resend directly, or only instruct the customer to return to WhatsApp?

## 14. Final Recommendation

The customer flow is not fully ready for a high-confidence production pilot, but no P0 blocker was found in the core known-customer request, signed ticket, provider acceptance, and handover path. The implementation is close enough for controlled internal/pilot testing if operations understands the known P1 risks.

Before broader pilot, fix these first:

1. Add issue-description capture and summary display.
2. Reuse/link selected saved addresses instead of duplicating them.
3. Make photo linking transactionally safe or clearly partial-fail before customer success confirmation.
4. Add transactional request-submit idempotency.
5. Standardize customer-facing error codes, trace IDs, and notification retry/auditability.

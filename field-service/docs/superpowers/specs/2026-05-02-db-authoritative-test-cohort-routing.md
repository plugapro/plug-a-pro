# DB-authoritative test cohort routing

Date: 2026-05-02

## Context

Test/live WhatsApp sends were previously decided from two sources of truth: a static bootstrap phone list and persisted `Customer.isTestUser` / `Provider.isTestUser` flags. When those disagreed, a valid test post-match notification could be blocked as a cohort mismatch.

## Decisions

- `Customer.isTestUser` and `Provider.isTestUser` are authoritative once a row exists.
- `INTERNAL_TEST_PHONE_NUMBERS` remains as a bootstrap list for first-contact seeding and fallback-only send contexts.
- Cohort state propagates at write time: customer/provider DB flag to job request, job request to lead, and lead/message metadata to message events.
- WhatsApp send guards prefer caller-supplied `recipientIsTest` metadata over phone-string inference.

## Implementation Notes

- Job request creation reads the resolved customer row before setting `JobRequest.isTestRequest`.
- Dispatch lead creation copies `JobRequest.isTestRequest` / `cohortName` into `Lead.isTestLead` / `cohortName`.
- Post-match customer and provider notifications pass DB-sourced `recipientIsTest` values into WhatsApp metadata.
- Message-event failure diagnostics now record the effective recipient test flag used for the decision, not the fallback phone-list guess.
- Backfill scripts report and repair DB flag drift without treating the static list as the runtime authority.

## Validation

- Added propagation tests for customer to job request, job request to lead, and lead metadata to message send context.
- Added WhatsApp template guard tests proving explicit `recipientIsTest` overrides phone-list guessing.
- Added message-event failure diagnostics coverage for explicit recipient flags.

# Plug A Pro Codex Implementation Pack

## Purpose

This pack breaks the Plug A Pro product blueprint into small implementation-ready Codex tasks.

The three journeys are:

1. Service Provider Onboarding
2. Client Service Request
3. Matching / Shortlist / Provider Acceptance / Credit Flow

## Core product decision

Plug A Pro will use a **Qualified Shortlist Model**, not blind auto-allocation.

The model is:

```text
Provider applies
↓
Admin reviews and approves provider
↓
Client submits service request
↓
System filters and scores suitable providers
↓
Top providers receive safe lead preview
↓
Interested providers submit rate / availability
↓
Client receives shortlist
↓
Client selects provider
↓
Selected provider accepts job
↓
1 credit is deducted
↓
Full customer details unlock
↓
Job is assigned
```

## How to use this pack

Run the tasks in sequence.

Do not skip the as-is assessment. The current codebase already has working WhatsApp onboarding, lead matching, provider credits, image handling, secure lead links, and Worker Portal pieces. Codex must inspect and reuse what exists before creating new structures.

## Recommended execution order

### Foundation

1. `01-as-is-assessment.md`
2. `02-product-decisions-and-state-machines.md`
3. `03-shared-data-model-and-migration-plan.md`

### Flow 1: Service Provider Onboarding

4. `04-provider-onboarding-as-is-and-gap.md`
5. `05-provider-onboarding-data-capture.md`
6. `06-provider-admin-review-approval.md`

### Flow 2: Client Service Request

7. `07-client-request-as-is-and-gap.md`
8. `08-client-request-data-capture-and-privacy.md`
9. `09-client-request-submission-and-notifications.md`

### Flow 3: Matching / Shortlist / Acceptance / Credits

10. `10-matching-engine-as-is-and-gap.md`
11. `11-provider-opportunity-preview-and-response.md`
12. `12-customer-shortlist-and-selection.md`
13. `13-provider-final-acceptance-credit-and-unlock.md`

### Cross-cutting hardening

14. `14-whatsapp-template-and-url-audit.md`
15. `15-security-privacy-audit.md`
16. `16-test-matrix-and-release-plan.md`

## Global rules for all tasks

- Reuse existing code and schema where possible.
- Do not create duplicate systems if an equivalent already exists.
- Do not expose customer phone, exact address, GPS coordinates, or access notes before provider acceptance.
- Do not deduct credits before the selected provider accepts the job.
- Make every state transition explicit and auditable.
- Use server-side authorization. Do not rely on frontend hiding.
- Use production public URLs for WhatsApp messages.
- Log implementation notes and product decisions to OpenBrain.
- Keep the MVP simple and operationally realistic.

## Standard deliverable format for each Codex task

Each task should end with a concise summary:

```text
Root cause / current state found:
Files changed:
Schema changes:
API changes:
UI changes:
WhatsApp template changes:
Tests added or updated:
Manual verification completed:
Remaining risks:
OpenBrain notes logged:
```

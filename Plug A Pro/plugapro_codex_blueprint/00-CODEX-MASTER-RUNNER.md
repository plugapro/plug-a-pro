# 00 — CODEX MASTER RUNNER: Execute Plug A Pro Blueprint One File at a Time

## Purpose

This is the only file you need to give to Codex.

Codex must use this file as the execution controller. It must locate the remaining blueprint `.md` files, execute them in the correct sequence, and produce a physical Markdown implementation output after each file.

There must be **no single final implementation summary**. Each blueprint file must produce its own implementation output file.

The objective is to implement the Plug A Pro Qualified Shortlist Model across three journeys:

1. Service Provider Onboarding
2. Client Service Request
3. Matching / Shortlist / Provider Acceptance / Credit Flow

## Core product decision

Plug A Pro must use the **Qualified Shortlist Model**, not blind auto-allocation.

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

## Important execution rule

Do not jump straight into implementation.

Start with the as-is assessment first. Existing code, schema, WhatsApp flows, lead flows, credit flows, image flows, and admin flows must be inspected before any structural changes are made.

## Where the blueprint files are

This runner file should live in the same folder as the other blueprint files.

Expected folder:

```text
plugapro_codex_blueprint/
```

Expected files:

```text
00-README-sequence.md
01-as-is-assessment.md
02-product-decisions-and-state-machines.md
03-shared-data-model-and-migration-plan.md
04-provider-onboarding-as-is-and-gap.md
05-provider-onboarding-data-capture.md
06-provider-admin-review-approval.md
07-client-request-as-is-and-gap.md
08-client-request-data-capture-and-privacy.md
09-client-request-submission-and-notifications.md
10-matching-engine-as-is-and-gap.md
11-provider-opportunity-preview-and-response.md
12-customer-shortlist-and-selection.md
13-provider-final-acceptance-credit-and-unlock.md
14-whatsapp-template-and-url-audit.md
15-security-privacy-audit.md
16-test-matrix-and-release-plan.md
```

If this file is not in the same folder, search the repository for:

```text
01-as-is-assessment.md
```

Then use that directory as the blueprint directory.

## Output folder

Create the following output folder in the repository:

```text
docs/codex-execution/
```

All execution reports must be written there.

## Required output files

Create and continuously update this master index:

```text
docs/codex-execution/000-execution-index.md
```

After each blueprint file is executed, create a separate output report using this naming pattern:

```text
docs/codex-execution/001-as-is-assessment-output.md
docs/codex-execution/002-product-decisions-and-state-machines-output.md
docs/codex-execution/003-shared-data-model-and-migration-plan-output.md
docs/codex-execution/004-provider-onboarding-as-is-and-gap-output.md
docs/codex-execution/005-provider-onboarding-data-capture-output.md
docs/codex-execution/006-provider-admin-review-approval-output.md
docs/codex-execution/007-client-request-as-is-and-gap-output.md
docs/codex-execution/008-client-request-data-capture-and-privacy-output.md
docs/codex-execution/009-client-request-submission-and-notifications-output.md
docs/codex-execution/010-matching-engine-as-is-and-gap-output.md
docs/codex-execution/011-provider-opportunity-preview-and-response-output.md
docs/codex-execution/012-customer-shortlist-and-selection-output.md
docs/codex-execution/013-provider-final-acceptance-credit-and-unlock-output.md
docs/codex-execution/014-whatsapp-template-and-url-audit-output.md
docs/codex-execution/015-security-privacy-audit-output.md
docs/codex-execution/016-test-matrix-and-release-plan-output.md
```

Do **not** create a combined final file such as:

```text
docs/codex-execution/999-final-implementation-summary.md
```

The output for each file is the implementation summary for that specific file.

## Execution sequence

Execute the files in this exact order:

| Step | Blueprint file | Required output file |
|---:|---|---|
| 1 | `01-as-is-assessment.md` | `001-as-is-assessment-output.md` |
| 2 | `02-product-decisions-and-state-machines.md` | `002-product-decisions-and-state-machines-output.md` |
| 3 | `03-shared-data-model-and-migration-plan.md` | `003-shared-data-model-and-migration-plan-output.md` |
| 4 | `04-provider-onboarding-as-is-and-gap.md` | `004-provider-onboarding-as-is-and-gap-output.md` |
| 5 | `05-provider-onboarding-data-capture.md` | `005-provider-onboarding-data-capture-output.md` |
| 6 | `06-provider-admin-review-approval.md` | `006-provider-admin-review-approval-output.md` |
| 7 | `07-client-request-as-is-and-gap.md` | `007-client-request-as-is-and-gap-output.md` |
| 8 | `08-client-request-data-capture-and-privacy.md` | `008-client-request-data-capture-and-privacy-output.md` |
| 9 | `09-client-request-submission-and-notifications.md` | `009-client-request-submission-and-notifications-output.md` |
| 10 | `10-matching-engine-as-is-and-gap.md` | `010-matching-engine-as-is-and-gap-output.md` |
| 11 | `11-provider-opportunity-preview-and-response.md` | `011-provider-opportunity-preview-and-response-output.md` |
| 12 | `12-customer-shortlist-and-selection.md` | `012-customer-shortlist-and-selection-output.md` |
| 13 | `13-provider-final-acceptance-credit-and-unlock.md` | `013-provider-final-acceptance-credit-and-unlock-output.md` |
| 14 | `14-whatsapp-template-and-url-audit.md` | `014-whatsapp-template-and-url-audit-output.md` |
| 15 | `15-security-privacy-audit.md` | `015-security-privacy-audit-output.md` |
| 16 | `16-test-matrix-and-release-plan.md` | `016-test-matrix-and-release-plan-output.md` |

Do not run `00-README-sequence.md` as an implementation task. It is context only.

## Execution method for each file

For each blueprint file:

1. Read the full blueprint file.
2. Inspect the current codebase relevant to that file.
3. Identify what already exists.
4. Reuse existing implementations wherever practical.
5. Implement only what the file asks for.
6. Do not introduce duplicate systems.
7. Add or update tests.
8. Run relevant tests/lint/type checks.
9. Write the detailed output report for that specific file.
10. Update the master execution index.
11. Move to the next file.

## Stop conditions

Continue through the sequence automatically unless one of these happens:

1. A destructive database migration is required and cannot be made safe.
2. Required environment/config values are missing and no safe fallback exists.
3. The codebase structure is too different from the blueprint and would require a product decision.
4. A test failure suggests data loss, privacy breach, or credit balance corruption.
5. A security/privacy rule cannot be enforced with the current architecture.

If a stop condition is hit:

1. Stop execution.
2. Write a blocker report to the current step's output file.
3. Update `docs/codex-execution/000-execution-index.md`.
4. Add required decision points and recommended next action.
5. Do not continue to the next file.

## Global implementation rules

### Reuse first

Before creating anything new, search for existing equivalents.

Examples:

- Do not create a new credit system if a credit ledger already exists.
- Do not create a new WhatsApp sender if one already exists.
- Do not create a second URL helper if a public URL builder exists.
- Do not create duplicate provider statuses if existing statuses can be mapped.
- Do not create a parallel lead system if current lead invites can be extended.

### Privacy

Before provider final acceptance, the provider may see:

```text
category
subcategory
description
photos
suburb
city
province
region
urgency
preferred date/time
budget preference
```

Before provider final acceptance, the provider must not see:

```text
customer phone
customer email
exact street address
house number
unit number
complex access details
GPS coordinates
private access notes
```

Full customer details unlock only after:

```text
customer selected provider
provider accepted selected job
1 credit deducted successfully
job assigned to provider
```

Privacy must be enforced server-side. Frontend hiding is not enough.

### Credits

Credit rule:

```text
Charge 1 credit only when the customer-selected provider accepts the selected job.
```

Do not charge credits for:

```text
provider receiving preview
provider viewing preview
provider responding interested
provider appearing in shortlist
customer viewing provider profile
customer selecting provider
provider declining
invite expiring
customer cancelling before provider acceptance
```

Credit deduction and job assignment must be atomic.

### WhatsApp URLs

Production WhatsApp messages must never contain localhost.

Production app base URL:

```text
https://app.plugapro.co.za
```

Use a central public URL helper/config.

### OpenBrain

Every file execution must include an implementation note intended for OpenBrain.

If OpenBrain integration exists in the repo, use it.

If no integration exists, write the OpenBrain note into the output report under:

```text
## OpenBrain note
```

## Required output report format after each file

Every `docs/codex-execution/*-output.md` file must use this structure:

```md
# Execution Output — <Blueprint File Name>

## Status

One of:

- Completed
- Completed with warnings
- Blocked
- Not started
- Partially completed

## Blueprint file executed

<relative path>

## Objective

<brief objective copied/summarised from the blueprint file>

## Current-state findings

<what was found in the existing codebase>

## Implementation completed

<detailed list of code/schema/config/test changes made for this file only>

## Files changed

| File | Change summary |
|---|---|

## Schema / migration changes

<details or "None">

## API / server action changes

<details or "None">

## UI changes

<details or "None">

## WhatsApp/template changes

<details or "None">

## Security and privacy impact

<details>

## Credit impact

<details>

## Tests added or updated

<details>

## Commands run

```bash
<commands>
```

## Test results

<pass/fail summary>

## Manual verification checklist

- [ ] Item 1
- [ ] Item 2

## Risks and follow-ups

<remaining risks>

## OpenBrain note

<implementation note / product decision / follow-up>
```

## Master execution index format

Maintain:

```text
docs/codex-execution/000-execution-index.md
```

Use this structure:

```md
# Plug A Pro Codex Execution Index

## Execution started

<timestamp>

## Current status

<in progress / completed / blocked>

## Blueprint directory

<path>

## Execution table

| Step | Blueprint | Output report | Status | Summary |
|---:|---|---|---|---|

## Global files changed

| File | Reason |
|---|---|

## Global migrations

| Migration | Reason | Status |
|---|---|---|

## Global tests run

| Command | Result |
|---|---|

## Final blockers / decisions needed

<list>

## Current recommendation

<summary>
```

Update this file after every blueprint file.

## Completion rule

When all 16 blueprint files have been executed:

1. Do not create a final combined implementation summary.
2. Mark `docs/codex-execution/000-execution-index.md` as completed.
3. Ensure every step has its own output report.
4. Ensure every output report contains implementation details specific to that blueprint file.
5. Stop after updating the execution index.

## Execution starts now

Begin with:

```text
01-as-is-assessment.md
```

Do not implement later phases before completing and reporting the as-is assessment.

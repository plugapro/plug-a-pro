# 00 — CLIENT PWA MASTER RUNNER: WhatsApp-First Client Journey Execution

## Purpose

This is the single instruction file to give to Codex.

Codex must use this file as the execution controller for the **Client PWA journey**. It must locate and execute the remaining client PWA blueprint files in sequence, produce a physical Markdown output after each file, and update an execution index after each step.

There must be **no single final implementation summary**. Each blueprint file must produce its own implementation output file.

## Product context

The original Plug A Pro client journey is primarily **WhatsApp-first**.

The PWA is not replacing WhatsApp. The PWA is used when WhatsApp is not enough to present, capture, compare, or manage information properly.

The correct model is:

```text
WhatsApp starts and guides the journey
↓
PWA opens for richer screens and structured actions
↓
Backend state is updated
↓
WhatsApp sends confirmation / reminders / next steps
↓
PWA remains available for tracking and detail views
```

WhatsApp and the PWA must be two doors into the same backend journey.

A customer may:

```text
start on WhatsApp → continue in PWA → receive WhatsApp updates
start in PWA → receive WhatsApp updates
open an old WhatsApp link → land on the correct current PWA state
```

## Core client journey model

The Client PWA must align to the Plug A Pro Qualified Shortlist Model:

```text
Client starts request
↓
Client captures request information
↓
Client submits request
↓
System matches suitable providers
↓
Providers respond with interest / rate / availability
↓
Client views provider shortlist
↓
Client compares profiles
↓
Client selects provider
↓
Selected provider confirms job
↓
Provider spends 1 credit
↓
Full customer details unlock to provider
↓
Client tracks job progress
↓
Job completes
↓
Client rates / reports / books again
```

## Critical channel principle

Some steps stay primarily on WhatsApp.

Some steps must hand off to the PWA because WhatsApp is weak for structured UX.

### WhatsApp is best for

```text
starting request
simple prompts
submission confirmation
status updates
alerts
links to continue
provider accepted message
arrival notifications
completion reminders
support prompts
```

### PWA is best for

```text
multi-step request form
photo upload management
address capture
review before submit
matching status page
provider shortlist comparison
provider profile view
provider selection
job tracking timeline
invoice / completion / review
```

## Blueprint files

This runner should live in the same folder as these files:

```text
01-client-pwa-as-is-assessment.md
02-client-pwa-channel-and-handoff-model.md
03-client-pwa-route-map-and-state-resolver.md
04-client-pwa-request-creation-flow.md
05-client-pwa-photo-address-and-privacy-flow.md
06-client-pwa-submission-and-matching-status-flow.md
07-client-pwa-shortlist-profile-and-selection-flow.md
08-client-pwa-provider-confirmation-and-job-tracking-flow.md
09-client-pwa-exception-and-recovery-states.md
10-client-pwa-security-privacy-and-token-rules.md
11-client-pwa-notifications-copy-and-url-rules.md
12-client-pwa-test-matrix-and-release-plan.md
```

If this runner file is not in the same folder, search the repo for:

```text
01-client-pwa-as-is-assessment.md
```

Then use that directory as the client PWA blueprint directory.

## Output folder

Create:

```text
docs/client-pwa-execution/
```

Create and continuously update:

```text
docs/client-pwa-execution/000-client-pwa-execution-index.md
```

After each file, create:

```text
docs/client-pwa-execution/001-client-pwa-as-is-assessment-output.md
docs/client-pwa-execution/002-client-pwa-channel-and-handoff-model-output.md
docs/client-pwa-execution/003-client-pwa-route-map-and-state-resolver-output.md
docs/client-pwa-execution/004-client-pwa-request-creation-flow-output.md
docs/client-pwa-execution/005-client-pwa-photo-address-and-privacy-flow-output.md
docs/client-pwa-execution/006-client-pwa-submission-and-matching-status-flow-output.md
docs/client-pwa-execution/007-client-pwa-shortlist-profile-and-selection-flow-output.md
docs/client-pwa-execution/008-client-pwa-provider-confirmation-and-job-tracking-flow-output.md
docs/client-pwa-execution/009-client-pwa-exception-and-recovery-states-output.md
docs/client-pwa-execution/010-client-pwa-security-privacy-and-token-rules-output.md
docs/client-pwa-execution/011-client-pwa-notifications-copy-and-url-rules-output.md
docs/client-pwa-execution/012-client-pwa-test-matrix-and-release-plan-output.md
```

## Execution order

| Step | Blueprint | Output |
|---:|---|---|
| 1 | `01-client-pwa-as-is-assessment.md` | `001-client-pwa-as-is-assessment-output.md` |
| 2 | `02-client-pwa-channel-and-handoff-model.md` | `002-client-pwa-channel-and-handoff-model-output.md` |
| 3 | `03-client-pwa-route-map-and-state-resolver.md` | `003-client-pwa-route-map-and-state-resolver-output.md` |
| 4 | `04-client-pwa-request-creation-flow.md` | `004-client-pwa-request-creation-flow-output.md` |
| 5 | `05-client-pwa-photo-address-and-privacy-flow.md` | `005-client-pwa-photo-address-and-privacy-flow-output.md` |
| 6 | `06-client-pwa-submission-and-matching-status-flow.md` | `006-client-pwa-submission-and-matching-status-flow-output.md` |
| 7 | `07-client-pwa-shortlist-profile-and-selection-flow.md` | `007-client-pwa-shortlist-profile-and-selection-flow-output.md` |
| 8 | `08-client-pwa-provider-confirmation-and-job-tracking-flow.md` | `008-client-pwa-provider-confirmation-and-job-tracking-flow-output.md` |
| 9 | `09-client-pwa-exception-and-recovery-states.md` | `009-client-pwa-exception-and-recovery-states-output.md` |
| 10 | `10-client-pwa-security-privacy-and-token-rules.md` | `010-client-pwa-security-privacy-and-token-rules-output.md` |
| 11 | `11-client-pwa-notifications-copy-and-url-rules.md` | `011-client-pwa-notifications-copy-and-url-rules-output.md` |
| 12 | `12-client-pwa-test-matrix-and-release-plan.md` | `012-client-pwa-test-matrix-and-release-plan-output.md` |

## Execution method

For each file:

1. Read the full blueprint file.
2. Inspect existing routes, components, APIs, WhatsApp links, token resolvers, and tests.
3. Identify what already exists.
4. Reuse existing implementation wherever practical.
5. Implement only the current file scope.
6. Avoid duplicate route systems.
7. Add or update tests.
8. Run relevant validation.
9. Write the output file for that step.
10. Update the execution index.
11. Move to the next file.

## Stop conditions

Stop only if:

1. A destructive migration is required and no safe plan exists.
2. Current app routing is incompatible and needs a product decision.
3. A privacy rule cannot be enforced server-side.
4. Secure token access cannot be made safe.
5. Tests reveal customer data exposure, credit corruption, or broken request submission.
6. Required production public URL config is missing and no safe fallback exists.

If blocked, write the blocker into the current output file, update the index, and stop.

## Global rules

### WhatsApp-first rule

Do not design the PWA as if every customer starts in the PWA. Most customers may still start on WhatsApp. The PWA must support handoff from WhatsApp links.

### State-aware route rule

Links from WhatsApp must resolve current backend state.

Example:

```text
Customer clicks old shortlist link
↓
Request is already assigned
↓
PWA shows job tracking, not stale shortlist
```

### Privacy rule

Before selected provider acceptance, provider must not receive:

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

The Client PWA must reassure the customer of this before submission.

### Credit rule

Client selection does not deduct provider credits. Provider credit is deducted only when the selected provider accepts the job.

### URL rule

Production WhatsApp messages and PWA handoff links must use:

```text
https://app.plugapro.co.za
```

No production WhatsApp or PWA handoff URL may contain localhost.

## Required output format after each file

Each output report must use:

```md
# Execution Output — <Blueprint File Name>

## Status

Completed / Completed with warnings / Blocked / Partially completed

## Blueprint file executed

<relative path>

## Objective

<summary>

## Current-state findings

<what exists>

## Implementation completed

<what was changed>

## Files changed

| File | Change summary |
|---|---|

## Routes/screens changed

<details or None>

## API/server changes

<details or None>

## WhatsApp handoff changes

<details or None>

## Security/privacy impact

<details>

## Tests added or updated

<details>

## Commands run

```bash
<commands>
```

## Test results

<summary>

## Manual verification checklist

- [ ] WhatsApp handoff opens correct screen
- [ ] PWA route resolves current state
- [ ] Customer can continue journey
- [ ] Privacy rules are respected

## Risks and follow-ups

<remaining risks>

## OpenBrain note

<implementation note>
```

## Execution starts now

Begin with:

```text
01-client-pwa-as-is-assessment.md
```

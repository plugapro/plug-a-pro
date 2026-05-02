# 00 — PROVIDER WHATSAPP + PWA MASTER RUNNER

## Purpose

This is the single instruction file to give to Codex.

Codex must use this file as the execution controller for the **Service Provider WhatsApp-first, PWA-optional journey**.

Codex must locate and execute the remaining provider blueprint `.md` files in sequence, produce a physical Markdown output after each file, and update an execution index after each step.

There must be **no single final implementation summary**. Each blueprint file must produce its own implementation output file.

## Product context

For service providers, WhatsApp must be the **primary execution channel**.

Many field service providers may have limited data, limited comfort with PWAs, or only reliable access to WhatsApp. The provider must therefore be able to complete the full provider journey end to end in WhatsApp.

The PWA is still useful, but it must be optional for normal provider operations.

## Core provider principle

```text
Provider journey must be WhatsApp-first, WhatsApp-complete, and PWA-optional.
```

The provider must be able to complete these actions inside WhatsApp:

```text
apply/register
submit profile details
submit services and work areas
submit availability and rates
upload profile/work photos where possible
receive application status
check credits
receive opportunity preview
respond interested / not interested
submit call-out fee
submit estimated arrival
get customer selected notification
accept selected job
spend 1 credit
receive full customer details after acceptance
confirm arrival time
mark on the way
mark arrived
start job
complete job
submit notes/photos
check active jobs
check credits
get help
```

The PWA may enhance the journey, but it must not be required for these core actions.

## Correct channel model

### WhatsApp is primary for providers

WhatsApp handles:

```text
registration/application
simple data capture
approval/rejection/more info messages
lead opportunity alerts
lead preview summary
provider interest response
rate and availability capture
customer selected notification
job acceptance
credit deduction confirmation
full customer detail delivery
arrival confirmation
job status updates
job completion
credits/status/menu/help
```

### PWA is optional and richer

PWA handles:

```text
full dashboard
profile management
bulk service area editing
credit ledger/history
full job card viewer
image gallery
document management
job history
performance dashboard
advanced settings
```

## Core provider journey

```text
Provider starts on WhatsApp
↓
Provider applies/registers
↓
Admin reviews and approves
↓
Provider receives starter credits
↓
Provider receives opportunity preview
↓
Provider responds interested with rate/arrival
↓
Customer sees shortlist and selects provider
↓
Provider receives customer-selected notification
↓
Provider accepts selected job
↓
1 credit deducted
↓
Full customer details are sent in WhatsApp and available in PWA
↓
Provider confirms arrival
↓
Provider updates job status
↓
Provider completes job
↓
Customer receives updates
```

## Blueprint files

This runner should live in the same folder as these files:

```text
01-provider-as-is-assessment.md
02-provider-channel-responsibility-model.md
03-provider-whatsapp-command-and-state-machine.md
04-provider-onboarding-whatsapp-first-flow.md
05-provider-optional-pwa-profile-and-dashboard-flow.md
06-provider-opportunity-preview-whatsapp-flow.md
07-provider-interest-rate-response-whatsapp-flow.md
08-provider-customer-selected-and-acceptance-whatsapp-flow.md
09-provider-credit-balance-and-ledger-flow.md
10-provider-full-job-details-and-privacy-unlock-flow.md
11-provider-arrival-and-job-execution-whatsapp-flow.md
12-provider-completion-photos-notes-and-history-flow.md
13-provider-pwa-routes-and-handoff-flow.md
14-provider-security-token-and-access-rules.md
15-provider-notifications-copy-and-url-rules.md
16-provider-test-matrix-and-release-plan.md
```

If this runner file is not in the same folder, search the repo for:

```text
01-provider-as-is-assessment.md
```

Then use that directory as the provider blueprint directory.

## Output folder

Create:

```text
docs/provider-whatsapp-pwa-execution/
```

Create and continuously update:

```text
docs/provider-whatsapp-pwa-execution/000-provider-whatsapp-pwa-execution-index.md
```

After each file, create:

```text
docs/provider-whatsapp-pwa-execution/001-provider-as-is-assessment-output.md
docs/provider-whatsapp-pwa-execution/002-provider-channel-responsibility-model-output.md
docs/provider-whatsapp-pwa-execution/003-provider-whatsapp-command-and-state-machine-output.md
docs/provider-whatsapp-pwa-execution/004-provider-onboarding-whatsapp-first-flow-output.md
docs/provider-whatsapp-pwa-execution/005-provider-optional-pwa-profile-and-dashboard-flow-output.md
docs/provider-whatsapp-pwa-execution/006-provider-opportunity-preview-whatsapp-flow-output.md
docs/provider-whatsapp-pwa-execution/007-provider-interest-rate-response-whatsapp-flow-output.md
docs/provider-whatsapp-pwa-execution/008-provider-customer-selected-and-acceptance-whatsapp-flow-output.md
docs/provider-whatsapp-pwa-execution/009-provider-credit-balance-and-ledger-flow-output.md
docs/provider-whatsapp-pwa-execution/010-provider-full-job-details-and-privacy-unlock-flow-output.md
docs/provider-whatsapp-pwa-execution/011-provider-arrival-and-job-execution-whatsapp-flow-output.md
docs/provider-whatsapp-pwa-execution/012-provider-completion-photos-notes-and-history-flow-output.md
docs/provider-whatsapp-pwa-execution/013-provider-pwa-routes-and-handoff-flow-output.md
docs/provider-whatsapp-pwa-execution/014-provider-security-token-and-access-rules-output.md
docs/provider-whatsapp-pwa-execution/015-provider-notifications-copy-and-url-rules-output.md
docs/provider-whatsapp-pwa-execution/016-provider-test-matrix-and-release-plan-output.md
```

## Execution order

| Step | Blueprint | Output |
|---:|---|---|
| 1 | `01-provider-as-is-assessment.md` | `001-provider-as-is-assessment-output.md` |
| 2 | `02-provider-channel-responsibility-model.md` | `002-provider-channel-responsibility-model-output.md` |
| 3 | `03-provider-whatsapp-command-and-state-machine.md` | `003-provider-whatsapp-command-and-state-machine-output.md` |
| 4 | `04-provider-onboarding-whatsapp-first-flow.md` | `004-provider-onboarding-whatsapp-first-flow-output.md` |
| 5 | `05-provider-optional-pwa-profile-and-dashboard-flow.md` | `005-provider-optional-pwa-profile-and-dashboard-flow-output.md` |
| 6 | `06-provider-opportunity-preview-whatsapp-flow.md` | `006-provider-opportunity-preview-whatsapp-flow-output.md` |
| 7 | `07-provider-interest-rate-response-whatsapp-flow.md` | `007-provider-interest-rate-response-whatsapp-flow-output.md` |
| 8 | `08-provider-customer-selected-and-acceptance-whatsapp-flow.md` | `008-provider-customer-selected-and-acceptance-whatsapp-flow-output.md` |
| 9 | `09-provider-credit-balance-and-ledger-flow.md` | `009-provider-credit-balance-and-ledger-flow-output.md` |
| 10 | `10-provider-full-job-details-and-privacy-unlock-flow.md` | `010-provider-full-job-details-and-privacy-unlock-flow-output.md` |
| 11 | `11-provider-arrival-and-job-execution-whatsapp-flow.md` | `011-provider-arrival-and-job-execution-whatsapp-flow-output.md` |
| 12 | `12-provider-completion-photos-notes-and-history-flow.md` | `012-provider-completion-photos-notes-and-history-flow-output.md` |
| 13 | `13-provider-pwa-routes-and-handoff-flow.md` | `013-provider-pwa-routes-and-handoff-flow-output.md` |
| 14 | `14-provider-security-token-and-access-rules.md` | `014-provider-security-token-and-access-rules-output.md` |
| 15 | `15-provider-notifications-copy-and-url-rules.md` | `015-provider-notifications-copy-and-url-rules-output.md` |
| 16 | `16-provider-test-matrix-and-release-plan.md` | `016-provider-test-matrix-and-release-plan-output.md` |

## Execution method

For each file:

1. Read the full blueprint file.
2. Inspect existing WhatsApp bot flows, webhook handlers, provider PWA routes, APIs, token resolvers, provider status models, credit services, and tests.
3. Identify what already exists.
4. Reuse existing implementation wherever practical.
5. Implement only the current file scope.
6. Avoid duplicate WhatsApp state machines, duplicate PWA routes, or duplicate credit systems.
7. Add or update tests.
8. Run relevant validation.
9. Write the output file for that step.
10. Update the execution index.
11. Move to the next file.

## Stop conditions

Stop only if:

1. A destructive migration is required and no safe plan exists.
2. WhatsApp webhook routing is incompatible and requires a product decision.
3. A privacy rule cannot be enforced server-side.
4. Secure token access cannot be made safe.
5. Credit deduction cannot be made atomic.
6. Tests reveal customer data exposure, duplicate credit deduction, or broken provider acceptance.
7. Required production public URL config is missing and no safe fallback exists.

If blocked, write the blocker into the current output file, update the index, and stop.

## Global rules

### WhatsApp-complete rule

Do not require PWA for core provider operations.

Every core provider action must work in WhatsApp:

```text
apply
check credits
view safe opportunity
respond interested
submit call-out fee
submit estimated arrival
accept selected job
receive full customer details
confirm arrival
update job status
complete job
```

### PWA-optional rule

PWA can improve usability but must not be mandatory for the provider to execute work.

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

After selected provider accepts and 1 credit is deducted, full customer details may be sent to that provider via WhatsApp and shown in PWA.

### Credit rule

Provider is not charged for:

```text
opportunity preview
viewing photos
responding interested
appearing in shortlist
customer selecting provider
declining
opportunity expiry
```

Provider is charged exactly 1 credit only when:

```text
customer selected provider
provider accepts selected job
credit balance check passes
job assignment succeeds
```

Credit deduction and job assignment must be atomic.

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

## WhatsApp flow changes

<details or None>

## PWA route/screen changes

<details or None>

## API/server changes

<details or None>

## Credit impact

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

- [ ] Provider can complete required step in WhatsApp
- [ ] PWA remains optional
- [ ] Privacy rules are respected
- [ ] Credit rules are respected
- [ ] WhatsApp response is clear

## Risks and follow-ups

<remaining risks>

## OpenBrain note

<implementation note>
```

## Execution starts now

Begin with:

```text
01-provider-as-is-assessment.md
```

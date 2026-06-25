# 16 — Provider Test Matrix and Release Plan

## Task

Create and implement the provider WhatsApp + PWA test matrix and release validation plan.

## Required tests

### WhatsApp onboarding

```text
provider starts registration
provider captures services
provider captures areas
provider captures rates
provider uploads photo where supported
provider submits application
application submitted confirmation sent
```

### Approval and credits

```text
admin approves provider
starter credits awarded
approval WhatsApp message sent
provider can check credits in WhatsApp
```

### Opportunity and response

```text
provider receives safe opportunity preview
preview hides phone/address
provider responds interested
provider submits call-out fee
provider submits arrival time
provider submits negotiable flag
no credits deducted
```

### Customer selected and accept

```text
customer selected message sent
provider accepts in WhatsApp
1 credit deducted
job assigned
full details sent in WhatsApp
customer notified
duplicate accept does not double-deduct
insufficient credits blocks acceptance
```

### Job execution

```text
provider confirms arrival in WhatsApp
provider marks on the way
provider marks arrived
provider starts job
provider completes job
customer receives updates
```

### PWA optional

```text
provider can open dashboard
provider can view credits
provider can view job
old WhatsApp links resolve current state
PWA is not required for core path
```

### Security

```text
wrong provider cannot access lead
provider cannot see protected fields before acceptance
non-selected provider cannot access full job
unauthorized image access blocked
production URLs do not contain localhost
```

## Validation commands

Run:

```bash
npm test -- --run
npx tsc --noEmit
npm run lint
npx prisma validate
```

If project has additional e2e commands, run those too.

## Manual verification

1. Provider applies through WhatsApp.
2. Admin approves provider.
3. Provider checks credits in WhatsApp.
4. Provider receives opportunity.
5. Provider responds interested with fee and arrival.
6. Customer selects provider.
7. Provider accepts through WhatsApp.
8. Provider receives full customer details in WhatsApp.
9. Provider confirms arrival.
10. Provider marks on the way.
11. Provider marks arrived.
12. Provider completes job.
13. PWA remains optional at every step.

## Acceptance criteria

- Provider can complete core journey end to end in WhatsApp.
- PWA remains optional.
- Privacy rules are enforced.
- Credit rules are enforced.
- Tests pass.
- Execution index completed.

# 12 — Client PWA Test Matrix and Release Plan

## Task

Create and implement the Client PWA test matrix and release validation plan.

## Required tests

### WhatsApp handoff

```text
request form link opens current draft
photo upload link opens upload step
shortlist link opens shortlist if ready
old shortlist link opens job tracking if request assigned
invalid token shows safe error
expired token shows safe error
```

### Request creation

```text
client starts request
client selects category
client selects subcategory
client enters description
client uploads photo
client captures address
client selects urgency/time
client selects provider preference
client reviews and submits
```

### Matching status

```text
submitted request shows submitted state
matching state shows progress
awaiting responses state shows providers reviewing
no provider state shows recovery options
```

### Shortlist

```text
shortlist renders provider cards
provider profile opens
provider private fields hidden
client selects provider
selection does not deduct credits
waiting state appears
```

### Job tracking

```text
provider accepted shows assigned state
arrival confirmed shows timeline update
on the way shows status
arrived shows status
completed shows review options
```

### Privacy/security

```text
client token cannot access another request
provider preview hides customer phone
provider preview hides exact address
client cannot see provider private docs
image access requires authorization
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

If the project has additional e2e commands, run those too.

## Manual verification

1. Start request on WhatsApp.
2. Continue in PWA.
3. Upload photos in PWA.
4. Capture address in PWA.
5. Submit request.
6. Receive WhatsApp confirmation.
7. Open matching status from WhatsApp.
8. Generate provider responses.
9. Open shortlist from WhatsApp.
10. View provider profile.
11. Select provider.
12. Wait for provider acceptance.
13. Track job.
14. Complete and review.

## Acceptance criteria

- Full client journey works WhatsApp-first.
- Full client journey works PWA-first.
- Old WhatsApp links resolve current state.
- Privacy rules are enforced.
- Tests pass.
- Execution index completed.

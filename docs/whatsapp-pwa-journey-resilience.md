# WhatsApp and PWA journey resilience

Plug A Pro journeys must not fail silently or reset unexpectedly.

Core user rule:
- The user must know what happened.
- The user must know whether progress was saved.
- The user must get a clear next action.
- The user must be able to recover without losing safe progress.

## Central model

Use `field-service/lib/journey-recovery.ts` for journey failures.

Failure types include validation errors, missing input, invalid selection, stale action, expired session, state mismatch, dependency failure, database failure, storage failure, media processing failure, matching failure, no results, permission denied, rate limited, external service failure, and unexpected error.

Recovery classes include retry same step, resume step, show status, return main menu, start again, contact support, manual review, and wait and notify.

## State rules

- Preserve state by default.
- Clear state only when the user explicitly cancels/exits or when the recovery class is unrecoverable.
- Active flows beat generic greetings and menus.
- Stale buttons must not mutate data; they should resume the latest safe step.
- Duplicate WhatsApp webhooks must be idempotent through WAMID logging or flow-specific idempotency keys.

## Step matrix

Customer street address:
- Positive: save free text and continue to province/city/suburb.
- Invalid input: ask for the street address again with an example.
- Backend failure: preserve the address step and ask retry.
- Stale greeting: show active-flow resume actions.
- Cancellation: close the request flow only when the user confirms.

Customer photos:
- Positive: save image attachments and continue.
- Invalid document: ask for an image or allow skip.
- Storage failure: preserve the photo step and ask retry/skip.
- Duplicate media: reuse stored attachment or ignore safely.

Customer status:
- Positive: show latest request status.
- No providers: explain that matching is still checking.
- Request not found: offer new request and main menu.
- Dependency failure: tell the user the request is saved and offer refresh.

Provider onboarding:
- Positive: save each completed answer.
- Media failure: preserve the current upload step and offer retry/skip.
- Stale greeting: resume provider application, do not reset.
- Cancellation: close only when explicit.

Provider jobs and credits:
- Positive: mutate job/credit state once.
- Duplicate accept: return existing accepted/unlocked state.
- Insufficient credits: explain the balance requirement and offer top-up.
- Stale job action: do not mutate; show latest job/status.

PWA journeys:
- User-facing errors should use the same taxonomy and copy rules.
- Technical details belong in logs; trace IDs may be shown only as short support references.
- Do not expose raw URLs, internal enum values, OTPs, document numbers, private media URLs, or full phone numbers.

## Logging

Every recovery should log:
- trace id
- user role
- channel
- flow name
- step
- failure type
- recovery class
- request/application/job id where available
- action/message id where available
- whether state was preserved

Never log broad sensitive data such as full addresses, OTPs, full phone numbers, tokens, private media URLs, or identity numbers.

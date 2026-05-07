# 15 — Provider Notifications, Copy, and URL Rules

## Task

Align provider WhatsApp copy, PWA copy, and URL generation to the WhatsApp-complete provider journey.

## Required provider messages

```text
provider onboarding intro
application submitted
more info required
application approved
application rejected
credit balance
new opportunity preview
interest submitted
customer selected you
job accepted
insufficient credits
job unavailable
arrival confirmed
on the way confirmation
arrived confirmation
job completed
help/menu
```

## Copy rules

Make credit rules clear:

```text
No credits are used for previewing or saying you are interested.
1 credit is used only when you accept a customer-selected job.
```

Make PWA optional:

```text
You can continue here on WhatsApp. You can also open the Worker Portal for more details.
```

## URL rules

Production base URL:

```text
https://app.plugapro.co.za
```

No production message may include:

```text
localhost
127.0.0.1
```

Use central public URL helper.

## Implementation requirements

1. Audit all provider WhatsApp templates.
2. Update copy to align with WhatsApp-complete journey.
3. Ensure every PWA link is optional.
4. Ensure links use production public URL helper.
5. Add tests to prevent localhost in production templates.
6. Add tests for key message content.

## Acceptance criteria

- Provider messages are clear.
- PWA is not presented as mandatory for core actions.
- Credit rules are clear.
- No localhost in production messages.
- Tests pass.

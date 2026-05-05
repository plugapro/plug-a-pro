# 11 — Client PWA Notifications, Copy, and URL Rules

## Task

Align WhatsApp messages, PWA screen copy, and URL generation for the Client PWA journey.

## Why

WhatsApp is the primary communication channel. PWA links from WhatsApp must open the right screen and use production URLs.

## Required client messages

```text
request started
continue request
add photos/details
request submitted
matching in progress
providers reviewing
shortlist ready
provider selected
provider accepted
arrival confirmed
provider on the way
provider arrived
job completed
review requested
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

## Copy rules

Use simple customer language.

Explain trust clearly:

```text
Your exact address and phone number are only shared after you select a provider and that provider accepts the job.
```

Explain shortlist clearly:

```text
You can compare providers before choosing.
```

## Implementation requirements

1. Audit all client WhatsApp templates.
2. Update message copy to align with journey.
3. Ensure every link uses public URL helper.
4. Ensure link intent maps to PWA handoff resolver.
5. Add tests for URL generation.
6. Add tests to prevent localhost in production templates.

## Acceptance criteria

- Client WhatsApp messages align with PWA journey.
- Links open correct PWA states.
- No localhost in production messages.
- Tests pass.

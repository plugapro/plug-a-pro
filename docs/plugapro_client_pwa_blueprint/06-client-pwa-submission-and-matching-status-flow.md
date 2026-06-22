# 06 — Client PWA Submission and Matching Status Flow

## Task

Implement or align request submission and matching-status screens in the Client PWA.

## Flow

```text
review request
↓
submit request
↓
request status = submitted
↓
matching starts
↓
request status = matching
↓
providers invited
↓
request status = awaiting_provider_responses
```

## Screens

### Request submitted

```text
Request submitted

We’ve received your {{category}} request in {{suburb}}, {{city}}.

We’re checking suitable providers in your area.
```

### Matching progress

```text
We match based on:
- service type
- area
- availability
- experience
- rate
- verification level
```

### Providers reviewing

```text
Suitable providers are reviewing your request.
We’ll notify you when your shortlist is ready.
```

## WhatsApp handoff

After PWA submission, WhatsApp should send confirmation.

When customer opens the WhatsApp request link, PWA should show current status.

## Implementation requirements

1. Validate request before submit.
2. Prevent duplicate submissions.
3. Trigger matching once.
4. Show status based on backend state.
5. Poll or refresh status where appropriate.
6. Provide cancel/help actions if allowed.
7. Send WhatsApp confirmation through existing notification system.
8. Add tests.

## Acceptance criteria

- Request submits successfully.
- Matching starts once.
- Client sees matching/progress state.
- WhatsApp confirmation sent.
- Duplicate submit handled idempotently.
- Tests pass.

# 09 — Client PWA Exception and Recovery States

## Task

Implement or align exceptional states in the Client PWA.

## Required states

### No providers found

```text
We could not find enough suitable providers yet.

You can:
- change your preferred time
- expand your area
- request manual assistance
- cancel the request
```

### Provider responses timed out

```text
We’re still waiting for provider responses.

You can keep waiting, adjust your request, or ask us for help.
```

### Selected provider declined or did not confirm

```text
The selected provider could not confirm this job.

You can choose another provider from your shortlist.
```

### Request cancelled

```text
Request cancelled

You can start a new request anytime.
```

### Link expired or invalid

```text
This link is no longer valid.

Please open the latest WhatsApp message or request a new link.
```

### Unauthorized access

```text
We could not verify access to this request.

Please use the link sent to you on WhatsApp or sign in.
```

## Implementation requirements

1. Add clear recovery actions.
2. Do not show generic errors for known states.
3. Do not leak protected data in error states.
4. Ensure WhatsApp and PWA copy are consistent.
5. Add trace ID for support where appropriate.
6. Add tests.

## Acceptance criteria

- Known exception states have controlled UI.
- Customer can recover or contact support.
- Invalid token handled safely.
- Unauthorized access handled safely.
- Tests pass.

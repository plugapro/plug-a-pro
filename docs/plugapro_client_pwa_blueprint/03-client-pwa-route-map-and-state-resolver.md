# 03 — Client PWA Route Map and State Resolver

## Task

Create or align the Client PWA route map and state resolver so every client route renders the correct screen based on backend state.

## Recommended routes

Use existing conventions if they differ, but support these route intents:

```text
/client
/client/new-request
/client/requests
/client/requests/:requestId
/client/requests/:requestId/matching
/client/requests/:requestId/shortlist
/client/requests/:requestId/providers/:providerId
/client/requests/:requestId/selected
/client/jobs/:jobId
/client/jobs/:jobId/status
/client/jobs/:jobId/review
```

Secure WhatsApp entry routes may include:

```text
/r/:secureToken
/ticket/:secureToken
/client/request/:secureToken
/client/handoff/:secureToken
```

## State resolver

Implement or update a resolver like:

```text
resolveClientPwaDestination({ token, requestId, jobId, intendedScreen })
```

It should return:

```text
screen
route
request
job
allowedActions
accessLevel
reason
```

## State-to-screen mapping

| State | Screen |
|---|---|
| no active request | client home |
| draft | request form current step |
| submitted | request submitted |
| matching | matching progress |
| awaiting_provider_responses | providers reviewing |
| shortlist_ready | shortlist |
| customer_selection_pending | shortlist |
| provider_confirmation_pending | waiting for provider confirmation |
| assigned | job confirmed / tracking |
| scheduled | job tracking |
| in_progress | active job |
| completed | completion / review |
| cancelled | cancelled |
| expired | expired |

## Implementation requirements

1. Use existing request/job statuses where possible.
2. Do not duplicate routing logic in every page.
3. Centralize state-to-screen mapping.
4. Ensure secure token access is enforced server-side.
5. Ensure client can resume draft from WhatsApp handoff.
6. Ensure old links resolve current state.
7. Add tests.

## Acceptance criteria

- Route resolver exists.
- All client PWA routes use or align to resolver.
- Stale WhatsApp links route correctly.
- Invalid/expired token handled safely.
- Tests pass.

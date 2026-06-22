# 13 — Provider PWA Routes and Handoff Flow

## Task

Implement or align provider PWA routes and handoff so PWA is optional but useful.

## Suggested routes

```text
/provider
/provider/apply
/provider/application
/provider/dashboard
/provider/credits
/provider/credits/history
/provider/profile
/provider/profile/services
/provider/profile/areas
/provider/profile/availability
/provider/profile/rates
/provider/opportunities
/provider/opportunities/:leadInviteId
/provider/jobs
/provider/jobs/:jobId
/provider/jobs/:jobId/arrival
/provider/jobs/:jobId/execute
/provider/jobs/:jobId/complete
```

Secure WhatsApp routes:

```text
/provider/handoff/:secureToken
/provider/lead/:secureToken
/provider/job/:secureToken
```

## Handoff map

| WhatsApp event | PWA destination |
|---|---|
| Start application | Application form |
| Continue application | Current application step |
| More info required | Missing info screen |
| Application approved | Dashboard |
| New opportunity | Lead preview |
| Customer selected you | Accept job screen |
| Job accepted | Job detail |
| Confirm arrival | Arrival confirmation |
| Complete job | Completion screen |
| Credits low | Credits screen |

## State-aware rule

Old WhatsApp links must resolve current state.

Example:

```text
Provider opens old opportunity link
Job is already accepted
PWA shows accepted job detail, not stale opportunity preview
```

## Implementation requirements

1. Reuse existing Worker Portal routes.
2. Add state-aware handoff resolver if missing.
3. Ensure secure tokens are scoped.
4. Ensure PWA is optional and mirrors WhatsApp state.
5. Add tests.

## Acceptance criteria

- Provider PWA routes resolve correctly.
- Old links show current state.
- PWA does not create separate state.
- Tests pass.

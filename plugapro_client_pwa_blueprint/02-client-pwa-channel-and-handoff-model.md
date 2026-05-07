# 02 — Client PWA Channel and Handoff Model

## Task

Implement or document the channel orchestration model between WhatsApp and the Client PWA.

## Why

The journey starts primarily on WhatsApp. The PWA is used for richer screens where WhatsApp is limited. The two channels must operate from one shared backend state.

## Required model

```text
WhatsApp starts / prompts / confirms / reminds
PWA captures rich details / shows shortlist / tracks job
Backend owns state
WhatsApp and PWA both read from backend state
```

## Handoff map

| WhatsApp message | PWA destination intent |
|---|---|
| Start request | request creation |
| Continue request | current draft step |
| Add photos | photo upload step |
| Add address/details | address/details step |
| Review request | review and submit |
| Request submitted | matching status |
| Providers reviewing | provider response pending |
| Shortlist ready | shortlist |
| View provider profile | provider profile |
| Provider selected | waiting for provider confirmation |
| Provider accepted | job tracking |
| Arrival confirmed | job tracking |
| Job completed | completion/review |

## Implementation requirements

1. Create or update a shared handoff resolver.
2. The resolver must accept a secure token or request reference and determine the correct PWA destination by current backend state.
3. Do not rely only on the original link intent.
4. If the original link is stale, route to the current correct screen.
5. Add a clear fallback for invalid or expired links.
6. Ensure PWA pages can be opened from WhatsApp in-app browser.
7. Ensure links use the public production URL helper.
8. Add tests for stale links resolving correctly.

## Example behaviour

```text
Link intent: shortlist
Current request status: assigned
Expected PWA screen: job tracking
```

```text
Link intent: request_form
Current request status: draft
Expected PWA screen: current draft step
```

## Acceptance criteria

- WhatsApp handoff uses one resolver.
- Resolver is state-aware.
- Stale links do not show stale screens.
- Invalid links show controlled recovery.
- Production URLs do not contain localhost.
- Tests cover state-based redirects.

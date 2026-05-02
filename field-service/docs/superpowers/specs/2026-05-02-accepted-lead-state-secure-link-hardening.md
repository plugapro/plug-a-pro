# Accepted lead state and secure link hardening

Date: 2026-05-02

## Context

Providers can accept a lead from WhatsApp and then reopen the original secure `View Lead` URL. The accepted page must stop treating that lead as an expiring offer and must allow assigned-provider post-acceptance actions through the same signed link.

## Implementation notes

- Accepted jobs keep the historical `expiresAt` value for audit and matching history, so UI must not use `expiresAt` alone as an active-offer signal.
- The signed lead page now calculates one response gate: `canRespondToLead = (SENT or VIEWED) && !isExpired`.
- The expiry countdown, accept confirmation, top-up prompt, back-to-preview, and decline action now render only when `canRespondToLead` is true.
- Explicit `EXPIRED` lead status is treated as closed even if `expiresAt` is absent or stale.
- The original WhatsApp invite token with lead-response scopes may pass the pre-check for accepted-job actions, but final authorization still resolves the token against the accepted lead, assigned provider, active provider, and match relationship before any write.

## Decisions

- Do not clear `expiresAt` on acceptance. It remains useful as a historical offer deadline.
- Do not mint a new accepted-job token as a prerequisite for providers who already have the WhatsApp link. The resolver is the source of truth for whether that token belongs to the accepted provider.
- Keep closed states conservative: expired, declined, and accepted leads cannot be accepted again from the PWA form path.

## Validation

- Added source-level regression coverage so countdown and response actions stay tied to `canRespondToLead` rather than raw `expiresAt`.
- Existing accepted-job action tests cover the original WhatsApp invite token reaching the resolver and tampered tokens being rejected before database writes.

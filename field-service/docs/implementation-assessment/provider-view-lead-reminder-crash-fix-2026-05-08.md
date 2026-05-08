# Provider View Lead reminder crash fix (2026-05-08)

## Summary
A production provider could open a WhatsApp reminder link (`View Lead`) and hit the generic app crash page (`Something went wrong`, digest-style Error ID).

## Root cause
Two reliability gaps combined into an unhandled failure path:
1. Lead-link verification depended on signing-secret resolution that could throw during token verification when environment secret wiring was incomplete for that runtime context.
2. Reminder sends could still target near-expiry offers, producing stale links and poor click-time behavior (`0 min left`) even when the lead was effectively closing.

## Remediation shipped
- Hardened `verifyProviderLeadAccessToken` to return `invalid` with reason `SIGNING_SECRET_MISSING` instead of throwing.
- Added invalid-reason plumbing in `resolveProviderLeadAccessToken` so callers can render specific closed states.
- Hardened `/leads/access/[token]` to catch token/session/wallet lookup failures and render safe user-facing states instead of bubbling to the generic app crash boundary.
- Added structured observability fields on link open (`trace_id`, `token_hash`, status/reason, lead/provider refs) without logging secrets.
- Guarded reminder selection to active providers + active requests only.
- Updated reminder countdown rendering to avoid `0 min left`; uses `expires soon` for sub-minute windows.

## Privacy and credit rules
- No customer phone/exact address is exposed before accepted unlock.
- Reminder and preview flows remain non-mutating for credit balance until acceptance paths.

## Tests
- `__tests__/lib/provider-lead-access.test.ts`
  - missing-signing-secret verification path returns safe invalid result.
  - inactive-provider reason stays explicit.
- `__tests__/lib/matching-engine.test.ts`
  - reminder copy handles near-expiry without `0 min left`.
  - reminder query enforces active-provider + active-request guards.

## OpenBrain note
Provider WhatsApp `View Lead` links now fail closed with explicit states (invalid, expired, unavailable, inactive/setup issue) and no generic crash fallback for expected lead/token conditions. Reminder dispatch now avoids stale/ineligible sends and uses expiry-safe copy.

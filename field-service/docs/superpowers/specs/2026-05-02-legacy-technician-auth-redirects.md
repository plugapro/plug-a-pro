# Legacy technician auth redirects

Date: 2026-05-02

## Context

The canonical Worker Portal OTP flow is `/provider-sign-in` and `/provider-verify`, backed by the server-side provider lookup and access checks in the provider OTP API. The legacy `/technician-sign-in` and `/technician-verify` pages still used the older browser-direct Supabase OTP flow and checked `user_metadata.role`.

## Root cause

Approved provider accounts can exist without reliable Supabase `user_metadata.role = provider`. When a provider landed on `/technician-verify` from a bookmark, cached tab, or legacy link, the old client-side verification path accepted the OTP but then rejected the user with the misleading “provider account hasn’t been approved yet” message.

## Implementation notes

- `/technician-sign-in` now performs a server-side redirect to `/provider-sign-in`.
- `/technician-verify` now performs a server-side redirect to `/provider-verify`.
- Legacy query parameters are preserved, including repeated parameters.
- The old browser-direct Supabase OTP calls and metadata-role approval gate were removed from the legacy pages.
- Proxy comments were updated to document the canonical provider OTP routes and legacy bounce behavior.

## Decisions

- Do not maintain two provider OTP implementations. All provider OTP verification must flow through `/api/auth/provider/verify-code`.
- Do not rely on Supabase auth metadata as the approval source of truth for Worker Portal access.
- Keep `/technician/*` protected application routes for backward compatibility, but route legacy auth entry points to `/provider-*`.

## Validation

- Added regression coverage for the legacy auth redirects and query preservation.
- Kept phone-normalization coverage focused on the active customer and provider sign-in pages.

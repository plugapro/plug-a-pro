# Worker Portal OTP Provider Resolution

**Date:** 2026-05-02
**Project:** Plug A Pro — field-service
**Status:** Implemented

This note records the Worker Portal OTP login hardening for approved providers whose Supabase OTP identity was not linked to the provider profile created during onboarding approval.

## Root Cause

Worker Portal OTP send-code validated the provider row by normalized phone before sending an OTP, but provider verify ran in the browser and trusted Supabase `user_metadata.role === "provider"` after OTP verification. If approval failed to create or stamp the Supabase auth identity, or if an existing OTP identity lacked provider metadata, the approved provider was treated as unapproved after entering a valid OTP.

Provider dashboard pages also resolve provider data by `providers.userId`, so approved provider records without a linked auth user could not reliably reach `/provider` even when the phone number was approved.

## Canonical Modules

- `lib/worker-provider-auth.ts`: canonical Worker Portal provider resolution, status checks, verify error messages, and structured decision logs.
- `app/api/auth/provider/send-code/route.ts`: phone normalization and pre-OTP Worker Portal access check.
- `app/api/auth/provider/verify-code/route.ts`: server-side OTP verification, provider resolution, first-login link repair, metadata stamping, and session cookie creation.
- `lib/auth.ts`: server route guard resolves provider access from DB links, not only Supabase metadata.
- `proxy.ts`: middleware/provider route guard uses the same Worker Portal access predicate.

## Decision Contract

The verify endpoint returns explicit codes:

```text
INVALID_OTP
OTP_EXPIRED
OTP_PROVIDER_REJECTED
WORKER_NOT_FOUND
WORKER_NOT_APPROVED
WORKER_INACTIVE
WORKER_AUTH_IDENTITY_MISSING
WORKER_ROLE_MISSING
WORKER_PROFILE_LINK_MISSING
DUPLICATE_WORKER_PROFILE
AUTH_SESSION_MISSING
UNKNOWN_WORKER_VERIFY_ERROR
```

Approved Worker Portal access requires:

- `Provider.status === ACTIVE`
- `Provider.active === true`
- `Provider.verified === true`
- OTP auth user linked to the selected provider by `Provider.userId`

Pending provider states return `WORKER_NOT_APPROVED`; suspended, banned, archived, inactive, or unverified states return `WORKER_INACTIVE`.

## Data Remediation

`scripts/audit-repair-provider-portal-access.ts` audits approved provider applications, matching provider profiles, Supabase auth users, provider links, and metadata. It is dry-run by default and repairs only non-sensitive links in `--commit` mode:

- `ProviderApplication.providerId`
- `Provider.userId`
- Supabase user metadata role/providerId when a matching phone auth identity already exists

The script does not create duplicate provider profiles or auto-approve pending providers.

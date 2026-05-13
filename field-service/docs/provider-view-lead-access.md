# Provider View Lead Access

Provider WhatsApp `View lead` buttons use signed `/leads/access/[token]` links. The token grants the invited provider access to the safe request preview without requiring an existing Worker Portal browser session.

## Access Model

The signed token is valid when it maps to:

- the invited lead id
- the invited provider id
- the request id when present
- the provider phone hash when present
- lead-response scopes: `view_lead`, `accept_lead`, `decline_lead`
- a future expiry time

The lead preview route authorizes against the lead/request/provider invitation context. It must not require a confirmed `Job` or `Match` before final provider acceptance.

## Viewable States

The lead preview is viewable when the lead is in a response state such as `SEND_PENDING`, `SENT`, `VIEWED`, or `CUSTOMER_SELECTED`, and the lead response deadline has not passed.

Closed states render recovery pages:

- expired lead or expired token: `JOB_LINK_EXPIRED`
- declined/already responded: already-responded copy with `JOB_LINK_INVALID`
- provider mismatch, request mismatch, missing lead, cancelled match: invalid/unavailable link copy with an internal denial reason in logs

Use `JOB_ACCESS_DENIED` only for real authorization mismatches. Normal stale or expired links should not show a generic access-denied state.

## Privacy Rules

Before final acceptance and credit application, the page may show only safe preview data:

- service category
- suburb/city/province
- preferred availability
- urgency/request summary
- safe preview attachments
- response deadline and credit rule

Do not show customer phone, exact street/unit/access notes, private media URLs, or full address before the selected provider has completed final acceptance and the lead unlock exists.

## Root Cause: 2026-05-13 Lovemore Link Failure

Lovemore's signed token for Sarah request `PAP-3359B631` verified correctly, but `/leads/access/[token]` threw before authorization completed. The resolver queried `unlock: true`, which asked Prisma for every `lead_unlocks` column. Production migration history showed `20260429130000_paid_lead_unlocks` as applied, but the live `lead_unlocks` table still had the older shape and was missing newer columns such as `matchId` and `creditsCharged`.

That database schema drift caused Prisma `P2022` exceptions and the route showed the generic load failure screen. The fix is to keep pre-acceptance View Lead resolution independent of `lead_unlocks`. Unlock data is now looked up separately only after the lead is already accepted.

## Troubleshooting

When a View Lead link fails, logs must include:

- route `/leads/access/[token]`
- token hash, never the token value
- token status and internal reason
- lead id and provider id when available
- denial reason such as `provider_mismatch`, `job_request_mismatch`, `lead_expired`, `match_cancelled`, or `lead_access_resolution_exception`

Never log full phone numbers, signed token values, OTPs, exact customer address, access notes, or private attachment URLs.

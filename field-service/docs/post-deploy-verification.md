# Post-Deploy Verification

This checklist covers the structured location rollout, provider skills multi-select, progressive address capture, photo-first evidence uploads, signed one-ticket access, and the attachment proxy token path.

Run this after deploy in the order listed below.

## Recommended Execution Order

1. Migrations and schema verification
2. Backfill and idempotency re-run
3. Public/auth path checks
4. Signed ticket access and attachment proxy
5. Evidence upload and completion enforcement
6. Provider skills and progressive address flow
7. Locations admin and matching/backfill spot checks

## 0. Pre-Deploy

- Confirm `prisma migrate deploy` ran cleanly.
- Verify migration `20260415123000_ticket_access_and_attachment_caption` appears in the migration log.
- Confirm `job_requests` has:
  - `customerAccessToken`
  - `customerAccessTokenExpiresAt`
  - `customerAccessTokenRevokedAt`
- Confirm `attachments.caption` exists.
- Run backfill:

```bash
pnpm tsx scripts/backfill-location-nodes.ts
```

- Record:
  - Phase A resolved address count
  - Phase A unresolved address count
  - Phase B provider area writes
- Re-run the script once and confirm the second run produces `0` updates.

## 1. Auth and Public Paths

- `/requests/access/[any-token]` returns `200` without a session cookie and is not redirected to sign-in.
- `/api/health` returns `200` without a session cookie.
- `/admin` without a session redirects to `/admin-sign-in`.
- `/provider` without a session redirects to `/provider-sign-in`.

## 2. Signed Ticket Access — Happy Path

- Submit a booking via the app and confirm `customerAccessToken` is written to `job_requests`.
- Open the signed ticket URL and confirm the page renders without login.
- Confirm work photos render on the page.
- Confirm the browser network request for each rendered image is `/api/attachments/:id?token=...`, not a direct blob URL.
- Confirm the image request returns `200` with `Content-Type: image/*`.
- Confirm caption and label display correctly on photos, with fallback to `label` when `caption` is null.
- Confirm address, provider info, and quote summary display.

## 3. Signed Ticket Access — Failure Paths

- Expired token:
  - manually set `customerAccessTokenExpiresAt` to the past
  - confirm the page shows `This ticket link has expired`
  - confirm sign-in CTA is present
  - confirm WhatsApp resend guidance is present
- Invalid token:
  - request `/requests/access/notarealtoken`
  - confirm an invalid-link state renders instead of a `500`
- Revoked token:
  - set `customerAccessTokenRevokedAt` to a timestamp
  - confirm the same rejection behavior as expired

## 4. Attachment Proxy — Token Path

- Valid token and matching `jobRequestId` returns `200` and serves the photo.
- Valid token with mismatched `jobRequestId` returns `403`.
- Expired token returns `401` with a token-specific error, not a generic session error.
- No session and no token returns `401 Unauthorized`.

## 5. Evidence Uploads

- Provider uploads a single photo through `file` and it is stored.
- Provider uploads multiple photos through `files[]` and all are stored.
- API response includes `proxyUrl` values.
- Caption is saved correctly.
- Empty-string caption is stored as `null`.
- Non-image file such as PDF or text returns `400`.
- File larger than `10 MB` returns `400`.
- Photos are visible to customers on booking detail.
- Photos are visible to admins on booking detail.

## 6. Photo Enforcement on Job Completion

- Provider attempts to set status to `PENDING_COMPLETION_CONFIRMATION` with zero photos and receives `422` with:
  - `Add at least one work photo before marking the job complete.`
- Provider uploads at least one photo and then sets `PENDING_COMPLETION_CONFIRMATION` successfully.
- Other status transitions such as `EN_ROUTE`, `STARTED`, and `PAUSED` still work with zero photos.

## 7. Provider Skills

- Provider profile page renders `SkillPicker` with existing selections pre-checked.
- Save persists selections to `TechnicianSkill` rows.
- Save updates the `Provider.skills` compatibility cache.
- Reload the profile page and confirm selections rehydrate from persisted data, not only the cache.
- WhatsApp registration accepts `1,3,5` style input.
- WhatsApp registration shows selected skills for review before final submit.

## 8. Progressive Address Capture

- Booking flow requires province before region/suburb selection.
- Booking flow requires region/suburb selection before street address entry.
- Structured path resolves and writes `locationNodeId` on the job request.
- Manual fallback path for estates, complexes, informal areas, or lookup gaps completes without `locationNodeId`.
- `create-job-request.ts` suburb resolution does not block submission when node resolution fails.

## 9. Location Taxonomy (Admin)

- Locations admin page loads.
- Nodes are listed and grouped by type.
- Create node form saves a valid node and the node appears in the table.
- Inline label edit updates the table after submit.
- Deactivate changes an active node to an inactive badge/state.
- Delete is blocked when the node has children or active references.

## 10. Matching and Backfill

- `TechnicianServiceArea` rows exist for providers that previously had legacy `serviceAreas[]` strings.
- REGION nodes produce `areaType = 'REGION'` and `suburbKey = null`.
- SUBURB nodes produce `areaType = 'SUBURB'` and non-null `suburbKey`.
- `Address.locationNodeId` is populated for addresses with resolvable suburbs.

## High-Risk Edge Cases

- `allowLegacyStringFallback` should remain `true` in this deploy.
- Flip it in a separate deploy only after backfill results are reviewed.
- Token-backed attachment responses currently use `Cache-Control: private, max-age=300`.
- A revoked token may still be served from browser cache for up to 5 minutes.
- This is acceptable for MVP, but any future hard-revocation requirement should move token-backed attachment responses to `no-store`.
- If unresolved Phase A or Phase B backfill counts exceed the expected threshold, investigate before disabling legacy fallback.

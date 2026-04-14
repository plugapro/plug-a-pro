# Vercel Production Auto-Matching Verification Checklist

## Purpose

This checklist is for an operator who has:

- Vercel dashboard access
- production database access
- optional WhatsApp / Meta delivery visibility

Its purpose is to confirm whether Plug-A-Pro auto-matching is actually firing successfully in production, not just whether the code exists.

## Scope Being Verified

Auto-matching in production has three moving parts:

1. A customer request is created as an `OPEN` job request.
2. The app immediately tries to dispatch leads.
3. Vercel Cron retries unmatched requests through `/api/cron/match-leads`.

Production success means all three are working end to end.

## Known Implementation Points

- Cron route: [field-service/app/api/cron/match-leads/route.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/app/api/cron/match-leads/route.ts#L1)
- Cron schedule: [field-service/vercel.json](/Users/shimane/Projects/Plug-A-Pro/field-service/vercel.json#L1)
- Immediate dispatch on request submit: [field-service/lib/whatsapp-flows/job-request.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-flows/job-request.ts#L326)
- Matching logic: [field-service/lib/matching-engine.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/matching-engine.ts#L1)
- Lead notification message: [field-service/lib/whatsapp-bot.ts](/Users/shimane/Projects/Plug-A-Pro/field-service/lib/whatsapp-bot.ts#L483)
- Matching-related schema: [field-service/prisma/schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L155)

## Vercel Verification Checklist

### 1. Confirm the cron route is in the current production deployment

In Vercel:

- Open project `plug-a-pro`
- Open the latest `production` deployment
- Check build output or route list
- Confirm `/api/cron/match-leads` appears in the deployed routes

Pass condition:

- Route exists in the currently active production deployment

Fail condition:

- Route missing from the active production deployment

### 2. Confirm cron is configured and attached to production

In Vercel:

- Open project settings
- Open cron configuration
- Confirm `/api/cron/match-leads` exists
- Confirm schedule is `*/30 7-20 * * *`

Pass condition:

- Cron is configured for the production project with the expected schedule

Fail condition:

- Cron missing, disabled, or pointing to the wrong path

### 3. Confirm required production environment variables exist

Check at minimum:

- `CRON_SECRET`
- `NEXT_PUBLIC_APP_URL`
- database connection variables used by the app
- WhatsApp credentials used by outbound messaging
- `ADMIN_WHATSAPP_NUMBER` if unmatched-job alerting is expected

Pass condition:

- All required values exist in production

Fail condition:

- `CRON_SECRET` missing or blank
- app URL incorrect
- WhatsApp credentials absent

### 4. Confirm cron runtime executions are actually happening

In Vercel runtime logs, filter for:

- `/api/cron/match-leads`
- `cron/match-leads:`
- `Unauthorized`
- `Error expiring leads`
- `Error expiring quotes`
- `Error dispatching job`
- `No providers for job`

Expected successful log signature:

- request reaches `/api/cron/match-leads`
- response status is `200`
- console output similar to:
  - `[cron/match-leads:<id>] { dispatched: X, expired: Y, expiredQuotes: Z, noMatch: A, errors: 0 }`

Known failure signatures:

- `401 Unauthorized`
  - usually wrong or missing `CRON_SECRET`
- repeated `errors > 0`
  - cron is firing, but internal matching work is failing
- no cron hits at all
  - cron config or project linkage issue

### 5. Confirm immediate dispatch is also happening

This is separate from cron.

In runtime logs, look for:

- `[job-request] No providers found for <jobRequestId> — cron will retry`
- `[job-request] Matching error:`

Pass condition:

- new requests trigger immediate matching attempts

Fail condition:

- requests are created but no immediate dispatch path runs

## Database Evidence Path

## Core Tables To Inspect

### `job_requests`

Defined in [schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L155)

Key fields:

- `id`
- `category`
- `status`
- `createdAt`
- `updatedAt`

Relevant statuses:

- `OPEN`
- `MATCHING`
- `MATCHED`
- `EXPIRED`
- `CANCELLED`

### `leads`

Defined in [schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L180)

Key fields:

- `jobRequestId`
- `providerId`
- `status`
- `sentAt`
- `respondedAt`
- `expiresAt`

Relevant statuses:

- `SENT`
- `VIEWED`
- `ACCEPTED`
- `DECLINED`
- `EXPIRED`

### `matches`

Defined in [schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L199)

Key fields:

- `jobRequestId`
- `providerId`
- `status`
- `inspectionNeeded`
- `createdAt`

Relevant statuses:

- `MATCHED`
- `INSPECTION_SCHEDULED`
- `INSPECTION_COMPLETE`
- `QUOTED`
- `QUOTE_APPROVED`
- `QUOTE_DECLINED`
- `CANCELLED`

### `message_events`

Defined in [schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L467)

Purpose:

- evidence that WhatsApp messages were attempted and whether delivery/read receipts came back

Key fields:

- `to`
- `channel`
- `direction`
- `body`
- `externalId`
- `status`
- `sentAt`
- `deliveredAt`
- `readAt`
- `failureReason`

### `inbound_whatsapp_messages`

Defined in [schema.prisma](/Users/shimane/Projects/Plug-A-Pro/field-service/prisma/schema.prisma#L491)

Purpose:

- evidence that inbound provider/customer responses are hitting the webhook and being processed

Key fields:

- `externalId`
- `phone`
- `body`
- `processedAt`
- `failureReason`
- `duplicateCount`

## Expected Record Flow For A Healthy Match

### Scenario A: immediate dispatch succeeds

Expected record sequence:

1. `job_requests`
   - new row created
   - status starts as `OPEN`
2. `leads`
   - one to three rows created or reset to `SENT`
   - `sentAt` populated
   - `expiresAt` about 4 hours later
3. `job_requests`
   - status becomes `MATCHING`
4. provider accepts
5. `leads`
   - accepted row becomes `ACCEPTED`
   - competing live rows become `EXPIRED`
6. `matches`
   - row created for the accepted provider
7. `job_requests`
   - status becomes `MATCHED`

### Scenario B: immediate dispatch finds nobody, cron later retries

Expected record sequence:

1. `job_requests`
   - row created as `OPEN`
2. no lead rows created immediately, or no active lead remains
3. cron later runs
4. `leads`
   - one or more `SENT` rows appear
5. `job_requests`
   - status becomes `MATCHING`
6. later either:
   - provider accepts and a `matches` row is created
   - all leads expire or are declined, and `job_requests.status` returns to `OPEN`

## Exact DB Checks To Run

These are the records to inspect for a recent production request.

### Check 1: are recent requests entering the pipeline?

Look for recent rows in `job_requests` with:

- `status IN ('OPEN', 'MATCHING', 'MATCHED')`
- `createdAt` within the last 24 hours

Healthy sign:

- fresh requests are appearing continuously

### Check 2: are leads being created for recent requests?

For a recent `jobRequestId`, inspect `leads`.

Healthy sign:

- at least one lead row appears after request creation
- `sentAt` is populated
- `expiresAt` is populated

Problem sign:

- request remains `OPEN` with zero lead rows for too long

### Check 3: are requests transitioning correctly?

For a sample of recent requests:

- `OPEN` should move to `MATCHING` when leads are sent
- `MATCHING` should move to `MATCHED` when one provider accepts
- `MATCHING` with only expired/declined leads should eventually return to `OPEN`

Problem sign:

- request is stuck in `MATCHING` but has no active `SENT` or `VIEWED` leads
- request is `MATCHED` but has no row in `matches`

### Check 4: are provider responses being captured?

Inspect `leads` and `inbound_whatsapp_messages`.

Healthy sign:

- accepted leads have `respondedAt`
- declines have `respondedAt`
- inbound WhatsApp rows show `processedAt` populated

Problem sign:

- inbound WhatsApp records accumulate with `failureReason`
- leads stay `SENT` until expiry despite known provider responses

### Check 5: are WhatsApp lead messages actually being attempted?

Inspect `message_events` around the same time as lead creation.

Healthy sign:

- outbound WhatsApp rows exist to the provider phone
- `status` progresses to `SENT`, `DELIVERED`, or `READ`

Problem sign:

- leads are created but no matching outbound message evidence exists
- many WhatsApp messages have `FAILED`

### Check 6: are unmatched requests being surfaced?

Cron should notify admin when requests remain `OPEN` for over 1 hour.

Healthy sign:

- long-open requests are rare
- if present, matching logs show `noMatch`
- optional admin WhatsApp alerts exist if configured

Problem sign:

- many requests older than 1 hour remain `OPEN`
- no operator alerting exists in logs or WhatsApp

## High-Signal Failure Patterns

### Failure Pattern 1: cron is not firing

Evidence:

- no runtime log entries for `/api/cron/match-leads`
- requests remain `OPEN`
- no lead creation after submission unless immediate dispatch succeeds

Likely causes:

- missing cron config
- wrong Vercel project
- cron disabled

### Failure Pattern 2: cron fires but is unauthorized

Evidence:

- runtime logs show `401`
- no leads created by cron

Likely cause:

- `CRON_SECRET` mismatch or missing header validation issue

### Failure Pattern 3: dispatch fires but no candidates are eligible

Evidence:

- logs show `No providers for job`
- requests stay `OPEN`
- no `leads` rows created

Likely causes:

- provider pool too small
- providers not `active`
- providers not `availableNow`
- providers not `verified` for internal marketplace eligibility
- category or service area mismatch

### Failure Pattern 4: leads are created but providers never receive or respond

Evidence:

- `leads.status = SENT`
- `message_events` missing or failing
- all leads expire after 4 hours

Likely causes:

- WhatsApp delivery issue
- provider phone mismatch
- provider not monitoring WhatsApp

### Failure Pattern 5: providers respond but matches do not form

Evidence:

- inbound WhatsApp records exist
- no `matches` row created
- lead rows remain in unexpected states

Likely causes:

- webhook processing issue
- lead already taken / race handling
- accept flow error

## Practical SQL Checks

These are example SQL checks for a production operator.

### Recent job requests

```sql
select id, category, status, "createdAt", "updatedAt"
from job_requests
order by "createdAt" desc
limit 50;
```

### Lead activity for one request

```sql
select "jobRequestId", "providerId", status, "sentAt", "respondedAt", "expiresAt"
from leads
where "jobRequestId" = '<JOB_REQUEST_ID>'
order by "sentAt" asc;
```

### Match created for one request

```sql
select id, "jobRequestId", "providerId", status, "inspectionNeeded", "createdAt"
from matches
where "jobRequestId" = '<JOB_REQUEST_ID>';
```

### Requests stuck in matching with no active live leads

```sql
select jr.id, jr.status, jr."createdAt"
from job_requests jr
where jr.status = 'MATCHING'
and not exists (
  select 1
  from leads l
  where l."jobRequestId" = jr.id
    and l.status in ('SENT', 'VIEWED', 'ACCEPTED')
);
```

### Open requests older than one hour

```sql
select id, category, "createdAt"
from job_requests
where status = 'OPEN'
and "createdAt" < now() - interval '1 hour'
order by "createdAt" asc;
```

### Outbound WhatsApp evidence around matching time

```sql
select id, "to", status, "sentAt", "deliveredAt", "readAt", "failureReason", body
from message_events
where channel = 'WHATSAPP'
order by "createdAt" desc
limit 100;
```

### Inbound WhatsApp processing failures

```sql
select id, phone, body, "processedAt", "failureReason", "firstSeenAt", "lastSeenAt"
from inbound_whatsapp_messages
where "failureReason" is not null
order by "lastSeenAt" desc
limit 50;
```

## Minimum Acceptance Standard

Production auto-matching should be considered healthy only if all of the following are true:

- Vercel cron is configured and firing
- `/api/cron/match-leads` returns `200`
- recent `job_requests` show movement into `MATCHING` or `MATCHED`
- recent `leads` rows are being created
- at least some leads progress to `ACCEPTED`
- `matches` rows are being created for accepted leads
- outbound WhatsApp evidence exists for lead notifications
- inbound WhatsApp processing is not failing at a meaningful rate

## Decision Outcome Template

Use this summary after the production check:

- `Configured`: yes / no
- `Cron firing`: yes / no / unknown
- `Immediate dispatch firing`: yes / no / unknown
- `Lead rows created`: yes / no
- `Matches created`: yes / no
- `WhatsApp delivery evidence present`: yes / no
- `Unmatched backlog acceptable`: yes / no
- `Overall status`: healthy / degraded / broken / inconclusive


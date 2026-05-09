# Application Error Events — Support & Developer Lookup Guide

## What is this table?

`application_error_events` captures every provider-application submit failure.
Users are shown a short public reference (`PAP-XXXXX`). This table lets support
agents and engineers correlate that reference back to the full technical detail
without ever exposing internal codes to the user.

---

## User-facing reference format

```
PAP-XXXXX   (5 uppercase alphanumeric chars, charset excludes O/0/I/1)
```

Users are told to share this reference when contacting support. Example message:

> Sorry, we couldn't submit your application right now.
>
> Your progress has been saved. Please try again in a few minutes.
>
> If the issue continues, contact support and share this reference:
> PAP-AB3CK

---

## Lookup queries

### Find a record by public reference

```sql
SELECT *
FROM application_error_events
WHERE "publicErrorRef" = 'PAP-AB3CK';
```

### Find recent failures for a specific workflow step

```sql
SELECT "publicErrorRef", "errorCode", "severity", "createdAt", "technicalMessage"
FROM application_error_events
WHERE workflow = 'provider_application'
  AND step     = 'submit'
ORDER BY "createdAt" DESC
LIMIT 50;
```

### Find all events related to a trace ID

```sql
SELECT *
FROM application_error_events
WHERE "traceId" = 'provider_app_submit_<UUID>';
```

### Find all open events by error code

```sql
SELECT "publicErrorRef", "createdAt", "retryable", "userSafeMessage"
FROM application_error_events
WHERE "errorCode" = 'PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED'
  AND status = 'open'
ORDER BY "createdAt" DESC;
```

### Count failures by error category (last 7 days)

```sql
SELECT "errorCategory", COUNT(*) AS occurrences
FROM application_error_events
WHERE "createdAt" >= NOW() - INTERVAL '7 days'
GROUP BY "errorCategory"
ORDER BY occurrences DESC;
```

---

## Structured log correlation

Every failure also emits a `console.error` log line with both identifiers:

```json
{
  "event": "application_submit_failed",
  "public_error_ref": "PAP-AB3CK",
  "trace_id": "provider_app_submit_<UUID>",
  "workflow": "provider_application",
  "step": "submit",
  "error_code": "PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED",
  "error_category": "database_constraint",
  "severity": "error",
  "retryable": true
}
```

Search your log aggregator for `public_error_ref = "PAP-AB3CK"` or `trace_id = "..."`.

---

## Privacy notes

- **Phone numbers are never stored.** Only the first 16 hex chars of a SHA-256
  hash are kept in `whatsappPhoneHash` for deduplication purposes.
- **Sensitive payload fields are redacted** before storage: `phone`, `email`,
  `password`, `otp`, `token`, `idnumber`, `authorization`, `apikey`, `secret`,
  `session`, `cookie`. These appear as `[REDACTED]` in
  `requestPayloadSummary` / `responsePayloadSummary`.
- Raw stack traces and technical messages are stored in `stackTrace` and
  `technicalMessage` — **these columns must never be returned in any public API
  response**.

---

## Marking an event resolved

```sql
UPDATE application_error_events
SET status = 'resolved', "lastSeenAt" = NOW()
WHERE "publicErrorRef" = 'PAP-AB3CK';
```

---

## Schema reference

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (cuid) | Internal primary key |
| `publicErrorRef` | TEXT UNIQUE | Shown to users — format `PAP-XXXXX` |
| `traceId` | TEXT | `provider_app_submit_<UUID>` — internal only |
| `source` | TEXT | `whatsapp` \| `api` |
| `workflow` | TEXT | e.g. `provider_application` |
| `step` | TEXT | e.g. `submit` |
| `userId` | TEXT? | Supabase user ID if available |
| `providerApplicationId` | TEXT? | Set if application was partially created |
| `whatsappPhoneHash` | TEXT? | SHA-256 first 16 hex chars — no raw phone |
| `errorCode` | TEXT | e.g. `PROVIDER_APPLICATION_DB_CONSTRAINT_FAILED` |
| `errorCategory` | TEXT | e.g. `database_constraint`, `validation`, `network` |
| `severity` | TEXT | `info` \| `warning` \| `error` \| `critical` |
| `retryable` | BOOLEAN | Whether the user can retry immediately |
| `userSafeMessage` | TEXT | Exact copy of what was shown to the user |
| `technicalMessage` | TEXT? | Raw error `.message` — internal only |
| `stackTrace` | TEXT? | Full stack trace — internal only |
| `requestPayloadSummary` | JSONB? | Redacted request context |
| `responsePayloadSummary` | JSONB? | Redacted upstream response |
| `metadata` | JSONB | Extra context (Prisma code, DB column, etc.) |
| `status` | TEXT | `open` \| `resolved` |
| `firstSeenAt` | TIMESTAMPTZ | When the error was first recorded |
| `lastSeenAt` | TIMESTAMPTZ | Updated on deduplication |
| `occurrenceCount` | INT | Incremented on deduplication (future) |
| `createdAt` | TIMESTAMPTZ | Row insert time |

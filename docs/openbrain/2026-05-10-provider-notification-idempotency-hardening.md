# OpenBrain implementation note — 2026-05-10

## Scope
Hardening completed for Workflow 5: selected-provider WhatsApp notification.

## Decision
Provider notification now uses a short-lived reservation field on `Lead` to make outbound sends idempotent under retry and concurrent calls.

## Implementation
- Added `Lead.notificationAttemptedAt` in Prisma (`field-service/prisma/schema.prisma`) with migration `20260510094500_add_lead_notification_attempted_at`.
- `notifySelectedProvider()` now reserves lead rows before WhatsApp send with guarded status/`notifiedAt` criteria and clears reservation on failure.
- Final lead transition now requires reservation token match so stale retries cannot mark already-notified leads.
- Expired request/lead and duplicate send races return explicit non-send outcomes.
- Additional structured logs added for selection rejection, in-flight lock, send failure, DB failure, and duplicate/expired states.
- Tests expanded in `field-service/__tests__/lib/customer-shortlists.test.ts` to cover:
  - missing lead,
  - request/lead expired,
  - stale/in-flight duplicate lock,
  - DB update failure after send,
  - duplicate notifications.

## Result
The workflow now avoids double WhatsApp notifications and avoids falsely updating lead state when DB writes fail after external send.

## Commands run
- `cd field-service && npm test -- --run __tests__/lib/customer-shortlists.test.ts __tests__/api/customer-request-matched-providers.test.ts`
- `cd field-service && npx eslint lib/customer-shortlists.ts __tests__/lib/customer-shortlists.test.ts app/api/customer/requests/[id]/matched-providers/route.ts lib/review-first.ts`
- `cd field-service && npx tsc --noEmit`
- `cd '/Users/shimane/Library/CloudStorage/Dropbox/KgolaEntle Holdings/Solutions/Projects/Plug A Pro' && vercel --prod --yes`
- `git push origin main`

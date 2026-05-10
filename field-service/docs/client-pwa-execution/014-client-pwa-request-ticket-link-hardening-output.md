# CLIENT-14 — Request Ticket Link Hardening (WhatsApp View Request)

## Status
Completed

## Root cause
- The `/requests/access/[token]` page performed deep-link destination resolution and shortlist loading directly in the page render path.
- Any resolver/query failure (stale token relation, enum decode drift, shortlist query failure, or other data-shape edge) bubbled to the global App Router error boundary, producing the generic crash screen (`Something went wrong` + digest/Error ID).
- This made older WhatsApp "View Ticket" links fragile: instead of rendering a controlled unavailable state, failures could crash the page.

## Fix summary
- Added a crash-safe server-side ticket view-model wrapper:
  - `lib/customer-request-ticket-view-model.ts`
  - `buildCustomerRequestTicketViewModel({ token, intendedScreen })`
  - Wraps destination resolution and shortlist lookup with controlled fallback states and structured logs.
- Updated `app/requests/access/[token]/page.tsx` to consume the wrapper and render explicit unavailable states:
  - expired link
  - invalid link
  - lookup failure
- Added clearer recovery actions:
  - Return to WhatsApp
  - Start a new request
  - Sign in
  - Go home
- Added defensive fallback mapping in `lib/client-pwa-state.ts` for unexpected runtime status values.
- Updated WhatsApp CTA wording to `View request` (while keeping old routes/tokens compatible).

## Files changed
- `app/requests/access/[token]/page.tsx`
- `lib/customer-request-ticket-view-model.ts` (new)
- `lib/client-pwa-state.ts`
- `lib/whatsapp-flows/job-request.ts`
- `lib/whatsapp-flows/status.ts`
- `__tests__/lib/customer-request-ticket-view-model.test.ts` (new)
- `__tests__/lib/client-pwa-state.test.ts`
- `__tests__/lib/whatsapp-flows/status.test.ts`

## Test coverage added
- Resolver failure -> controlled unavailable state (`resolve_failed`)
- Expired token -> unavailable expired state
- Invalid token -> unavailable invalid state
- Shortlist fetch failure -> page model still renders (`ready` with `shortlist=null`)
- Runtime fallback for unmapped request/job statuses
- Status flow CTA label regression (`View request`)

## Privacy and security
- No customer full phone/address expansion was introduced.
- Existing token-gated attachment access remains unchanged.
- No raw URLs are added to WhatsApp message body text.

## Backward compatibility
- Existing old "View Ticket" links still resolve on the same `/requests/access/[token]` route.
- Legacy payloads continue to work; only CTA display copy changed to `View request`.

# Investigation — Review Providers First PWA latency (2026-05-25)

## Root cause

The Review Providers First flow was using plain server-action submit buttons on the public token page. On mobile, each Add/Remove/Send tap waited for the server action and a full ticket page rebuild before showing any visible state change.

The post-action page rebuild also loaded independent ticket data sequentially: legacy shortlist, review candidates, then review shortlist. This made every redirect slower than necessary. Production logs for the affected request reference showed repeated public-token POST/redirect cycles within a ~30s window, with GET reloads several seconds later. Send Request also waited for WhatsApp provider notification work before redirecting.

## Fix applied

1. Added the existing `FormSubmitButton` pending/loading pattern to the public token Review Providers First Add, Remove, and Send forms.
2. Parallelized independent ticket view-model reads in `buildCustomerRequestTicketViewModel`.
3. Added regression tests for public-token pending labels and parallel review-first data loading.

## Verification

- `pnpm vitest run __tests__/lib/customer-request-ticket-view-model.test.ts __tests__/app/customer/submission-matching-status.test.ts __tests__/components/button-loading.test.tsx` — 33 passing.
- `pnpm typecheck` — passing.
- `pnpm lint` — passing.

## Operational evidence

- Customer: `customer-id-example`.
- Request: `PAP-EXAMPLE1` / `request-id-example`.
- First shortlist item: Provider A, rank 1, created at submission time.
- Second shortlist item: Provider B, rank 2, created shortly after.
- Send request moved the job to `MATCHING`; provider template for Provider A was delivered, and customer status WhatsApps were read.

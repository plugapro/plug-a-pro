# Investigation — Review Providers First PWA latency (2026-05-25)

## Root cause

Sarah's Review Providers First flow was using plain server-action submit buttons on the public token page. On mobile, each Add/Remove/Send tap waited for the server action and a full ticket page rebuild before showing any visible state change.

The post-action page rebuild also loaded independent ticket data sequentially: legacy shortlist, review candidates, then review shortlist. This made every redirect slower than necessary. Production logs for `PAP-2940235F` showed repeated public-token POST/redirect cycles around `2026-05-25T08:30:24Z` through `08:30:55Z`, with GET reloads several seconds later. Send Request also waited for WhatsApp provider notification work before redirecting.

## Fix applied

1. Added the existing `FormSubmitButton` pending/loading pattern to the public token Review Providers First Add, Remove, and Send forms.
2. Parallelized independent ticket view-model reads in `buildCustomerRequestTicketViewModel`.
3. Added regression tests for public-token pending labels and parallel review-first data loading.

## Verification

- `pnpm vitest run __tests__/lib/customer-request-ticket-view-model.test.ts __tests__/app/customer/submission-matching-status.test.ts __tests__/components/button-loading.test.tsx` — 33 passing.
- `pnpm typecheck` — passing.
- `pnpm lint` — passing.

## Operational evidence

- Sarah customer: `cmpcgwrm2003llg04m3aw6izw`.
- Request: `PAP-2940235F` / `cmpky3jjh000gla040qzhmz2j`.
- First shortlist item: Tshepo serve1, rank 1, created `2026-05-25T08:30:28.541Z`.
- Second shortlist item: Lovemore Sibanda, rank 2, created `2026-05-25T08:30:59.581Z`.
- Send request moved the job to `MATCHING`; provider template for Tshepo serve1 was delivered, and customer status WhatsApps were read.

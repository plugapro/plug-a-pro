# engineering — post-match handoff durability: after() boundary + paid-only redrive (2026-09-13)

> Synced to OpenBrain 2026-09-13 (local CLI backend + Worker MCP).
> Tags: domain:engineering, post-match, handoff, durability, redrive, pr-207

## Why this existed

The platform had never produced a quote, booking, job or payment. Four providers accepted leads
(2026-06-17, 07-01, 07-17, 08-03); all four matches sat at `MATCHED` with zero quotes, and all four
customers had read "we found you a provider" and then heard nothing.

`notifyAcceptedLeadLocked` fired three notifications as floating promises (`void promise`). Vercel
abandons in-flight work the moment a function suspends after returning its response, so the acceptance
transaction committed — credit charged, lead `ACCEPTED` — while the message releasing customer contact
and linking the provider to their job page never ran. It never recorded a failure either, because the
code never reached its own error handling.

Boundary is exact: `post_match_*` last sent 2026-07-01; PR #157 merged 2026-07-02 adding ~165 lines of
awaits to this path, widening the window for the floating promise to be killed.
`provider_job_accepted_next_steps` is APPROVED at Meta and had **zero** `message_events` rows, ever.

## Decisions

**1. `after()`, not `await`, and not a queue.** `lib/run-after-response.ts` routes deferred work through
`next/server`'s `after()`. Awaiting inline would add WhatsApp round-trips to the provider's accept
request; a queue is more infrastructure than this needs. `after()` was already the codebase's answer to
this exact problem in `lib/job-requests/create-job-request.ts` — the acceptance path simply never got it.

**2. Fallback semantics.** `after()` throws outside a request scope (nested inside another `after()`
callback, cron, scripts, tests). The helper catches that and awaits the work inline instead, returning
`mode: 'after' | 'inline'` so callers and tests can tell which happened. It never throws: the caller has
already committed its state change and must not be rolled back by a notification failure. A failing
callback is logged with its label and swallowed.

**3. Redrive is paid-only — the sharpest constraint here.** `providerAcceptedAt` is stamped at
`PROVIDER_ACCEPTED` (`lib/provider-credit-check.ts:419`), *before* the credit is applied. A lead in
`PROVIDER_ACCEPTED` or `CREDIT_REQUIRED` therefore has an acceptance timestamp and no debit. Since
`notifyPostMatchAcceptance` releases the customer's name and phone — the monetised product — redriving
on the timestamp alone would give a lead away free and leak customer contact to a provider who never
bought it. The cron requires `status IN (CREDIT_APPLIED, ACCEPTED, ACCEPTED_LOCKED)` **and** an existing
`unlock` row. Ledger-first: the unlock row is what the ledger writes, so status alone is not accepted as
proof of payment.

**4. Eligibility filtering happens in the query, not after the batch limit.** Applying `take: 25` before
excluding delivered handoffs let 25 already-handled rows fill every run and starve genuinely stranded
ones until they aged past the 48h cutoff. The `messageEvents: { none: ... }` filter now runs in the
database.

**5. Dedup counts the fallback template.** The customer-side guard checked only
`post_match_customer_provider_accepted`. Whenever that template is unapproved the flow falls back to
`customer_match_found`, which the guard could not see — so a 15-minute redrive would re-message the
customer for as long as the provider side stayed unresolved. Both templates now count as "the customer
has been told".

## Failure behaviour

- Live path: work runs post-response via `after()`; failures are logged (`[after-response] deferred work
  failed`) and never surface to the provider.
- Recovery: the redrive cron re-sends any paid acceptance 10min–48h old with no handoff message on
  record. `notifyPostMatchAcceptance` re-checks `message_events` before each send, so replay is safe.
- Outside the window or with no approved template, the existing code records
  `NO_ACTIVE_WHATSAPP_SERVICE_WINDOW` rather than attempting a doomed send.

## Rollout

1. Merge and deploy — the `after()` fix is unflagged; it restores intended behaviour.
2. Run an end-to-end test booking and confirm the provider receives the job-page link.
3. Flip `provider.post_match_handoff.redrive` (default OFF) once the live path is confirmed.

The four historical stranded acceptances are deliberately NOT recovered by this cron: they are 1–3 months
old and the 48h window excludes them. Messaging those providers now would confuse rather than help; they
need a manual decision.

## Verification

5552 tests passing, 0 failing. `__tests__/lib/mvp1-acceptance-e2e.test.ts` asserted
`toHaveBeenCalledTimes(2)` — the defect was encoded in the test as expected behaviour, because the third
message never arrived. It now asserts 3 and names the post-match message.

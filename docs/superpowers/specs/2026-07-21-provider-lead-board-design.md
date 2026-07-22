# Provider Lead Board (Searchable Lead Queue) — Design Spec

**Date:** 2026-07-21
**Status:** Approved for planning (Approach A)
**Driver:** 60% of pushed leads expire unanswered (12 of 20 all-time); job requests whose push
wave lands nowhere currently dead-end until the 7-day expiry. Providers have no way to pull
work they can see themselves doing.

## Concept

Two doors into one pipeline. Push matching stays exactly as it is. NEW: job requests whose
push offers all lapsed become **browsable** on a provider-facing board; in-area providers
**express interest** (max 3); the **customer picks** one; the existing acceptance machinery
creates the Match. Past-due requests never appear and are closed by the existing expiry cron.

User-confirmed decisions:
- Claim semantics: **express interest → customer picks** (not first-come-first-served).
- Surface: **PWA only** in v1 (no WhatsApp browse).
- Pre-selection visibility: **job details, no identity** (no name/phone/street address).
- Shortlist: **cap 3**, customer notified on the **first** interest, again per interest.
- Everything behind flag **`provider.board.v1`**, default OFF.

## Why Approach A (extend the Lead pipeline)

The schema already models this flow: `Lead.status` includes `INTERESTED`, `SHORTLISTED`,
`CUSTOMER_SELECTED`; `safePreviewToken` guards pre-unlock privacy; `LeadUnlock` gates
customer contact data; acceptance (`lib/matching/service.ts`) already enforces the KYC gate,
credits, idempotency, and race-safe Match creation. The board adds a query + one new lead
source, not a parallel subsystem. (Rejected: standalone BoardPost/BoardInterest models —
duplicates privacy/unlock/notification/match logic; the qgv2 create-on-PASS history shows
parallel reimplementations bleed divergence bugs. Rejected: admin-mediated assignment —
contradicts the claim-semantics decision.)

## Design

### 1. Board eligibility (pure query, no new state machine)

A `JobRequest` is board-eligible iff ALL of:
- `status` IN (`OPEN`, `MATCHING`, `SHORTLIST_READY`) — SHORTLIST_READY keeps the job
  board-visible until the cap or a customer selection (true cap-3, user-ratified at final
  review 2026-07-22)
- `expiresAt` IS NULL OR `expiresAt` > now()
- `requestedWindowEnd` IS NULL OR `requestedWindowEnd` > now()  ← "past due" exclusion
- no `Match` exists for it
- no ACTIVE `AssignmentHold`
- no lead in a live push state (`SENT`, `VIEWED` with unexpired offer window)
- at least one push dispatch was attempted (≥1 lead row exists) — i.e. "did not match
  first-hand"; requests that never had candidates keep today's auto-expire behaviour
  (documented follow-up: surface those too once the board proves itself)
- fewer than 3 leads in `INTERESTED`/`SHORTLISTED`/`CUSTOMER_SELECTED` for it

Implemented as `lib/board/eligibility.ts` exporting the Prisma `where` builder +
`findBoardJobsForProvider(providerId, filters)` which intersects eligibility with the
provider's coverage (reusing the same `TechnicianServiceArea`/location-node coverage
helpers `lib/matching/filter.ts` uses) and skill match (`JobRequest.category` ∈
`provider.skills`, canonicalized).

Past-due close remains owned by the existing crons (`expireOpenJobRequest` at `expiresAt`,
customer notified). The board never shows what those crons have closed or what the window
rule excludes — no new cleanup cron needed for v1 beyond §5's interest close-out.

### 2. Provider surface — PWA `/provider/board`

- Auth: `requireProvider()` (same as `/provider/leads`).
- Flag-gated: page 404s (or hides nav entry) when `provider.board.v1` is OFF.
- List: board-eligible jobs in the provider's service areas; filters: category (their own
  skills preselected), suburb text search; sort newest-first.
- Card: category, title, description (truncated), suburb label ONLY (no street/access
  notes), requested window, posted-ago, interest count `n/3`.
- Detail view + one action: **"I'm interested"**. Attachments shown only via the existing
  safe-preview mechanism.

### 3. Express interest

Server action (`lib/board/interest.ts`, called from the page):
- Guards: flag ON; provider `active AND verified`; in-area; skill match; job still
  board-eligible (re-checked inside the transaction).
- Transaction: `SELECT` count of open interests `FOR UPDATE` on the job request row →
  reject with "shortlist full" at 3 → create `Lead { source: 'BOARD', status: 'INTERESTED',
  sentAt: now, safePreviewToken, no assignmentHold, no rankingPosition }`. One interest per
  (jobRequestId, providerId) — enforced by the existing per-job/provider lead uniqueness if
  present, else an explicit pre-check inside the same transaction.
- `Lead.source` is a new additive column (`String @default("PUSH")`) if no discriminator
  exists — verify against schema at planning time; if a source/origin field already exists,
  reuse it.
- No credits charged and no KYC check at interest time; both stay at the existing
  acceptance step (KYC honours `matching.kyc_grace_legacy_providers` exactly as today).
- Audit: one `AuditLog` row per interest (`lead.board_interest_created`).

### 4. Customer selection

- On EVERY interest (1st through 3rd): the board regenerates the shortlist (existing
  `generateCustomerShortlistForRequest` supersedes the prior published list) which re-sends
  the EXISTING customer notify (`interactive:client_shortlist_ready` machinery) — no new
  Meta template (implementation discovery; original `customer_shortlist_review` plan dropped) — body: "Hi {{1}}, {{2}} provider(s) are available
  for your job. Tap below to review and choose." + dynamic-URL button whose suffix
  variable is `JobRequest.customerAccessToken`, landing on the EXISTING token-authed
  customer tracking page (exact route confirmed at planning time from the smoke-suite
  inventory), extended with a shortlist section.
  Template submitted to Meta at implementation start (URL-button shape — nudge lesson).
- Shortlist page: up to 3 cards — provider first name, `averageRating`, `completedJobsCount`,
  coverage tier ("works in your area") — NO phone numbers. One tap = select.
- Selection: lead → `CUSTOMER_SELECTED`; job request → `PROVIDER_CONFIRMATION_PENDING`
  (existing status); push rotation skips jobs in that status (verify — it does today for
  shortlist mode); selected provider notified via the existing lead-offer notification path
  to confirm on their existing lead page; confirmation runs the EXISTING acceptance flow
  (KYC gate, LeadUnlock/credits, hold-free idempotent Match creation; Match uniqueness per
  job request makes any race with a stray push-accept lose cleanly).
- Non-selected INTERESTED/SHORTLISTED leads → `CANCELLED` (the enum's existing
  customer-side terminal state) with a cancellation reason of `customer_selected_other`,
  plus a polite provider notification.
- If the selected provider does not confirm within the standard offer window, the lead
  expires by existing mechanics and the job returns to board-eligible (interest count
  recomputed from open leads).

### 5. Lifecycle close-out

When a job request expires (`expiresAt` cron) or its `requestedWindowEnd` passes with open
interests: open board leads flip `EXPIRED` and each interested provider gets a courteous
close-out WhatsApp text (session message if within 24h window, else silently closed —
providers see the status on their leads page regardless). Implemented inside the existing
expiry path (`expireOpenJobRequest`), additively.

### 6. Rollout & flags

- Flag `provider.board.v1`, default OFF, seeded via registry (auto-picked-up by seed-flags).
- Ships dark in one PR. Flip order: Meta template `customer_shortlist_review` APPROVED →
  flag ON.
- No schema drops; only additive columns (`Lead.source` if needed).

## Error handling

- Shortlist-full race: transaction re-check → provider sees "this job just filled up".
- Interest on a job that got matched meanwhile: eligibility re-check inside transaction →
  friendly "no longer available".
- Customer taps a stale shortlist link (job expired/matched): tracking page shows current
  state — no dead ends.
- Template send failure on interest: interest still stands; notification retried on next
  interest or via existing customer-recontact machinery; failure logged.

## Testing

- Vitest: eligibility `where`-builder matrix (each exclusion rule flips one fixture);
  interest transaction (cap 3, duplicate provider, gone-meanwhile); selection transitions
  (CUSTOMER_SELECTED, non-selected close-out, no-confirm return-to-board); close-out on
  expiry. Fake-client idiom per `__tests__/lib/provider-registration/` precedent.
- Existing matching/service tests must stay green (acceptance path untouched — reused).
- Playwright smoke: `/provider/board` renders behind flag (extend smoke inventory per house
  rule 6).

## Success criteria

- ≥50% of board-listed jobs receive ≥1 interest within 24h of listing.
- First customer-picked match created end-to-end via the board (the metric that matters).
- Zero leakage: no customer name/phone/street address visible pre-selection (review gate).
- Push pipeline metrics unchanged when flag OFF (byte-equivalent behaviour).

## Implementation amendments (ratified during build, 2026-07-22)

- Board leads carry a real `expiresAt` (job's own expiry, else +7d) so their responses
  satisfy the shared shortlist-generation predicates; the board's live-push exclusion is
  scoped to `origin: PUSH`.
- Interest collects `callOutFee` + `estimatedArrivalAt` (the shortlist ranks by fee).
- Non-selected providers stay open as cascade fallbacks until the job resolves (existing
  pipeline design) rather than closing at selection.
- v1 area coverage is node-id/suburb/RADIUS (no regionKey or legacy-string fallback tier);
  region-only-coverage providers see an empty board. Fast-follow: reuse
  `providerCoversAddress` from lib/matching/filter.ts.
- Detail view + safe-preview attachments deferred (card-only board in v1).

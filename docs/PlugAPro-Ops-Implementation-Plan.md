# Plug A Pro Ops — Implementation Plan

**Source of findings:** `PlugAPro-Ops-Review.md` (same folder).  
**Target runtime:** The admin app at `admin.plugapro.co.za`.  
**Observed stack (from `/admin/flows`):** Next.js App Router + Server Actions, Prisma over Supabase Postgres, Vercel Cron, Vercel Blob, WhatsApp + payment webhooks. I did not read the repo — paths below are best-guess and should be verified by Claude Code in the first pass.  
**Who runs this:** A developer using Claude Code against the admin app's repo.

---

## How to use this document

Treat each **workstream** as a small project and each **task (PR)** inside it as one Claude Code session with one pull request. That's the unit that works best with Claude Code — one clear brief, one branch, one PR, one green test run, merged, moved on. Trying to do five tasks in one session is where Claude Code gets muddled, and so do humans.

There is a **Workstream 0** (codebase mapping + safety rails) that must run first. It's the foundation that lets every other task slot cleanly into the existing conventions instead of fighting them. Skip it and you'll regret it within two PRs.

Priorities follow the review: **P0** (ship first — today the dashboard lies and cases can't be closed), then **P1** (make it fast at volume), then **P2** (hygiene and scale).

A Claude Code task brief template is at the bottom — use it verbatim so every task ends up self-contained.

> **Important practical note:** every task in this plan assumes Claude Code has read access to the repo and can run tests. Work on a feature branch per PR, keep migrations backward-compatible, and gate user-facing changes behind a feature flag (`ops.v2.enabled`) so you can ship dark, QA, then flip on.

---

## Workstream 0 — Codebase mapping and safety rails (run this FIRST)

**Why it exists:** Claude Code produces better code when it knows the conventions of the codebase. Five minutes of mapping saves fifty minutes of rework later.

### Task 0.1 — Generate a CLAUDE.md
Run Claude Code's `/init` against the admin repo. The goal is a CLAUDE.md that captures the Next.js route layout, server-action pattern, Prisma schema location, Tailwind/shadcn conventions, test framework, and how to run dev/lint/test/db-migrate locally.

### Task 0.2 — Add a feature flag primitive
Add a simple flag module (`src/lib/flags.ts` or similar) that reads from env/DB, with a single helper `isEnabled(flagKey, opts)`. Add keys: `ops.v2.closeOut`, `ops.v2.notes`, `ops.v2.audit`, `ops.v2.breachBanner`, `ops.v2.dispatchOverride`, `ops.v2.profileV2`, `ops.v2.bulkActions`, `ops.v2.duplicates`.  
*Why:* Every subsequent PR ships behind a flag. Flip flags in staging, run QA, then flip in prod.

### Task 0.3 — Establish a reason-code registry
Create `src/lib/reason-codes.ts` (or DB-backed equivalent — prefer DB). Seed per-queue lists:

- **Dispatch close-out:** `COVERAGE_GAP`, `DUPLICATE_REQUEST`, `CUSTOMER_CANCELLED`, `FRAUD_SUSPECTED`, `PROVIDER_UNRESPONSIVE`, `OUT_OF_SCOPE`, `OTHER`
- **Field exceptions:** `PROVIDER_NO_SHOW`, `CUSTOMER_NO_SHOW`, `SITE_ACCESS_BLOCKED`, `ADDITIONAL_SCOPE_REQUIRED`, `EQUIPMENT_MISSING`, `OTHER`
- **Validation:** `INSUFFICIENT_INFO`, `DUPLICATE`, `WRONG_CATEGORY`, `SPAM`, `OTHER`
- **Quotes:** `CUSTOMER_DECLINED`, `EXPIRED`, `PRICE_DISPUTE`, `SCOPE_CHANGE`, `OTHER`
- **Trust/disputes:** `RESOLVED_REFUND`, `RESOLVED_REDO`, `RESOLVED_NO_ACTION`, `ESCALATED_LEGAL`, `OTHER`
- **Finance:** `REFUND_ISSUED`, `RETRIED_OK`, `WRITTEN_OFF`, `CUSTOMER_CONTACTED`, `OTHER`

`OTHER` must require a free-text reason. All codes must support deprecation (don't delete — mark inactive).

### Task 0.4 — Add a shared SLA registry
Create `src/lib/sla.ts` with per-queue targets (already present visually on tiles). Expose `slaFor(queueType) → { target, unit, warningAt }` so every case-level view can compute remaining time consistently.

---

## Workstream 1 — Case lifecycle foundation (P0, blocks everything else)

This is the data-model work that enables close-out, notes, audit, and ownership. Without it, the rest of the plan is paint on drywall.

### Task 1.1 — Prisma schema: Case, CaseEvent, CaseNote
Add three models (or extend existing ones):

- **Case**: polymorphic wrapper with `queueType` (`VALIDATION | DISPATCH | FIELD | QUOTES | FINANCE | TRUST | SUPPLY`), `entityType`, `entityId` (FK to JobRequest/Match/Booking/Payment/Dispute/Application), `state` (`OPEN | IN_PROGRESS | RESOLVED | CANCELLED | REOPENED`), `outcome` (nullable until resolved), `reasonCode` (nullable until resolved), `ownerUserId` (nullable), `slaDueAt`, `createdAt`, `resolvedAt`, `resolvedBy`.
- **CaseEvent**: append-only timeline rows. `caseId`, `type` (`STATE_CHANGE | SYSTEM_EVENT | OPS_ACTION | NOTE_ADDED | ATTACHMENT_ADDED | ASSIGNMENT_CHANGE | CUSTOMER_CONTACTED | ESCALATION`), `payload` (JSON), `actorUserId` (nullable for system), `createdAt`.
- **CaseNote**: `caseId`, `authorUserId`, `body`, `visibility` (`INTERNAL_ONLY` first — no customer-visible yet), `createdAt`.

Migration must be backward-compatible. Existing JobRequest/Match/Booking records need a **backfill script** that creates a Case row keyed to each open entity, inferring `queueType` from status. Wrap backfill in a transaction with idempotency — it must be safe to rerun.

### Task 1.2 — Case server actions
Add server actions under `src/app/admin/_actions/case/`:

- `claimCase(caseId)` — sets `ownerUserId = currentUser`, writes `ASSIGNMENT_CHANGE` event.
- `releaseCase(caseId)`
- `reassignCase(caseId, toUserId, reasonNote)`
- `resolveCase(caseId, { outcome, reasonCode, note, attachments? })` — enforces `note` required when `reasonCode === 'OTHER'`. Writes `STATE_CHANGE` and `NOTE_ADDED` events. Sets `resolvedAt/resolvedBy`. Moves state to `RESOLVED`.
- `reopenCase(caseId, reasonNote)` — only allowed within 30 days of resolution; writes event.
- `addNote(caseId, body)`
- `addEvent(caseId, type, payload)` — internal helper, server-side only.

Every action must be wrapped by a single middleware that enforces: authenticated admin, logs `OPS_ACTION` event, returns typed result, and invalidates the case query cache.

### Task 1.3 — Case hooks into existing state machines
Wire Case lifecycle into the existing JobRequest / Match / Booking / Dispute state machines. When a JobRequest hits `MATCHING`, a Dispatch Case opens. When a Match hits `QUOTED`, a Quotes Case opens. When a Booking completes, the Field Case resolves with `outcome = 'COMPLETED_SUCCESSFULLY'` unless already resolved. System transitions write `SYSTEM_EVENT` rows. This is the "glue" that keeps Cases truthful without relying on human opening/closing.

**Acceptance for WS1:** Prisma migration applied in staging; backfill produces Case rows for all currently-open entities; unit tests cover state transitions; no user-visible change yet (flags off).

---

## Workstream 2 — Close-out UI + activity timeline + notes (P0)

Now the layer that ops actually touches.

### Task 2.1 — `CaseActivityTimeline` component
`src/app/admin/_components/case-activity-timeline.tsx`. Renders `CaseEvent[]` chronologically, grouping by day. Row template: icon (by event type), actor name, human summary, timestamp (relative + absolute on hover), expandable payload JSON for `SYSTEM_EVENT`. Append-only; no edit/delete UI.

### Task 2.2 — `CaseNotes` component + add-note form
Below the timeline. Textarea (markdown-lite supported), Save. Notes render interleaved in the timeline as `NOTE_ADDED` events but are also listable alone in a "Notes only" tab.

### Task 2.3 — `ResolveCaseDialog` component
Modal/Sheet with: Outcome (select — queue-dependent), Reason code (select populated from registry for that queue), Note (textarea — required if code is OTHER; optional otherwise), Attachment uploader (Vercel Blob, optional). Submit calls `resolveCase` server action. Confirm-before-close pattern. Shows operator and timestamp on the success toast. Includes keyboard shortcut `R` to open, `⌘+Enter` to submit.

### Task 2.4 — Mount timeline/notes/resolve on every queue detail page
Queue detail pages to touch (verify paths during WS0):

- `/admin/dispatch?request=…`
- `/admin/validation/[id]` (new or existing)
- `/admin/field-exceptions/[id]`
- `/admin/quotes/[id]`
- `/admin/disputes/[id]`
- `/admin/payments/[id]` (or payment detail route)
- `/admin/applications/[id]`
- `/admin/bookings/[id]` (the page with the empty "Actions" header — fill it)

Uniform placement: right-column rail = Activity timeline + Notes; primary action button group at the top right with **Claim / Reassign / Resolve / Reopen (if resolved)**.

### Task 2.5 — Recently resolved view per queue
Each queue page gets a tab: **Open | Recently resolved (7d)**. Recently resolved rows show outcome + reason code + operator + resolved-at + reopen link.

**Acceptance for WS2:** On any open case in any queue, an ops user can claim, add a note, resolve with reason code, see the event in the timeline, and find the case in "Recently resolved." Reopen returns the case to Open.

---

## Workstream 3 — Dashboard reconciliation + breach surfacing (P0)

Fixes the dangerous "Operational exceptions: 0" lie.

### Task 3.1 — Define "Operational exceptions" as SLA-breach-aggregated
Source: `Case.slaDueAt < now() AND state IN ('OPEN','IN_PROGRESS')` across all queues. Expose as a server query `getBreachedCases()` that returns counts per queue plus total.

### Task 3.2 — Replace the "Operational exceptions" tile
The existing tile on `/admin/` must show the live breach count + a mini-list of the top 3 most-breached cases. Click-through to a new page `/admin/breached` that lists all breached cases across queues with filters and owner columns.

### Task 3.3 — Top-of-page breach banner
Persistent banner when breach count > 0. Dismissable for the session only — **not** persistent dismissal. Message pattern: "⚠️ 3 cases past SLA — [Open]".

### Task 3.4 — Wire the existing `Queue breach detection` cron into the UI
The Journey Flows page already documents a cron and "Ops WhatsApp alert." Extend the cron handler to also write a `BREACH_DETECTED` `CaseEvent` on the offending case. Add a toast/notification centre in the admin header showing the last 10 breach events unread.

**Acceptance for WS3:** The headline "Operational exceptions" count equals the sum of breached cases across queues. The current 3 Dispatch cases (all 6-7d past a 15-min SLA) appear in the banner, the tile, and the new `/admin/breached` page.

---

## Workstream 4 — Queue triage tools (P0/P1)

So ops can actually work at volume.

### Task 4.1 — Server-side filtering primitive
A shared `useQueueFilter` query param schema: `status`, `age` (`lt_1h | 1_24h | 1_7d | 7d_plus | breached`), `owner` (`me | unassigned | anyone | userId`), `region`, `category`, `channel`, `search` (freetext). Push filters to Prisma with safe parameterization.

### Task 4.2 — Apply filter bar to every queue list
Dispatch, Validation, Field, Quotes, Disputes, Payments, Applications, Bookings, Matches. Uniform filter bar component at top. Filters persist in URL. Add a **Saved views** mechanism (per-user, stored in DB) so ops can pin their working set.

### Task 4.3 — Bulk selection and bulk actions
Checkbox column on every queue list. Bulk bar at bottom when anything is selected: **Claim to me | Release | Reassign to… | Resolve… (opens multi-case resolve dialog with single reason applied to all) | Add note to all**. Enforce a cap (say 50 cases per bulk op) to keep transactions sane.

### Task 4.4 — "My queue" and "Unclaimed" as built-in views
Top of every queue. One-click.

**Acceptance for WS4:** On any queue with >20 items, an ops user can filter to "breached + unclaimed + my region" in <5 seconds and bulk-claim all.

---

## Workstream 5 — Dispatch override and escalation (P0)

The reason your Cape Town, Durban, and Pretoria cases have been dead for a week.

### Task 5.1 — Add three case actions on Dispatch case detail
- **Force assign** — pick any provider (searchable), regardless of filters. Requires reason code (`FORCE_ASSIGNED_COVERAGE_EXTENSION`, `FORCE_ASSIGNED_PROVIDER_REQUEST`, `FORCE_ASSIGNED_VIP_CUSTOMER`, `OTHER+note`). Writes `OPS_ACTION` event with chosen provider and reason. Moves Match to `MATCHED`.
- **Expand radius once** — increase the area radius for this one case by selectable step (5 / 10 / 25 / 50 km). Re-runs matcher. Event logged. Does not change the provider's service area permanently.
- **Escalate to Supply** — moves case to a new `SUPPLY` queue with mandatory note. Supply queue's SLA target: 1 business day.

### Task 5.2 — Silent-fail guardrails
"Auto-assign top candidate" currently silently no-ops when eligible = 0. Change it to show an inline warning banner: "No eligible providers under current filters. [Force assign] [Expand radius] [Escalate]." The button is not clickable when eligible = 0.

### Task 5.3 — Coverage gap report
New report at `/admin/reports/coverage-gaps`: aggregate `AUTO_ASSIGN_NO_MATCH` events by suburb + category. The same cases that are stuck today will tell supply where to recruit.

**Acceptance for WS5:** The three currently-stuck cases can be closed by ops — either force-assigned, or resolved with `COVERAGE_GAP` and `CUSTOMER_CANCELLED` after customer outreach.

---

## Workstream 6 — Subscriber profile workspaces (P0/P1)

Make profiles useful, not decorative.

### Task 6.1 — Customer profile v2
On `/admin/customers/[id]`, add sections (in this priority):

1. **Open cases** — active requests + open Cases linked to this customer, with claim/open buttons.
2. **Case history** — resolved Cases in last 90 days.
3. **Notes** — same CaseNote primitive, scoped to the customer rather than a case (add `CustomerNote` if needed, or use polymorphic `Note` model).
4. **Internal flags** — VIP, high-risk, do-not-contact-after-18:00 (small boolean/enum set; editable via a Flags dialog).
5. **WhatsApp conversation** — last 20 inbound/outbound messages (read-only, link into Messages view).
6. **Actions** — Block (sets `isBlocked = true` + note), Suspend (temporary, with duration), Resend welcome, Merge duplicate (links to WS9), Change contact details.
7. **Audit trail** — events on the customer record (profile edits, flags, blocks).

Fix the pre-existing visual bug: header shows "Booking history (1)" while the body says "No bookings yet" — the count and body must agree.

### Task 6.2 — Provider profile v2
On `/admin/providers/[id]`, add:

1. **Open leads / active jobs** — leads sent, lead response rate, last lead responded to.
2. **Certifications** (editable list — name, issuer, expiry, attachment).
3. **Equipment** (editable list).
4. **KYC / ID verification state** + payout account verification state.
5. **Notes** and **Strikes** (trust record).
6. **Coverage map** — visual map of service areas with edit action.
7. **Audit trail** on profile edits.
8. **Actions** — already has Deactivate; add Suspend (temporary), Reactivate, Request re-onboarding, Send message.

Expose the filter reasons the matcher is actually using (`MISSING_REQUIRED_CERTIFICATION`, `MISSING_REQUIRED_EQUIPMENT`) as first-class fields on the profile so ops can fix them in-place.

**Acceptance for WS6:** Opening Lerato Molefe's profile shows her active Dispatch case with a direct link. Opening Kagiso Sithole's profile shows his certifications and equipment as editable fields matching the matcher's criteria.

---

## Workstream 7 — Provider data completeness (P1)

Feeds the matcher's filters. Without this, WS5 is a workaround, not a fix.

### Task 7.1 — Data-model fields for filter inputs
If `certifications` and `equipment` are not already in Prisma (strongly suspect they aren't, given they don't render), add:

- `ProviderCertification { id, providerId, type, number, issuedAt, expiresAt, attachmentBlobId }`
- `ProviderEquipment { id, providerId, type, notes, verifiedAt }`

### Task 7.2 — Matcher reads from real data
Refactor the matcher's `MISSING_REQUIRED_CERTIFICATION` / `MISSING_REQUIRED_EQUIPMENT` checks to read from the new tables (they may currently be always-false stubs or always-true fails).

### Task 7.3 — Provider self-serve collection
Add the same fields to the provider PWA onboarding + profile so new providers can capture them. Existing providers get a prompt on next login.

**Acceptance for WS7:** A provider with a valid Certified Electrician cert in Cape Town will now be eligible for the "No power to lounge plug points" request — verified end-to-end.

---

## Workstream 8 — Duplicate detection (P2)

### Task 8.1 — Duplicate rules engine
Rules: exact phone match, exact email match, soft name+suburb match, soft phone with country-code normalisation. Write a nightly cron that flags candidate duplicate pairs into a `DuplicateCandidate` table with a confidence score.

### Task 8.2 — "Review duplicates" queue + merge action
New page `/admin/duplicates`. Each row shows both records side-by-side with a diff. Actions: **Merge into left**, **Merge into right**, **Mark as not duplicate**, **Investigate**. Merge action is destructive — require explicit typed confirmation.

---

## Workstream 9 — Reporting (P1/P2)

### Task 9.1 — Reason-code analytics
New report: cases closed per queue per week, broken down by reason code. Sparkline per reason. This directly feeds product + supply prioritisation.

### Task 9.2 — SLA performance by operator
Average time-to-claim and time-to-resolve per operator per queue. Surfaces training needs without surveillance — it's per-queue aggregates, not case-level judgements.

### Task 9.3 — Coverage gap by geography + category
Already in WS5.3 — bring into `/admin/reports` as a first-class card.

---

## Workstream 10 — Testing, observability, rollout (P0 throughout)

### Task 10.1 — Test harness
Unit tests for every server action, Playwright tests for the three happy paths: "resolve a Dispatch case," "force-assign with reason," "bulk-claim 10 cases as a user."

### Task 10.2 — Error budgets + alerts
Add Sentry (if not already present) or equivalent for server actions. Add an alert on "resolveCase error rate > 1%".

### Task 10.3 — Rollout plan
1. All PRs ship behind flags, merged to main.
2. Enable flags for `ops@plugapro.co.za` only (internal test).
3. Enable for the full ops team with a 24h soak.
4. Flip dashboard reconciliation flag (`ops.v2.breachBanner`) last — it's the most visible.

---

## Suggested PR order and rough effort

I'm deliberately not giving you calendar dates — those depend on team size and context-switching. The ordering matters more.

1. WS0.1–0.4 (foundation: flags, reason codes, SLA registry, CLAUDE.md)
2. WS1.1–1.3 (Case model + actions + glue) — **single biggest PR batch**
3. WS2.1–2.5 (Close-out UI + timeline + notes on every queue)
4. WS3.1–3.4 (Dashboard reconciliation + breach banner)
5. WS5.1–5.3 (Dispatch override) — unblocks the three current stuck cases
6. WS4.1–4.4 (Filters + bulk actions)
7. WS6.1–6.2 (Profile v2)
8. WS7.1–7.3 (Provider data completeness)
9. WS9.1–9.3 (Reporting)
10. WS8.1–8.2 (Duplicates)
11. WS10.1–10.3 (Testing + rollout run in parallel throughout)

A pragmatic single-developer path to "ship the P0s": WS0 → WS1 → WS2 → WS3 → WS5. Expect this to take a focused 2–3 weeks with Claude Code doing the typing and the developer doing the thinking.

---

## Claude Code task brief template

Copy this, fill in the angle brackets, paste into a fresh Claude Code session. One task per session.

```
## Context
We're executing Workstream <N>, Task <X.Y> from the Plug A Pro Ops Implementation Plan.
The review that led to this task is in PlugAPro-Ops-Review.md.
The full plan is in PlugAPro-Ops-Implementation-Plan.md.

## Goal
<one-line goal, matching the task's objective from the plan>

## What already exists
<Claude Code: read CLAUDE.md first, then explore the relevant paths and confirm>
- Expected path(s): <from plan>
- Expected pattern(s): <e.g. "server actions under src/app/admin/_actions/...">

## Scope (do / don't)
DO:
- <specific deliverables from the plan>
- Add unit tests
- Ship behind flag <flag key>
DON'T:
- Touch files outside the listed paths
- Rename existing symbols unless necessary
- Change the database schema beyond the listed migration

## Acceptance
- <acceptance criteria from plan>
- CI green (lint, typecheck, tests)
- PR description summarises user-visible change and test plan

## Safety
- Database migrations must be backward-compatible and idempotent
- Do not remove existing functionality — only add
- Do not ship without the feature flag gate

## Output
- One PR against main, targeting branch `ops-v2/<short-slug>`
- PR description in the format used elsewhere in the repo
```

---

## First three prompts — copy-paste ready

These are WS0.1, WS0.2, and WS1.1 phrased as Claude Code briefs. Good starter set.

### Prompt 1 — WS0.1 Codebase mapping

```
Run /init. Specifically: produce a CLAUDE.md at repo root that captures:
- The Next.js App Router structure (list all /admin routes)
- Where server actions live and the naming convention used
- The Prisma schema file path and the current models related to:
  JobRequest, Match, Booking, Quote, Dispute, Provider, Customer, Application, Payment
- The test framework and how to run: dev, lint, typecheck, test, db:migrate
- The Tailwind/shadcn conventions used in /admin
- Any existing feature flag or environment-variable-driven toggle pattern
- Any existing audit log / event log model (search for "event", "audit", "history")

At the end, summarise: what's already in place that Workstreams 1–3 can build on,
and what's missing that we'll need to introduce.
Do NOT modify code in this session. Report only.
```

### Prompt 2 — WS0.2 Feature flag primitive

```
Create a small feature flag module at src/lib/flags.ts.

Requirements:
- Single function isEnabled(key: string, ctx?: { userId?: string; env?: string }): boolean
- Reads from (in order): explicit DB override (new FeatureFlag table, optional),
  then env var FEATURE_FLAGS (JSON object), then a default of false.
- Add a Prisma model FeatureFlag { key String @id, enabled Boolean, enabledForUsers String[] }.
- Add a seed for these keys, all disabled:
  ops.v2.closeOut, ops.v2.notes, ops.v2.audit, ops.v2.breachBanner,
  ops.v2.dispatchOverride, ops.v2.profileV2, ops.v2.bulkActions, ops.v2.duplicates
- Add unit tests covering: default false, env var enable, DB enable,
  per-user enable via enabledForUsers.

Ship-behind-flag: N/A — this IS the flag system.

Acceptance:
- isEnabled('ops.v2.closeOut') returns false by default
- Setting FEATURE_FLAGS='{"ops.v2.closeOut": true}' makes it return true
- Setting FeatureFlag row enabled=true in DB makes it return true
- Setting FeatureFlag row enabled=false but enabledForUsers=[uid] returns true for that user only
- Tests pass, typecheck passes, lint passes.
```

### Prompt 3 — WS1.1 Case, CaseEvent, CaseNote

```
Add Case, CaseEvent, and CaseNote models to prisma/schema.prisma.

Case:
- id (cuid), createdAt, updatedAt
- queueType enum: VALIDATION | DISPATCH | FIELD | QUOTES | FINANCE | TRUST | SUPPLY
- entityType enum: JOB_REQUEST | MATCH | BOOKING | PAYMENT | DISPUTE | APPLICATION
- entityId string (no FK — polymorphic — add DB index)
- state enum: OPEN | IN_PROGRESS | RESOLVED | CANCELLED | REOPENED (default OPEN)
- outcome string? (freeform, validated at app layer)
- reasonCode string?
- note text?
- ownerUserId string?
- slaDueAt DateTime
- resolvedAt DateTime?
- resolvedBy string?

CaseEvent (append-only):
- id, caseId (FK), type enum
  (STATE_CHANGE | SYSTEM_EVENT | OPS_ACTION | NOTE_ADDED |
   ATTACHMENT_ADDED | ASSIGNMENT_CHANGE | CUSTOMER_CONTACTED |
   ESCALATION | BREACH_DETECTED)
- payload Json
- actorUserId string?
- createdAt

CaseNote:
- id, caseId (FK), authorUserId, body text, visibility
  enum: INTERNAL_ONLY (only value for now), createdAt

Add indexes on Case(queueType, state, slaDueAt) and CaseEvent(caseId, createdAt).

Write a backfill script at scripts/backfill-cases.ts that:
- Scans open JobRequests/Matches/Bookings/Disputes/Payments/Applications
- Creates Case rows with inferred queueType and entityType/entityId
- Sets slaDueAt using the SLA registry (WS0.4 — if not yet built, hardcode for this PR)
- Is idempotent (uses a unique constraint on (entityType, entityId, queueType, state='OPEN'))
- Writes a CaseEvent with type=SYSTEM_EVENT and payload={backfilled:true}
- Logs a summary: created X, skipped Y
Ship behind flag ops.v2.closeOut (read-only code paths can bypass the flag).

Tests:
- Creating a case then querying by queue returns it
- State transitions write CaseEvent rows
- Backfill is idempotent across two runs
- SLA index used by EXPLAIN on the breach query

Do NOT yet wire into any UI. Do NOT remove existing fields from any model.
```

---

## One more thing — the three cases currently stuck in Dispatch

You have three real customer requests that have been waiting 6–7 days. The implementation plan above takes weeks. Don't wait.

Today, manually:

1. Phone the three customers (Lerato Molefe, Siphamandla Dube, Boitumelo Sithole). Apologise. Offer timelines or close politely.
2. Either force-match them to the nearest capable provider in your actual contact list (even if manually, off-platform), or cancel with the customer's consent.
3. Note what happened in a spreadsheet until the Cases system lands.

That's your stop-gap. Ship WS0 → WS1 → WS2 → WS3 → WS5 in that order so the next three never repeat.

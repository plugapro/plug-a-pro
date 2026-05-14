# Quick Match Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quick Match persist and rotate through the top 10 ranked providers, update the customer every 30 minutes while matching is active, terminate cleanly when exhausted, and use Quick Match-specific provider notification copy.

**Architecture:** Use existing `DispatchDecision` and `MatchAttempt` rows as the persisted Quick Match queue. The first offered hold must point at the same dispatch decision that contains the ranked top-10 attempts, so timeout/decline can move to the next `RANKED` attempt without reopening the request. Customer progress updates use `MessageEvent` idempotency rather than new schema fields.

**Tech Stack:** Next.js, Prisma, Vitest, WhatsApp Cloud API templates/interactives.

---

### Task 1: Quick Match Queue Persistence

**Files:**
- Modify: `lib/matching/config.ts`
- Modify: `lib/matching/reservation.ts`
- Modify: `lib/matching/orchestrator.ts`
- Test: `__tests__/lib/matching-orchestrator.test.ts`

- [ ] Write failing tests proving `orchestrateMatch()` persists up to 10 ranked `MatchAttempt` rows before dispatch and only tries reservations from that top-10 queue.
- [ ] Run `npx vitest run __tests__/lib/matching-orchestrator.test.ts` and confirm the new tests fail.
- [ ] Add `quickMatchMaxProviderOffers: 10` to `MATCHING_CONFIG`.
- [ ] Extend `reserveBestProviderAtomically()` to accept an optional existing `dispatchDecisionId`, `matchAttemptId`, and `rankedPosition`; when provided, update that queued attempt instead of creating a stub decision/attempt.
- [ ] Update `orchestrateMatch()` to create one `DispatchDecision` plus top-10 `MatchAttempt` rows before reservation, pass queued attempt IDs into reservation, and update the same decision with dispatch metadata.
- [ ] Re-run the orchestrator tests and confirm they pass.

### Task 2: Exhaustion Behaviour

**Files:**
- Modify: `lib/matching/service.ts`
- Test: `__tests__/lib/matching-expiry.test.ts`

- [ ] Write failing tests proving `offerNextRankedCandidate()` marks the request `EXPIRED`, not `OPEN`, when the queue is exhausted.
- [ ] Run `npx vitest run __tests__/lib/matching-expiry.test.ts` and confirm the new/updated test fails.
- [ ] Update `offerNextRankedCandidate()` to set the dispatch decision to `NO_MATCH`, clear retry, and terminate the request as `EXPIRED` when no `RANKED` attempt remains.
- [ ] Re-run expiry tests and confirm they pass.

### Task 3: Quick Match Provider Template

**Files:**
- Modify: `lib/messaging-templates.ts`
- Modify: `lib/whatsapp.ts`
- Modify: `lib/matching/dispatch.ts`
- Modify: `scripts/register-whatsapp-templates.mjs`
- Test: `__tests__/lib/matching-dispatch.test.ts`
- Test: `__tests__/lib/whatsapp-send-raw-url-guard.test.ts`

- [ ] Write failing tests proving AUTO_ASSIGN dispatch uses `quick_match_provider_lead_offer` while Review Providers/selected-provider copy can keep `provider_lead_offer`.
- [ ] Add `quick_match_provider_lead_offer` template metadata with copy: `Hi {{1}}, a new {{2}} lead is available in {{3}}. Preferred time: {{4}}. Tap the button below to view the lead and respond.`
- [ ] Extend `sendJobOffer()` to accept an optional `templateName` constrained to provider lead offer templates.
- [ ] Update Quick Match dispatch to pass `quick_match_provider_lead_offer`.
- [ ] Add the template to the registration script with the same URL CTA button label `View lead`.
- [ ] Re-run dispatch/raw URL tests and confirm they pass.

### Task 4: 30-Minute Customer Progress Updates

**Files:**
- Modify: `lib/matching/service.ts`
- Modify: `app/api/cron/match-leads/route.ts`
- Test: `__tests__/lib/matching-expiry.test.ts`

- [ ] Write failing tests for a helper that sends a Quick Match progress update only when the last progress update is older than 30 minutes.
- [ ] Implement `sendQuickMatchProgressUpdates()` to find active `MATCHING` + `AUTO_ASSIGN` requests with active holds and no recent `interactive:quick_match_progress_update` `MessageEvent`.
- [ ] Add a cron step to call the helper and include a `progressUpdates` count in cron results.
- [ ] Re-run focused tests and then run lint/build.

### Task 5: Commit and OpenBrain

**Files:**
- Modify only files changed by the tasks above.

- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Stage only Quick Match files.
- [ ] Commit with a message describing the Quick Match rotation fix.
- [ ] Push `main`.
- [ ] Add an OpenBrain engineering knowledge entry with root cause, fix, verification, and commit SHA.
